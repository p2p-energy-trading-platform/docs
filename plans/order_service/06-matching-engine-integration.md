---
connie-title: Order Service Matching Engine Integration
---

Matching Engine Integration
===========================

Purpose
-------

This document defines the integration boundary between the Order Service and the Matching Engine: who owns what, how an order travels between them, what each outcome means, and what the engine must change before the integration works end to end.

The Order Service validates requests and keeps the durable order record. The Matching Engine decides matches, execution prices, and authoritative fill quantities. The Order Service never implements a second matching algorithm and never derives fills or prices on its own.

Verified State of the Engine
----------------------------

As of 2026-11-02, the `matching-engine` repository contains tested components but not a running service:

| Area | State |
|---|---|
| Service wiring | `main.cpp` still has `TODO`s for building clients, starting the consumers, polling, flushing, and shutdown. Nothing consumes or produces yet. |
| Matching | Same-zone matching works. Cross-zone matching exists but `MatchingEngine::match` calls only the same-zone matcher. |
| Validation | A validator exists, but `OrderProcessor` ignores its result and matches regardless. |
| Outcomes | Only updates for **resting** orders are published. The incoming order's own outcome (accepted, filled, partly filled) is never published. |
| Cancel | Not implemented. |
| Duplicate handling | None. |
| Expiry | The expiry manager changes in-memory orders without publishing anything. |
| Events | `event_id` is an empty string. There is no order sequence. Kafka records have no key. |
| Self-trade | No check found in the matchers. |

This integration therefore depends on engine work, listed in the checklist below. The Order Service can be built and tested against a fake engine in parallel.

Responsibilities
----------------

| Concern | Owner |
|---|---|
| Authentication, permission, request validation, IoT checks | Order Service |
| Order identifiers (`order_id`), numeric `trader_id`, user UUID mapping | Order Service |
| Energy allocation ledger | Order Service |
| Durable order record, status history, outbox | Order Service |
| Matching, price priority, effective-price rule, grid fees | Matching Engine |
| Execution price and fill quantities | Matching Engine |
| Per-order event sequence (`order_seq`) | Matching Engine |
| Expiry at slot end, and MARKET expiry | Matching Engine (Order Service reconciler is a fallback) |
| Cancel outcome (cancel versus fill race) | Matching Engine |
| Trade records, settlement, wallet movements | Matching Engine events, then Billing and Settlement |

The Order Service does not query or change the engine's in-memory book. Its view of an order is whatever the engine's `OrderUpdated` events last said, plus its own local states (`PENDING`, `CANCEL_PENDING`).

Communication Boundary
----------------------

Kafka is the **only** integration channel between the two services. The engine has only Kafka adapters, and the Order Service has no synchronous path to it.

| Direction | Topic | Message |
|---|---|---|
| Order Service to engine | `gridx.orders.v1` | `OrderAccepted` (place), `OrderCancelRequested` (cancel) |
| Engine to Order Service | `gridx.orders.updates.v1` | `OrderUpdated` |
| Engine to others | `gridx.trades.v1` | `TradeExecuted` |

Earlier documents (`api-contracts.md` §5.4 and the engine's crash-recovery document) describe a direct gRPC recovery request from the engine to the Order Service. That path is removed. Recovery also goes through Kafka and is defined in the recovery document.

Acceptance Boundaries
---------------------

Each stage means something different and is reported as such:

| Stage | What it proves | What it does not prove |
|---|---|---|
| `CreateOrder` returns `OK`, status `PENDING` | The order passed validation and was durably recorded with its command in the outbox, in one transaction | That Kafka received it, or that the engine saw it |
| Outbox row `published_at` set | Kafka acknowledged the command | That the engine processed it |
| First `OrderUpdated` with `NEW` (status `OPEN`) | The engine accepted the order and it rests in the book | That any trade occurred |
| `OrderUpdated` with a fill status | The engine executed some or all of the order | Anything about settlement |
| `TradeExecuted` | One trade happened | Settlement or wallet movement (Billing's job) |

A successful API response never implies a trade, and a published command never implies engine acceptance.

Order Submission Flow
---------------------

| Step | Actor | Action | Durable artifact |
|---|---|---|---|
| 1 | Gateway | Authenticates, forwards `CreateOrder` with the user and idempotency key | none |
| 2 | Order Service | Validates the request, checks permission, looks up idempotency, calls IoT (SELL) | none |
| 3 | Order Service | One transaction: trader account, order, SELL allocation, history, outbox row | `orders`, `energy_allocations`, `order_status_history`, `outbox_events` |
| 4 | Order Service | Responds `OK` with status `PENDING` | |
| 5 | Outbox publisher | Publishes `OrderAccepted` to `gridx.orders.v1`, keyed by `order_id` | `published_at` |
| 6 | Engine | Consumes, deduplicates, validates, matches | engine memory |
| 7 | Engine | Publishes `TradeExecuted` per trade and one `OrderUpdated` per affected order, including the incoming order | Kafka |
| 8 | Order Service | Consumes each `OrderUpdated`, applies it in one transaction | `orders`, history, allocation, `processed_events` |
| 9 | Gateway | Clients read the current status through `GetOrder` or the real-time channel | |

The status the client sees changes `PENDING` to `OPEN`, `PARTIALLY_FILLED`, `FILLED`, or `REJECTED` only at step 8.

Engine Processing Specification
-------------------------------

For every message on `gridx.orders.v1`, in order within a partition, the engine must:

**Placement (`order.accepted`)**

1. Decode. A message that cannot be decoded, or has an unknown `x-message-type`, is logged and dead-lettered by the engine. It must never be silently skipped.
2. If `order_id` is already known: do not process it again. Re-publish the order's **current** state as an `OrderUpdated` with a new `order_seq` (an echo), so an Order Service that lost the first outcome still learns it.
3. Validate (below). On failure, publish `OrderUpdated` with status `REJECTED` and the reason.
4. Match against the book for the order's market (zone and slot).
5. Publish all resulting events (see ordering rules), including one `OrderUpdated` for the **incoming** order.
6. Commit the Kafka offset only after the resulting events were delivered to the producer's acknowledgement.

**Cancel (`order.cancel_requested`)**

1. If the command `event_id` was already processed, echo the order's current state.
2. If the order is resting, remove it and publish `OrderUpdated` `CANCELLED` with reason `USER_REQUEST` and the cumulative remaining quantity.
3. If the order is already terminal, publish an echo of its terminal state with a new `order_seq`.
4. If the engine does not know the order, publish `OrderUpdated` with status `REJECTED` and reason `UNKNOWN_ORDER`. The Order Service treats this as an invalid transition, quarantines it, and flags the order for reconciliation. The engine must not invent a status or quantity for an order it has no record of.
5. Always set `causation_id` to the command's `event_id`.

### Validation the engine performs

The existing checks stay. The engine also adds:

- `grid_zone_id` must be a known market zone, otherwise `REJECTED` with reason `INVALID_ORDER` (the market-cache check is currently a `TODO` in `OrderValidator`).
- `delivery_slot_start` is aligned to 30 minutes, and the slot has not ended.
- The order has not passed `expires_at`, otherwise `REJECTED` with reason `ORDER_EXPIRED`.
- On placement, `status` is `NEW` and the stated remaining quantity equals `quantity`.
- `user_id` (numeric trader number) is non-zero.

The Order Service has already enforced all business rules. The engine's validation is a second line of defence, and a rejection from it indicates a bug or a contract mismatch, so it raises an alert on the Order Service side.

### Event emission and ordering

- Each `OrderUpdated` carries a fresh UUID `event_id`, a strictly increasing `order_seq` for that order, and the cumulative remaining quantity.
- For one command, the engine publishes the incoming order's `OrderUpdated` and each affected resting order's `OrderUpdated`, and one `TradeExecuted` per trade. Within one order the sequence number defines the order. **No ordering across the updates and trades topics is guaranteed or relied on.**
- Every update is keyed by `order_id` and every trade by `trade_id`.

Self-Trade Prevention
---------------------

The engine must not match an order against a resting order with the same numeric trader ID. It skips the resting order and continues to the next best one. The incoming order is not cancelled for this reason. A user whose own BUY and SELL cross would otherwise create a trade with themselves, moving money and energy credit between their own accounts.

*Needs sign-off: Matching Engine, product.*

Contract Alignment
------------------

The shared contracts are defined in the Kafka contracts document. The integration relies on these additions, all in the `protobuf` repository:

| Addition | Used for |
|---|---|
| `OrderType.MARKET` | MARKET orders (limit-and-market document) |
| `OrderStatus.REJECTED`, `OrderUpdateType.REJECTED` | Engine refusals |
| `OrderUpdateReason` (`USER_REQUEST`, `NO_LIQUIDITY`, `IOC_REMAINDER`, `SLOT_ENDED`, `ORDER_EXPIRED`, `INVALID_ORDER`, and the new `UNKNOWN_ORDER = 7`) | Why a terminal status was reached |
| `OrderUpdated.order_seq`, `causation_id`, `reason` | Ordering, correlation, explanation |
| `OrderCancelRequested` | Cancellation command |
| `user_uuid` on `OrderAccepted` and `OrderCancelRequested`, `buyer_user_uuid` and `seller_user_uuid` on `TradeExecuted` | Identity passthrough |
| `delivery_slot_start` on `TradeExecuted` | Settlement slot reference |

The engine treats `user_id` as an opaque numeric trader number issued by the Order Service. It passes `user_uuid` through unchanged and never interprets it.

Order Lifecycle and Matching Outcomes
-------------------------------------

| Engine outcome | `OrderUpdated` | Order Service status |
|---|---|---|
| Accepted, nothing matched (LIMIT) | `NEW`, remaining equals quantity | `OPEN` |
| Partly matched, rests (LIMIT) | `PARTIALLY_FILLED` | `PARTIALLY_FILLED` |
| Fully matched | `FILLED`, remaining 0 | `FILLED` |
| MARKET remainder cancelled | `CANCELLED`, reason `IOC_REMAINDER` or `NO_LIQUIDITY` | `CANCELLED` |
| Refused | `REJECTED`, reason | `REJECTED` |
| Cancelled on request | `CANCELLED`, reason `USER_REQUEST` | `CANCELLED` |
| Slot ended | `EXPIRED`, reason `SLOT_ENDED` | `EXPIRED` |

A partially filled order always keeps the correct remaining quantity, because every update carries the cumulative value.

Cancel versus fill: if both are possible, the engine processes whichever reached it first in the partition. The result, `CANCELLED` or `FILLED`, is what its `OrderUpdated` says, and the Order Service follows it by `order_seq`. The full rules are in the status synchronization and cancellation documents.

Execution Processing (Order Service side)
-----------------------------------------

For every `OrderUpdated` the Order Service, in one transaction:

1. Deduplicates by `event_id`.
2. Locks the order and ignores the event if `order_seq` is not newer.
3. Validates the transition and the quantities.
4. Applies status and remaining quantity, appends history, and releases unused SELL allocation on a terminal status.
5. Commits, and only then commits the Kafka offset.

An echo (same status and remaining quantity as already stored, with a newer `order_seq`) updates only `me_seq`. It changes no state and raises no alert.

The Order Service never recomputes execution prices or fills, and never reads `TradeExecuted`.

Failure Handling and Recovery
-----------------------------

| Scenario | Behaviour |
|---|---|
| Kafka unavailable when publishing | The order is already durable. Outbox rows accumulate and are published when Kafka returns. The API is unaffected. Backlog alerts fire. |
| Duplicate command delivery | The engine ignores a known `order_id` or processed command `event_id` and echoes the current state. |
| Engine restart | The engine rebuilds its book and its set of known orders from the recovery protocol, including terminal orders of unfinished slots, so a redelivered command is still recognised as a duplicate. This requirement is carried into the recovery document. |
| Delayed, duplicate, or out-of-order updates | Deduplicated by `event_id`. Stale updates ignored by `order_seq`. |
| Missing acknowledgement | The order stays `PENDING`. After 30 s an alert fires and the placement may be republished. The engine echoes if it already holds the order. No automatic rejection. |
| Order Service consumer crash mid-event | The transaction rolls back, the offset was not committed, and the record is redelivered and applied once. |
| Schema incompatibility or invalid message | Dead-lettered with a stage and error, partition not blocked, alert raised. |
| Conflicting versions or results | The `order_seq` rule decides. An update that cannot be applied is quarantined and the order is flagged for reconciliation. |
| Engine down for a long time | Orders stay `PENDING` (MARKET orders expire after 30 s, LIMIT orders at slot end). The reconciler applies the expiry fallback after the grace period. |

The Order Service does not stop accepting orders when the engine is slow. Operators can set `ORDER_CREATION_ENABLED=false`, which makes `CreateOrder` fail with `ORDER_CREATION_DISABLED` (`UNAVAILABLE`, retryable) without affecting reads or cancels.

Engine Change Checklist
-----------------------

This is the hand-off list for the engine team. Milestones: **M1** is needed for the first end-to-end order, **M2** before any real or test credits move, **M3** for resilience.

| # | Change | Where | Evidence | Milestone |
|---|---|---|---|---|
| E-1 | Wire the service: build clients, start the order and grid-transfer consumers, poll and hand off to `OrderProcessor`, flush producers, shut down cleanly | `src/main.cpp` | `TODO`s at lines 51-71 | M1 |
| E-2 | Honour the validation result and publish `REJECTED` with a reason | `OrderProcessor.cpp` | Result is discarded today | M1 |
| E-3 | Publish an `OrderUpdated` for the incoming order using `MatchingResult.incomingOutcome` | `MatchingResult.hpp`, matchers, `MatchingResultPublisher.cpp` | Only resting orders are published | M1 |
| E-4 | UUID `event_id`, per-order `order_seq`, `causation_id`, `reason` on every `OrderUpdated` | event mapper, publisher | `event_id` is empty | M1 |
| E-5 | Producer: record keys, `enable.idempotence=true`, `acks=all`, `x-message-type` header | `KafkaProducer.cpp` | Unkeyed, default config | M1 |
| E-6 | Consumer: never advance past a failed record without a dead-letter or reject outcome | `KafkaOrderConsumer.cpp` | A later commit skips a failed message | M1 |
| E-7 | Pass `user_uuid` through, and add slot start to `TradeExecuted` | mappers | New proto fields | M1 |
| E-8 | Read topic and group names from the environment with the values in the Kafka document | `EnvConfigLoader.cpp` | No defaults today | M1 |
| E-9 | Dedupe placements by `order_id` and cancels by command `event_id`, with echo | new known-orders set | No dedupe today | M2 |
| E-10 | Handle `OrderCancelRequested`, including the unknown-order reply | consumer, new handler | No cancel today | M2 |
| E-11 | Publish expiry updates with reason `SLOT_ENDED` | `ExpiryManager.cpp` | Nothing published today | M2 |
| E-12 | Fix the cross-zone SELL energy price to `buyer_price - grid_fee`, and wire cross-zone matching | `CrossZoneMatcher.cpp`, `MatchingEngine.cpp` | Buyer pays above their limit; cross-zone not called | M2 |
| E-13 | Persist or monotonically derive trade IDs across restarts | `TradeIdGenerator.cpp` | In-memory counter | M2 |
| E-14 | Self-trade prevention | matchers | No check found | M2 |
| E-15 | Validate `grid_zone_id` against known markets, and slot alignment and end | `OrderValidator.cpp` | Market-cache `TODO` | M2 |
| E-16 | MARKET orders (`ORDER_TYPE_MARKET`, no remainder insertion, TTL rejection) | per the limit-and-market document | LIMIT only today | M2 |
| E-17 | Recovery from Kafka, including the known-orders set | recovery document | None today | M3 |

Each change needs a unit test in the engine, and E-1 to E-11 also need a case in the cross-service test below.

Cross-Service Integration Tests
-------------------------------

Run the Order Service, the engine, Kafka, and PostgreSQL together (for example with Compose). Cover:

1. Create a LIMIT SELL, observe `PENDING` then `OPEN`.
2. Create a crossing BUY, observe both orders `FILLED` and one trade on `gridx.trades.v1`.
3. A partial fill leaves the resting order `PARTIALLY_FILLED` with the right remaining quantity.
4. Cancel a resting order, observe `CANCEL_PENDING` then `CANCELLED`, and the SELL allocation released.
5. Cancel racing a fill: exactly one of `CANCELLED` or `FILLED` results, never both.
6. MARKET BUY fully filled, partly filled, and with no liquidity.
7. Engine rejects an order: status `REJECTED`, allocation released.
8. Republish the same placement: no second order, no second trade.
9. Kill the engine mid-flow and restart it: all orders reach a consistent state.
10. Kill the Order Service consumer mid-event: the update applies exactly once.

Decisions and Dependencies
--------------------------

### Resolved decisions

| ID | Open item | Decision |
|---|---|---|
| M-1 | Does the engine support MARKET orders | Not yet. It is added as IOC with a protection price (E-16). |
| M-2 | IOC and market BUY protection | Not implemented. Designed in the limit-and-market document. |
| M-3 | Which commands, events, topics, and schemas exist | `OrderAccepted`, `OrderUpdated`, `TradeExecuted` exist. Topics do not. All additions are specified in the Kafka document. |
| M-4 | How the engine acknowledges accepted and rejected commands | The first `OrderUpdated`: `NEW` or a fill status for acceptance, `REJECTED` with a reason for refusal. The engine publishes neither today (E-2, E-3). |
| M-5 | How cancellations and partial executions are represented | A cancel command, answered by `CANCELLED` or an echo of the terminal state. Partial executions are cumulative remaining quantities with an increasing `order_seq`. |
| M-6 | How durable state is rebuilt after interruptions | PostgreSQL is durable. The reconciler handles stuck orders. The engine's book and known-orders set are rebuilt by the recovery protocol (E-17). |
| M-7 | Whether Kafka is the exclusive boundary | Yes. The gRPC recovery path in the older documents is removed. |

### Remaining items needing sign-off

| ID | Item | Owner |
|---|---|---|
| M-O1 | Accept the engine checklist, assign owners, and agree M1, M2, and M3. | Matching Engine |
| M-O2 | Self-trade prevention rule (skip the resting order, keep the incoming order active). | Matching Engine, product |
| M-O3 | Add `ORDER_UPDATE_REASON_UNKNOWN_ORDER = 7` to the proto block in the Kafka document. | protobuf maintainers |
| M-O4 | Confirm the `ORDER_CREATION_ENABLED` kill switch and its `ORDER_CREATION_DISABLED` error. | Product, operations |
| M-O5 | Replace the direct gRPC recovery description in `api-contracts.md` §5.4 and the engine's crash-recovery document with the Kafka protocol. | Matching Engine, docs |

Record confirmed decisions in the shared contracts and the Matching Engine documentation before describing them as existing behaviour.
