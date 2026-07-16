---
connie-title: Matching Engine Components
---

# Matching Engine Components

## Purpose

This document describes the main components of the Matching Engine and their responsibilities.

Each component has a single responsibility, making the system easier to understand, maintain, and extend.

---

# Component Overview

```text
Matching Engine

├── Kafka Consumer
├── Order Validator
├── Market Book Manager
├── Grid Transfer Cache
├── Order Matcher
├── Trade Manager
├── Event Publisher
├── Expiry Manager
└── Recovery Manager
```

---

# Component Flow

```text
Kafka

↓

Kafka Consumer

↓

Order Validator

↓

Order Matcher

↓

Order Book Manager

↓

Trade Manager

↓

Event Publisher

↓

Kafka
```

The Recovery Manager is used only when the Matching Engine starts after a restart.

---

# 1. Kafka Consumer

## Purpose

Receives new order events from Kafka.

## Responsibilities

* Subscribe to the order topic
* Consume incoming order events
* Convert events into Order objects
* Send orders to the Order Validator

## Input

* Order events from Kafka

## Output

* Order object

---

# 2. Order Validator

## Purpose

Checks whether an order is valid before matching.

The Order Service already performs business validation. The Matching Engine only performs validations required for matching.

## Responsibilities

* Check grid zone
* Check order type
* Check quantity
* Check price
* Check delivery slot
* Check that the delivery slot follows the 30-minute slot duration
* Check that the order has not expired
* Check required fields

## Input

* Order object

## Output

* Valid order

---

# 3. Market Book Manager

## Purpose

Manages all Market Books used by the Matching Engine.

Each Market Book represents one 30-minute delivery slot and product type.

Each Market Book contains Zone Order Books for participant grid zones.

## Responsibilities

* Load the correct Market Book by delivery slot and product type
* Load Zone Order Books inside the Market Book
* Add new orders to the correct Zone Order Book
* Remove completed or expired orders
* Update remaining quantities
* Find same-zone and cross-zone candidate orders
* Maintain Price Levels

## Input

* Valid order

## Output

* Updated Order Book

---

# 4. Grid Transfer Cache

## Purpose

Stores grid transfer rules and tariff information required for cross-zone matching.

The Matching Engine should not call external services during normal matching. Therefore, grid transfer rules and grid fees are kept in memory.

## Responsibilities

* Store allowed grid zone transfer pairs
* Store grid fee per zone pair
* Store grid rule or tariff version
* Provide transfer rules to the Order Matcher during matching

## Input

* Grid transfer rule events from Kafka
* Tariff rule events from Kafka

## Output

* GridTransferRule

---

# 5. Order Matcher

## Purpose

Matches incoming orders with existing orders in the Order Book.

The matching process follows the matching algorithm defined for GridX.

## Responsibilities

* Select the correct Market Book
* Search eligible same-zone and cross-zone opposite orders
* Apply Grid Transfer Policy
* Calculate effective price using grid fees
* Apply Effective-Price-Time Priority
* Handle partial fills
* Match multiple orders when required
* Return the matching result

## Input

* Order object
* Order Book

## Output

* MatchingResult

---

# 6. Expiry Manager

## Purpose

Expires unmatched order quantities when their 30-minute delivery slot ends.

## Responsibilities

* Detect orders whose delivery slot has ended
* Mark remaining unmatched quantity as EXPIRED
* Remove expired orders from active Market Books
* Publish order expiry status updates

## Input

* Active orders in Market Books

## Output

* Expired order updates

---

# 7. Trade Manager

## Purpose

Creates Trade objects after successful matching.

## Responsibilities

* Create Trade objects
* Generate trade identifiers
* Store completed trade information
* Prepare trade data for publishing

## Input

* MatchingResult

## Output

* Trade objects

---

# 8. Event Publisher

## Purpose

Publishes completed trade information for other services.

The Matching Engine completes all matching before publishing events.

## Responsibilities

* Publish trade events
* Publish order status updates
* Send events to Kafka

## Input

* Trade objects
* Updated orders

## Output

* Kafka events

---

# 9. Recovery Manager

## Purpose

Rebuilds the Matching Engine after a restart.

The Order Book is stored in memory. If the Matching Engine restarts, the Order Book must be rebuilt.

## Responsibilities

* Request active OPEN orders from the Order Service
* Rebuild each Grid Zone Order Book
* Resume order processing

## Recovery Flow

```text
Matching Engine Starts

↓

Recovery Manager

↓

Order Service

↓

PostgreSQL

↓

Return OPEN Orders

↓

Rebuild Order Books

↓

Resume Kafka Consumer
```

---

# Component Summary

| Component          | Responsibility                    |
| ------------------ | --------------------------------- |
| Kafka Consumer     | Receive order events from Kafka   |
| Order Validator    | Validate incoming orders          |
| Market Book Manager | Manage Market Books and Zone Order Books |
| Grid Transfer Cache | Store grid transfer rules and grid fees |
| Order Matcher       | Match buy and sell orders using effective-price-time priority |
| Expiry Manager      | Expire unmatched orders when their delivery slot ends |
| Trade Manager      | Create completed trades           |
| Event Publisher    | Publish events to Kafka           |
| Recovery Manager   | Restore Order Books after restart |

---
