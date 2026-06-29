# Matching Engine Objects

## Purpose

This document describes the main objects used by the Matching Engine.

These objects represent the core data used during order matching and trade execution.

---

## Object Overview

```text
Matching Engine

├── Order
├── Trade
├── OrderBook
├── PriceLevel
└── MatchingResult
```

---

# Object Relationships

```text
OrderBook
│
├── Buy Book
│     │
│     ├── PriceLevel
│     │      │
│     │      └── Order
│
└── Sell Book
      │
      ├── PriceLevel
      │      │
      │      └── Order

MatchingResult
│
├── Trades
└── Updated Orders
```

---

# 1. Order

## Purpose

Represents a buy or sell request received by the Matching Engine.

## Fields

| Field             | Description                           |
| ----------------- | ------------------------------------- |
| orderId           | Unique order identifier               |
| userId            | User who created the order            |
| gridZone          | Grid zone for matching                |
| side              | BUY or SELL                           |
| orderType         | LIMIT or MARKET                       |
| price             | Order price                           |
| quantity          | Original quantity                     |
| remainingQuantity | Quantity still available for matching |
| status            | Current order status                  |
| timestamp         | Order creation time                   |

## Responsibilities

* Store order information
* Track remaining quantity
* Store current status
* Participate in the matching process

---

# 2. Trade

## Purpose

Represents a successful match between one buy order and one sell order.

## Fields

| Field       | Description                        |
| ----------- | ---------------------------------- |
| tradeId     | Unique trade identifier            |
| buyOrderId  | Buy order reference                |
| sellOrderId | Sell order reference               |
| buyerId     | Buyer identifier                   |
| sellerId    | Seller identifier                  |
| gridZone    | Grid zone where the trade occurred |
| price       | Executed trade price               |
| quantity    | Executed quantity                  |
| timestamp   | Trade execution time               |

## Responsibilities

* Store completed trade information
* Provide trade details for settlement
* Publish trade information to other services

---

# 3. OrderBook

## Purpose

Stores all active buy and sell orders for one Grid Zone.

Each Grid Zone has its own OrderBook.

## Structure

```text
OrderBook

├── Buy Book
└── Sell Book
```

## Responsibilities

* Store active orders
* Add new orders
* Remove completed orders
* Update remaining quantities
* Find the best buy price
* Find the best sell price

---

# 4. PriceLevel

## Purpose

Groups all orders with the same price.

## Structure

```text
Price = 25

├── Order A
├── Order B
└── Order C
```

Orders are stored in arrival order (FIFO).

## Responsibilities

* Group orders with the same price
* Maintain arrival order
* Support Price-Time Priority

---

# 5. MatchingResult

## Purpose

Stores the result after processing one incoming order.

## Contains

* Generated trades
* Updated orders
* Remaining quantity

## Responsibilities

* Return matching results
* Pass completed results to the next processing stage

