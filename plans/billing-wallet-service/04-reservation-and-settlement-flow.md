---
connie-title: Billing Service - Reservation and Settlement flow
---

# 04 – Reservation and Settlement Flows

## 4.1 Buy order lifecycle (happy path)

```
User ──► Gateway ──► OMS ──► Billing.ReserveCredits ──► (hold ACTIVE)
                       │
                       ▼ order accepted into book
                  Matching engine ── trade ──► OMS ──► Billing.SettleTrade (per fill)
                       │
              order filled / cancelled ──► OMS ──► Billing.ReleaseReservation (if anything left)
```

OMS must call `ReserveCredits` **before** the order reaches the matching engine, and reject the order if billing says `INSUFFICIENT_FUNDS`. This applies to both **limit** and **market** buy orders. Sell orders skip reservation (the seller fee comes out of proceeds).

## 4.2 ReserveCredits (one DB transaction)

1. Check idempotency: `SELECT` hold by `(ORDER, order_id)`. If found with identical params, return it. If found with different params, `IDEMPOTENCY_CONFLICT`.
2. Compute `max_value = TradeValue(qty, max_price)`, then `amount = max_value + Fee(max_value, buyer_fee_bps) + rounding_buffer`, where `buyer_fee_bps` is the **currently active** rate (it is snapshotted in step 7). For limit orders `max_price` is the limit price; for market orders it is the price collar.
3. Get-or-create wallet for `user_id`.
4. `SELECT ... FROM wallets WHERE id = $1 FOR UPDATE`.
5. Reject if wallet not ACTIVE or `available < amount`.
6. `UPDATE wallets SET available = available - amount, reserved = reserved + amount, version = version + 1`.
7. `INSERT INTO holds (... ACTIVE ...)`, storing `order_type`, `qty_wh`, `max_price_per_kwh`, `buyer_fee_bps` and `buyer_fee_config_id`.
8. Insert outbox event `wallet.balance_changed`.
9. Commit.

Alternative without explicit lock (also fine): single statement
`UPDATE wallets SET available = available - $a, reserved = reserved + $a WHERE id = $1 AND available >= $a AND status='ACTIVE'` and check rows affected. The `CHECK` constraints are a second line of defence either way.

### Rounding buffer

Per-fill rounding means the sum of per-fill values can exceed the order-level value by a few minor units. To handle this scenario, we can reserve with `buffer = max_fills_per_order * 1 unit` (e.g. 50 units = 0.50 credits) and release the unused part on completion. This must be shown in the user-facing UI as "up to X credits held".

### Market orders

A market buy has no price of its own, so the reservation needs an upper bound:

- OMS supplies `max_price_per_kwh` (the **price collar**), for example best ask plus a slippage cap, or a platform-wide max price. Billing rejects a market buy without it (`MARKET_ORDER_NEEDS_COLLAR`).
- Billing reserves for the full quantity at the collar. The matching engine must not fill above the collar and the billing enforces the same rule at settlement.
- Typical market fills execute well below the collar, so most of the hold returns to `available` when the order completes. UI should show this fact as "up to X credits held".
- Unfilled market quantity is cancelled by matching (IOC-style). OMS then calls `ReleaseReservation` (or sends `buy_order_final = true` on the last fill).
- Market **sell** orders need nothing from billing until they trade.
- Trade-off: a wide collar locks more credits than needed. Keep the collar tight (a slippage cap such as 5–10% above best ask) to avoid rejecting users who can afford the likely fill price.

## 4.3 SettleTrade (one DB transaction)

Inputs: trade, buyer, seller, qty, execution price.

1. If `trade_settlements` has `trade_id` then return stored result with `already_settled = true`.
2. Pick the rates: **buyer rate = the hold's snapshotted `buyer_fee_bps`** (what the buyer was shown and reserved for) and **seller rate = fee config active at `executed_at`** (cached in-process ~30s). Both rates and config ids are stored on the settlement.
3. Compute (all integers):
   - `value = TradeValue(qty, price)`
   - `buyer_fee = Fee(value, buyer_fee_bps)`; `seller_fee = Fee(value, seller_fee_bps)` (both sides always pay in the split model)
   - `buyer_debit = value + buyer_fee`
   - `seller_credit = value - seller_fee`
   - `platform_credit = buyer_fee + seller_fee`
   - Check: `buyer_debit == seller_credit + platform_credit`
4. **Lock wallets in deterministic order** (sort by wallet_id) to avoid deadlocks: `SELECT ... FOR UPDATE`.
5. Load buyer hold `FOR UPDATE`, require `price_per_kwh <= hold.max_price_per_kwh` (else `PRICE_EXCEEDS_RESERVATION`) and `remaining >= buyer_debit` (else `HOLD_INSUFFICIENT_REMAINING`).
6. Update wallets:
   - Buyer: `reserved -= buyer_debit`
   - Seller: `available += seller_credit`
7. Update hold: `amount_consumed += buyer_debit`. If `buy_order_final`: `amount_released += remaining_after`; buyer `reserved -= leftover`, `available += leftover`; status → `CONSUMED`/`RELEASED`.
8. Insert journal `TRADE_SETTLEMENT` (`idempotency_key = 'settle:' || trade_id`) with lines:

| Account | Amount |
|---|---|
| Buyer wallet | `-buyer_debit` |
| Seller wallet | `+seller_credit` |
| PLATFORM_REVENUE | `+platform_credit` |

Sum = 0.

1. Insert `trade_settlements` row, outbox events (`trade.settled`, balance changes for both users).
2. Commit.

**Price improvement:** if a buyer's limit is 50 but the trade executes at 45, only the executed value is consumed; the difference stays in the hold and returns to `available` when the order is final. For market buys this is the normal case, since the hold was sized at the collar.

**Self-trade:** `buyer_user_id == seller_user_id` should be rejected upstream by OMS/matching and billing also rejects (`INVALID_ARGUMENT`) as a guard.

## 4.4 AdjustReservation

- Used when OMS amends an open order (new price/qty).
- New required amount is computed for the *remaining* qty: `new_amount = consumed + TradeValue(new_qty, new_max_price) + Fee(that value, hold.buyer_fee_bps) + buffer`. The hold keeps its original locked buyer rate.
- Increase → need extra `available`; decrease → release the difference. Same lock/update pattern as reserve. Idempotent on `idempotency_key`.
- Simplest v1 alternative: OMS does cancel + new order (release then reserve). Start with that and add `AdjustReservation` only if needed.

## 4.5 ReleaseReservation

1. Lock wallet and hold. If hold already terminal then return `released_amount = 0` (idempotent).
2. `leftover = remaining`, wallet `reserved -= leftover`, `available += leftover`.
3. `amount_released += leftover`. status is changed to `RELEASED` (or `CONSUMED` if fully consumed).
4. Outbox event.

## 4.6 Reservation expiry (safety net)

- Orders can be GTC, so `expires_at` should be generous (Ex: order expiry + 1 day) and only reclaim holds whose order OMS no longer knows about.
- Background sweeper: `SELECT ... FROM holds WHERE status='ACTIVE' AND expires_at < now() FOR UPDATE SKIP LOCKED LIMIT 100` then release each in its own transaction. `SKIP LOCKED` lets multiple replicas run it without coordination.
- Do **not** silently expire holds for orders that are still open: if OMS is the authority, have the sweeper emit a `hold.expiring` event or call OMS to confirm before releasing (this must be discussed later before implementation).

## 4.7 Failure scenarios to design for

| Scenario | Handling |
|---|---|
| OMS reserves, crashes before sending to matching engine | Hold sits ACTIVE then OMS recovery releases it, sweeper is the backstop |
| Network timeout on `ReserveCredits`, OMS retries | Unique `(kind, ref_id)` means same hold returned, no double lock |
| `SettleTrade` times out but committed | Retry returns `already_settled = true` |
| Settlement fails permanently (e.g. hold insufficient) | OMS marks trade `SETTLEMENT_FAILED`, alerts and billing logs full context. Needs a manual runbook |
| Two trades for same buyer settle concurrently | Row locks on wallet and hold serialise them |
| Matching fills a market buy above its collar | Billing refuses the fill (`PRICE_EXCEEDS_RESERVATION`), OMS flags the trade and alerts. Fix the collar enforcement in matching/OMS |
| Fee config changes while buy orders are open | Buyer fee rate is locked in the hold, so reservations stay sufficient. Only new orders see the new buyer rate |
| Billing down | OMS rejects new buy orders (fail closed) and settlement retried from OMS queue with backoff |

## 4.8 Sequence summary (settlement)

```
OMS ─SettleTrade(trade_id,…)─► Billing
   Billing: BEGIN
            idempotency check → fee config → compute
            lock wallets (sorted) → lock hold
            update wallets/hold → journal + lines → settlement row → outbox
            COMMIT
   Billing ─response─► OMS
   Outbox relay ─► event bus ─► notification / WebSocket service (balance updates)
```
