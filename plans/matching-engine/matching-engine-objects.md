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
├── MarketId
├── MarketBook
├── ZoneOrderBook
├── OrderBookSide
├── PriceLevel
├── GridTransferRule
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

| Field             | Description |
| ----------------- | ----------- |
| orderId           | Unique order identifier |
| userId            | User who created the order |
| marketId          | Identifies the delivery slot and product type |
| gridZone          | Grid zone where the participant is located |
| side              | BUY or SELL |
| orderType         | LIMIT or MARKET |
| price             | Limit price per kWh |
| quantity          | Original quantity |
| remainingQuantity | Quantity still available for matching |
| deliverySlotStart | Start time of the 30-minute delivery slot |
| deliverySlotEnd   | End time of the 30-minute delivery slot |
| expiresAt         | Time after which unmatched quantity expires |
| status            | Current order status |
| timestamp         | Order creation time used for time priority |

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

| Field                 | Description |
| --------------------- | ----------- |
| tradeId               | Unique trade identifier |
| buyOrderId            | Buy order reference |
| sellOrderId           | Sell order reference |
| buyerId               | Buyer identifier |
| sellerId              | Seller identifier |
| buyerGridZone         | Grid zone of the buyer |
| sellerGridZone        | Grid zone of the seller |
| deliverySlotStart     | Start time of the delivery slot |
| deliverySlotEnd       | End time of the delivery slot |
| energyPrice           | Executed energy price per kWh |
| gridFee               | Grid fee per kWh for this trade |
| buyerTotalPrice       | Energy price plus grid fee |
| quantity              | Executed quantity |
| gridRuleVersion       | Version of the grid/tariff rule used |
| timestamp             | Trade execution time |

## Responsibilities

* Store completed trade information
* Provide trade details for settlement
* Publish trade information to other services

---

# 3. MarketBook

## Purpose

Stores all active buy and sell orders for one delivery slot and product type.

For the initial implementation, each MarketBook represents one 30-minute ENERGY trading window.

Example:

```text
MarketBook = ENERGY / 10:00–10:30
```

Each MarketBook contains multiple ZoneOrderBooks.

---

# 4. ZoneOrderBook

## Purpose

Stores active buy and sell orders submitted by participants from one grid zone inside a MarketBook.

A ZoneOrderBook does not prevent cross-zone matching. It is used to organize orders by participant location so that the matcher can apply grid transfer rules and grid fees.

## Structure

```text
ZoneOrderBook

├── Buy Book
└── Sell Book
```

## Responsibilities

* Store active orders for one grid zone
* Maintain buy and sell price levels
* Support price-time ordering inside each price level
* Allow the matcher to search same-zone and cross-zone candidates

---

# GridTransferRule

## Purpose

Represents whether energy transfer is allowed between two grid zones and what grid fee applies.

## Fields

| Field          | Description |
| -------------- | ----------- |
| sellerGridZone | Grid zone of the seller |
| buyerGridZone  | Grid zone of the buyer |
| allowed        | Whether transfer is allowed |
| gridFee        | Grid fee per kWh |
| version        | Rule or tariff version |

## Responsibilities

* Determine whether cross-zone matching is allowed
* Provide grid fee used during effective price calculation
* Provide version information for settlement and auditability

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

