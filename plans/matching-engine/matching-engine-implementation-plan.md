# Matching Engine - Implementation Plan

**Author:** K.Keeththigan

**Scope:** Matching Engine module only

**Language:** C++20

**Status:** Draft v1

---

# 1. Purpose

The Matching Engine is the core component of the GridX peer-to-peer energy trading platform.

Its responsibility is to continuously receive valid buy and sell orders, match them according to the platform's trading rules, generate completed trades, and publish the results for the rest of the system.

The Matching Engine is designed for low-latency processing. To achieve this, all active Order Books are maintained in memory while persistent order storage remains the responsibility of the Order Service.

This document describes how the Matching Engine will be implemented, the responsibilities of each internal component, and the overall architecture that will guide development.

> **NOTE:** This document focuses only on the Matching Engine. Kafka architecture, Order Service implementation, settlement, notifications, and other platform modules are documented separately.

---

# 2. What the Matching Engine Does

The Matching Engine is responsible only for order matching. Every responsibility inside the module should contribute to that goal.

The Matching Engine performs the following tasks:

* Receive new order events from Kafka.
* Validate fields required for matching.
* Maintain active Order Books in memory.
* Keep one Order Book for each Grid Zone.
* Match BUY and SELL orders.
* Apply Price-Time Priority.
* Support partial order execution.
* Generate one or more trades from a single order when required.
* Update the in-memory Order Book.
* Publish completed trade events.
* Rebuild Order Books after a restart.

The Matching Engine does not make business decisions outside the matching process. It only processes orders that have already been accepted by the Order Service.

---

## 2.1 What the Matching Engine Does NOT Do

To keep responsibilities clear, the Matching Engine does not perform the following tasks:

* User authentication
* User authorization
* Wallet balance validation
* Payment processing
* Settlement processing
* Order persistence
* Database management
* Notification delivery
* Market analytics
* Price prediction

These responsibilities belong to other services within the GridX platform.

> **NOTE:** The Order Service owns all persistent order data. The Matching Engine only maintains active orders in memory while it is running.

---

## 2.2 Matching Engine Boundaries

The Matching Engine receives completed order events and returns completed trade events.

```
Order Service

↓

Kafka

↓

Matching Engine

↓

Kafka

↓

Settlement Service

Market Data Service

Notification Service
```

This keeps the Matching Engine independent from the rest of the platform.

It does not directly communicate with databases or external business services during normal order processing.

---

# 3. Architecture Principles

The implementation follows several architectural principles to keep the Matching Engine simple, reliable, and scalable.

These principles should remain unchanged throughout development.

---

## 3.1 Single Responsibility

Each internal component has one responsibility.

Example:

* Kafka Consumer receives messages.
* Order Validator validates orders.
* Order Book Manager manages Order Books.
* Order Matcher performs matching.
* Trade Manager creates Trade objects.
* Event Publisher publishes events.
* Recovery Manager restores the engine after a restart.

Keeping responsibilities separate makes the implementation easier to test, maintain, and extend.

---

## 3.2 In-Memory Processing

The Matching Engine stores active Order Books entirely in memory.

```
Order Book

↓

RAM
```

No database queries are performed during normal matching.

This reduces latency and allows orders to be matched as quickly as possible.

Persistent storage remains the responsibility of the Order Service.

> **NOTE:** The in-memory Order Book is considered a working copy of active orders. PostgreSQL remains the source of truth.

---

## 3.3 Grid Zone Isolation

Energy trading in GridX only occurs between participants connected to the same Grid Zone.

For this reason, each Grid Zone owns its own Order Book.

```
Matching Engine

├── Northern Order Book
├── Central Order Book
├── Western Order Book
└── Southern Order Book
```

Orders from different Grid Zones are never matched together.

This design also allows future horizontal scaling by assigning different Grid Zones to different Matching Engine instances.

---

## 3.4 Event-Driven Communication

The Matching Engine communicates with the rest of the platform using Kafka.

Incoming orders are received as events.

Completed trades are published as events.

```
Order Event

↓

Matching Engine

↓

Trade Event
```

The Matching Engine does not directly call other business services during normal operation.

This keeps services loosely coupled and allows each module to evolve independently.

---

## 3.5 Continuous Matching

The Matching Engine follows the Continuous Double Auction (CDA) market model.

Each incoming order is processed immediately.

If a matching order already exists, the trade is executed immediately.

If no suitable order exists, the order remains in the Order Book until another matching order arrives.

There are no scheduled matching windows or auction periods.

Trading continues as long as new orders are received.

---

## 3.6 Price-Time Priority

Price-Time Priority is the primary matching rule used throughout the engine.

Orders are always matched using the following priority:

1. Best Price
2. Earliest Timestamp

Example:

```
Price 25

Order A   10:00

Order B   10:03

Order C   10:05
```

Order A is matched first because it arrived earlier.

This rule guarantees fair order execution.

---

## 3.7 One Matching Pipeline

The Matching Engine does not distinguish between manual and automatic orders.

Both follow exactly the same processing pipeline.

```
Manual Order

            ↓

Automatic Order

            ↓

Order Validator

            ↓

Order Matcher

            ↓

Trade Generation
```

The order source may be stored for reporting purposes, but it never changes the matching behaviour.

---

## 3.8 Stateless Recovery

The Matching Engine does not permanently store active orders.

If the application stops, the in-memory Order Books are lost.

After restarting, the Recovery Manager requests all active orders from the Order Service and rebuilds every Grid Zone Order Book before matching resumes.

This allows the Matching Engine to remain lightweight while still recovering safely from unexpected failures.

> **NOTE:** Recovery is completed before the Kafka Consumer starts processing new orders.

---

## 3.9 Low-Latency Design

Several design decisions have been made specifically to reduce matching latency.

These include:

* In-memory Order Books
* One Order Book per Grid Zone
* `std::map` for maintaining sorted price levels
* `std::deque` for FIFO order handling
* No database access during matching
* Batch event publishing after matching completes
* Lightweight internal components with clear responsibilities

Future versions may introduce additional optimizations such as lock-free data structures, memory pools, or multiple Matching Engine instances if higher throughput becomes necessary.

---

