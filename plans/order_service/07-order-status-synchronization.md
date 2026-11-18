---
connie-title: Order Service Status Synchronization
---

Order Status Synchronization
============================

Purpose
-------

This service consumes `OrderUpdated` from `order.state` and applies it to PostgreSQL. The engine is authoritative for fills, remaining quantity, and the transitions it publishes. This service owns `PENDING`, `CANCEL_PENDING`, and the SELL energy ledger.

An update is not a wallet settlement. This version does not call billing.

Input
-----

`OrderUpdated` carries `event_id`, `event_type`, `order_id`, `status`, `remaining_quantity`, `updated_at`, `order_seq`, `reason`, and `user_id`.

- `order_seq` is the only ordering signal. `updated_at` is stored on the history row and is never used to order events.
- `event_id` is a UUID and is the deduplication key.
- `status` is authoritative. `event_type` must agree with it, or the message is malformed.
- `user_id` must equal the stored UUID.

| `status` | Required `event_type` | Required `remaining_quantity` |
|---|---|---|
| `NEW` | `UPDATED` | equals `quantity` |
| `PARTIALLY_FILLED` | `PARTIALLY_FILLED` | from 1 to `quantity - 1` |
| `FILLED` | `FILLED` | 0 |
| `CANCELLED` | `CANCELLED` | at least 1, unless reason is `IOC_REMAINDER` and some quantity was already filled, in which case remaining is the unfilled part and is at least 1 |
| `EXPIRED` | `EXPIRED` | at least 1 |
| `REJECTED` | `REJECTED` | equals `quantity` |

A `CANCELLED` or `EXPIRED` order with nothing left is invalid, because a fully executed order is `FILLED`.

`REJECTED` with reason `UNKNOWN_ORDER` is the engine's reply to a cancel for an order it does not have. `order_seq` is 0. Handle it before the sequence check. Do not apply it. Dead-letter it with stage `UNKNOWN_ORDER`, set `needs_reconciliation`, and alert.

Procedure
---------

One database transaction:

1. Insert `event_id` into `processed_events`. If it exists, commit and advance the offset.
2. Lock the order. If it does not exist, dead-letter `UNKNOWN_ORDER`, commit, and alert.
3. Validate the table above, a UUID `event_id`, a non-zero `order_id`, and `remaining_quantity <= quantity`. A bad message is stage `VALIDATE`.
4. If `reason` is `UNKNOWN_ORDER`, stop as above.
5. Sequence:
   - `order_seq < me_seq`: stale. Count it and commit.
   - `order_seq == me_seq`: if status and remaining quantity match, ignore. If they differ, the sequence was reused. Dead-letter `APPLY` and set `needs_reconciliation`.
   - `order_seq > me_seq`: continue. A gap is allowed because the quantity is cumulative.
6. Remaining quantity must not exceed the stored remaining quantity. An increase is dead-lettered.
7. Look up the matrix.
   - Echo: update `me_seq` only.
   - Apply: step 8.
   - Invalid: dead-letter `APPLY`, or `STALE_TERMINAL` when the stored order is already terminal. Set `needs_reconciliation`. Change nothing else.
8. Update status, remaining quantity, reason, `me_seq`, `version`, and `terminal_at` when the new status is terminal. Append history. Release unused SELL energy. Commit, then commit the offset.

Transition matrix
-----------------

Rows are the stored status. **A** applies the new status, **E** is an echo, **K** keeps `CANCEL_PENDING` and updates quantity and `me_seq`, **X** is invalid.

| Stored | `NEW` | `PARTIALLY_FILLED` | `FILLED` | `CANCELLED` | `EXPIRED` | `REJECTED` |
|---|---|---|---|---|---|---|
| `PENDING` | A `OPEN` | A `PARTIALLY_FILLED` | A `FILLED` | note 1 | A `EXPIRED` | A `REJECTED` |
| `OPEN` | E | A `PARTIALLY_FILLED` | A `FILLED` | X | A `EXPIRED` | X |
| `PARTIALLY_FILLED` | X | A, or E if remaining is unchanged | A `FILLED` | X | A `EXPIRED` | X |
| `CANCEL_PENDING` | K | K, or E if unchanged | A `FILLED` | A `CANCELLED` | A `EXPIRED` | A `REJECTED` |
| terminal | invalid, quarantine | | | | | |

Notes:

1. `CANCELLED` from `PENDING` is valid only for a MARKET order with `IOC_REMAINDER` or `NO_LIQUIDITY`.
2. `CANCELLED` with `USER_REQUEST` is valid only from `CANCEL_PENDING`.
3. For a MARKET order, `NEW` and `PARTIALLY_FILLED` are invalid in every row.
4. From `PENDING`, a forward engine status is accepted even if an earlier event was lost. The quantity rule still applies.

A terminal row is not reversed. An identical newer event is an echo. Any other event on a terminal row is quarantined.

Quantities
----------

`remaining_quantity` replaces the stored value. It is not added or subtracted. Filled quantity is `quantity_wh - remaining_quantity_wh` and is not a column. Remaining quantity never increases and reaches 0 only through `FILLED`.

History
-------

Write a history row when an applied update changes status or remaining quantity, and for creation and cancel request. Echoes, stale events, and duplicates write nothing.

| Column | Content |
|---|---|
| `from_status`, `to_status` | The transition. Equal when only the quantity changed. |
| `source` | `USER`, `ME`, or `SYSTEM` |
| `event_id`, `me_seq` | The engine event, null for a local transition |
| `remaining_quantity_wh` | After the change |
| `reason` | Engine or local reason |
| `engine_updated_at` | The event timestamp, null for a local transition |

The table is append-only.

Abnormal cases
--------------

| Case | Result |
|---|---|
| Duplicate `event_id` | No state change |
| Older `order_seq` | No state change |
| Same `order_seq`, same content | No state change |
| Same `order_seq`, different content | Quarantine, flag |
| Remaining quantity would increase | Quarantine, flag |
| Unknown `order_id` | Quarantine, alert, no new order |
| Event after a terminal status that is not an echo | Quarantine, flag |
| Consumer dies before the offset commit | Transaction rolls back, the record is redelivered, and it applies once |

`needs_reconciliation` is cleared only by an operator action that records a `SYSTEM` history row. The service does not guess a correction.

A cancel that races a fill ends as exactly one of `CANCELLED` or `FILLED`, whichever `order_seq` says. It does not end as both.
