# Matching Algorithm

## Purpose

This document describes how the Matching Engine processes incoming orders and creates trades.

This matching algorithm is based on the Continuous Double Auction (CDA) market model with additional business rules for energy trading.

---

## Matching Strategy

The matching algorithm follows these principles:

* Continuous order matching
* Match only within the same 30-minute delivery slot
* Allow cross-zone matching when Grid Transfer Policy allows it
* Include grid fees in effective price calculation
* Effective-Price-Time Priority
* Support partial fills
* Support multiple trades from a single order
* Expire unmatched quantity when the delivery slot ends
* Process both manual and automatic orders using the same logic

---

## Matching Flow

```text
Receive Order
      │
      ▼
Validate Delivery Slot
      │
      ▼
Select Market Book
      │
      ▼
Load Zone Order Books
      │
      ▼
Find Eligible Same-Zone and Cross-Zone Opposite Orders
      │
      ▼
Find Matching Orders
      │
      ▼
Generate Trades
      │
      ▼
Update Order Book
      │
      ▼
Update Order Status
      │
      ▼
Publish Events
```

---

## Step 1 - Receive Order

The Matching Engine consumes a new order event from Kafka.

The source of the order does not affect the matching process.

---

## Step 2 - Select Market Book

Each order contains a delivery slot and product type.

For the initial implementation:

```text
Product Type: ENERGY
Delivery Slot Duration: 30 minutes
```

The Matching Engine selects the Market Book using:

```text
delivery_slot_start + product_type
```

Orders are matched only within the same Market Book.

The order's grid zone is still used, but it represents the participant's location and is used for cross-zone transfer rules and grid fee calculation.

---

## Step 3 - Load Eligible Opposite Orders

The engine searches the opposite side of the selected Market Book.

For a BUY order, the engine searches SELL orders.

For a SELL order, the engine searches BUY orders.

The search may include:

* Same-zone orders
* Cross-zone orders where transfer is allowed by Grid Transfer Policy

---

## Step 4 - Find Matching Orders

The engine searches the selected Order Book for matching orders.

Matching conditions:

For BUY orders:

```text
seller_price + grid_fee <= buyer_limit_price
```

For SELL orders:

```text
seller_limit_price <= buyer_limit_price - grid_fee
```

For same-zone trades:

```text
grid_fee = 0
```

For cross-zone trades, the grid fee is taken from the Grid Transfer Cache.


If no matching order exists:

* Store the order in the Order Book.
* Wait for future matching orders.

---

## Step 5 - Apply Effective-Price-Time Priority

When multiple matching orders are available, the engine follows Effective-Price-Time Priority.

Priority is determined by:

1. Best effective price
2. Earliest timestamp
3. Same-zone match if effective price and timestamp are equal

For an incoming `BUY` order, the best match is the lowest effective ask:

```text
effective_ask = seller_price + grid_fee
```

For an incoming `SELL` order, the best match is the highest effective bid:

```text
effective_bid = buyer_limit_price - grid_fee
```

---

## Step 6 - Handle Partial Fills

If the incoming order cannot be completely matched by a single order, the engine continues matching until:

* The order is fully matched, or
* No suitable orders remain.

Example:

```text
BUY 100

SELL 40

SELL 30

SELL 50
```

Generated trades:

```text
Trade 1 = 40

Trade 2 = 30

Trade 3 = 30
```

The remaining quantity of the last SELL order stays in the Order Book.

---

## Step 7 - Expire Orders

Each order is active only for its 30-minute delivery slot.

If the delivery slot ends before the order is fully matched, the remaining quantity expires.

Expired orders are removed from the active Market Book and an order status update is published.

Possible status:

```text
EXPIRED
```

---

## Step 8 - Update Order Status

The Matching Engine updates the current status of each processed order.

Possible statuses:

* OPEN
* PARTIALLY_FILLED
* FILLED
* CANCELLED

The Matching Engine publishes these updates for other services to process.

---

## Step 9 - Publish Events

The Matching Engine completes all matching before publishing any events.

Example:

```text
Receive Order

↓

Complete All Matching

↓

Update Order Book

↓

Publish Trade Events

↓

Publish Order Status Updates
```

Publishing events after the matching process keeps the Order Book in a consistent state.

---
## Design Decisions

### Decision 1

Match only within the same 30-minute delivery slot.

Reason:

Energy must be bought and sold for the same delivery period.

Orders from different grid zones may match if Grid Transfer Policy allows transfer between those zones.

---

### Decision 2

Use Effective-Price-Time Priority.

Reason:

Cross-zone trades may include grid fees. Therefore, the matching engine must compare orders using effective price rather than raw energy price alone.

---

### Decision 3

Support Partial Fills.

Reason:

Large orders can be matched against multiple smaller orders without waiting for a single matching order.

---

### Decision 4

Process Manual and Automatic Orders using the same algorithm.

Reason:

The Matching Engine only processes valid orders and does not change its behaviour based on how an order was created.

---

### Decision 5

Complete matching before publishing events.

Reason:

Publishing events after all matching is complete keeps the matching process consistent and reduces the chance of exposing incomplete trade information to other services.

---

## Notes

* The algorithm is based on the Continuous Double Auction (CDA) market model.
* The implementation will use one Market Book for each 30-minute delivery slot.
* Each Market Book will contain Zone Order Books.
* Cross-zone matching will be controlled by Grid Transfer Policy.
* Active Order Books are maintained in memory to achieve low-latency matching.


