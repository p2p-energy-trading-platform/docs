# Matching Algorithm

## Purpose

This document describes how the Matching Engine processes incoming orders and creates trades.

This matching algorithm is based on the Continuous Double Auction (CDA) market model with additional business rules for energy trading.

---

## Matching Strategy

The matching algorithm follows these principles:

* Continuous order matching
* Match only within the same Grid Zone
* Price-Time Priority
* Support partial fills
* Support multiple trades from a single order
* Process both manual and automatic orders using the same logic

---

## Matching Flow

```text
Receive Order
      │
      ▼
Select Grid Zone
      │
      ▼
Load Grid Zone Order Book
      │
      ▼
Select Opposite Order Book
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

## Step 2 - Select Grid Zone

Each order contains a Grid Zone.

Example:

```text
Northern
Western
Central
```

The Matching Engine selects the correct Order Book for that Grid Zone.

Orders are only matched within the same Grid Zone.

---

## Step 3 - Load the Opposite Order Book

The engine selects the opposite side of the market.

Examples:

BUY Order

↓

Search Sell Order Book

SELL Order

↓

Search Buy Order Book

---

## Step 4 - Find Matching Orders

The engine searches the selected Order Book for matching orders.

Matching conditions:

For BUY orders:

```text
BUY Price >= SELL Price
```

For SELL orders:

```text
SELL Price <= BUY Price
```

If no matching order exists:

* Store the order in the Order Book.
* Wait for future matching orders.

---

## Step 5 - Apply Price-Time Priority

When multiple matching orders are available, the engine follows Price-Time Priority.

Priority is determined by:

1. Best Price
2. Earliest Timestamp

Example:

```text
Price 25

Order A - 10:00

Order B - 10:05

Order C - 10:10
```

Order A is matched first because it arrived earlier.

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

## Step 7 - Update the Order Book

After matching:

* Remove completed orders.
* Update remaining quantities.
* Store partially matched orders if required.
* Keep unmatched limit orders in the Order Book.

The Order Book always represents the current active market.

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

