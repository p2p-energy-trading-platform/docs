---
connie-title: Order Service API and Error Handling
---

Order Service API and Error Handling
====================================

Purpose
-------

The API Gateway serves HTTP to clients. The Order Service serves gRPC `OrderService` to the gateway only. The service has no HTTP server.

The gateway has no orders feature yet. These are the routes and the gRPC messages it will call. Identity metadata is the same pattern IoT uses: `x-gridx-user-id`, `x-request-id`, `x-correlation-id`, and `traceparent`.

Responsibilities
----------------

| Concern | Gateway | Order Service |
|---|---|---|
| TLS, cookies, CORS, rate limits | Yes | No |
| Access token | Yes | No |
| JSON shape and unknown fields | Yes | Re-checks enums and required values |
| `Idempotency-Key` present and well formed | Yes | Authoritative record |
| Permission, ownership, IoT, allocation, idempotency | No | Yes |
| HTTP status and the public error body | Yes | No |
| `ErrorInfo.reason` | Forwards it | Defines it |

The gateway does not copy the price band, the quantity step, or the slot horizon.

Public HTTP
-----------

Base path `/api/v1/orders`. Every route requires authentication.

- Order ids are decimal strings.
- Timestamps are ISO 8601 UTC with `Z`.
- `quantityWh` is watt-hours.
- `pricePerKwh` is minor units of LKR per kWh. 4500 is 45.00 LKR/kWh. The client converts for display.
- Writes use a limit of 30 requests per minute per user. Reads use 120. Bodies are at most 4 KB.

| Method and path | Success |
|---|---|
| `POST /api/v1/orders` | `202 Accepted` |
| `GET /api/v1/orders` | `200 OK` |
| `GET /api/v1/orders/:orderId` | `200 OK` |
| `DELETE /api/v1/orders/:orderId` | `202 Accepted` |

Create requires `Idempotency-Key`.

```json
{
  "side": "SELL",
  "orderType": "LIMIT",
  "pricePerKwh": 4500,
  "quantityWh": 2000,
  "deliverySlotStart": "2026-11-03T10:00:00Z"
}
```

| Field | Required | Rule |
|---|---|---|
| `side` | Yes | `BUY` or `SELL` |
| `orderType` | Yes | `LIMIT` or `MARKET` |
| `pricePerKwh` | Yes | LIMIT price or MARKET protection price. Integer minor units, inside the band. |
| `quantityWh` | Yes | Watt-hours, multiple of 100, from 100 to 20000 |
| `deliverySlotStart` | Yes | `:00` or `:30` UTC |
| `deliverySlotEnd` | No | If present, start plus 30 minutes |

`gridId`, `userId`, `expiresAt`, and `status` are not accepted from the client.

`202` response, with `Location: /api/v1/orders/4821`:

```json
{
  "order": {
    "orderId": "4821",
    "side": "SELL",
    "orderType": "LIMIT",
    "pricePerKwh": 4500,
    "quantityWh": 2000,
    "remainingQuantityWh": 2000,
    "filledQuantityWh": 0,
    "status": "PENDING",
    "statusReason": null,
    "gridId": "grid-a",
    "deliverySlotStart": "2026-11-03T10:00:00Z",
    "deliverySlotEnd": "2026-11-03T10:30:00Z",
    "expiresAt": "2026-11-03T10:30:00Z",
    "createdAt": "2026-11-03T09:41:07Z",
    "updatedAt": "2026-11-03T09:41:07Z"
  }
}
```

`PENDING` means the order was stored. It does not mean the engine accepted it. A replay is `200` with `Idempotency-Replayed: true` and the order's current state.

A MARKET create uses `"orderType": "MARKET"` and a required `pricePerKwh`. Its `expiresAt` is 30 seconds after creation, or the slot end when that is sooner. It will not appear as `OPEN`.

List accepts `pageSize` (default 20, maximum 100) and `pageToken`. The token is the last `orderId` the caller saw. Results are that user's orders, newest first. `Get` of another user's order is `404`.

`DELETE` returns the order in `CANCEL_PENDING`. A repeated delete of the same non-terminal order returns the current row and does not append a second command.

| gRPC result | HTTP |
|---|---|
| Create `OK`, not a replay | `202` |
| Create `OK`, replay | `200` and `Idempotency-Replayed: true` |
| Cancel `OK` | `202` |
| `INVALID_ARGUMENT`, `FAILED_PRECONDITION` | `400` |
| `UNAUTHENTICATED` | `401` |
| `PERMISSION_DENIED` | `403` |
| `NOT_FOUND` | `404` |
| `ABORTED` | `409` |
| `UNAVAILABLE` | `503` |
| `DEADLINE_EXCEEDED` | `504` |
| `INTERNAL` | `500` |

The public error body includes the stable reason from `google.rpc.ErrorInfo.reason`, so a client can tell `ENERGY_INSUFFICIENT` from `READING_STALE`. The reason list is in the validation document. `Retry-After` is set on `503` and `504`.

gRPC `OrderService`
-------------------

Package `gridx.order.v1`. The file `order_service.proto` does not exist yet. Add it in the protobuf repository. The service does not generate its own stubs. It uses `go-sdk`.

```proto
service OrderService {
  rpc CreateOrder(CreateOrderRequest) returns (CreateOrderResponse);
  rpc GetOrder(GetOrderRequest) returns (GetOrderResponse);
  rpc ListOrders(ListOrdersRequest) returns (ListOrdersResponse);
  rpc CancelOrder(CancelOrderRequest) returns (CancelOrderResponse);
}

message CreateOrderRequest {
  string idempotency_key = 1;
  Side side = 2;
  OrderType order_type = 3;
  int64 price_per_kwh = 4;          // LKR minor units per kWh
  int64 quantity_wh = 5;
  google.protobuf.Timestamp delivery_slot_start = 6;
  google.protobuf.Timestamp delivery_slot_end = 7; // optional
}

message Order {
  string order_id = 1;
  Side side = 2;
  OrderType order_type = 3;
  int64 price_per_kwh = 4;
  int64 quantity_wh = 5;
  int64 remaining_quantity_wh = 6;
  int64 filled_quantity_wh = 7;
  string status = 8;                // the eight local statuses, including PENDING
  string status_reason = 9;
  string grid_id = 10;
  google.protobuf.Timestamp delivery_slot_start = 11;
  google.protobuf.Timestamp delivery_slot_end = 12;
  google.protobuf.Timestamp expires_at = 13;
  google.protobuf.Timestamp created_at = 14;
  google.protobuf.Timestamp updated_at = 15;
}

message CreateOrderResponse {
  Order order = 1;
  bool replayed = 2;
}
```

`GetOrder`, `ListOrders`, and `CancelOrder` take `order_id` as a decimal string. The user id comes from metadata, not from the body. The gateway's deadline for these calls is 5 seconds, which covers the 2 second IoT budget.

Real-time updates, if the gateway already has a socket for the user, are a projection of the same order row. They are not a second source of status. This service does not open that socket.
