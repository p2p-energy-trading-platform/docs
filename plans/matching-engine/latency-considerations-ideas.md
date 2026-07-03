# Latency Considerations

## Purpose

This document records ideas that may help reduce latency in the matching engine.

These are research notes and not final implementation decisions.




## Potential Optimisations

### 1. Direct Communication Between Order Service and Matching Engine

Instead of sending orders through Kafka before they reach the matching engine:

```text
Order Service
    ↓
Kafka
    ↓
Matching Engine
```

consider:

```text
Order Service
    ↓
gRPC / REST
    ↓
Matching Engine
```

Benefits:

* Fewer network hops
* Faster order delivery
* Lower latency

Trade-offs:

* Reduced buffering
* Additional reliability mechanisms may be required

---

### 2. Keep Order Book in Memory

Store active buy and sell orders in memory instead of querying the database for every operation.

Benefits:

* Faster order lookup
* Faster matching
* Reduced database dependency during trading

---

### 3. Use Efficient Data Structures and Algorithms

The order book data structure has a significant impact on matching performance.

Potential options:

* Red-Black Tree
* Ordered Map
* Priority Queue
* Custom Price Level Structure

The matching algorithm should efficiently locate the best buy and sell prices without scanning the entire order book.

Benefits:

* Faster order matching
* Better scalability as order volume increases
* Reduced CPU usage

This area requires further research and benchmarking before implementation.

#### 3.1 Cache Grid Transfer Rules In Memory

Cross-zone matching requires checking whether transfer is allowed between the seller zone and buyer zone and calculating the grid fee.

The matching engine should not call an external service during matching.

Grid transfer rules and tariff rules should be consumed from Kafka and stored in an in-memory cache.

Benefits:

* Avoids network calls during matching
* Keeps cross-zone matching low-latency
* Provides deterministic fee calculation during trade generation

---

### 4. Avoid Synchronous Database Writes

The matching engine should avoid waiting for database operations before continuing processing.

Possible approach:

```text
Matching Engine
    ↓
Trade Event
    ↓
Kafka
```

Database updates can be handled by separate services.

Benefits:

* Lower matching latency
* Improved throughput

---

### 5. Minimise Work Inside the Matching Engine

The matching engine should focus only on:

* Order book management
* Order matching
* Trade generation

Functions such as:

* Notifications
* Analytics
* Reporting
* Historical storage

should be handled by separate services.

Benefits:

* Simpler architecture
* Faster execution path

---

### 6. Consider Single Writer Architecture

Allow only one thread to modify the order book while other services consume generated events.

Benefits:

* Reduced locking
* Simpler concurrency management
* Predictable processing order

#### 6.1 Partition by Market Book

All orders that can match each other should be processed by the same matching thread or matching engine instance.

For cross-zone matching, Kafka partitioning should not use grid zone as the key.

Instead, the partition key should be:

```text
delivery_slot_start + product_type
```

---

### 7. Reduce Memory Allocations

Frequent memory allocation may introduce additional overhead.

Potential techniques:

* Object pooling
* Reusing structures
* Preallocated containers

This may become important during performance optimisation.

---

### 8. Limit Cross-Zone Candidate Search

Cross-zone matching may require checking multiple Zone Order Books inside the same Market Book.

To reduce latency:

* Check only zones allowed by Grid Transfer Policy
* Cache eligible zone pairs
* Start with best price level in each eligible zone
* Compare effective prices instead of scanning all orders
* Stop when no remaining candidate can satisfy the incoming order price

This keeps cross-zone matching efficient even when many grid zones exist.

---

## Team Notes

* These items are research ideas only and are not final design decisions.
* Benchmarking should be performed before selecting an implementation approach.
* Additional latency optimisation techniques may be added as research continues.
