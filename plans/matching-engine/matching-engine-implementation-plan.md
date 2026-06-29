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


# 4. Internal Processing Flow

The Matching Engine processes every incoming order using a fixed processing pipeline.

Regardless of whether the order is created manually or automatically, every order follows the same sequence.

```text
Kafka

↓

Kafka Consumer

↓

Order Validator

↓

Order Book Manager

↓

Order Matcher

↓

Trade Manager

↓

Event Publisher

↓

Kafka
```

Each component performs one specific task before passing the order to the next stage.

---

## 4.1 Receive Order

The process begins when the Kafka Consumer receives an order event published by the Order Service.

The Matching Engine only receives orders that have already passed business validation.

Typical validations already completed by the Order Service include:

* User authentication
* Wallet validation
* Order ownership
* Required business rules

The Matching Engine assumes the order is valid for processing.

> **NOTE:** The Matching Engine only performs validations required for matching. It does not repeat business validations already handled by the Order Service.

---

## 4.2 Validate Order

The Order Validator performs lightweight checks before the order enters the matching process.

Validation includes:

* Grid Zone exists
* Supported order type
* Valid quantity
* Valid price
* Required fields present

If validation fails, the order is rejected and no matching is performed.

---

## 4.3 Select Grid Zone

Every order belongs to one Grid Zone.

Example:

```text
Northern

Central

Western
```

The Matching Engine selects the corresponding Order Book for that Grid Zone.

Orders are never matched across different Grid Zones.

This rule ensures local energy trading within the same distribution network.

---

## 4.4 Select Opposite Order Book

The Matching Engine always searches the opposite side of the market.

Example:

```text
Incoming BUY

↓

Search Sell Book
```

```text
Incoming SELL

↓

Search Buy Book
```

Searching only the opposite Order Book reduces unnecessary processing.

---

## 4.5 Execute Matching

The Order Matcher applies the GridX matching algorithm.

Matching follows these rules:

* Same Grid Zone
* Price-Time Priority
* Continuous Double Auction (CDA)
* Partial Fill support
* Multiple trade generation

The matcher continues until:

* the incoming order is fully matched, or
* no suitable orders remain.

---

## 4.6 Generate Trades

Every successful match creates a Trade object.

One incoming order may generate:

```text
One Order

↓

One Trade
```

or

```text
One Order

↓

Trade 1

Trade 2

Trade 3
```

This happens when one large order is matched against multiple smaller orders.

The Trade Manager creates Trade objects only after a successful match.

---

## 4.7 Update Order Book

After matching completes, the Order Book is updated.

Possible updates include:

* Remove completed orders.
* Update remaining quantities.
* Store partially matched orders.
* Insert unmatched limit orders.

The Order Book always represents the current active market.

---

## 4.8 Publish Events

After all matching is completed, the Matching Engine publishes the results.

Events may include:

* Trade Executed
* Order Updated
* Order Filled

Publishing occurs only after the matching operation is complete.

This prevents other services from observing incomplete matching results.

---

# 5. Order Book Implementation

The Order Book is the most important data structure inside the Matching Engine.

It stores all active orders currently waiting to be matched.

The Matching Algorithm reads and updates the Order Book continuously while the engine is running.

Because matching speed directly depends on the Order Book, its implementation is designed for fast in-memory access.

---

## 5.1 One Order Book per Grid Zone

Each Grid Zone maintains an independent Order Book.

```text
Matching Engine

├── Northern Order Book

├── Central Order Book

├── Western Order Book

└── Southern Order Book
```

This design ensures that only participants within the same Grid Zone can trade with each other.

It also allows future horizontal scaling by assigning different Grid Zones to different Matching Engine instances.

---

## 5.2 Buy Book and Sell Book

Each Order Book contains two independent collections.

```text
Order Book

├── Buy Book

└── Sell Book
```

The Buy Book stores active BUY orders.

The Sell Book stores active SELL orders.

Keeping both sides separate simplifies the matching process.

---

## 5.3 Selected Data Structure

The implementation uses:

```cpp
std::map<Price, std::deque<Order>>
```

for both the Buy Book and the Sell Book.

This structure was selected after comparing several alternatives.

The `std::map` automatically keeps price levels sorted.

Internally, it is typically implemented using a balanced Red-Black Tree.

Each price level stores its orders inside a `std::deque`.

The deque preserves FIFO order for orders with the same price.

Together these two structures naturally support Price-Time Priority.

---

## 5.4 Price Levels

Instead of storing every order in one large list, orders are grouped by price.

Example:

```text
Price 25

├── Order A

├── Order B

└── Order C
```

Every order at the same price belongs to the same Price Level.

This makes matching faster because the engine works with one price level at a time instead of scanning every order.

---

## 5.5 Order Priority

Orders are selected using two levels of priority.

First:

```text
Best Price
```

Then:

```text
Earliest Arrival
```

This is known as Price-Time Priority.

Example:

```text
Price 25

Order A   10:00

Order B   10:02

Order C   10:05
```

Matching order:

```text
Order A

↓

Order B

↓

Order C
```

---

## 5.6 In-Memory Storage

The active Order Book exists only in memory.

No database queries occur during normal matching.

```text
RAM

↓

Order Books

↓

Matching
```

Persistent storage remains the responsibility of the Order Service.

This separation reduces latency and keeps the Matching Engine focused only on order matching.

---

## 5.7 Rebuilding the Order Book

If the Matching Engine restarts, the in-memory Order Books are rebuilt.

The Recovery Manager requests active orders from the Order Service.

Each returned order is inserted into its corresponding Grid Zone Order Book.

After rebuilding is complete, normal order processing resumes.

This approach combines fast in-memory matching with reliable recovery after unexpected failures.


# 6. Matching Algorithm Implementation

The Matching Engine follows a Continuous Double Auction (CDA) market model.

Orders are processed immediately after they are received. If a matching order already exists, a trade is executed immediately. Otherwise, the order is stored in the Order Book until a suitable matching order becomes available.

The matching algorithm is based on the following rules:

* Match only within the same Grid Zone.
* Apply Price-Time Priority.
* Support partial fills.
* Support multiple trades from a single order.
* Support Limit Orders.
* Complete matching before publishing events.

---

## 6.1 Matching Process

Every incoming order follows the same matching process.

```text
Receive Order

↓

Select Grid Zone

↓

Load Order Book

↓

Select Opposite Book

↓

Search Matching Orders

↓

Generate Trades

↓

Update Order Book

↓

Publish Events
```

The matching process continues until the incoming order is fully matched or no suitable orders remain.

---

## 6.2 Grid Zone Validation

Before matching begins, the Matching Engine identifies the Grid Zone associated with the incoming order.

Only orders within the same Grid Zone are considered.

Example:

```text
Northern BUY

↓

Northern Sell Book
```

Orders from different Grid Zones are never matched.

This rule reflects the GridX business requirement that energy can only be traded within the same local grid.

---

## 6.3 Selecting the Opposite Order Book

The Matching Engine always searches the opposite side of the market.

For a BUY order:

```text
BUY Order

↓

Search Sell Book
```

For a SELL order:

```text
SELL Order

↓

Search Buy Book
```

Searching only the opposite side reduces unnecessary processing.

---

## 6.4 Price Matching

The Matching Engine checks whether prices satisfy the matching rules.

BUY orders:

```text
BUY Price >= SELL Price
```

SELL orders:

```text
SELL Price <= BUY Price
```

If these conditions are not satisfied, matching stops and the remaining order is stored in the Order Book.

---

## 6.5 Price-Time Priority

When multiple matching orders exist, the Matching Engine applies Price-Time Priority.

Priority is determined using two rules.

### Rule 1

Best price always has the highest priority.

### Rule 2

If multiple orders have the same price, the earliest order is matched first.

Example:

```text
Price 25

Order A   10:00

Order B   10:03

Order C   10:08
```

Matching order:

```text
Order A

↓

Order B

↓

Order C
```

This approach provides fair and predictable order execution.

---

## 6.6 Partial Fill

An incoming order may not be fully matched by a single existing order.

In this situation, the Matching Engine continues matching until:

* the incoming order is completely filled, or
* no suitable matching orders remain.

Example:

```text
BUY

100 kWh

↓

SELL

40 kWh

↓

SELL

30 kWh

↓

SELL

50 kWh
```

Generated trades:

```text
Trade 1

40 kWh

↓

Trade 2

30 kWh

↓

Trade 3

30 kWh
```

The remaining 20 kWh from the last SELL order stays in the Order Book.

---

## 6.7 Multiple Trade Generation

A single incoming order may create multiple Trade objects.

Example:

```text
BUY

150

↓

SELL 50

↓

SELL 40

↓

SELL 60
```

Result:

```text
Trade 1

50

↓

Trade 2

40

↓

Trade 3

60
```

Each Trade object represents one completed transaction between one buyer and one seller.

---

## 6.8 Updating the Order Book

After matching is completed, the Matching Engine updates the Order Book.

Possible updates include:

* Remove completed orders.
* Update remaining quantities.
* Insert partially matched orders.
* Store unmatched limit orders.

The Order Book always reflects the current active market.

---

## 6.9 Event Publishing

The Matching Engine does not publish events during the matching process.

Instead, it first completes all matching operations.

Example:

```text
Receive Order

↓

Complete Matching

↓

Update Order Book

↓

Generate Trades

↓

Publish Events
```

This ensures that all published information represents a completed and consistent matching operation.

> **NOTE:** Publishing events after matching reduces the possibility of other services reading incomplete trade information.

---

## 6.10 Limit Orders

The initial implementation supports Limit Orders only.

Every order specifies the price at which the participant is willing to buy or sell energy.

If no suitable matching order exists, the remaining quantity stays in the Order Book until another compatible order arrives.

Support for additional order types, such as Market Orders, may be introduced in future versions without changing the core matching algorithm.

---

# 7. Internal Components

The Matching Engine is divided into multiple internal components.

Each component has one responsibility and communicates with the next component in the processing pipeline.

This separation keeps the implementation simple, maintainable, and easy to test.

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

## 7.1 Kafka Consumer

The Kafka Consumer receives order events published by the Order Service.

Responsibilities:

* Subscribe to Kafka topics.
* Receive new order events.
* Convert messages into Order objects.
* Forward orders to the Order Validator.

The Kafka Consumer does not perform any matching logic.

---

## 7.2 Order Validator

The Order Validator performs validations required by the Matching Engine.

Responsibilities:

* Validate Grid Zone.
* Validate order type.
* Validate quantity.
* Validate price.
* Validate required fields.

Business validations are not repeated because they have already been completed by the Order Service.

---

## 7.3 Order Book Manager

The Order Book Manager maintains every Grid Zone Order Book.

Responsibilities:

* Load Grid Zone Order Books.
* Add orders.
* Remove orders.
* Update remaining quantities.
* Find the best BUY order.
* Find the best SELL order.
* Maintain Price Levels.

The Order Matcher interacts with the Order Book only through this component.

---

## 7.4 Order Matcher

The Order Matcher performs the actual matching process.

Responsibilities:

* Select the correct Grid Zone.
* Search the opposite Order Book.
* Apply Price-Time Priority.
* Handle partial fills.
* Generate Matching Results.

The Order Matcher is the core component of the Matching Engine.

---

## 7.5 Trade Manager

The Trade Manager creates completed Trade objects after successful matching.

Responsibilities:

* Create Trade objects.
* Generate trade identifiers.
* Store completed trade information.
* Prepare trades for publishing.

A single incoming order may create multiple Trade objects.

---

## 7.6 Event Publisher

The Event Publisher publishes completed matching results.

Responsibilities:

* Publish Trade events.
* Publish Order Update events.
* Send messages to Kafka.

Publishing occurs only after the matching process has finished.

---

## 7.7 Recovery Manager

The Recovery Manager restores the Matching Engine after an unexpected shutdown.

Responsibilities:

* Request active orders from the Order Service.
* Rebuild every Grid Zone Order Book.
* Restore partially filled orders.
* Start normal processing after recovery.

The Recovery Manager is active only during startup and recovery.

> **NOTE:** The Kafka Consumer starts only after the Recovery Manager has successfully rebuilt every Order Book.
