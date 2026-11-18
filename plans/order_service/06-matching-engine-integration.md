---
connie-title: Order Service Matching Engine Boundary
---

Matching Engine Boundary
========================

Purpose
-------

This document is the boundary the Order Service implements. The relavant details of the new matching engine implementation details/suggested changes are in [proposed engine changes](../matching-engine/proposed-engine-changes.md).

The current engine process does not yet acknowledge the incoming order, accept MARKET orders, consume cancels, or publish expiry. This service is built and tested against a fake publisher of `order.state` that follows the contract below. Connecting the real process is separate work.

Who owns what
-------------

| Concern | Owner |
|---|---|
| Permission, validation, idempotency, IoT checks, SELL energy ledger | Order Service |
| Order id, user UUID, grid id | Order Service. The user id is the Auth UUID. The grid id is the zone. |
| Durable status, history, outbox | Order Service |
| Matches, prices, fill quantities, expiry, cancel outcome | Matching Engine |
| `order_seq` | Matching Engine |
| Grid-fee cache | Matching Engine, from `grid.transfer`. Not this service. |
| Wallet movement | Not this version. Later, `OrderBillingService` in `protobuf/proto/gridx/billing/v1/order_billing.proto` |

The order service does not read the engine's memory and does not read `trade.executed`.

What is exchanged
-----------------

| Direction | Topic | Message |
|---|---|---|
| To the engine | `order.accepted` | `OrderAccepted` |
| To the engine | `order.cancel_requested` | `OrderCancelRequested` |
| From the engine | `order.state` | `OrderUpdated` |

| Stage | Proves | Does not prove |
|---|---|---|
| `CreateOrder` returns `PENDING` | Validated and stored, with an outbox row | That Kafka or the engine saw it |
| Outbox `published_at` set | The broker took the command | That the engine applied it |
| First `OrderUpdated` | The engine accepted, filled, cancelled, or rejected it | Settlement |
| Later `OrderUpdated` | A further engine outcome | A wallet movement |

Flow
----

1. The gateway calls `CreateOrder` with the user id and the idempotency key.
2. This service validates, checks permission, and calls IoT for the house and, on a SELL, the reading.
3. One transaction writes the order, the SELL allocation, history, and the `order.accepted` outbox row.
4. The response is `PENDING`.
5. The publisher sends `OrderAccepted`.
6. The engine eventually publishes `OrderUpdated` records, including one for the incoming order.
7. This service applies each update in one transaction.
8. Clients read the status with `GetOrder` or the gateway's real-time channel.

Outcomes this service applies
-----------------------------

| Engine result | `OrderUpdated` | Stored status |
|---|---|---|
| LIMIT accepted, nothing matched | `NEW`, remaining equals quantity | `OPEN` |
| LIMIT partly matched and resting | `PARTIALLY_FILLED` | `PARTIALLY_FILLED` |
| Fully matched | `FILLED`, remaining 0 | `FILLED` |
| MARKET remainder cancelled | `CANCELLED`, `IOC_REMAINDER` or `NO_LIQUIDITY` | `CANCELLED` |
| Refused | `REJECTED` and a reason | `REJECTED` |
| User cancel won | `CANCELLED`, `USER_REQUEST` | `CANCELLED` |
| Slot or MARKET lifetime ended | `EXPIRED`, `SLOT_ENDED` | `EXPIRED` |

If a cancel and a fill both happen, the engine's `order_seq` is the result. This service does not choose between them.

A duplicate command is the engine's problem to ignore. This service may republish the same outbox `event_id`. It does not invent a second order.

When the engine is down, new orders stay `PENDING` and the outbox grows. Operators can set `ORDER_CREATION_ENABLED=false`, which makes `CreateOrder` return `ORDER_CREATION_DISABLED`. Reads and cancels still work. This service does not turn a missing acknowledgement into `REJECTED` or `EXPIRED`.
