---
connie-title: Order Service Status Synchronization
---

Order Status Synchronization
============================

Purpose
-------

The Order Service consumes Matching Engine updates and applies them to its durable order records. This document is the canonical definition of how an update is validated and applied: the decision procedure, the full transition matrix, the quantity rules, the audit trail, and the handling of every abnormal case.

PostgreSQL is the durable source of truth for the Order Service's order records and status history. The Matching Engine is authoritative for fills, quantities, and engine-side lifecycle transitions. The Order Service owns two local states (`PENDING`, `CANCEL_PENDING`) and the allocation of SELL energy.

An order update is not proof that wallet settlement has completed. Settlement belongs to Billing and Settlement.

Inputs
------

`OrderUpdated` (see the Kafka contracts document) carries `event_id`, `event_type`, `order_id`, `status`, `remaining_quantity` (cumulative and absolute), `updated_at`, `order_seq`, `causation_id`, and `reason`.

- `order_seq` is the only ordering signal. `updated_at` is the engine's wall clock at mapping time. It is stored for audit and **never** used to order events.
- `event_id` identifies the message, for deduplication.
- `status` is authoritative. `event_type` must agree with it, otherwise the message is malformed.

| `status` | Required `event_type` | Required `remaining_quantity` |
|---|---|---|
| `NEW` | `UPDATED` | equals `quantity` |
| `PARTIALLY_FILLED` | `PARTIALLY_FILLED` | between 1 and `quantity - 1` |
| `FILLED` | `FILLED` | 0 |
| `CANCELLED` | `CANCELLED` | at least 1 |
| `EXPIRED` | `EXPIRED` | at least 1 |
| `REJECTED` | `REJECTED` | equals `quantity` |

A `CANCELLED` or `EXPIRED` order with nothing remaining is a contract violation, because a fully executed order is `FILLED`. The engine's current mapper does not support `REJECTED` and must be extended.

**Special case: `REJECTED` with reason `UNKNOWN_ORDER`.** The engine sends this when it receives a cancel for an order it has no record of. It has no sequence for that order, so `order_seq` is 0. The Order Service handles this event first, before any sequence check, and never applies it to state (see below).

Decision Procedure
------------------

Every update is processed in one PostgreSQL transaction. Steps 1 to 3 are the standard prologue from the persistence document.

1. **Deduplicate.** Insert `event_id` into `processed_events`. If it already exists, the event is an exact duplicate: commit and advance the offset.
2. **Lock the order** with `SELECT ... FOR UPDATE`. If the order does not exist: dead-letter with stage `UNKNOWN_ORDER`, commit, alert.
3. **Validate the message** (the table above, plus a valid UUID `event_id`, non-zero `order_id`, `order_seq >= 1`, `remaining_quantity <= quantity`). A violation is dead-lettered with stage `VALIDATE`.
4. **Unknown-order reply.** If `reason` is `UNKNOWN_ORDER`: dead-letter with stage `UNKNOWN_ORDER`, set `needs_reconciliation`, make no state change, and alert.
5. **Sequence check.**
   - `order_seq < me_seq`: stale. Ignore, count it, commit.
   - `order_seq == me_seq`: if status and remaining quantity equal the stored values it is a repeat with a different event ID, so ignore it. Otherwise the engine reused a sequence number with different content. Dead-letter with stage `APPLY`, set `needs_reconciliation`.
   - `order_seq > me_seq`: continue. Gaps are allowed, because quantities are cumulative and a missed event is covered by a later one.
6. **Quantity check.** `remaining_quantity` must not exceed the stored remaining quantity. An increase is impossible and is dead-lettered with stage `APPLY` and `needs_reconciliation`.
7. **Look up the result** in the transition matrix below.
   - **Echo:** only `me_seq` is updated. No history row, no status change, no alert.
   - **Apply:** go to step 8.
   - **Invalid:** dead-letter with stage `APPLY` (stage `STALE_TERMINAL` for an engine-sourced terminal order), set `needs_reconciliation`, alert, change nothing else.
8. **Apply.** In the same transaction: update status, `remaining_quantity_wh`, `status_reason`, `me_seq`, `version`, `updated_at`, and for a terminal status `terminal_source` and `terminal_at`. Append the history row. Adjust the SELL allocation. Commit, and only then commit the Kafka offset.

Because the quantity rule and the sequence rule both hold, replaying the same events in any duplicated or delayed pattern converges to the same final state.

Transition Matrix
-----------------

Rows are the stored status. Columns are the engine status in the event. **A** means apply (the cell shows the new stored status), **E** means echo (identical remaining quantity), **K** means keep `CANCEL_PENDING` and update only quantities and `me_seq`, and **X** means invalid.

| Stored | `NEW` | `PARTIALLY_FILLED` | `FILLED` | `CANCELLED` | `EXPIRED` | `REJECTED` |
|---|---|---|---|---|---|---|
| `PENDING` | A: `OPEN` | A: `PARTIALLY_FILLED` | A: `FILLED` | see note 1 | A: `EXPIRED` | A: `REJECTED` |
| `OPEN` | E | A: `PARTIALLY_FILLED` | A: `FILLED` | X | A: `EXPIRED` | X |
| `PARTIALLY_FILLED` | X | A, or E if remaining is unchanged | A: `FILLED` | X | A: `EXPIRED` | X |
| `CANCEL_PENDING` | K | K (E if unchanged) | A: `FILLED` | A: `CANCELLED` | A: `EXPIRED` | A: `REJECTED` |
| `FILLED`, `CANCELLED`, `EXPIRED`, `REJECTED` | see terminal rules | | | | | |

**Notes**

1. `CANCELLED` is accepted from `PENDING` only for a MARKET order with reason `IOC_REMAINDER` or `NO_LIQUIDITY`. For any other order it is invalid: a user cancel always moves the order to `CANCEL_PENDING` first, and the engine cancels nothing on its own.
2. A `CANCELLED` event with reason `USER_REQUEST` is valid only when the stored status is `CANCEL_PENDING`.
3. A MARKET order never rests. For a MARKET order, `NEW` and `PARTIALLY_FILLED` are invalid in every row.
4. From `PENDING`, any forward engine status is accepted, because earlier events may have been dead-lettered or lost. The quantity rule still applies.
5. `PENDING` to `EXPIRED` and `CANCEL_PENDING` to `REJECTED` are real cases: an order the engine never acknowledged can expire, and an engine can refuse a placement that a cancel then follows.

### Terminal rules

A terminal stored status is never reversed by duplicate or stale events.

| Stored terminal source | Event | Result |
|---|---|---|
| Any | Identical status and remaining quantity, newer `order_seq` | **Echo**: update `me_seq` only |
| `RECONCILER` (stored `EXPIRED`) | Any terminal engine status, remaining quantity not above the stored value | **Supersede**: apply it, set `terminal_source = ME`, record the correction in history, recompute the allocation |
| `RECONCILER` | A non-terminal engine status | **Invalid**: quarantine, flag |
| `ME` | Anything else | **Invalid**: quarantine as `STALE_TERMINAL`, flag, alert |

A late event that conflicts with a legitimate fill or cancellation is therefore never silently overwritten. Either the engine's authoritative event supersedes a reconciler guess, or the conflict is preserved for an operator.

Partial Fills and Quantities
----------------------------

- `remaining_quantity` in every event is **cumulative and absolute**, never a delta. The Order Service never adds or subtracts event quantities. It replaces the stored remaining quantity.
- `filled_quantity_wh = quantity_wh - remaining_quantity_wh`. It is derived, never stored.
- Remaining quantity never increases. It only reaches 0 through `FILLED`.
- Every accepted update satisfies `0 <= remaining <= quantity`, and the database constraints re-check the combination of status and quantity.
- Distinct executions arriving out of order are harmless. A later sequence number already includes any earlier fill, so an older event is simply stale. No execution is lost.
- The engine remains authoritative for execution prices and fill quantities. The Order Service stores no prices or trades.

Status History and Auditability
-------------------------------

One history row is written for every **applied** update that changes the status or the remaining quantity, and for every local transition (creation, cancel request, reconciler expiry). Echoes, stale events, and duplicates write nothing, so a repeated delivery can never create a duplicate history row.

| Column | Content |
|---|---|
| `order_id`, `from_status`, `to_status` | The transition. `to_status` equals `from_status` for a quantity-only change |
| `source` | `USER` (create, cancel request), `ME` (engine update), `RECONCILER`, `SYSTEM` (operator correction) |
| `event_id`, `me_seq` | The triggering engine event, null for local transitions |
| `remaining_quantity_wh` | Remaining quantity after the change |
| `reason` | The engine reason or a local reason |
| `engine_updated_at` | The event's `updated_at`, null for local transitions (new column, see dependencies) |
| `created_at` | Database time of the write |

The table is append-only, enforced by a trigger. History plus `processed_events` lets an operator reconstruct exactly which events produced the current state.

Energy Allocation Synchronization
---------------------------------

The Order Service owns the SELL allocation ledger. Changes are made in the same transaction as the status change.

| Applied change | Ledger effect |
|---|---|
| `PENDING` to `OPEN`, `PARTIALLY_FILLED`, or `CANCEL_PENDING` | None |
| Quantity decrease through fills | None. Filled energy stays consumed. |
| Cancel requested (`CANCEL_PENDING`) | None. Nothing is released on a request. |
| Terminal `CANCELLED`, `EXPIRED`, `REJECTED` | Release the remaining quantity once |
| Terminal `FILLED` | Nothing to release |
| Reconciler `EXPIRED` | Release the remaining quantity once |
| Superseding engine event after a reconciler expiry | Set `released_wh` to the new remaining quantity and add the difference back to `allocated_wh` |
| Echo, stale, duplicate, invalid | None |

Release is idempotent (`released_at IS NULL` guard), so replays and recovery cannot release twice.

Settlement Boundary
-------------------

- The Order Service stores order lifecycle and the cumulative remaining quantity. It stores no trades, execution prices, or money.
- `FILLED` means the engine executed the whole quantity. It does not mean the wallets have been updated.
- The API reports `filled_quantity_wh` and the status. A per-order list of trades comes from Settlement or a trade history service, not from the Order Service.
- The Order Service must never infer settlement from an order update, and Billing must never infer order state from a settlement.

Concurrency with API Requests
-----------------------------

`CancelOrder` and the update consumer both lock the order row, so they are serialized.

- If the engine's `FILLED` is applied first, the cancel finds a terminal order and returns `ORDER_NOT_CANCELLABLE`.
- If the cancel is applied first, the order becomes `CANCEL_PENDING` and the engine's later `FILLED` resolves it to `FILLED`.
- `GetOrder` and `ListOrders` read committed state without locks.

Notifications and other consumers read engine events directly and may be a few seconds ahead of the Order Service. The Order Service is the only source for `PENDING` and `CANCEL_PENDING`, and clients treat notifications as hints and confirm with `GetOrder`.

Error Handling and Recovery
---------------------------

| Case | Handling |
|---|---|
| Malformed or unsupported event, unknown enum, bad UUID | Dead-letter (`DECODE` or `VALIDATE`), commit, alert |
| Unknown order ID | Dead-letter (`UNKNOWN_ORDER`), commit, alert |
| Duplicate event (same `event_id`) | Ignore |
| Stale event (`order_seq` below stored) | Ignore, count |
| Conflicting content with the same `order_seq` | Dead-letter (`APPLY`), flag the order |
| Impossible transition or quantity | Dead-letter (`APPLY` or `STALE_TERMINAL`), flag the order, alert |
| Database failure or timeout | No commit. Pause the partition and retry the same record with backoff up to 60 s. Alert after 5 minutes. Never skip. |
| Consumer restart or repeated delivery | The transaction either committed with the offset not yet committed (then `event_id` deduplicates) or rolled back (then it is applied once) |
| Distinct executions out of order | No action needed, because quantities are cumulative |
| An event that cannot be reconciled automatically | The order is flagged (`needs_reconciliation`), the event is in `consumer_dead_letters`, and an alert fires |
| Non-transient `APPLY` failure | Retried up to five times, then dead-lettered |

Nothing is silently discarded. Every ignored event is counted and every conflicting event is stored with its payload.

### Operator reconciliation path

1. Query pending dead letters and flagged orders.
2. Compare the order history and `me_seq` with the engine's logs and `TradeExecuted` events.
3. If the event is valid but was blocked by a bug, fix the bug and replay with `cmd/dead-letter-replay`. Replay is safe because of deduplication, `me_seq`, and the idempotent allocation release.
4. If the stored state is wrong, an authorised operator applies a correction as a normal transaction with a history row whose source is `SYSTEM`, then clears `needs_reconciliation`.
5. Mark the dead letter `REPLAYED` or `DISCARDED` with a note. Never delete it.

The steps are written into the `dead-letters.md` runbook.

Observability
-------------

| Metric | Meaning |
|---|---|
| `order_updates_applied_total{transition}` | Applied updates by transition |
| `order_updates_ignored_total{kind}` | `duplicate`, `stale`, `echo` |
| `order_updates_quarantined_total{stage}` | Dead-lettered updates |
| `order_orders_needing_reconciliation` | Flagged orders |
| `order_update_apply_duration_seconds` | Transaction latency |
| `order_me_ack_latency_seconds` | Time from order creation to first engine update |

Required Tests
--------------

- **Matrix test:** a table-driven test covers every cell of the transition matrix for LIMIT and MARKET, in every stored status, including notes 1 to 5.
- **Message validation:** each row of the status, event type, and quantity table, and a mismatch for each.
- **Sequence rules:** stale, equal-and-identical, equal-and-different, and gap.
- **Terminal rules:** echo, supersede, invalid, for both terminal sources.
- **Convergence property:** for random valid event sequences, applying them with random duplication, reordering of stale events, and redelivery always ends in the same final state and never lets remaining quantity increase.
- **Crash points:** a crash before the transaction commits, after the commit and before the offset commit, and during dead-letter handling.
- **Concurrency:** a cancel request racing a fill ends in exactly one of `CANCELLED` or `FILLED`.
- **Ledger:** every applied transition leaves `allocated_wh` consistent, and a replay changes nothing.

Decisions and Dependencies
--------------------------

### Resolved decisions

| ID | Open item | Decision |
|---|---|---|
| Y-1 | Actual engine event schemas and topics | `OrderUpdated` on `gridx.orders.updates.v1`, extended as in the Kafka contracts document. |
| Y-2 | Identifier semantics | `event_id` (UUID) identifies the message, `order_id` the order, `order_seq` the order's version. There are no execution identifiers in the order contract. |
| Y-3 | Versioning or sequence guarantee | `order_seq`, strictly increasing per order, set by the engine for every event about it. |
| Y-4 | Cumulative or incremental quantities | Cumulative and absolute. |
| Y-5 | Supported lifecycle and transitions | The transition matrix above. |
| Y-6 | Transaction and offset strategy | One transaction per event or batch, offset committed after the transaction, no skipping on failure. |
| Y-7 | Ownership of allocation and settlement | The Order Service owns SELL allocation. Billing and Settlement own money. |
| Y-8 | Retry, quarantine, replay, reconciliation | Backoff for transient failures, `consumer_dead_letters` for permanent ones, `cmd/dead-letter-replay`, and the operator path above. |

### Remaining items needing sign-off

| ID | Item | Owner |
|---|---|---|
| Y-O1 | Engine contract: `order_seq` on every event, `event_type` agreeing with `status`, `CANCELLED` and `EXPIRED` never with 0 remaining, `REJECTED` mapped by the event mapper, and `order_seq = 0` for `UNKNOWN_ORDER` replies. | Matching Engine |
| Y-O2 | Add the `engine_updated_at TIMESTAMPTZ` column to `order_status_history` in migration `00001`. | Order Service team |
| Y-O3 | The API exposes `status`, `status_reason`, and `filled_quantity_wh` but no trade list. Decide where the trade list for an order comes from. | API Gateway, Billing and Settlement, product |
| Y-O4 | Operator tooling for corrections (the `SYSTEM` history source) and who is authorised. | Operations |

Record confirmed decisions in the shared contracts before describing them as existing behaviour.
