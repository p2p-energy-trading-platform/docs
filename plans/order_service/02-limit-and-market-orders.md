---
connie-title: Limit and Market Orders
---

Limit and Market Orders
=======================

Purpose
-------

This document defines the behaviour of orders by type in GridX. The Order Service validates and coordinates order submission. The Matching Engine determines eligible matches, execution prices, and authoritative fill quantities.

Order Types
-----------

| Order type | Status | Notes |
|---|---|---|
| `LIMIT` | Supported | Rests in the book until filled, cancelled, or the slot ends. |
| `MARKET` | Supported, enabled by `ORDER_MARKET_ENABLED` | Immediate-or-cancel with a protection price. Never rests. The flag stays off until the `protobuf` enum value and the Matching Engine support are released. |

While the flag is off, a MARKET request is rejected with `ORDER_TYPE_NOT_SUPPORTED` before anything is persisted.

Units
-----

- Quantity is an `int64` in watt-hours (Wh).
- Price is an `int64` in micro-AED per kWh (1 AED = 1,000,000 micro-AED), in whole-fil ticks of 10,000. The grid fee uses the same unit.
- Trade value in micro-AED is `price x quantity_wh / 1000`.

Price Semantics
---------------

The price boundary is defined against the engine's effective-price rule, so the two sides do not mean the same thing:

- **BUY:** the maximum **all-in** price per kWh the buyer will pay, including any grid fee.
- **SELL:** the minimum **energy** price per kWh the seller will receive. The grid fee is never deducted from the seller.

The engine matches when the following holds, where `grid_fee` is 0 for same-zone trades:

- Incoming BUY: `seller_price + grid_fee <= buyer_price`
- Incoming SELL: `seller_price <= buyer_price - grid_fee`

For a LIMIT order the price is the limit. For a MARKET order it is the protection price (below). The grid fee comes from the grid transfer rule for the seller and buyer zones. A zone pair with no rule never matches.

### Execution price

A trade executes at the **resting order's price**. The incoming order gets any price improvement. This is confirmed in the engine code (`SameZoneMatcher`, and the BUY path of `CrossZoneMatcher`).

| Incoming | Resting | `energy_price` | `grid_fee` | Buyer pays | Seller receives |
|---|---|---|---|---|---|
| BUY | SELL | seller's price | rule fee | `energy_price + grid_fee` | `energy_price` |
| SELL | BUY | `buyer_price - grid_fee` | rule fee | `buyer_price` | `energy_price` |

**Defect to fix in the engine:** in the cross-zone SELL path the engine uses the resting buyer's price as the energy price and then adds the grid fee, so the buyer pays more than their all-in price. The energy price must be `buyer_price - grid_fee`. Cross-zone matching is also not wired: `MatchingEngine::match` calls only `SameZoneMatcher`.

LIMIT Orders
------------

A LIMIT order states the price at which a participant is willing to trade.

- It is active only for its 30-minute delivery slot. Unmatched quantity expires at slot end and the status becomes `EXPIRED`.
- The engine applies effective-price-time priority and keeps unfilled quantity resting in its book.
- Each fill is one trade. After every change the engine publishes the cumulative remaining quantity in `OrderUpdated`, applied by `order_seq` (see Order Validation, D-07).

### Worked example

Resting BUY in Zone A, limit 500000 micro-AED per kWh. Incoming SELL in Zone B, limit 440000, grid fee 40000, quantity 2000 Wh.

- Effective bid is `500000 - 40000 = 460000`, which is at least 440000, so they match.
- The trade executes at `energy_price = 460000` and `grid_fee = 40000`. The buyer pays 500000 per kWh and the seller receives 460000 per kWh.
- Seller amount is `460000 x 2000 / 1000 = 920000` micro-AED (AED 0.92). Buyer amount is `500000 x 2000 / 1000 = 1000000` micro-AED (AED 1.00).

MARKET Orders
-------------

A MARKET order is **immediate-or-cancel with a protection price**. It matches against the book at once and never rests. Whatever cannot be matched within the protection price is cancelled.

### Protection price

- BUY: the maximum all-in price per kWh the buyer will accept.
- SELL: the minimum energy price per kWh the seller will accept.
- It is optional. If omitted, the Order Service uses the band maximum for BUY and the band minimum for SELL, and records `price_defaulted = true`. A configuration setting can make it required.
- It passes the same tick and band checks as a LIMIT price. The engine always receives a positive price in the `price` field.

### Lifetime

A MARKET order is valid for `MARKET TTL` (default 30 s) after creation, capped at the slot end. An order that reaches the engine after `expires_at`, for example after an outage or a Kafka replay, is rejected with reason `ORDER_EXPIRED` and never executes late.

### Matching and outcomes

Matching uses the same effective-price rule as LIMIT, with the protection price in the limit's role. The engine publishes exactly one final `OrderUpdated` per MARKET order.

| Case | Final status | Reason | Fills |
|---|---|---|---|
| Fully matched | `FILLED` | none | All |
| Partly matched, remainder cancelled | `CANCELLED` | `IOC_REMAINDER` | Retained |
| Nothing eligible | `CANCELLED` | `NO_LIQUIDITY` | None |
| Arrived after `expires_at` | `REJECTED` | `ORDER_EXPIRED` | None |
| Failed validation | `REJECTED` | `INVALID_ORDER` | None |

A MARKET order never has status `OPEN` or `PARTIALLY_FILLED`. It can be cancelled by the user only while it is still `PENDING`.

### Worked examples

Same-zone BUY, 3000 Wh. Resting SELLs: 2000 Wh at 430000 and 2000 Wh at 450000 micro-AED per kWh.

- Protection price defaulted to 5000000. Trade 1: 2000 Wh at 430000 (AED 0.86). Trade 2: 1000 Wh at 450000 (AED 0.45). Order status is `FILLED`.
- Protection price 440000. Only the first SELL is eligible. Trade: 2000 Wh at 430000. The remaining 1000 Wh is cancelled with `IOC_REMAINDER`, and the 2000 Wh fill is retained.
- Empty book: status `CANCELLED` with `NO_LIQUIDITY`, remaining quantity equals quantity.

Fees and Settlement
-------------------

- The grid fee is borne by the buyer and takes part in matching. It appears on every `TradeExecuted` as `grid_fee_per_kwh`.
- Billing also calculates a platform fee commission (`fee_configs`) at settlement. The platform fee never changes a price boundary or an execution price.
- Amounts are exact in micro-AED up to the division by 1000. Billing's wallet uses minor units of 1/100 credit, so Billing rounds per trade when posting. Billing owns the rule.
- The Order Service stores no money amounts and never recomputes execution prices or fills.

SELL Order Constraints
----------------------

A SELL order of either type must satisfy the energy rules in Order Validation (D-04) before it is accepted:

- Meter online, reading fresh, and the quantity within the slot's allocatable capacity.
- Capacity is allocated atomically by the Order Service when the order is created.
- Rejected, cancelled, and expired orders release their unused allocation. For a MARKET order the cancelled remainder is released at once, and filled energy stays consumed.
- Grid fees do not change the seller's minimum price.

BUY Order Constraints
---------------------

GridX uses admin-funded wallet credits and has no payment gateway. Billing has no reservation contract yet, so no wallet check exists in v1. When reservation exists, a LIMIT BUY reserves `limit price x quantity` and a MARKET BUY reserves the worst case `protection price x quantity`, with the unused part released on completion. Whether production BUY orders stay restricted until then is decided in the cancellation and expiry plan.

Matching Engine Verification Checklist
--------------------------------------

1. Price boundaries are enforced for both sides using the effective-price rule.
2. The execution price is the resting order's price, including the cross-zone SELL fix.
3. Cross-zone matching is wired into `MatchingEngine::match`, or v1 is declared same-zone only.
4. Partial fills and multiple trades update remaining quantity correctly and publish cumulative values.
5. A zone pair with no grid transfer rule never matches.
6. Unmatched LIMIT quantity expires at slot end and publishes `EXPIRED`.
7. MARKET orders never enter the book, and exactly one final `OrderUpdated` is published for each.
8. An order arriving after `expires_at` is rejected with `ORDER_EXPIRED`.
9. The engine publishes an `OrderUpdated` for every incoming order, not only resting ones.
10. `TradeExecuted` carries `delivery_slot_start` and the user UUIDs.

Decisions and Dependencies
--------------------------

### Resolved decisions

| ID | Item | Decision |
|---|---|---|
| L-1 | Does the engine support MARKET and IOC? | Not yet. MARKET is added as IOC with a protection price. Engine and proto changes are listed in the plan, and `ORDER_MARKET_ENABLED` gates it. |
| L-2 | Market protection in the shared schema | The `price` field carries the protection price. No new field is needed. |
| L-3 | Statuses for no-fill and partially filled MARKET orders | `CANCELLED` with reason `NO_LIQUIDITY` or `IOC_REMAINDER`. Fills are retained. |
| L-4 | Execution-price rule | Resting order's price, confirmed in code, with the cross-zone SELL defect to fix. |
| L-5 | Fees on price boundaries | BUY price is all-in including grid fee. SELL price is net energy price. Platform fee is applied by Billing at settlement and never affects matching. |
| L-6 | Sellable energy validation and over-allocation | The Order Service allocation ledger (Order Validation, D-04). |
| L-7 | How results reach the Order Service | `OrderUpdated` on `gridx.orders.updates.v1`, cumulative, guarded by `order_seq` (Order Validation, D-07). |
| L-8 | Settlement and rounding | Settlement consumes one `TradeExecuted` per fill, computes amounts in micro-AED, and Billing rounds per trade. |
| L-9 | MARKET lifetime | 30 s TTL capped at slot end. Late arrivals are rejected. |

### Remaining items needing sign-off

| ID | Item | Owner |
|---|---|---|
| L-O1 | Engine: `ORDER_TYPE_MARKET`, `incomingOutcome`, `OrderUpdateReason`, expired-order rejection, cross-zone SELL price fix, and cross-zone wiring. | Matching Engine |
| L-O2 | Protobuf: `ORDER_TYPE_MARKET`, `ORDER_STATUS_REJECTED`, `ORDER_UPDATE_TYPE_REJECTED`, `OrderUpdated` new fields. | Matching Engine, protobuf maintainers |
| L-O3 | Should the MARKET protection price be required instead of defaulting to the band bound? | Product |
| L-O4 | Billing's per-trade rounding rule and the BUY reservation amount for MARKET. | Billing and Settlement |
| L-O5 | Whether production BUY orders are blocked until reservation exists. | Product, Billing and Settlement (decided in the cancellation and expiry plan) |

Record these decisions in the shared contracts and the Matching Engine documentation so the Order Service, the Matching Engine, and Settlement use the same price rules.
