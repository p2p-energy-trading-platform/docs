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
├── Order Book Manager
├── Order Matcher
├── Trade Manager
├── Event Publisher
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

* Check Grid Zone
* Check order type
* Check quantity
* Check price
* Check required fields

## Input

* Order object

## Output

* Valid order

---

# 3. Order Book Manager

## Purpose

Manages all Order Books used by the Matching Engine.

Each Grid Zone has its own Order Book.

## Responsibilities

* Load the correct Grid Zone Order Book
* Add new orders
* Remove completed orders
* Update remaining quantities
* Find the best buy order
* Find the best sell order
* Maintain Price Levels

## Input

* Valid order

## Output

* Updated Order Book

---

# 4. Order Matcher

## Purpose

Matches incoming orders with existing orders in the Order Book.

The matching process follows the matching algorithm defined for GridX.

## Responsibilities

* Select the correct Grid Zone
* Search the opposite Order Book
* Apply Price-Time Priority
* Handle partial fills
* Match multiple orders when required
* Return the matching result

## Input

* Order object
* Order Book

## Output

* MatchingResult

---

# 5. Trade Manager

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

# 6. Event Publisher

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

# 7. Recovery Manager

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
| Order Book Manager | Manage Grid Zone Order Books      |
| Order Matcher      | Match buy and sell orders         |
| Trade Manager      | Create completed trades           |
| Event Publisher    | Publish events to Kafka           |
| Recovery Manager   | Restore Order Books after restart |

---


