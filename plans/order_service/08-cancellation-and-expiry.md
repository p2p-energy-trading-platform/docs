---
connie-title: Order Service Cancellation and Expiry
---

Order Cancellation and Expiry
=============================

Purpose
-------

This document defines how orders are cancelled and how they expire, how those flows interact with fills, how SELL energy is released, and what the Order Service requires from the Billing and Wallet service for BUY orders.

Cancellation and expiry are coordinated with the Matching Engine. The engine is authoritative for the outcome. The Order Service records the request, follows the engine's events, and keeps its own ledgers consistent. The rules for applying events are in the status synchronization document, and this document does not repeat them.

Cancellation Flow
-----------------

1. The client calls `DELETE /orders/:orderId`. The gateway calls the gRPC `CancelOrder` with the authenticated user and the order ID.
2. The Order Service locks the order row and checks ownership. A non-owner receives `NOT_FOUND`, indistinguishable from a missing order.
3. The order must be cancellable (table below).
4. In **one transaction** the Order Service sets the status to `CANCEL_PENDING`, appends a history row (source `USER`), and writes an `OrderCancelRequested` outbox row with a fresh `event_id`. The SELL allocation is untouched.
5. It responds `OK` with the order in status `CANCEL_PENDING`. The gateway returns `202 Accepted`. The response means "cancellation requested", never "cancelled".
6. The outbox publisher sends the command to `gridx.orders.v1` with key `order_id`, so the engine sees it after the order's placement.
7. The engine answers with `OrderUpdated` (`CANCELLED`, or the terminal status the order had already reached). The Order Service applies it by the transition matrix.

| Stored status | Result of `CancelOrder` |
|---|---|
| `PENDING` | Allowed. For a MARKET order this is the only cancellable status. |
| `OPEN`, `PARTIALLY_FILLED` | Allowed |
| `CANCEL_PENDING` | Idempotent: `OK` with the current state, no new command |
| `FILLED`, `CANCELLED`, `EXPIRED`, `REJECTED` | `ABORTED` with reason `ORDER_NOT_CANCELLABLE` |

A cancel is allowed after `expires_at` as long as the order is not yet terminal. The engine then answers with an echo of `EXPIRED`.

Retry and Idempotency
---------------------

- **Client retries.** Repeating `CancelOrder` is safe. While the order is `CANCEL_PENDING` it returns the same state. After a terminal status it returns `ORDER_NOT_CANCELLABLE`.
- **One command per order.** A partial unique index on the outbox allows at most one `order.cancel_requested` row per order, so a retry can never produce a second command.
- **Atomic state and command.** The status change and the outbox row commit together, so a crash cannot leave an order in `CANCEL_PENDING` without a command, or a command without the state.
- **Engine side.** The engine deduplicates the command by `event_id` and answers an already-terminal order with an echo of its state.
- **Republishing is an operator action** in v1 (see Missing Acknowledgements). Nothing republishes automatically.

Cancellation and Execution Races
--------------------------------

A cancel request never guarantees that no execution occurred. The engine's partition order decides, and `order_seq` carries the result:

| Case | Result |
|---|---|
| Cancel processed before any further fill | `CANCELLED`, remaining quantity released |
| Fills processed before the cancel, order still resting | Status stays `CANCEL_PENDING` while quantities update, then `CANCELLED` |
| Fully filled before the cancel | `FILLED`. The cancel lost the race. Nothing is released. |
| Partly filled, then cancelled | `CANCELLED` with fills retained and the remaining quantity released |
| Order already terminal at the engine | The engine echoes its terminal status and `CANCEL_PENDING` resolves to it |
| Older cancellation response after a newer fill | Ignored as stale by `order_seq`. A cancel response never overwrites newer execution data. |
| Duplicate cancellation responses | Ignored by `event_id` and `order_seq` |

The engine reports the cancelled quantity as the cumulative `remaining_quantity` of the `CANCELLED` event. The filled quantity is `quantity - remaining`.

### Missing acknowledgements

- An order in `CANCEL_PENDING` is never resolved by a timeout.
- After 30 s an alert fires. The cause is either an unpublished outbox row (the publisher retries by itself) or the engine not answering.
- The operator follows the `pending-orders.md` runbook: check the outbox row, check the engine, and if needed republish the same command (clear `published_at` on the existing row so the same `event_id` is sent again). The engine deduplicates, so this is safe.
- If the order's slot ends first, the expiry rules below take over.

Expiry
------

### Policy

| Question | Decision |
|---|---|
| Which orders can expire | Any non-terminal order: `PENDING`, `OPEN`, `PARTIALLY_FILLED`, `CANCEL_PENDING` |
| When | LIMIT: at `delivery_slot_end`. MARKET: `min(created_at + 30 s, delivery_slot_end)`. Always `expires_at`, set by the Order Service and never client-supplied. |
| Who decides | The Matching Engine removes unmatched quantity and publishes `EXPIRED`. The Order Service reconciler is a fallback only. |
| Time source | UTC. The engine uses the `expires_at` carried in the command and never recomputes it. Both services run NTP. |
| Clock skew | The engine rejects a MARKET order only if `now > expires_at + 5 s`. The reconciler grace (5 min) absorbs skew for LIMIT orders. |
| Partially filled orders | `EXPIRED` with the fills retained and the remaining quantity greater than 0 |
| Fully filled orders | Never `EXPIRED`. They are `FILLED`. |
| Creation gate | New orders are accepted only before `delivery_slot_start`, so no order is created for a slot already underway |

### Engine flow

At slot end the engine removes every resting order of the slot and publishes one `OrderUpdated` per order with status `EXPIRED`, reason `SLOT_ENDED`, and the cumulative remaining quantity. It also rejects an order that arrives after its `expires_at` with `REJECTED` and reason `ORDER_EXPIRED`. Today the engine's expiry manager changes in-memory orders without publishing, so this is a required engine change (E-11).

### Order Service flow

1. An `EXPIRED` event is applied by the transition matrix. SELL allocation is released and history is written.
2. **Fallback reconciler**, every 30 s. It selects up to 100 orders with `FOR UPDATE SKIP LOCKED` where the status is non-terminal and `expires_at + 5 min < now`. For each, in its own transaction it re-checks that the order is still non-terminal, then sets `EXPIRED` with `terminal_source = RECONCILER`, writes a history row (source `RECONCILER`), releases the remaining SELL allocation, and raises an alert.
3. The reconciler never acts before the grace period, so it cannot pre-empt a normal engine expiry.
4. A reconciler expiry can be **superseded** by a later engine event (`FILLED`, `CANCELLED`, or `EXPIRED` with its true quantity). That is the safeguard against a guess overwriting authoritative data.

### Races and stale events

| Race | Resolution |
|---|---|
| Expiry versus a fill | The engine's order in the partition decides. If the fill came first the order is `FILLED` and no expiry is emitted. |
| Expiry versus cancel | Same. The later event is an echo or is stale. |
| Reconciler versus engine event | The row lock serializes them. If the engine's event lands first, the reconciler finds a terminal order and does nothing. If the reconciler lands first, the engine's event supersedes it. |
| Stale expiry after a newer outcome | Ignored by `order_seq`. It never reverts a fill or a cancellation. |
| Delayed expiry after an outage | The engine publishes it when it recovers. The reconciler covers the gap after the grace period. |

The expiry workflow is idempotent: every step is guarded by the order status, `me_seq`, and `released_at IS NULL`.

Energy Allocation Release
-------------------------

The Order Service owns the SELL ledger and releases the **remaining** quantity exactly once at a terminal status.

| Event | Release |
|---|---|
| Confirmed cancellation | The remaining quantity |
| Expiry (engine or reconciler) | The remaining quantity |
| Rejection | The whole quantity |
| Complete execution | Nothing |
| Partial execution, then cancel or expiry | The remaining quantity. Filled energy stays consumed. |
| Cancel request only (`CANCEL_PENDING`) | Nothing |
| Duplicate outcome events | Nothing, guarded by `released_at IS NULL` |
| Failed transaction or restart | The status change and the release are in one transaction, so both happen or neither does |
| Reconciler expiry superseded by the engine | `released_wh` is set to the new remaining quantity and the difference is added back to `allocated_wh` |

Example: a SELL of 2,000 Wh fills 500 Wh and is then cancelled. The terminal `CANCELLED` event has remaining 1,500, so 1,500 Wh is released and 500 Wh stays consumed.

Wallet Integration
------------------

**Current state of Billing.** The Billing and Wallet service is scaffolding only: it has a project layout, a Go domain with error definitions, and no protobuf contract or reservation RPC. Its README and error list describe the intended design:

- Wallets with available and reserved balances, holds on open BUY orders, and double-entry journals in integer minor units (1 credit = 100 minor units).
- A background sweeper for expired holds.
- A market BUY requires a **price collar** (`ErrMarketOrderNeedsCollar`), and a fill priced above the collar is refused at settlement (`ErrPriceExceedsReservation`).
- Insufficient funds, frozen wallets, and idempotency conflicts are explicit errors.

Everything below is a **future** integration contract. Nothing is implemented, and no document may claim that wallet checks, reservations, releases, or settlement exist until Billing ships them.

### Expected contract

| Concern | Decision |
|---|---|
| Who computes money | Billing. The Order Service sends the price collar and the quantity, never an amount. Billing computes the hold (including any platform fee from its fee configuration) and its own rounding. |
| Reserve | A synchronous, idempotent gRPC `ReserveFunds(user_id, reference, collar_price, quantity_wh, hold_expires_at, idempotency_key)`. Returns a hold ID and the reserved amount. |
| Collar | The order's effective price: the LIMIT price, or the MARKET protection price. Because a BUY price is all-in, it already covers the grid fee. |
| Hold expiry | `expires_at` plus 10 minutes. Billing's sweeper releases a hold nobody released. |
| Release and adjustment | Billing consumes `gridx.orders.updates.v1` and releases the remaining hold on a terminal status, and consumes `gridx.trades.v1` to settle fills against the hold. The Order Service calls no release RPC. |
| Stable identifiers | Reservation key `order-create:{user_id}:{idempotency_key}`, so a client retry reuses the same hold. The request ID is propagated for correlation. |
| Audit | Billing journals every movement. The Order Service stores the hold ID and reserved amount on the order (added in a later migration when the contract exists). |
| Settlement and final balances | Owned entirely by Billing. |

### Create flow when reservation is required

1. Local validation, permission, idempotency lookup, and the IoT house lookup, as before.
2. `ReserveFunds` for the BUY order, before the creation transaction.
3. The creation transaction stores the order and the hold reference, and writes the outbox row.
4. If the transaction fails after a successful reserve, the hold either is reused by the client's retry (same key, same hold) or expires on its own. No money is lost.

### Failures

| Condition | Reason code | gRPC status | Retryable |
|---|---|---|---|
| Not enough available funds | `INSUFFICIENT_FUNDS` | `FAILED_PRECONDITION` | No |
| Wallet frozen | `WALLET_FROZEN` | `FAILED_PRECONDITION` | No |
| Billing unavailable, timed out, or reserve outcome unknown | `BILLING_UNAVAILABLE` | `UNAVAILABLE` | Yes |

The Order Service fails closed. An unknown reservation outcome rejects the order. The client retries with the same idempotency key, and Billing returns the same hold.

An engine bug would surface here: a trade priced above the buyer's collar is refused by Billing. The cross-zone SELL price defect (E-12) must be fixed before reservation is enabled.

BUY Order Readiness
-------------------

Billing has no reservation contract yet. A BUY order cannot be funded-checked, so BUY orders are controlled by an explicit mode:

| `BUY_RESERVATION_MODE` | Behaviour | Allowed environments |
|---|---|---|
| `blocked` (default) | BUY orders are rejected with `BUY_ORDERS_NOT_ENABLED` (`FAILED_PRECONDITION`, not retryable). SELL orders are unaffected. | All |
| `disabled` | BUY orders are accepted with **no funds check or hold**. | `development`, `test`, `demo` only |
| `required` | `ReserveFunds` is called as above. | All, once the Billing contract exists |

- `ORDER_ENV` is one of `development`, `test`, `demo`, `production`. **Startup fails** if `BUY_RESERVATION_MODE=disabled` with `ORDER_ENV=production`.
- The check is enforced in the service, not only in configuration: `CreateOrder` for a BUY re-reads the mode.
- In `disabled` mode every unfunded BUY logs a warning and increments `order_unfunded_buy_total`. The API makes no claim that funds were checked.
- Production therefore trades SELL orders only, or runs in `required` mode once Billing is ready. No document or UI may describe BUY orders as funded before then.
- When the mode is `required`, a MARKET BUY must carry an explicit protection price (`INVALID_ORDER` otherwise). The default band maximum would reserve an unreasonable amount, and Billing itself requires a collar.

Failure Handling and Recovery
-----------------------------

| Case | Handling |
|---|---|
| Kafka publication failure | The outbox retries. The order or cancel is already durable. |
| Missing cancel or expiry acknowledgement | Alert after 30 s. The cancel stays `CANCEL_PENDING`. Operator republish. Expiry fallback after the grace period. |
| Duplicate and out-of-order events | Deduplicated by `event_id`, stale ones ignored by `order_seq`, echoes accepted. |
| Matching Engine restart | The engine rebuilds from the recovery protocol. A redelivered cancel is deduplicated or answered with an echo. |
| Database transaction failure | The whole transaction rolls back. The offset is not committed and the event is retried. |
| Conflicting execution, cancellation, and expiry outcomes | Decided by `order_seq`. An impossible combination is quarantined and the order flagged. |
| Failed or repeated allocation release | Idempotent: the status change and release are one transaction, and `released_at IS NULL` prevents a second release. |
| Unknown wallet reservation outcome | Fail closed with `BILLING_UNAVAILABLE`. The client retries with the same key. |
| Billing unavailable | BUY creation fails. SELL, cancel, and reads are unaffected. |

Observability and Tests
-----------------------

| Metric | Meaning |
|---|---|
| `order_cancel_requests_total{result}` | Cancels by outcome |
| `order_cancel_pending_age_seconds` | Oldest `CANCEL_PENDING` order |
| `order_expiry_reconciled_total` | Orders expired by the fallback |
| `order_expiry_superseded_total` | Reconciler expiries later corrected by the engine |
| `order_unfunded_buy_total` | BUY orders created without a funds check |

Required tests:

- Cancel from every stored status, and a repeated cancel.
- Cancel racing a fill, in both orders, ends in exactly one of `CANCELLED` or `FILLED`.
- Cancel of a partly filled order releases exactly the remaining quantity.
- Only one cancel command can exist per order.
- The reconciler skips an order that an engine event just finished, and a later engine event supersedes a reconciler expiry.
- Release is idempotent across duplicates, crashes, and replays.
- Startup fails for `BUY_RESERVATION_MODE=disabled` in production, and `blocked` rejects BUY but not SELL.
- A fake Billing returns each failure above and the order is rejected with the right code.

Decisions and Dependencies
--------------------------

### Resolved decisions

| ID | Open item | Decision |
|---|---|---|
| X-1 | Supported lifecycle and cancellable states | `PENDING`, `OPEN`, `PARTIALLY_FILLED` (and `CANCEL_PENDING` idempotently). MARKET only while `PENDING`. |
| X-2 | Cancellation and expiry schemas | `OrderCancelRequested` command. `OrderUpdated` with `CANCELLED` or `EXPIRED` and a reason. Defined in the Kafka contracts document. |
| X-3 | Matching Engine acknowledgement semantics | The engine answers every cancel with `OrderUpdated`: `CANCELLED`, an echo of the terminal state, or `REJECTED` / `UNKNOWN_ORDER`. |
| X-4 | Ordering, versioning, deduplication | `order_seq`, `event_id`, and the rules in the status synchronization document. |
| X-5 | Expiry ownership and time rules | Engine authoritative. `expires_at` set by the Order Service in UTC. Reconciler fallback after 5 minutes. MARKET TTL 30 s. |
| X-6 | SELL allocation ownership and release | The Order Service. Remaining quantity released once, at a terminal status. |
| X-7 | BUY restrictions before wallet integration | `BUY_RESERVATION_MODE` defaults to `blocked`. `disabled` is only for development, test, and demo. Production cannot start in `disabled`. |
| X-8 | Retry, recovery, reconciliation | The outbox, the reconciler, the operator republish runbook, and the failure table above. |
| X-9 | Who computes money and releases holds | Billing computes holds and amounts and releases holds from order events. The Order Service sends only a collar and a quantity. |

This document resolves the open items on BUY readiness (L-O5 in the limit-and-market document) and, together with Billing's collar rule, the protection-price question (L-O3) for BUY orders.

### Remaining items needing sign-off

| ID | Item | Owner |
|---|---|---|
| X-O1 | Billing protobuf contract: `ReserveFunds`, hold ID and amount in the response, the three failure codes, and idempotency. | Billing and Settlement |
| X-O2 | Billing consumes `gridx.orders.updates.v1` to release holds and `gridx.trades.v1` to settle, in its own consumer groups. | Billing and Settlement |
| X-O3 | Confirm 1 credit equals 1 AED, and the hold expiry buffer of 10 minutes. | Product, Billing |
| X-O4 | Engine: slot-end expiry events (E-11), the MARKET skew tolerance, and the cross-zone SELL fix (E-12). | Matching Engine |
| X-O5 | Choose the default `BUY_RESERVATION_MODE` per environment, in particular whether the demo uses `disabled`. | Product, team lead |
| X-O6 | Operator procedure and authority for republishing a command. | Operations |

Record confirmed decisions in the shared contracts and the Billing documentation before describing them as existing behaviour.
