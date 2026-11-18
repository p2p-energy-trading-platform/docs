---
connie-title: Proposed Matching Engine Changes
---

# Proposed matching-engine changes

**Status: not implemented.** The C++ process does not do what this document describes. It is the list of changes required before the engine matches the order-service contract.

The previous crash-recovery document is withdrawn. It is not the design. Recovery here is the Kafka snapshot protocol.

## What the code does today

The repository builds and unit-tests matching pieces. It does not run a matching service.

| Gap | Where | What that means |
|---|---|---|
| The process never starts consumers, the processor, or a clean shutdown | `src/main.cpp` | After config is logged, the loop only prints a heartbeat. Nothing is consumed or produced. |
| Validation is called and ignored, and the match result is not applied to the book | `src/engine/OrderProcessor.cpp` | An invalid order is still matched. The `TODO` under the match call is still open. |
| Only same-grid matching is invoked | `src/matching/MatchingEngine.cpp` | `CrossZoneMatcher` exists and has tests. `match` does not call it. |
| The incoming order's own outcome is not published | `MatchingResultPublisher` | Only resting-order updates are sent. An accepted order is never acknowledged. |
| `event_id` is an empty string | `OrderUpdateEventMapper.cpp`, `TradeEventMapper.cpp` | Consumers cannot deduplicate. |
| Kafka records have no key | `KafkaProducer.cpp` | Updates for one order are not kept in order. |
| The producer sets only the bootstrap server and the client id | `KafkaProducer.cpp` | No idempotent producer and no `acks=all`. |
| A failed consume can be skipped when a later offset is committed | `KafkaOrderConsumer.cpp` | A poison record does not become a rejection. |
| Cancel is not implemented | order consumer | The consumer decodes only `OrderAccepted`. |
| Expiry changes memory and publishes nothing | expiry manager | The book drops orders without telling the order service. |
| No duplicate detection | none | A redelivered placement can match again. |
| Incoming cross-grid sells overcharge the buyer | `CrossZoneMatcher.cpp`, `TradeManager.cpp` | The energy price is the buyer's raw limit, then the grid fee is added again, so the buyer pays more than the all-in price. `buyerTotalPrice` is `(energyPrice + fee) * quantity`, and quantity is watt-hours, so that internal field is 1000 times a per-kWh amount. `TradeExecuted` does not carry it. The energy price on the trade must be `buyer_price - grid_fee` for an incoming sell. |
| Trade ids are an in-memory counter | `TradeIdGenerator` | A restart can reuse ids. |
| User id is `uint64` | `Types.hpp` | Auth users are UUID strings. This type predates the auth service. |
| Zone id is `uint32` | `Types.hpp` | A zone is a grid, and the grid id is a string. |
| Price is documented as micro-AED | `Types.hpp` | The platform unit is LKR minor units per kWh, 1 LKR = 100. |
| `OrderType` is `Limit` only | `Types.hpp`, `order_events.proto` | MARKET is required. It is not optional follow-up work. |
| There is no self-trade check | both matchers | Two orders with the same user id can trade. |
| The market-cache check is a `TODO` | `OrderValidator.cpp` | An unknown grid is not rejected. |
| Topic names disagree | `.env` versus `docker-compose.yml` | Tests and `.env` use `order.accepted`, `trade.executed`, `order.state`, `grid.transfer`. Compose uses `order-placements`, `completed-trades`, `order-state`, `grid.transfer-rules.v1`. |
| Unused topic-name constants | `KafkaTopics.hpp` | `order.updated`, `order.cancelled`, and `order.expired` are not subscribed or published. They are not topics. |
| No recovery | none | Memory is lost on restart. |

Same-grid matching and the unused cross-grid matcher are tested. The Kafka adapters exist. Those facts do not make the service runnable. Closing the table above is the engine project, not a patch on top of a finished one.

## Target behaviour

### Topics

Use the `.env` names. Change `docker-compose.yml` to the same names.

| Topic | Role |
|---|---|
| `order.accepted` | Consume `OrderAccepted`. Key `order_id`. |
| `order.cancel_requested` | Consume `OrderCancelRequested`. This topic does not exist in the process today. Key `order_id`. |
| `order.state` | Produce every `OrderUpdated`, including accept, fill, cancel, expire, and reject. Key `order_id`. |
| `trade.executed` | Produce `TradeExecuted`. Key `trade_id`. |
| `grid.transfer` | Compacted. Consume grid-fee rules before matching. |
| `order.recovery.requests` | Produce `RecoveryRequested`. One partition. |
| `order.recovery.snapshots` | Consume the order service's snapshot. One partition. |

The order service publishes the first command topic and the cancel topic, consumes `order.state`, and serves the snapshot. Its side of that contract is in `docs/plans/order_service/`.

Producer requirements for `order.state` and `trade.executed`: record key, `acks=all`, idempotent producer, header `x-message-type` (`order.updated` or `trade.executed`). A consumer of those topics uses `isolation.level=read_committed` once the transactional producer below is on.

A command that cannot be decoded is not skipped. It is logged and left out of the book, and the offset advances only after that is recorded. A placement the engine already knows is not matched again. The engine republishes that order's current state with a new `order_seq` so a caller that missed the first outcome can see it.

### Identity, zone, and price

- `user_id` on orders and on trades is the Auth UUID string. There is no numeric trader id.
- The zone is `grid_id`, the same string as IoT `Grid.grid_id`. Same-grid means equal strings.
- Price and `grid_fee_per_kwh` are `int64` minor units of LKR per kWh. 1 LKR = 100. Quantity stays watt-hours.
- Do not match an order against a resting order with the same `user_id`. Skip that resting order and continue. Do not cancel the incoming order for that reason.

### Price rule

- BUY price is the maximum all-in price, including the grid fee.
- SELL price is the minimum energy price. The fee is not taken from the seller.
- Incoming BUY matches when `seller_price + grid_fee <= buyer_price`. Energy price is the seller's price.
- Incoming SELL matches when `seller_price <= buyer_price - grid_fee`. Energy price is `buyer_price - grid_fee`. This replaces the current sell path, which uses the buyer's raw price and then adds the fee.
- Same-grid fee is 0. A pair with no rule does not match.
- The trade stores the energy price and the fee. It does not store `(price + fee) * watt-hours`.

### LIMIT and MARKET

Both types are required.

- LIMIT rests until it is filled, cancelled, or `expires_at` (the slot end).
- MARKET is immediate-or-cancel. `price` is the protection price and is always present. The remainder is not inserted into the book. One final `OrderUpdated` is published: `FILLED`, or `CANCELLED` with `IOC_REMAINDER` or `NO_LIQUIDITY`.
- An order that arrives after `expires_at` is `REJECTED` with `ORDER_EXPIRED` and is not matched. For a MARKET order the engine allows 5 seconds of clock skew past `expires_at` before that rejection.

### What every command publishes

For a placement the engine publishes one `OrderUpdated` for the incoming order and one for each resting order that changed, plus one `TradeExecuted` per trade. `order_seq` starts at 1 for that order and increases by 1 for every update, including an echo. `event_id` is a new UUID. `user_id` is copied from the order. `remaining_quantity` is the cumulative watt-hours left.

A cancel for a resting order removes it and publishes `CANCELLED` with `USER_REQUEST`. A cancel for an order that is already terminal publishes an echo of that terminal state with a new `order_seq`. A cancel for an unknown order publishes `REJECTED` with `UNKNOWN_ORDER` and `order_seq` 0. The engine does not invent a quantity for an order it has never stored.

At slot end, each resting order of that slot is removed and published as `EXPIRED` with `SLOT_ENDED`.

`OrderStatus` gains `ORDER_STATUS_REJECTED`. `OrderUpdateType` gains the matching rejected value. Reasons are `USER_REQUEST`, `NO_LIQUIDITY`, `IOC_REMAINDER`, `SLOT_ENDED`, `ORDER_EXPIRED`, `INVALID_ORDER`, and `UNKNOWN_ORDER`.

The first `OrderUpdated` is the acknowledgement. There is no separate acknowledgement topic.

### Suggested protobuf changes

Not applied. These are breaking changes because the messages are not a live production API. Do not add a parallel numeric id beside the UUID.

`protobuf/proto/gridx/order/v1/order_events.proto`

- Add `ORDER_TYPE_MARKET = 2`.
- Change `user_id` from `uint64` to `string`.
- Replace `uint32 grid_zone_id` with `string grid_id`.
- Price comment: LKR minor units per kWh. For MARKET this is the protection price.
- Quantity remains watt-hours.
- Stop using `double remaining_quantity`. The command does not carry a second remaining amount. `OrderUpdated.remaining_quantity` is the `int64` watt-hour remainder.

`protobuf/proto/gridx/order/v1/order_update_events.proto`

- Add `ORDER_STATUS_REJECTED` and `ORDER_UPDATE_TYPE_REJECTED`.
- Add `uint64 order_seq`, the reason enum, and `string user_id`.

`protobuf/proto/gridx/trade/v1/trade_events.proto`

- `buyer_id` and `seller_id` become strings.
- `buyer_grid_zone_id` and `seller_grid_zone_id` become `string buyer_grid_id` and `string seller_grid_id`.
- Price and fee comments become LKR minor units per kWh.

`protobuf/proto/gridx/grid/v1/grid_transfer_rule.proto`

- `seller_grid_zone` and `buyer_grid_zone` are reserved names and cannot be reused.
- Add `string seller_grid_id` and `string buyer_grid_id` at new field numbers. Stop using the `uint32` zone fields.
- `grid_fee_per_kwh` is LKR minor units per kWh.

`OrderCancelRequested` and the recovery messages are specified for the order service in `docs/plans/order_service/05-kafka-contracts-and-outbox.md` and `docs/plans/order_service/09-kafka-based-recovery.md`. Add those messages in the same protobuf change. The snapshot's `user_id` and `grid_id` are strings, and its price is LKR minor units.

Also add `order_service.proto` as described in the order-service API document. That file is the gateway's API, not an engine API.

## Recovery

The engine keeps books in memory. On startup it does not match until it has loaded grid rules and a snapshot of orders the order service has already acknowledged (`me_seq > 0`). Replaying `order.accepted` through the matcher is not recovery: expiry and grid fees depend on the clock and the rules at the time, so a replay can create different trades from the ones already published.

The engine publishes the outputs of each command batch in one Kafka transaction: the `OrderUpdated` and `TradeExecuted` records, plus the consumer offsets. A transaction error, a fencing error, or an abort exits the process. It does not keep matching on memory that includes an aborted batch. The transactional id is fixed (`matching-engine-1`), so a new process fences the previous one. Only one engine instance runs.

Startup states:

| State | Action |
|---|---|
| `STARTING` | Load configuration. Do not consume `order.accepted` or `order.cancel_requested`. |
| `FENCING` | `init_transactions` on the transactional producer. |
| `LOADING_RULES` | Read `grid.transfer` to its current end and fill the in-memory fee cache. |
| `REQUESTING` | Publish `RecoveryRequested` with a new `request_id`. |
| `LOADING_SNAPSHOT` | Read `order.recovery.snapshots` for that `request_id` until `RecoverySnapshotComplete`, or 60 seconds. `RecoveryUnavailable` or a timeout waits with backoff from 5 seconds up to 60 seconds and requests again. |
| `BUILDING` | Check the snapshot, build the known-order set and the books, and schedule expiries. A failed check discards the attempt and requests again. |
| `CLOSING_EXPIRED` | For a resting snapshot order whose `expires_at` has passed, publish `EXPIRED` with the next `order_seq` and leave it out of the book. |
| `READY` | Consume commands from the committed offsets and match. |

Nothing is matched during recovery. A crash in any state starts again at `STARTING`.

The snapshot is valid only when chunk indexes are contiguous, the order count matches, every `order_id` is unique, price and quantities agree with the status, and rows are ordered by `(created_at, order_id)`. Resting orders are inserted in that order so an earlier order stays ahead at the same price. Live insertion uses the same `(created_at, order_id)` ordering.

Orders with `me_seq = 0` are not in the snapshot. Their commands are still at or after the committed offset and are processed after `READY`. A known `order_id` is an echo, not a second match. Trade ids are derived from time so a restart does not reuse one.

The order service's refusal rules (lag, unreconciled rows, database down) are in its recovery document. The engine treats `RecoveryUnavailable` as "try again", not as an empty book.

## Work breakdown

This is the engine work.

1. Wire `main`: consumers, processor, producer flush, shutdown.
2. Honour validation. Publish `REJECTED` with a reason. Apply the match result to the book.
3. Publish an `OrderUpdated` for the incoming order, with a UUID `event_id`, `order_seq`, `user_id`, and the cumulative remaining quantity.
4. Key records. Turn on the idempotent producer and `acks=all`.
5. Do not commit past a failed record without a recorded failure or a reject outcome.
6. Switch user id, grid id, and price to the types and units above, including the protobuf change.
7. Call cross-grid matching and fix the incoming-sell energy price.
8. Deduplicate placements by `order_id` and cancels by command `event_id`, with an echo.
9. Consume `order.cancel_requested`, including the unknown-order reply.
10. Publish expiry on `order.state`.
11. Persist or monotonically derive trade ids across restarts.
12. Skip a resting order with the same user id.
13. Reject an unknown grid and a slot that is misaligned or already over.
14. Implement MARKET as immediate-or-cancel. Do not insert the remainder.
15. Implement the recovery states above.
16. Point `docker-compose.yml` at the `.env` topic names.

Each of those needs an engine test. Items 1 through 11 are also what a later cross-service test will hit. Until they exist, the order service tests against a fake publisher of `order.state`.
