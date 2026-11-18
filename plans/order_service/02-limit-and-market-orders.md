---
connie-title: Limit and Market Orders
---

Limit and Market Orders
=======================

Purpose
-------

Both order types are part of this service. The Order Service checks the request and stores it. The Matching Engine decides matches, prices, and fill quantities. The engine does not implement MARKET yet. That work is in [proposed engine changes](../matching-engine/proposed-engine-changes.md). This document is the behaviour the order service implements and the behaviour it expects on `order.state`.

Units
-----

- Quantity is watt-hours.
- Price is minor units of LKR per kWh. 1 LKR = 100. Tick is 1.
- This service does not compute a trade value.

Order types
-----------

| Type | Behaviour |
|---|---|
| `LIMIT` | Rests until filled, cancelled, or the slot ends. |
| `MARKET` | Immediate-or-cancel. Required protection price. Never rests. Unmatched quantity is cancelled. |

A MARKET request is not feature-flagged. A missing protection price is `INVALID_ORDER` before anything is stored.

Price
-----

- **BUY.** The price is the maximum all-in price per kWh, including the grid fee.
- **SELL.** The price is the minimum energy price per kWh the seller will receive. The grid fee is not taken out of the seller's price.

The engine matches when:

- incoming BUY: `seller_price + grid_fee <= buyer_price`
- incoming SELL: `seller_price <= buyer_price - grid_fee`

Same-grid trades use a grid fee of 0. A grid pair with no transfer rule does not match. For a LIMIT order the price is the limit. For a MARKET order it is the protection price.

A trade executes at the resting order's price. The incoming order receives any price improvement.

| Incoming | Resting | Energy price | Buyer pays | Seller receives |
|---|---|---|---|---|
| BUY | SELL | seller's price | energy price + grid fee | energy price |
| SELL | BUY | buyer price − grid fee | buyer price | energy price |

The order service stores the price the user sent. It does not recompute the execution price. Grid fees are applied by the engine from `grid.transfer`. This service does not look them up.

LIMIT
-----

- Active for its 30-minute slot. Unmatched quantity expires at slot end with status `EXPIRED`.
- Unfilled quantity rests.
- Each fill arrives as an `OrderUpdated` with the cumulative remaining quantity.

Example. Resting BUY on grid `grid-a` at 5000 (50.00 LKR/kWh). Incoming SELL on grid `grid-b` at 4400, grid fee 400, quantity 2000 Wh.

- Effective bid is `5000 - 400 = 4600`, which is at least 4400, so they match.
- Energy price is 4600 and the fee is 400. The buyer pays 5000 per kWh. The seller receives 4600 per kWh.
- The order service records the remaining quantities from `order.state`. It does not record the money.

MARKET
------

A MARKET order matches immediately inside its protection price and never enters the book. Quantity that cannot match is cancelled.

- BUY protection price: maximum all-in price per kWh.
- SELL protection price: minimum energy price per kWh.
- The price is required and uses the same tick and band as a LIMIT price. The engine receives it in `price`.
- Lifetime is 30 seconds after creation, and not past the slot end. An order that arrives at the engine after `expires_at` is `REJECTED` with `ORDER_EXPIRED` and does not trade.

The engine publishes one final `OrderUpdated` for the MARKET order.

| Case | Final status | Reason |
|---|---|---|
| Fully matched | `FILLED` | none |
| Partly matched, remainder cancelled | `CANCELLED` | `IOC_REMAINDER` |
| Nothing eligible | `CANCELLED` | `NO_LIQUIDITY` |
| Arrived after `expires_at` | `REJECTED` | `ORDER_EXPIRED` |
| Failed engine validation | `REJECTED` | `INVALID_ORDER` |

A MARKET order is never `OPEN` or `PARTIALLY_FILLED`. The user can cancel it only while it is `PENDING`. Fills that happened before the remainder was cancelled stay filled, and the SELL ledger releases only the cancelled remainder.

Example. Same-grid BUY, 3000 Wh. Resting SELLs: 2000 Wh at 4300 and 2000 Wh at 4500.

- Protection price 5000. Both sells are inside it. The order becomes `FILLED` (2000 Wh at 4300, then 1000 Wh at 4500).
- Protection price 4400. Only the first sell matches. Status `CANCELLED`, reason `IOC_REMAINDER`, 2000 Wh filled, 1000 Wh released.
- Empty book. Status `CANCELLED`, reason `NO_LIQUIDITY`, remaining quantity equals the original quantity.

SELL and BUY
------------

A SELL of either type must pass the energy rules before it is stored. Capacity is reserved in the same transaction as the order. Rejection, cancellation, and expiry release the unused quantity. Filled energy stays consumed.

A BUY of either type is accepted without a wallet check in this version. The stored price is the amount a later `ReserveCredits` call would send as `max_price_per_kwh`: the LIMIT price, or the MARKET protection price. That call is not made here. The contract, when it is used, is `OrderBillingService` in `protobuf/proto/gridx/billing/v1/order_billing.proto`.
