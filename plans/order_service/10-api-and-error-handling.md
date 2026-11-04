---
connie-title: Order Service API and Error Handling
---

Order Service API and Error Handling
====================================

Purpose
-------

This document defines the two API layers for orders and the rules that connect them:

- The **public REST API** served by the API Gateway to clients.
- The **internal gRPC `OrderService`** served by the Order Service and called only by the gateway.

The Order Service has no HTTP server. It owns the order rules, and the gateway owns the HTTP surface. Responses distinguish validation, durable acceptance, Matching Engine acknowledgement, and execution, and they never claim more than the stage reached.

Verified State
--------------

| Item | State | Source |
|---|---|---|
| Gateway orders feature | None. The gateway has `auth`, `kyc`, `iot`, and `websocket` features and no Order Service gRPC client. | `api-gateway/src/features` |
| Gateway conventions | Routes under `/api/v1/...`, TypeBox schemas that reject unknown fields, camelCase JSON, `auth: 'required'` and a rate-limit preset per route, Connect gRPC clients, per-service deadlines. | `features/iot/routes.ts`, `transport/grpc` |
| Identity forwarding | `x-gridx-user-id`, `x-request-id`, `x-correlation-id`, `traceparent`. | `transport/grpc/metadata.ts` |
| Error mapping | `FAILED_PRECONDITION` becomes 400, `ABORTED` 409, `UNAVAILABLE` 503, `DEADLINE_EXCEEDED` 504. Only 4xx messages are forwarded, and `ErrorInfo.reason` is dropped. | `errors/grpc-to-http.ts` |
| Idempotency | CORS already allows the `Idempotency-Key` header. No handling exists. | `plugins/cors.ts` |
| CORS exposed headers | `X-Request-Id`, `Retry-After`. | `plugins/cors.ts` |
| Existing contract | `api-contracts.md` §4.3 describes REST endpoints that no longer match (see the last section). | `api-contracts.md` |

Responsibilities
----------------

| Concern | Gateway | Order Service |
|---|---|---|
| TLS, cookies, CSRF, CORS, rate limits | Yes | No |
| Authentication of the access token | Yes | No |
| JSON shape, unknown fields, enum membership, ISO format, pagination bounds | Yes | Re-checks enum and required values |
| `Idempotency-Key` header presence and format | Yes | Authoritative |
| Permission, ownership, business rules, IoT, allocation, idempotency | No | Yes |
| Mapping gRPC status to HTTP, the public error envelope | Yes | No |
| Stable error reason codes, retryability | Forwards | Defines |

The gateway must **not** duplicate business limits (price band, quantity step, slot horizon). Those are configurable in the Order Service, and a copy in the gateway would drift.

Public REST API
---------------

### Conventions

- Base path `/api/v1/orders`. All routes require authentication (`auth: 'required'`).
- JSON bodies are camelCase and strictly validated. An unknown field is a validation error.
- Order IDs are decimal strings (they are `uint64` internally).
- Timestamps are ISO 8601 UTC with `Z`.
- Units are the platform's canonical integers: `quantityWh` is watt-hours, and `pricePerKwh` is **micro-AED per kWh** (1 AED = 1,000,000 micro-AED). Clients convert for display.
- Writes use a dedicated `orders-write` rate-limit preset and reads an `orders-read` preset. Initial limits are 30 writes and 120 reads per minute per user, to be confirmed by product.
- Request bodies are limited to 4 KB.

### Endpoints

| Method and path | Purpose | Success |
|---|---|---|
| `POST /api/v1/orders` | Create an order | `202 Accepted` |
| `GET /api/v1/orders` | List the caller's orders | `200 OK` |
| `GET /api/v1/orders/:orderId` | Get one order | `200 OK` |
| `DELETE /api/v1/orders/:orderId` | Request cancellation | `202 Accepted` |

### Create order

Headers: `Authorization` (or the cookie), `Idempotency-Key` (required), `Content-Type: application/json`.

```json
{
  "side": "SELL",
  "orderType": "LIMIT",
  "pricePerKwh": 460000,
  "quantityWh": 2000,
  "deliverySlotStart": "2026-11-03T10:00:00Z"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `side` | string | Yes | `BUY` or `SELL` |
| `orderType` | string | Yes | `LIMIT`, or `MARKET` when enabled |
| `pricePerKwh` | integer | LIMIT: yes. MARKET: optional | Limit price, or the MARKET protection price. Micro-AED per kWh, a multiple of the price tick. |
| `quantityWh` | integer | Yes | Watt-hours, a multiple of the quantity step |
| `deliverySlotStart` | string | Yes | Start of a 30-minute slot aligned to `:00` or `:30` UTC |
| `deliverySlotEnd` | string | No | If supplied it must equal the start plus 30 minutes |

`gridZone`, `userId`, `expiresAt`, and `status` are never accepted from the client.

**Response `202 Accepted`** (headers `Location: /api/v1/orders/4821`, `X-Request-Id`):

```json
{
  "order": {
    "orderId": "4821",
    "side": "SELL",
    "orderType": "LIMIT",
    "pricePerKwh": 460000,
    "priceDefaulted": false,
    "quantityWh": 2000,
    "remainingQuantityWh": 2000,
    "filledQuantityWh": 0,
    "status": "PENDING",
    "statusReason": null,
    "gridZoneId": 1,
    "deliverySlotStart": "2026-11-03T10:00:00Z",
    "deliverySlotEnd": "2026-11-03T10:30:00Z",
    "expiresAt": "2026-11-03T10:30:00Z",
    "createdAt": "2026-11-03T09:41:07Z",
    "updatedAt": "2026-11-03T09:41:07Z"
  }
}
```

The status `PENDING` means the order was validated and durably recorded. It does not mean the Matching Engine accepted it and it does not mean any trade happened. The client learns the later states from `GET /api/v1/orders/:orderId` or the real-time channel.

An idempotent replay returns `200 OK` with the order's current state and the header `Idempotency-Replayed: true`.

### List orders

`GET /api/v1/orders?status=OPEN&side=SELL&limit=20&cursor=...`

| Parameter | Notes |
|---|---|
| `status` | Optional. One of the eight statuses. |
| `side` | Optional. `BUY` or `SELL`. |
| `limit` | Optional. Default 20, maximum 100. |
| `cursor` | Optional. Opaque value from the previous page. |

```json
{ "orders": [ { "...": "order object" } ], "nextCursor": "4790" }
```

Orders are returned newest first (by order ID). `nextCursor` is `null` on the last page. There is no total count and no offset, because they are expensive and unstable while orders are being created. Offset pagination from the old contract is removed.

### Get order

`GET /api/v1/orders/:orderId` returns `{ "order": { ... } }`, or `404 ORDER_NOT_FOUND` if the order does not exist **or belongs to someone else**.

### Cancel order

`DELETE /api/v1/orders/:orderId` returns `202 Accepted` and the order with status `CANCEL_PENDING`:

```json
{ "order": { "orderId": "4821", "status": "CANCEL_PENDING", "...": "..." } }
```

The response means the cancellation was durably requested. It does not mean the order is cancelled and does not mean no fill occurred. The old response `{ status: "CANCELLED", cancelledAt }` is removed. Repeating the request while the order is `CANCEL_PENDING` returns the same `202`. A terminal order returns `409 ORDER_NOT_CANCELLABLE`.

### Order status values

`PENDING`, `OPEN`, `PARTIALLY_FILLED`, `CANCEL_PENDING`, `FILLED`, `CANCELLED`, `EXPIRED`, `REJECTED`. `statusReason` explains a terminal status (for example `NO_LIQUIDITY`, `IOC_REMAINDER`, `USER_REQUEST`, `SLOT_ENDED`, `ORDER_EXPIRED`) and is `null` otherwise.

Idempotency
-----------

- `Idempotency-Key` is **required** on `POST /api/v1/orders`: 8 to 64 characters from `[A-Za-z0-9_-]`. A UUIDv4 is recommended. A missing or malformed key returns `400 IDEMPOTENCY_KEY_REQUIRED`.
- The gateway checks the format and forwards the value in the gRPC field `idempotency_key`. The Order Service is the authority.
- The scope is per user. The same key with the same request returns the existing order (`200`, `Idempotency-Replayed: true`). The same key with a different request returns `409 IDEMPOTENCY_CONFLICT`.
- The key stays bound to its order for the order's lifetime, so there is no key expiry.
- A request that failed validation stores nothing, so it can be retried with the same key after being corrected.
- The gateway adds `Idempotency-Replayed` and `Location` to the CORS exposed headers.
- `DELETE` needs no key. It is idempotent by order ID.

**After a timeout or lost response**, the client does not know whether the order was created. It retries `POST` with the **same** key and body. That is always safe and returns either the original order or an error, never a second order.

Error Handling
--------------

### Envelope

The gateway's existing envelope is kept, with one additive field:

```json
{
  "error": {
    "code": "ENERGY_INSUFFICIENT",
    "message": "Requested quantity exceeds the energy available for this slot.",
    "requestId": "7c1f...",
    "retryable": false,
    "details": {}
  }
}
```

- `code` is the Order Service's stable reason code when one exists (otherwise the gateway's generic code, such as `VALIDATION_ERROR`). Clients branch on `code`, never on `message`.
- `retryable` comes from the Order Service. A retry is only safe for a `POST` when it reuses the same `Idempotency-Key`.
- `details` carries field-level violations for schema errors.
- Only 4xx messages are shown. 5xx responses carry a generic message and the `requestId`.

### Status code mapping

| Result | HTTP | `error.code` |
|---|---|---|
| Malformed JSON, unknown field, bad enum, bad ISO date, bad pagination | 400 | `VALIDATION_ERROR` |
| Missing or malformed `Idempotency-Key` | 400 | `IDEMPOTENCY_KEY_REQUIRED` |
| Business rule failure (any code below marked 400) | 400 | the reason code |
| Not authenticated | 401 | `UNAUTHENTICATED` |
| Authenticated but not allowed to trade | 403 | `TRADING_NOT_PERMITTED` |
| Order missing or not owned | 404 | `ORDER_NOT_FOUND` |
| Idempotency conflict, order not cancellable, allocation conflict | 409 | the reason code |
| Rate limit exceeded | 429 | `RATE_LIMITED` |
| Order Service, IoT, Auth, or Billing unavailable | 503 | the reason code, or `UPSTREAM_UNAVAILABLE` |
| Deadline exceeded | 504 | `UPSTREAM_TIMEOUT` |
| Unexpected failure | 500 | `INTERNAL_ERROR` |

Business failures use 400 with a distinct `code`. The gateway already maps `FAILED_PRECONDITION` to 400 for the other features, and changing that globally would affect them.

### Order reason codes

| Reason code | gRPC status | HTTP | Retryable |
|---|---|---|---|
| `INVALID_ORDER` | `INVALID_ARGUMENT` | 400 | No |
| `IDEMPOTENCY_KEY_REQUIRED` | `INVALID_ARGUMENT` | 400 | No |
| `TRADING_NOT_PERMITTED` | `PERMISSION_DENIED` | 403 | No |
| `ORDER_NOT_FOUND` | `NOT_FOUND` | 404 | No |
| `IDEMPOTENCY_CONFLICT` | `ABORTED` | 409 | No |
| `ORDER_NOT_CANCELLABLE` | `ABORTED` | 409 | No |
| `ENERGY_ALLOCATION_CONFLICT` | `ABORTED` | 409 | Yes |
| `ORDER_TYPE_NOT_SUPPORTED` | `FAILED_PRECONDITION` | 400 | No |
| `BUY_ORDERS_NOT_ENABLED` | `FAILED_PRECONDITION` | 400 | No |
| `QUANTITY_OUT_OF_RANGE`, `QUANTITY_PRECISION_INVALID` | `FAILED_PRECONDITION` | 400 | No |
| `PRICE_OUT_OF_RANGE`, `PRICE_PRECISION_INVALID` | `FAILED_PRECONDITION` | 400 | No |
| `SLOT_INVALID`, `ORDER_SLOT_EXPIRED`, `SLOT_TOO_FAR` | `FAILED_PRECONDITION` | 400 | No |
| `METER_NOT_REGISTERED`, `HOUSE_AMBIGUOUS`, `GRID_ZONE_UNMAPPED` | `FAILED_PRECONDITION` | 400 | No |
| `METER_OFFLINE`, `READING_STALE` | `FAILED_PRECONDITION` | 400 | Yes |
| `ENERGY_INSUFFICIENT` | `FAILED_PRECONDITION` | 400 | No |
| `INSUFFICIENT_FUNDS`, `WALLET_FROZEN` | `FAILED_PRECONDITION` | 400 | No |
| `IOT_UNAVAILABLE`, `AUTH_UNAVAILABLE`, `BILLING_UNAVAILABLE`, `ORDER_CREATION_DISABLED` | `UNAVAILABLE` | 503 | Yes |
| `INTERNAL_ERROR` | `INTERNAL` | 500 | Yes |

### Dependency failures

| Dependency | When it fails during `CreateOrder` | Outcome |
|---|---|---|
| IoT (SELL, and grid lookup for BUY) | Unavailable or slow | `503 IOT_UNAVAILABLE`, nothing stored |
| Auth permission check | Unavailable | `503 AUTH_UNAVAILABLE`, nothing stored |
| Billing reservation (BUY, when required) | Unavailable or unknown outcome | `503 BILLING_UNAVAILABLE`, nothing stored. A retry with the same key reuses the same hold. |
| PostgreSQL | Unavailable | `503 UPSTREAM_UNAVAILABLE`, nothing stored |
| Kafka | Unavailable | **Not an error.** The order is durable, the outbox retries, and the response stays `202`. |
| Matching Engine | Down or slow | **Not an error.** The order stays `PENDING`. |

A failure after the creation transaction commits is never reported as a failed creation. The gateway does not retry `POST` automatically. The client retries with the same key.

Internal gRPC Contract
----------------------

Defined in the `protobuf` repository as `proto/gridx/order/v1/order_service.proto`, in package `gridx.order.v1`.

```proto
syntax = "proto3";

package gridx.order.v1;

import "google/protobuf/timestamp.proto";
import "gridx/order/v1/order_events.proto";   // Side, OrderType

service OrderService {
  rpc CreateOrder(CreateOrderRequest) returns (CreateOrderResponse);
  rpc GetOrder(GetOrderRequest) returns (GetOrderResponse);
  rpc ListOrders(ListOrdersRequest) returns (ListOrdersResponse);
  rpc CancelOrder(CancelOrderRequest) returns (CancelOrderResponse);
}

// Includes the two local states the Matching Engine never reports.
enum OrderLifecycleStatus {
  ORDER_LIFECYCLE_STATUS_UNSPECIFIED = 0;
  ORDER_LIFECYCLE_STATUS_PENDING = 1;
  ORDER_LIFECYCLE_STATUS_OPEN = 2;
  ORDER_LIFECYCLE_STATUS_PARTIALLY_FILLED = 3;
  ORDER_LIFECYCLE_STATUS_CANCEL_PENDING = 4;
  ORDER_LIFECYCLE_STATUS_FILLED = 5;
  ORDER_LIFECYCLE_STATUS_CANCELLED = 6;
  ORDER_LIFECYCLE_STATUS_EXPIRED = 7;
  ORDER_LIFECYCLE_STATUS_REJECTED = 8;
}

message Order {
  uint64 order_id = 1;
  Side side = 2;
  OrderType order_type = 3;
  int64 price = 4;                    // micro-AED per kWh, effective price
  bool price_defaulted = 5;
  int64 quantity_wh = 6;
  int64 remaining_quantity_wh = 7;
  int64 filled_quantity_wh = 8;
  OrderLifecycleStatus status = 9;
  string status_reason = 10;          // empty if none
  uint32 grid_zone_id = 11;
  google.protobuf.Timestamp delivery_slot_start = 12;
  google.protobuf.Timestamp delivery_slot_end = 13;
  google.protobuf.Timestamp expires_at = 14;
  google.protobuf.Timestamp created_at = 15;
  google.protobuf.Timestamp updated_at = 16;
}

message CreateOrderRequest {
  string owner_user_id = 1;           // UUID, set by the gateway from the token. Required.
  Side side = 2;
  OrderType order_type = 3;
  optional int64 price = 4;           // required for LIMIT, optional protection price for MARKET
  int64 quantity_wh = 5;
  google.protobuf.Timestamp delivery_slot_start = 6;
  optional google.protobuf.Timestamp delivery_slot_end = 7;
  string idempotency_key = 8;
}

message CreateOrderResponse {
  Order order = 1;
  bool replayed = 2;                  // true for an idempotent replay
}

message GetOrderRequest {
  string owner_user_id = 1;
  uint64 order_id = 2;
}
message GetOrderResponse { Order order = 1; }

message ListOrdersRequest {
  string owner_user_id = 1;
  optional OrderLifecycleStatus status = 2;
  optional Side side = 3;
  int32 page_size = 4;                // 1 to 100, default 20
  string page_token = 5;
}
message ListOrdersResponse {
  repeated Order orders = 1;
  string next_page_token = 2;         // empty on the last page
}

message CancelOrderRequest {
  string owner_user_id = 1;
  uint64 order_id = 2;
}
message CancelOrderResponse { Order order = 1; }
```

- `owner_user_id` is mandatory and must equal the `x-gridx-user-id` metadata. The Order Service never takes identity from anywhere else.
- Errors use the `google.rpc.Status` model with `ErrorInfo` (`reason`, domain `order.gridx`, metadata `retryable`) and, for `INVALID_ORDER`, `BadRequest` field violations.
- The status message is safe to show to a client for 4xx results and contains no internal detail.
- `status_reason` and `filled_quantity_wh` come from the Order Service, so the gateway never derives order state.

### Deadlines

| RPC | Gateway deadline |
|---|---|
| `CreateOrder` | 5 s (IoT 2 s, Auth 1 s, Billing 1 s, database) |
| `CancelOrder`, `GetOrder`, `ListOrders` | 3 s |

Gateway Work
------------

| Item | Change |
|---|---|
| Feature | New `features/orders` with `routes.ts`, `handler.ts`, `schemas.ts`, `mapper.ts`, following the IoT feature |
| gRPC client | A Connect client for `OrderService` in the gRPC transport layer, with the deadlines above, using the generated SDK |
| Schemas | TypeBox strict schemas for the four routes and their responses |
| Error mapping | Forward `ErrorInfo.reason` as `error.code`, `ErrorInfo.metadata.retryable` as `error.retryable`, and `BadRequest` violations in `error.details` |
| Idempotency | Validate and forward `Idempotency-Key`. Set `Idempotency-Replayed` and `Location` |
| CORS | Add `Idempotency-Replayed` and `Location` to `exposedHeaders` |
| Rate limits | Add `orders-write` and `orders-read` presets |
| Metadata | Forward the existing identity, request, and trace headers |

Security
--------

- Every route requires authentication. Ownership is enforced in the Order Service, and a non-owner always sees `404`.
- Permission is `trade:create`, checked by the Order Service through Auth. There is no administrative bypass in v1.
- Order, house, meter, and token data are not logged in full. The idempotency key is logged only as a hash.
- Cookie-authenticated writes are protected by the gateway's existing Origin check.
- The Order Service port accepts connections only from the gateway and trusted internal services, enforced at the network level.

Observability
-------------

| Signal | Name |
|---|---|
| Order Service RPCs | `order_grpc_requests_total{rpc,code,reason}`, `order_grpc_request_duration_seconds{rpc}` |
| Idempotent replays | `order_idempotent_replays_total` |
| Idempotency conflicts | `order_idempotency_conflicts_total` |
| Gateway | Standard request metrics per route, plus counts by `error.code` |

Every log line and trace carries `x-request-id`, and the Order Service adds the order ID once known.

Required Tests
--------------

- **Gateway:** each route's schema (unknown field, bad enum, bad date, bad pagination), the `Idempotency-Key` rules, the mapping of every reason code to its HTTP status and `error.code`, `retryable` forwarding, the replay `200` and its headers, and cursor pagination.
- **Order Service:** handler tests for every gRPC status and reason, `owner_user_id` and metadata mismatch, ownership for each RPC, and a replay, a conflict, and a cancel in each stored status.
- **Contract:** round trips of `order_service.proto` with the generated SDK, and a gateway test against a fake `OrderService`.
- **End to end:** create, replay, list with a cursor, cancel, and each dependency failure through the real gateway.

Decisions and Dependencies
--------------------------

### Resolved decisions

| ID | Open item | Decision |
|---|---|---|
| A-1 | Route prefix and paths | `/api/v1/orders` with the four endpoints above, matching the gateway's `/api/v1` convention. |
| A-2 | Authentication and authorization | Authenticated, `trade:create` checked by the Order Service, ownership enforced there, no admin bypass. |
| A-3 | Request and response schemas and units | Strict camelCase JSON with `quantityWh` and `pricePerKwh` in micro-AED. Order IDs are strings. |
| A-4 | Asynchronous creation | `202 Accepted` with status `PENDING`. |
| A-5 | Idempotency | Required `Idempotency-Key` header mapped to a request field, per-user scope, replay `200`, conflict `409`. |
| A-6 | Pagination | `limit` and an opaque `cursor`, newest first, `nextCursor`, no total or offset. |
| A-7 | Cancellation | `202 Accepted` with status `CANCEL_PENDING`. |
| A-8 | Status codes | The tables above, with business failures as 400 and a distinct `error.code`. |
| A-9 | Error envelope and codes | The gateway envelope plus `retryable`, with `code` taken from `ErrorInfo.reason`. |
| A-10 | Dependency failures | Fail closed for IoT, Auth, Billing, and PostgreSQL. Kafka and the engine never fail creation. |
| A-11 | Order Service interface | gRPC `OrderService`, defined in `order_service.proto`. |

### Remaining items needing sign-off

| ID | Item | Owner |
|---|---|---|
| A-O1 | Build the orders feature, error forwarding, CORS exposure, rate-limit presets, and deadlines listed in Gateway Work. | API Gateway |
| A-O2 | Add `order_service.proto` to `protobuf` and release a `go-sdk` and gateway SDK version. | protobuf maintainers |
| A-O3 | Seed the `trade:create` permission for the trading roles. | Auth |
| A-O4 | Confirm that `pricePerKwh` is exposed in micro-AED and that clients convert for display. | Frontend, product |
| A-O5 | Confirm the rate limits (30 writes and 120 reads per minute). | Product |
| A-O6 | Replace `api-contracts.md` §4.3 and the order sections of §5 and §6 with this document. | Docs |

Record confirmed decisions in the shared contracts and the OpenAPI documentation before describing them as existing behaviour.
