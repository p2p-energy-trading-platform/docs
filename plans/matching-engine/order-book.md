# Order Book Design

## Purpose

This document describes the planned design of the Order Book used by the Matching Engine.

The Order Book stores all active buy and sell orders in memory and provides fast access for the matching algorithm.

---

## Responsibilities

The Order Book is responsible for:

* Store active buy orders
* Store active sell orders
* Maintain price-time priority
* Support fast order lookup
* Support order updates
* Support order removal after matching
* Keep separate order books for each grid zone

---

## Grid Zone Order Books

Orders are only matched within the same grid zone.

Instead of using one global order book, the Matching Engine maintains one order book for each grid zone.

Example:

```text
Matching Engine

├── Zone A Order Book
│     ├── Buy Book
│     └── Sell Book
│
├── Zone B Order Book
│     ├── Buy Book
│     └── Sell Book
│
└── Zone C Order Book
      ├── Buy Book
      └── Sell Book
```

This design keeps the matching process simple and allows future scaling by assigning different grid zones to different matching engines.

---

## Data Structure Comparison

| Data Structure | Advantages                                                                     | Disadvantages                                | Decision     |
| -------------- | ------------------------------------------------------------------------------ | -------------------------------------------- | ------------ |
| Vector         | Simple implementation                                                          | Slow insert and search for large order books | Not Selected |
| Linked List    | Fast insertion and deletion                                                    | Slow price lookup                            | Not Selected |
| Priority Queue | Fast access to best price                                                      | Difficult to cancel or modify orders         | Not Selected |
| Map + Queue    | Maintains sorted prices, supports FIFO order, easy to update and cancel orders | Slightly more complex than basic structures  | Selected     |

---

## Selected Data Structure

The Order Book will use:

```cpp
std::map<Price, std::deque<Order>>
```

for both Buy Orders and Sell Orders.

Structure:

```text
Buy Book

Price 30
 ├── Order 1
 ├── Order 2
 └── Order 3

Price 29
 ├── Order 4
 └── Order 5


Sell Book

Price 31
 ├── Order 6
 └── Order 7

Price 32
 └── Order 8
```

The map keeps prices sorted automatically.

The deque stores orders in the order they arrive, allowing FIFO processing for orders with the same price.

This naturally supports Price-Time Priority.

---

## Supported Operations

The Order Book should support the following operations:

* Add Order
* Remove Order
* Update Order
* Cancel Order
* Find Best Buy Order
* Find Best Sell Order
* Return Best Bid
* Return Best Ask

---

## Storage Strategy

The active Order Book will only exist in the Matching Engine memory (RAM).

The Matching Engine will not use PostgreSQL or Redis during normal matching operations.

Reason:

* Faster access
* Lower latency
* No database queries during matching

---

## Crash Recovery

The Order Service is responsible for storing all newly created orders in PostgreSQL before publishing them to Kafka.

If the Matching Engine restarts:

1. The Matching Engine requests all active OPEN orders from the Order Service.
2. The Order Service loads the orders from PostgreSQL.
3. The Matching Engine rebuilds each Grid Zone Order Book in memory.
4. After rebuilding, the Matching Engine resumes consuming new order events from Kafka.

This approach provides low-latency matching while allowing the system to recover after a restart.

---

## Design Decisions

### Decision 1

Use one Order Book for each Grid Zone.

Reason:

Orders are only allowed to match within the same grid zone.

---

### Decision 2

Store active Order Books only in memory.

Reason:

Reading from memory is significantly faster than using Redis or a database.

---

### Decision 3

Use `std::map<Price, std::deque<Order>>`.

Reason:

This structure keeps prices sorted automatically and maintains FIFO order for orders with the same price, making it suitable for implementing Price-Time Priority.

---

## Notes

* The selected data structure may be optimized after performance testing.
* Future improvements such as custom price-level structures or lock-free data structures may be evaluated if required.
