---
connie-title: Order Service Validation
---

Order Validation and Lifecycle
==============================

Purpose
-------

The Order Service validates order requests, stores them, and submits them to the Matching Engine. It does not match orders.

It has no HTTP server. The API Gateway is the only caller of its gRPC `OrderService`. The Matching Engine is reached only through Kafka.

A persisted order is not yet accepted by the engine. An accepted order is not yet a trade.

| Stage | Where it happens | Client sees |
|---|---|---|
| Validation | Order Service, before any write | gRPC error, nothing stored |
| Persistence | PostgreSQL transaction | `OK`, status `PENDING` |
| Publication | Outbox | still `PENDING` |
| Engine acknowledgement | `OrderUpdated` on `order.state` | `OPEN`, `FILLED`, `CANCELLED`, or `REJECTED` |
| Later execution | further `OrderUpdated` events | `PARTIALLY_FILLED`, `FILLED`, `CANCELLED`, `EXPIRED` |

Units
-----

| Concept | Representation |
|---|---|
| Energy | `int64` watt-hours. 1 kWh = 1000 Wh. |
| Price | `int64` minor units of LKR per kWh. 1 LKR = 100. A price of 4500 is 45.00 LKR/kWh. |
| Price tick | 1 minor unit. |
| Time | UTC. `TIMESTAMPTZ` in PostgreSQL, `google.protobuf.Timestamp` on the wire. |
| Order id | `BIGINT` identity, shown to clients as a decimal string. |
| User id | Auth UUID string. The same value is stored and sent to the engine. |
| Grid | IoT `Grid.grid_id` string. This is the zone. |

No floating point is used for quantity or price. `rated_solar_kw` is a `double` from IoT and is converted once, at the capacity boundary, to integer watt-hours.

This service does not compute trade value or wallet amounts. When billing is connected later, it uses `OrderBillingService` in `protobuf/proto/gridx/billing/v1/order_billing.proto`. Prices stored here are already the minor units that message expects in `max_price_per_kwh` and `price_per_kwh`.

The current `OrderAccepted.remaining_quantity` field is a `double`, and `user_id` and `grid_zone_id` are integers. Those fields change. The target shape is in [proposed engine changes](../matching-engine/proposed-engine-changes.md). Until that protobuf change is released, the order service is built against the updated contract described there, not against the integer user id or the numeric zone.

Fixed configuration
-------------------

| Setting | Value |
|---|---|
| Quantity step | 100 Wh |
| Quantity min / max | 100 Wh / 20000 Wh |
| Price min / max | 100 / 100000 minor units per kWh (1.00 to 1000.00 LKR) |
| Slot booking horizon | 24 h |
| IoT reading max age | 60 s |
| IoT deadline | 1 s per call, 2 s for the order |
| Auth `CheckPermission` deadline | 1 s, cached 60 s |
| `PENDING` or `CANCEL_PENDING` age alert | 30 s |
| MARKET lifetime | 30 s, and never past the slot end |

Order record
------------

| Field | Type | Rule |
|---|---|---|
| `order_id` | `BIGINT` identity | Primary key. |
| `user_id` | UUID | From the gateway principal. Never from the order body. |
| `house_id`, `meter_id`, `grid_id` | text | From `ListHouses`. `grid_id` is the zone sent to the engine. |
| `side` | `BUY` or `SELL` | |
| `order_type` | `LIMIT` or `MARKET` | Both are accepted. |
| `price` | `BIGINT` | LIMIT price, or the MARKET protection price. Multiple of the tick, inside the band. |
| `quantity_wh` | `BIGINT` | Positive multiple of the step, inside the range. |
| `remaining_quantity_wh` | `BIGINT` | From `OrderUpdated`. Between 0 and `quantity_wh`. |
| `delivery_slot_start` / `delivery_slot_end` | `TIMESTAMPTZ` | Start on `:00` or `:30`. End is exactly 30 minutes later. |
| `expires_at` | `TIMESTAMPTZ` | LIMIT: slot end. MARKET: `min(created_at + 30 s, slot end)`. Not client-set. |
| `status` | enum | Eight values below. |
| `status_reason` | text, nullable | Engine reason, for example `NO_LIQUIDITY`. |
| `version` | `BIGINT` | This service's row version. |
| `me_seq` | `BIGINT` | Highest `order_seq` applied. `0` until the first engine event. |
| `needs_reconciliation` | boolean | Set when an event cannot be applied. |
| `idempotency_key` | text | Unique with `user_id`. |
| `request_fingerprint` | `BYTEA` | SHA-256 of the canonical request. |

Table DDL is in the persistence document. There is no numeric trader id and no zone map.

Validation
----------

Checks run in this order. A failure returns an error and writes nothing.

1. **Identity.** `owner_user_id` is the UUID the gateway put on the call from the access token. It must be present.
2. **Permission.** `AuthService.CheckPermission(user_id, "trade:create")` in `protobuf/proto/gridx/auth/v1/auth.proto`. Cache the allow result for 60 s. If Auth cannot be reached, fail with `AUTH_UNAVAILABLE`. View and cancel require ownership. A non-owner gets `NOT_FOUND`.
3. **Shape.** `UNSPECIFIED` enums are rejected. `idempotency_key` is required.
4. **Type.** `order_type` is `LIMIT` or `MARKET`. Anything else is `ORDER_TYPE_NOT_SUPPORTED`.
5. **Quantity.** A positive multiple of 100 Wh, from 100 to 20000. Otherwise `QUANTITY_PRECISION_INVALID` or `QUANTITY_OUT_OF_RANGE`.
6. **Price.** Required for both types. A positive multiple of 1 minor unit, from 100 to 100000. LIMIT: this is the resting price. MARKET: this is the protection price, the worst price the user accepts. A missing price is `INVALID_ORDER`.
7. **Slot.** Start aligned to `:00` or `:30` UTC, end exactly 30 minutes later (`SLOT_INVALID`). `now < delivery_slot_start` (`ORDER_SLOT_EXPIRED`). Start no later than now plus 24 h (`SLOT_TOO_FAR`).
8. **Idempotency.** Look up `(user_id, idempotency_key)` before calling IoT. Same fingerprint returns the existing order. A different fingerprint is `IDEMPOTENCY_CONFLICT`.
9. **House.** `IotService.ListHouses` with the caller's UUID. No house is `METER_NOT_REGISTERED`. More than one house is `HOUSE_AMBIGUOUS`. The order's `grid_id` is `House.grid.grid_id`. An empty grid id is `INVALID_ORDER`.
10. **SELL energy.** Meter, reading, and capacity, in the IoT energy document.
11. **Create.** One transaction re-checks the idempotency key and the energy allocation.

SELL energy is specified in [IoT Energy Validation](03-iot-energy-validation.md). BUY and SELL both call `ListHouses` so the order has a grid. Only SELL calls `GetLatestReading`.

Idempotency
-----------

- `CreateOrderRequest.idempotency_key`, 8 to 64 characters from `[A-Za-z0-9_-]`. The gateway copies the `Idempotency-Key` header into this field.
- Unique on `(user_id, idempotency_key)`.
- Fingerprint is SHA-256 of `side`, `order_type`, `price`, `quantity_wh`, and `delivery_slot_start`.
- Same key and fingerprint: `OK`, current state, `replayed = true`. No second order and no second allocation.
- Same key, different fingerprint: `ABORTED` / `IDEMPOTENCY_CONFLICT`.
- Concurrent inserts use `ON CONFLICT DO NOTHING`. The loser rolls back and then replays or conflicts.
- A rejected request is not stored.
- Cancel is idempotent by `order_id` and needs no key.

Order states
------------

| Status | Engine `OrderStatus` | Meaning | Terminal |
|---|---|---|---|
| `PENDING` | none, local | Stored, not yet acknowledged | No |
| `OPEN` | `ORDER_STATUS_NEW` | Acknowledged, resting, nothing filled | No |
| `PARTIALLY_FILLED` | `ORDER_STATUS_PARTIALLY_FILLED` | Resting, some quantity filled | No |
| `CANCEL_PENDING` | none, local | Cancel requested, outcome unknown | No |
| `FILLED` | `ORDER_STATUS_FILLED` | Remaining quantity is 0 | Yes |
| `CANCELLED` | `ORDER_STATUS_CANCELLED` | Cancelled. Earlier fills stay filled. | Yes |
| `EXPIRED` | `ORDER_STATUS_EXPIRED` | Slot or MARKET lifetime ended with quantity left | Yes |
| `REJECTED` | `ORDER_STATUS_REJECTED` | Engine refused the command | Yes |

`OPEN` is this service's name for proto `ORDER_STATUS_NEW`. `REJECTED` is not in the protobuf enum today. Adding it is part of the engine contract change.

A MARKET order never rests. It never becomes `OPEN` or `PARTIALLY_FILLED`. Its path is `PENDING` to `FILLED`, `CANCELLED`, or `REJECTED`. The user can cancel it only while it is `PENDING`. A MARKET cancel from the engine uses `NO_LIQUIDITY` when nothing matched and `IOC_REMAINDER` when some quantity matched and the rest was cancelled.

| From | To | Trigger |
|---|---|---|
| none | `PENDING` | Creation commits |
| `PENDING` | `OPEN`, `PARTIALLY_FILLED`, `FILLED`, `CANCELLED`, `EXPIRED`, `REJECTED` | `OrderUpdated` with a higher `order_seq` |
| `OPEN`, `PARTIALLY_FILLED` | `PARTIALLY_FILLED`, `FILLED`, `EXPIRED`, `CANCELLED` | `OrderUpdated` |
| `PENDING`, `OPEN`, `PARTIALLY_FILLED` | `CANCEL_PENDING` | `CancelOrder` |
| `CANCEL_PENDING` | `CANCELLED`, `FILLED`, `EXPIRED` | Terminal `OrderUpdated` |
| `CANCEL_PENDING` | stays `CANCEL_PENDING`, quantities change | `OrderUpdated` that is still a partial fill |

`CANCELLED` from `PENDING` is valid only for a MARKET order with reason `IOC_REMAINDER` or `NO_LIQUIDITY`. Every other transition is invalid. A terminal status is not changed by a later event. If that event disagrees with the stored terminal state, the event is quarantined, `needs_reconciliation` is set, and an alert fires. This service does not expire an order because a timer ran out.

Kafka
-----

| Topic | Direction | Payload |
|---|---|---|
| `order.accepted` | this service to the engine | `OrderAccepted` |
| `order.cancel_requested` | this service to the engine | `OrderCancelRequested` |
| `order.state` | engine to this service | `OrderUpdated` |

This service does not consume `trade.executed`. The first `OrderUpdated` is the acknowledgement: `NEW` means accepted and resting, a fill status means it matched on arrival, `CANCELLED` with a MARKET reason means the immediate-or-cancel finished, and `REJECTED` means refused. `remaining_quantity` is the cumulative amount left, never a delta. `order_seq` increases for every event about that order, including an echo. A missing acknowledgement leaves the order `PENDING`. After 30 s an alert fires. The order is not rejected locally.

Applying an update, in one transaction:

1. Insert `event_id` into `processed_events`. A conflict means the event was already applied.
2. Lock the order.
3. Ignore the event when `order_seq` is not newer, except the `UNKNOWN_ORDER` case in the status document.
4. An echo with the same status and remaining quantity updates `me_seq` only.
5. Reject a transition or a quantity that breaks the rules. Quarantine it and set `needs_reconciliation`.
6. Apply status and remaining quantity, append history, and release unused SELL energy on a terminal status.
7. Commit, then commit the Kafka offset.

Cancellation and expiry rules are in [Cancellation and Expiry](08-cancellation-and-expiry.md).

Creation transaction
--------------------

IoT and Auth run before the transaction. The transaction does not stay open across a network call.

1. Insert the order with `ON CONFLICT (user_id, idempotency_key) DO NOTHING`. Zero rows means stop, roll back, and replay or conflict.
2. For a SELL, allocate energy. Zero rows from the conditional update rolls back with `ENERGY_INSUFFICIENT`.
3. Insert history from null to `PENDING`.
4. Insert the `OrderAccepted` outbox row. Its `event_id` is created here and reused on every republish.
5. Commit.

The outbox publisher, dead letters, and `processed_events` retention are in the Kafka document.

API outcomes
------------

| RPC | Purpose |
|---|---|
| `CreateOrder` | Validate, store, and queue |
| `GetOrder` | One order owned by the caller |
| `ListOrders` | The caller's orders |
| `CancelOrder` | Request cancellation |

| Case | gRPC status |
|---|---|
| New order stored | `OK`, `PENDING`, `replayed = false` |
| Replay | `OK`, current status, `replayed = true` |
| Cancel stored | `OK`, `CANCEL_PENDING` |
| Bad request | `INVALID_ARGUMENT` |
| Missing identity | `UNAUTHENTICATED` |
| No permission | `PERMISSION_DENIED` |
| Missing or not owned | `NOT_FOUND` |
| Idempotency conflict, not cancellable, allocation conflict | `ABORTED` |
| Business rule | `FAILED_PRECONDITION` |
| IoT, Auth, or database down | `UNAVAILABLE` |
| Deadline | `DEADLINE_EXCEEDED` |
| Unexpected | `INTERNAL` |

`CreateOrder` success does not mean the engine accepted the order and does not mean a trade happened.

| Reason | gRPC status | Retryable |
|---|---|---|
| `INVALID_ORDER` | `INVALID_ARGUMENT` | No |
| `IDEMPOTENCY_KEY_REQUIRED` | `INVALID_ARGUMENT` | No |
| `TRADING_NOT_PERMITTED` | `PERMISSION_DENIED` | No |
| `ORDER_NOT_FOUND` | `NOT_FOUND` | No |
| `IDEMPOTENCY_CONFLICT` | `ABORTED` | No |
| `ORDER_NOT_CANCELLABLE` | `ABORTED` | No |
| `ENERGY_ALLOCATION_CONFLICT` | `ABORTED` | Yes |
| `ORDER_TYPE_NOT_SUPPORTED` | `FAILED_PRECONDITION` | No |
| `QUANTITY_OUT_OF_RANGE` | `FAILED_PRECONDITION` | No |
| `QUANTITY_PRECISION_INVALID` | `FAILED_PRECONDITION` | No |
| `PRICE_OUT_OF_RANGE` | `FAILED_PRECONDITION` | No |
| `PRICE_PRECISION_INVALID` | `FAILED_PRECONDITION` | No |
| `SLOT_INVALID` | `FAILED_PRECONDITION` | No |
| `ORDER_SLOT_EXPIRED` | `FAILED_PRECONDITION` | No |
| `SLOT_TOO_FAR` | `FAILED_PRECONDITION` | No |
| `METER_NOT_REGISTERED` | `FAILED_PRECONDITION` | No |
| `HOUSE_AMBIGUOUS` | `FAILED_PRECONDITION` | No |
| `METER_OFFLINE` | `FAILED_PRECONDITION` | Yes, after the meter recovers |
| `READING_STALE` | `FAILED_PRECONDITION` | Yes |
| `ENERGY_INSUFFICIENT` | `FAILED_PRECONDITION` | No, unless capacity is released |
| `IOT_UNAVAILABLE` | `UNAVAILABLE` | Yes |
| `AUTH_UNAVAILABLE` | `UNAVAILABLE` | Yes |
| `ORDER_CREATION_DISABLED` | `UNAVAILABLE` | Yes |
| `INTERNAL_ERROR` | `INTERNAL` | Yes |

A Kafka outage does not fail creation. The order is already durable and the outbox retries. `ORDER_CREATION_DISABLED` is the operator switch that stops new creates without affecting reads or cancels.

The gateway maps `OK` create and cancel to HTTP 202, a replay to HTTP 200 with `Idempotency-Replayed: true`, and forwards `ErrorInfo.reason` as the public error code. HTTP details are in the API document.
