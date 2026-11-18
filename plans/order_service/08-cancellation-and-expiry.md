---
connie-title: Order Service Cancellation and Expiry
---

Cancellation and Expiry
=======================

Purpose
-------

This document defines how a user cancels an order and how expiry is recorded. The Matching Engine decides the cancel-versus-fill race and decides when an order expires. This service requests a cancel, then applies `OrderUpdated`. It does not expire an order because a local timer fired.

Cancellation
------------

`CancelOrder` is allowed from `PENDING`, `OPEN`, and `PARTIALLY_FILLED`.

| Stored status | Result |
|---|---|
| `CANCEL_PENDING` | `OK` with the current order. No second command. |
| `FILLED`, `CANCELLED`, `EXPIRED`, `REJECTED` | `ABORTED` / `ORDER_NOT_CANCELLABLE` |
| `PENDING` and the type is `MARKET` | Allowed. The command can still win if the engine has not finished the order. |
| Anything else non-terminal | One transaction sets `CANCEL_PENDING`, writes history (`source = USER`), and inserts an `order.cancel_requested` outbox row. The energy allocation is not released. |

The command carries a new `event_id`, the `order_id`, the user UUID, and `requested_at`. It is published to `order.cancel_requested` with key `order_id`.

The engine answers on `order.state`:

| Outcome | Stored result |
|---|---|
| Cancel applied | `CANCELLED`, reason `USER_REQUEST`. Remaining SELL quantity is released. |
| Partial fill first, order still resting | Stays `CANCEL_PENDING`. Quantities update. The final event follows. |
| Filled before the cancel | `FILLED`. Nothing is released. |
| Already terminal at the engine | The engine echoes that status with a new `order_seq`. `CANCEL_PENDING` moves to it. |
| Engine has never seen the order | `REJECTED` / `UNKNOWN_ORDER` is quarantined and flagged. The row stays `CANCEL_PENDING`. It is not marked cancelled. |
| No answer yet | Stays `CANCEL_PENDING`. After 30 s an alert fires. A timeout is neither success nor failure. |

A MARKET order can be cancelled by the user only while it is `PENDING`. Once the engine has published `FILLED` or `CANCELLED`, the order is terminal.

Expiry
------

| Question | Rule |
|---|---|
| Which orders expire | Any non-terminal order the engine still has, or a `PENDING` order the engine rejects as late |
| When | LIMIT: `delivery_slot_end`. MARKET: `min(created_at + 30 s, delivery_slot_end)`. `expires_at` is set here and is not taken from the client. |
| Who writes `EXPIRED` | The Matching Engine, on `order.state`, reason `SLOT_ENDED` |
| Partial fill | `EXPIRED` keeps the fills. Remaining quantity is greater than 0 and is released from the SELL ledger. |
| Fully filled | `FILLED`, never `EXPIRED` |
| New orders | Accepted only before `delivery_slot_start` |

This service does not run a job that sets `EXPIRED`. If `expires_at` has passed and the status is still non-terminal, the pending-age alert already covers a missing acknowledgement, and a separate alert fires for an order past `expires_at` that is still `OPEN`, `PARTIALLY_FILLED`, `PENDING`, or `CANCEL_PENDING`. An operator investigates. The row changes only when an `OrderUpdated` arrives.

An order that reaches the engine after `expires_at` is `REJECTED` with `ORDER_EXPIRED`. The SELL allocation is released with that rejection.

Energy release
--------------

Release the remaining quantity once, in the same transaction as the terminal status.

| Event | Release |
|---|---|
| `CANCELLED` | Remaining quantity |
| `EXPIRED` | Remaining quantity |
| `REJECTED` | The whole quantity |
| `FILLED` | Nothing |
| Partial fill, then cancel or expiry | The remaining quantity. Filled energy stays consumed. |
| `CANCEL_PENDING` only | Nothing |
| Duplicate terminal event | Nothing, because `released_at` is already set |

Example. A SELL of 2000 Wh fills 500 Wh and is then cancelled. The `CANCELLED` event has remaining 1500, so 1500 Wh is released and 500 Wh stays consumed.

Wallet
------

This version does not reserve, settle, or release credits. There is no billing client and no billing message defined in this folder.

When that work starts, call the existing service. Do not invent a second one:

`protobuf/proto/gridx/billing/v1/order_billing.proto`

- `OrderBillingService.ReserveCredits`
- `OrderBillingService.ReleaseReservation`
- `OrderBillingService.SettleTrade`

Amounts in that file are minor units, 1 credit = 100, which is the same unit as `orders.price`. A MARKET buy's `max_price_per_kwh` is the protection price stored on the order. A LIMIT buy's is the limit price. SELL orders are not reserved. None of those calls are part of the implementation described here.

Alerts and tests
----------------

| Signal | Meaning |
|---|---|
| `order_cancel_requests_total{result}` | Cancel requests by outcome |
| `order_cancel_pending_age_seconds` | Oldest `CANCEL_PENDING` |
| `order_past_expiry_open_total` | Non-terminal orders whose `expires_at` has passed |

Tests:

- Cancel from every stored status, and a repeated cancel.
- A cancel racing a fill ends as exactly one of `CANCELLED` or `FILLED`.
- A partial fill then a cancel releases only the remainder.
- One cancel command exists per order. A second request does not write a second outbox row.
- No code path sets `EXPIRED` without an `OrderUpdated`.
- MARKET cancel is accepted only from `PENDING`.
- A terminal engine event releases SELL energy once.
