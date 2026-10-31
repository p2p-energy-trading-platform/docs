---
connie-title: Billing Service - Fees and Commission
---

# 05 – Fees and Commission

## Model: balanced split

Both sides of every trade pay a commission to the platform. Rates are in **basis points (bps)** (1 bps = 0.01%) and configurable per side.

| Parameter | Default | Meaning |
|---|---|---|
| `buyer_fee_bps` | 100 (1%) | Added on top of the trade value the buyer pays |
| `seller_fee_bps` | 100 (1%) | Deducted from the seller's proceeds |

Example, trade value = 1,000.00 credits:
- Buyer pays 1,000.00 + 10.00 = **1,010.00**
- Seller receives 1,000.00 − 10.00 = **990.00**
- Platform revenue = **+20.00** (2% of trade value)

Rates need not be equal. Setting one side to 0 gives a seller-only or buyer-only model without code changes which can be useful later.

## Which rate applies, and when

| Side | Rate used | Why |
|---|---|---|
| Buyer | Rate **locked in the hold** when the order was reserved | The reservation and the total shown to the buyer included this fee. Using the current rate could leave the hold too small |
| Seller | Config active at the trade's `executed_at` | Sellers have no pre-funded hold, so nothing needs protecting |

Both rates and both config ids are stored on `trade_settlements`, so any fee can be reproduced later.

## Reservation sizing for buyers

```go
max_value   = TradeValue(qty, max_price)  // limit price, or price collar for market orders
reserve     = max_value + Fee(max_value, buyer_fee_bps) + rounding_buffer
```

Because fills execute at or below `max_price`, the consumed amount (value + fee on the lower value) never exceeds the reservation. Leftover is released when the order completes.

## Rounding rules (single place in code)

```go
// Fee returns round_half_up(value * bps / 10_000).
func Fee(value int64, bps int32) int64 {
    return (value*int64(bps) + 5_000) / 10_000
}
```

- Overflow guard: enforce a max trade value so `value * bps` always fits in int64.
- Each side's fee is computed **independently** from the same `value`, then `seller_credit = value - seller_fee` and `buyer_debit = value + buyer_fee`. This guarantees `buyer_debit = seller_credit + buyer_fee + seller_fee`, so no dust is left over.
- Clamp `seller_fee <= value`; the config check (`bps <= 2000`) already makes this effectively impossible.

## Why there is no minimum fee

A per-fill minimum fee would break reservation sizing: an order that fills in many tiny pieces would pay the minimum many times, and the total could exceed what was reserved.

## Fee configuration management

- `fee_configs` is append-only with `effective_from`. `SetFeeConfig` inserts a new row and never edits old ones.
- The active config is cached in-process (30s TTL), with optional Redis pub/sub invalidation for immediate effect across replicas.
- Bound the rates (`0..2000` bps) in the DB `CHECK` and in the API, and require an admin actor (`created_by`).
- A rate change affects: new buy reservations (new buyer rate), and all sell-side settlements from `effective_from`. Open buy orders keep their locked buyer rate.

## Showing fees in the UI

- Order ticket (buy): quantity, price, **fee at current buyer rate**, estimated total, credits held. For market orders show the collar-based hold as "up to".
- Order ticket (sell): quantity, price, **fee at current seller rate**, estimated net proceeds.
- Trade History: value, fee, and net amount per trade (from `trade_settlements`).

## Revenue reporting

- `PLATFORM_REVENUE` ledger account balance = total fees earned (buyer + seller).
- `GetPlatformRevenue(from, to)` sums its ledger lines in range, grouped by day and optionally by side. Used by the admin dashboard (currently there is no plan or implementation for admin services/frontend).
- Moving platform profit out to a bank is an operational step, recorded as an `ADJUSTMENT` journal debiting `PLATFORM_REVENUE` and crediting `PAYMENT_CLEARING`.