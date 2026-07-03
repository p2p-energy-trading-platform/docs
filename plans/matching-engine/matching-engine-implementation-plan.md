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
* Keep one Market Book for each 30-minute delivery slot and product type.
* Keep Zone Order Books inside each Market Book.
* Support cross-zone matching when grid transfer rules allow it.
* Expire unmatched order quantity when the 30-minute delivery slot ends.
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

## 3.3 Market Books and Cross-Zone Matching

Energy trading in GridX is organized by delivery time.

Each order belongs to a fixed 30-minute delivery slot. The Matching Engine maintains one Market Book for each delivery slot and product type.

For the initial implementation, the only supported product type is ENERGY.

```text
Matching Engine

├── Market Book: ENERGY / 10:00–10:30
│   ├── Northern Zone Order Book
│   ├── Central Zone Order Book
│   └── Western Zone Order Book
│
├── Market Book: ENERGY / 10:30–11:00
│   ├── Northern Zone Order Book
│   ├── Central Zone Order Book
│   └── Western Zone Order Book
```

Orders may match across grid zones only when the Grid Transfer Policy allows transfer between the seller's grid zone and the buyer's grid zone.

Cross-zone matching includes grid fees in the effective price calculation.

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

## 3.6 Effective-Price-Time Priority

Effective-Price-Time Priority is the primary matching rule used throughout the engine.

For same-zone matching, the grid fee is zero.

For cross-zone matching, the grid fee is included in the effective price.

For a BUY order:

```text
effective_ask = seller_price + grid_fee
```

For a SELL order:

```text
effective_bid = buyer_limit_price - grid_fee
```

Orders are matched using the following priority:

1. Best effective price
1. Earliest timestamp
1. Same-zone match if effective price and timestamp are equal

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

After restarting, the Recovery Manager requests all active non-expired orders from the Order Service and rebuilds every Market Book and its internal Zone Order Books before matching resumes.

This allows the Matching Engine to remain lightweight while still recovering safely from unexpected failures.

> **NOTE:** Recovery is completed before the Kafka Consumer starts processing new orders.

---

## 3.9 Low-Latency Design

Several design decisions have been made specifically to reduce matching latency.

These include:

* In-memory Order Books
* One Market Book per 30-minute delivery slot
* Zone Order Books inside each Market Book
* In-memory Grid Transfer Cache for cross-zone matching
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

* Grid zone exists
* Supported order type
* Valid quantity
* Valid price
* Valid delivery slot
* Delivery slot follows the configured 30-minute slot duration
* Order is not expired
* Required fields present

If validation fails, the order is rejected and no matching is performed.

---

## 4.3 Select Market Book

Every order belongs to one Market Book.

A Market Book is identified by:

```text
delivery_slot_start + product_type
```

For the current implementation:

```text
product_type = ENERGY
slot_duration = 30 minutes
```

The Matching Engine selects the Market Book for the order's delivery slot.

The order's grid zone is still used as the participant location. It determines which Zone Order Book stores the order and which grid transfer rules apply during cross-zone matching

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

* Same delivery slot
* Same product type
* Cross-zone transfer allowed by Grid Transfer Policy
* Effective-Price-Time Priority
* Continuous Double Auction (CDA)
* Partial Fill support
* Multiple trade generation
* Order expiry at the end of the delivery slot

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

## 4.7 Update Market Book

After matching completes, the selected Market Book is updated.

Possible updates include:

* Remove fully filled orders.
* Update remaining quantities.
* Store partially filled orders.
* Insert unmatched limit order quantity into the correct Zone Order Book.
* Remove expired orders when their delivery slot ends.

The Market Book always represents the current active market for one delivery slot and product type.

---

## 4.8 Publish Events

After all matching and book updates are completed, the Matching Engine publishes the results.

Events may include:

* Trade Executed
* Order Updated
* Order Filled
* Order Partially Filled
* Order Expired
* Order Cancelled

Publishing occurs only after the matching operation and Market Book update are complete.

This prevents other services from observing incomplete matching results.

---

# 5. Order Book Implementation

The Market Book is the most important in-memory data structure inside the Matching Engine.

It stores all active orders for one product type and one delivery slot.

The Matching Algorithm reads and updates Market Books continuously while the engine is running.

Because matching speed directly depends on these structures, the implementation is designed for fast in-memory access.

---

## 5.1 One Market Book per Delivery Slot

Each 30-minute delivery slot has its own Market Book.

A Market Book contains all active orders for one product type and one delivery period.

For the initial version:

```text
Product Type: ENERGY
Slot Duration: 30 minutes
```

Each Market Book contains separate Zone Order Books so that orders can be organized by participant grid zone.

Example:

```text
Matching Engine

├── Market Book: ENERGY / 10:00–10:30
│   ├── Zone A Order Book
│   ├── Zone B Order Book
│   └── Zone C Order Book
│
├── Market Book: ENERGY / 10:30–11:00
│   ├── Zone A Order Book
│   ├── Zone B Order Book
│   └── Zone C Order Book
```

Orders are matched only inside the same Market Book.

---

## 5.2 Zone Order Book

Each Market Book contains one Zone Order Book for each grid zone that has active orders in that delivery slot.

```text
Market Book

├── Zone A Order Book
│   ├── Buy Book
│   └── Sell Book
│
├── Zone B Order Book
│   ├── Buy Book
│   └── Sell Book
```

A Zone Order Book stores orders submitted by participants from that grid zone.

This structure keeps orders organized by location while still allowing the matcher to evaluate valid cross-zone matches inside the same Market Book.

---

## 5.3 Buy Book and Sell Book

Each Order Book contains two independent collections.

```text
Zone Order Book

├── Buy Book
└── Sell Book
```

The Buy Book stores active BUY orders.

The Sell Book stores active SELL orders.

Keeping both sides separate simplifies opposite-side searching during matching.

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

Together these two structures support ordered price levels and arrival-order processing within each price level.

The complete structure can be represented as:

```cpp
struct MarketId {
    int64_t delivery_slot_start;
    ProductType product_type;
};

struct ZoneOrderBook {
    OrderBookSide buy_book;
    OrderBookSide sell_book;
};

struct MarketBook {
    MarketId market_id;
    std::unordered_map<GridZoneId, ZoneOrderBook> zone_books;
};
```

---

## 5.5 Price Levels

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

## 5.6 Order Priority Inside a Price Level

Inside a price level, orders are processed by arrival order.

Example:

```
Price 25

Order A   10:00
Order B   10:02
Order C   10:05
```

Processing order:

```text
Order A

↓

Order B

↓

Order C
```

This preserves fairness among orders with the same price inside the same price level.

Overall match selection is handled by the matching algorithm.

---

## 5.7 In-Memory Storage

The active Order Book exists only in memory.

No database queries occur during normal matching.

```text
RAM

↓

Market Books

↓

Matching
```

Persistent storage remains the responsibility of the Order Service.

This separation reduces latency and keeps the Matching Engine focused only on order matching.

---

## 5.8 Rebuilding the Market Books

If the Matching Engine restarts, the in-memory Market Books are rebuilt.

The Recovery Manager requests active, non-expired orders from the Order Service.

Each returned order is inserted into the correct Market Book based on

```text
delivery_slot_start + product_type
```

Inside that Market Book, the order is inserted into the correct Zone Order Book based on the order's grid zone.

After rebuilding is complete, normal order processing resumes.

This approach combines fast in-memory matching with reliable recovery after unexpected failures.

---

# 6. Matching Algorithm Implementation

The Matching Engine follows a Continuous Double Auction (CDA) market model.

Orders are processed immediately after they are received. If a suitable matching order already exists inside the selected Market Book, a trade is executed immediately. Otherwise, the remaining quantity is stored in the correct Zone Order Book until another suitable order arrives or the delivery slot expires.

The matching algorithm is based on the following rules:

* Match only within the same 30-minute delivery slot.
* Match only within the same product type.
* Use the selected Market Book for matching.
* Search same-zone and eligible cross-zone opposite orders.
* Apply Effective-Price-Time Priority.
* Support partial fills.
* Support multiple trades from a single order.
* Support Limit Orders.
* Expire unmatched quantity when the delivery slot ends.
* Complete matching before publishing events.

---

## 6.1 Matching Process

Every incoming order follows the same matching process.

```text
Receive Order

↓

Validate Delivery Slot

↓

Select Market Book

↓

Load Zone Order Books

↓

Search Eligible Opposite Orders

↓

Generate Trades

↓

Update Market Book

↓

Publish Events
```

The matching process continues until:

* the incoming order is fully matched,
* no suitable orders remain, or
* the order is no longer valid for the delivery slot.

---

## 6.2 Grid Zone Validation

Before matching begins, the Matching Engine identifies the Grid Zone associated with the incoming order.

Only orders within the same Market Book are considered.

Orders from different grid zones may be considered if:

* They are in the same 30-minute delivery slot
* They have the same product type
* Grid Transfer Policy allows transfer between the seller zone and buyer zone

This rule reflects the GridX business requirement that energy can only be traded within the same local grid.

---

## 6.3 Selecting Eligible Opposite Orders

The Matching Engine always searches the opposite side of the selected MarketBook.

For a BUY order:

```text
BUY Order

↓

Search SELL orders inside the same MarketBook
```

For a SELL order:

```text
SELL Order

↓

Search BUY orders inside the same MarketBook
```

The search may include:

* Orders from the same grid zone
* Orders from other grid zones if Grid Transfer Policy allows transfer

The engine does not search orders from other delivery slots.

Searching only the opposite side of the selected MarketBook reduces unnecessary processing while still allowing valid cross-zone matches.

---

## 6.4 Effective Price Matching

The Matching Engine checks whether prices satisfy the matching rules using effective price.

For same-zone trades:

```text
grid_fee = 0
```

For cross-zone trades, the grid fee is taken from the Grid Transfer Cache.

For BUY orders:

```text
seller_price + grid_fee <= buyer_limit_price
```

This means the buyer's maximum price must cover both the seller's energy price and the grid fee.

For SELL orders:

```text
seller_limit_price <= buyer_limit_price - grid_fee
```

This means the seller's minimum acceptable price must be less than or equal to the buyer's effective bid after subtracting the grid fee.

If these conditions are not satisfied, the candidate order is skipped.

If no valid matching order exists, the remaining quantity of the incoming limit order is stored in the correct Zone Order Book inside the selected MarketBook.

The order remains active only until the end of its 30-minute delivery slot. If it is not fully matched before the delivery slot ends, the remaining quantity expires.

---

## 6.5 Effective-Price-Time Priority

When multiple matching orders exist, the Matching Engine applies Effective-Price-Time Priority.

This is required because cross-zone trades may include grid fees. Therefore, the engine compares orders using the effective price rather than the raw order price alone.

For same-zone trades:

```text
grid_fee = 0
```

For cross-zone trades, the grid fee is taken from the Grid Transfer Cache.

### Rule 1

Orders must belong to the same Market Book.

A Market Book is identified by:

```text
delivery_slot_start + product_type
```

The slot duration and product type is as below. ENERGY is the only product type:

```text
slot_duration = 30 minutes
product_type = ENERGY
```

### Rule 2

Cross-zone matching is allowed only when the Grid Transfer Policy allows energy transfer between the seller's grid zone and the buyer's grid zone.

### Rule 3

Best effective price has the highest priority.

For an incoming BUY order, the engine compares seller orders using:

```text
effective_ask = seller_price + grid_fee
```

The BUY order can match when:

```text
effective_ask <= buyer_limit_price
```

The lowest effective ask has priority.

For an incoming SELL order, the engine compares buyer orders using:

```text
effective_bid = buyer_limit_price - grid_fee
```

The SELL order can match when:

```text
seller_limit_price <= effective_bid
```

The highest effective bid has priority.

### Rule 4

If multiple orders have the same effective price, the earliest order is matched first.

### Rule 5

If effective price and timestamp are both equal, same-zone matching is preferred.

Example for an incoming BUY order:

```text
Buyer Zone: Zone A
Buyer Limit Price: AED 0.50/kWh

Seller 1:
Zone A
Seller Price: AED 0.47/kWh
Grid Fee: AED 0.00/kWh
Effective Ask: AED 0.47/kWh

Seller 2:
Zone B
Seller Price: AED 0.45/kWh
Grid Fee: AED 0.04/kWh
Effective Ask: AED 0.49/kWh

Seller 3:
Zone C
Seller Price: AED 0.43/kWh
Grid Fee: AED 0.10/kWh
Effective Ask: AED 0.53/kWh
```

Matching result:

```text
Seller 1 matches first because effective ask is RM 0.47/kWh.

Seller 2 is eligible but has a higher effective ask of RM 0.49/kWh.

Seller 3 is not eligible because RM 0.53/kWh is greater than the buyer's limit price of RM 0.50/kWh.
```

This approach provides fair and predictable order execution while supporting cross-zone grid fees.

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

The Order Book Manager maintains every Market Book and the Zone Order Books inside each Market Book.

Responsibilities:

* Load the correct Market Book by delivery slot and product type.
* Load Zone Order Books inside the selected Market Book.
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

* Select the correct Market Book.
* Search eligible same-zone and cross-zone opposite orders.
* Apply Grid Transfer Policy.
* Apply Effective-Price-Time Priority.
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

# 8. Crash Recovery

The Matching Engine stores active Order Books in memory to achieve low-latency order processing.

If the application stops unexpectedly, all in-memory data is lost. The Crash Recovery process restores the Order Books before normal trading resumes.

The Matching Engine does not permanently store orders. Instead, it rebuilds the Order Books using active orders stored by the Order Service.

---

## 8.1 Recovery Objective

The objective of Crash Recovery is to restore the Matching Engine to its previous operational state without losing active orders.

Recovery should:

* Restore every active Order Book.
* Restore partially filled orders.
* Resume order processing.
* Prevent incorrect matching during startup.

---

## 8.2 Recovery Flow

```text
Matching Engine Starts

↓

Initialize Components

↓

Recovery Manager Starts

↓

Request Active Orders

↓

Order Service

↓

PostgreSQL

↓

Return OPEN Orders

↓

Rebuild Order Books

↓

Recovery Complete

↓

Start Kafka Consumer

↓

Resume Order Matching
```

The Kafka Consumer starts only after all Order Books have been successfully rebuilt.

---

## 8.3 Recovery Process

The recovery process follows these steps.

### Step 1

The Matching Engine starts.

Internal components are initialized.

No new orders are processed.

---

### Step 2

The Recovery Manager becomes active.

Normal matching remains disabled.

---

### Step 3

The Recovery Manager requests all active orders from the Order Service.

The Matching Engine never connects directly to PostgreSQL.

---

### Step 4

The Order Service retrieves active orders from the database.

Only orders with active statuses are returned.

Returned statuses include:

* OPEN
* PARTIALLY_FILLED

Orders with the following statuses are ignored:

* FILLED
* CANCELLED
* REJECTED

---

### Step 5

Orders are grouped by Grid Zone.

Each order is inserted into its corresponding Buy Book or Sell Book.

When all orders have been restored, the Order Books represent the latest active market.

---

### Step 6

The Kafka Consumer starts.

The Matching Engine begins processing new incoming orders.

---

## 8.4 Recovery States

The Matching Engine moves through several states during startup.

```text
STARTING

↓

RECOVERING

↓

READY

↓

RUNNING
```

### STARTING

The application is loading and internal components are initialized.

### RECOVERING

Order Books are rebuilt.

No matching operations are performed.

### READY

Recovery has completed successfully.

All Order Books are available.

### RUNNING

The Kafka Consumer starts.

Normal matching resumes.

---

## 8.5 Restoring Partially Filled Orders

Partially filled orders remain active until their remaining quantity reaches zero.

Example:

```text
Original Quantity

100

↓

Already Matched

40

↓

Remaining

60
```

During recovery, only the remaining quantity is restored to the Order Book.

This ensures that previously completed trades are not executed again.

---

## 8.6 Orders Received During Recovery

New orders may arrive while the Matching Engine is recovering.

These orders remain safely stored in Kafka until the consumer starts.

```text
Recovery Running

↓

Kafka Stores New Orders

↓

Recovery Completed

↓

Kafka Consumer Starts

↓

Process Waiting Orders
```

No incoming orders are lost during the recovery process.

---

## 8.7 Recovery Failure

If active orders cannot be retrieved from the Order Service:

* Retry the recovery request.
* Do not start the Kafka Consumer.
* Do not begin order matching.
* Continue recovery until successful.

The Matching Engine should never process new orders using an incomplete Order Book.

---

## 8.8 Recovery Checklist

Before entering normal operation, the Matching Engine verifies:

* Internal components initialized.
* Order Service available.
* Active orders received.
* Every Grid Zone Order Book rebuilt.
* Recovery completed successfully.
* Kafka Consumer started.

Only after these checks pass does the Matching Engine begin processing new orders.

> **NOTE:** The Order Service remains the owner of persistent order data. The Matching Engine rebuilds its in-memory Order Books during startup and does not directly access the database.

---

# 9. Concurrency Model

The initial implementation uses a simple concurrency model that prioritizes correctness and maintainability.

This approach is suitable for the first production version and can be extended in future releases.

---

## 9.1 Initial Design

The first implementation uses:

* One Matching Engine instance.
* One matching thread.
* One Order Book for each Grid Zone.
* Sequential order processing.

This simplifies synchronization and reduces implementation complexity.

---

## 9.2 Order Processing

Orders are processed one at a time.

```text
Order 1

↓

Match

↓

Order 2

↓

Match

↓

Order 3

↓

Match
```

Processing orders sequentially prevents race conditions while ensuring consistent Order Book updates.

---

## 9.3 Grid Zone Independence

Although orders are processed sequentially, each Grid Zone maintains its own independent Order Book.

```text
Matching Engine

├── Northern Order Book
├── Central Order Book
├── Western Order Book
└── Southern Order Book
```

This separation makes future parallel processing easier because each Grid Zone can be processed independently.

---

## 9.4 Future Scalability

As trading volume increases, the Matching Engine can be extended without changing the matching algorithm.

Possible improvements include:

* Multiple matching threads.
* One thread per Grid Zone.
* Multiple Matching Engine instances.
* Grid Zone partitioning.
* Lock-free data structures.
* Custom memory pools.

These improvements are planned for future versions and are not required for the initial implementation.

---

# 10. Project Structure

The following folder structure can be used for matching engine


```
matching-engine/
├── CMakeLists.txt
├── CMakePresets.json
├── conanfile.txt
├── README.md
├── .clang-format
├── .clang-tidy
├── .gitignore
├── .github/
│   └── workflows/
│       └── ci.yml
│
├── include/  # Contains header files
│   └── gridx/
│      └── matching/
|          |
|          ├── common/
|          │   ├── Logger.hpp
|          |   ├── Types.hpp
|          │   └── Utils.hpp
|          |
│          ├── domain/
│          │   ├── Order.hpp
│          │   ├── Trade.hpp
│          │   ├── MarketId.hpp
│          │   ├── Price.hpp
│          │   └── Quantity.hpp
│          │
│          ├── orderbook/
│          │   ├── OrderBook.hpp
│          │   ├── OrderBookSide.hpp
│          │   ├── PriceLevel.hpp
│          │   └── OrderBookManager.hpp
│          │
│          ├── matcher/
│          │   ├── Matcher.hpp
│          │   ├── MatchingResult.hpp
│          │   └── MatchingAlgorithm.hpp
│          │
│          ├── engine/
│          │   ├── MatchingEngine.hpp
│          │   ├── OrderProcessor.hpp
│          │   ├── MarketRouter.hpp
│          │   └── RecoveryManager.hpp
│          │
│          ├── config/
│          │   ├── MarketConfigCache.hpp
│          │   ├── TariffCache.hpp
│          │   └── GridTopologyCache.hpp
│          │
│          └── ports/
│              ├── OrderEventConsumer.hpp
│              ├── TradeEventPublisher.hpp
│              └── RecoveryClient.hpp
│
├── src/ # Contains implementations of above header files
│   ├── main.cpp
│   ├── domain/
│   ├── orderbook/
│   ├── matcher/
│   ├── engine/
│   ├── config/
│   └── adapters/
│       ├── kafka/
│       |   ├── KafkaOrderConsumer.cpp
│       │   ├── KafkaEventPublisher.cpp
│       │   └── KafkaConfigConsumer.cpp
│       ├── codec/
│       │   ├── ProtobufOrderCodec.cpp
│       │   ├── ProtobufTradeCodec.cpp
│       │   ├── ProtobufGridRuleCodec.cpp
│       │   └── OrderEventMapper.cpp
│       └── recovery/
│
├── tests/
│   ├── unit/
│   │   ├── OrderBookTest.cpp
│   │   ├── MatcherTest.cpp
│   │   └── TariffCacheTest.cpp
│   │
│   ├── integration/
│   │   ├── KafkaFlowTest.cpp
│   │   └── RecoveryTest.cpp
│   │
│   └── benchmark/
│       ├── OrderBookBenchmark.cpp
│       └── MatchingBenchmark.cpp
│
├── scripts/
│   ├── run-local.sh
│   └── benchmark.sh
├── Dockerfile
└── docker-compose.yml
```


# 11. Testing Strategy

Testing is an important part of the Matching Engine implementation.

The objective is to verify that every component behaves correctly under normal operation, invalid input, high workloads, and unexpected failures.

Testing will be performed throughout the development process rather than only after implementation is complete.

---

## 11.1 Testing Objectives

The testing process aims to verify the following:

* Orders are matched correctly.
* Price-Time Priority is always maintained.
* Partial fills are handled correctly.
* Trades are generated correctly.
* Order Books remain consistent.
* Crash Recovery restores the engine successfully.
* Performance meets the project requirements.

---

## 11.2 Unit Testing

Each module should be tested independently.

The following components require unit tests.

| Component        | Test Focus                        |
| ---------------- | --------------------------------- |
| Order            | Object creation and validation    |
| Trade            | Trade generation                  |
| PriceLevel       | FIFO order handling               |
| OrderBook        | Add, remove and update operations |
| Order Matcher    | Matching logic                    |
| Recovery Manager | Recovery process                  |

Unit tests should verify both expected behaviour and invalid input.

---

## 11.3 Integration Testing

Integration testing verifies communication between internal components.

The following scenarios should be tested.

* Kafka Consumer receives orders successfully.
* Orders move correctly through the processing pipeline.
* Order Book updates after matching.
* Trade Manager generates trades.
* Event Publisher publishes completed events.
* Recovery Manager rebuilds Order Books correctly.

The objective is to ensure all components work together correctly.

---

## 11.4 Functional Testing

Functional testing verifies business requirements.

Example scenarios include:

### Scenario 1

Single BUY matches single SELL.

Expected Result:

One completed trade.

---

### Scenario 2

Large BUY matches multiple SELL orders.

Expected Result:

Multiple trades generated.

---

### Scenario 3

Incoming order has no matching order.

Expected Result:

Order remains in the Order Book.

---

### Scenario 4

Partially matched order.

Expected Result:

Remaining quantity stays active.

---

### Scenario 5

Orders from different Grid Zones where transfer is not allowed.

Expected Result:

No matching occurs.

---

### Scenario 6

Orders from different Grid Zones where transfer is allowed and effective price condition is satisfied.

Expected Result:

A trade is generated with buyer grid zone, seller grid zone, energy price, grid fee, buyer total price, and grid rule version.

---

### Scenario 7

Order remains unmatched until its 30-minute delivery slot ends.

Expected Result:

The remaining quantity expires and the order status becomes EXPIRED.

---

### Scenario 8

Invalid order.

Expected Result:

Order rejected before matching.

---

## 11.5 Performance Testing

Performance testing measures how efficiently the Matching Engine performs under different workloads.

The following metrics should be measured.

* Average matching latency
* Maximum matching latency
* Orders processed per second
* Memory usage
* CPU utilization
* Recovery time

These tests help identify performance bottlenecks before deployment.

---

## 11.6 Stress Testing

Stress testing evaluates system behaviour under heavy load.

Example tests include:

* Thousands of active orders.
* Continuous order submissions.
* Large Order Books.
* Multiple Grid Zones with active trading.

The objective is to verify that the Matching Engine remains stable during high trading activity.

---

## 11.7 Recovery Testing

Recovery testing verifies the Crash Recovery process.

Example scenarios include:

* Unexpected application shutdown.
* Server restart.
* Recovery after partial order execution.
* Recovery with multiple Grid Zones.

The expected result is that all active Order Books are rebuilt successfully before matching resumes.

---

## 11.8 Testing Tools

The following tools are planned for testing.

| Tool                   | Purpose             |
| ---------------------- | ------------------- |
| Google Test            | Unit testing        |
| CTest                  | Test execution      |
| Kafka Test Environment | Integration testing |
| Benchmark Scripts      | Performance testing |

Additional testing tools may be introduced if required during development.

---

# 12. Performance Targets

The Matching Engine is designed to prioritize low-latency order processing.

Performance targets provide measurable goals that can be evaluated during implementation and testing.

---

## 12.1 Primary Goals

The implementation should achieve:

* Low matching latency.
* High throughput.
* Stable memory usage.
* Reliable crash recovery.
* Consistent Order Book updates.

---

## 12.2 Target Metrics

| Metric                   | Target                             |
| ------------------------ | ---------------------------------- |
| Order Book Storage       | In Memory                          |
| Average Matching Latency | Less than 10 ms (project target)   |
| Order Matching Accuracy  | 100%                               |
| Price-Time Priority      | 100%                               |
| Delivery Slot Isolation  | 100%                               |
| Grid Transfer Rule Accuracy | 100%                            |
| Order Expiry Accuracy    | 100%                               |
| Crash Recovery           | Restore active orders successfully |

The final performance depends on hardware, workload, and deployment environment.

---

## 12.3 Performance Monitoring

Performance should be monitored throughout development.

Recommended metrics include:

* Matching latency
* Queue size
* Active orders
* Completed trades
* Memory consumption
* CPU usage
* Recovery duration

Monitoring these values helps identify areas for optimization.

---

## 12.4 Optimization Strategy

The Matching Engine should be optimized only after functional correctness has been verified.

Optimization priorities include:

* Reduce memory allocations.
* Minimize unnecessary object copying.
* Improve Order Book operations.
* Reduce matching loop overhead.
* Profile CPU and memory usage.

Correctness should always take priority over optimization.

> **NOTE:** Premature optimization may increase implementation complexity without providing measurable benefits.

---

# Notes

* This implementation plan serves as the primary technical reference for the Matching Engine.
* Detailed design documents provide additional information for specific topics such as the Order Book, Matching Algorithm, Components, and Crash Recovery.
* Implementation should follow the architecture and responsibilities defined in this document.
* Any major architectural changes should be reviewed by the project team before implementation begins.
