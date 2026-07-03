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
* Keep separate Market Books for each delivery slot
* Keep separate Zone Order Books inside each Market Book
* Support matching across grid zones when grid transfer rules allow it
* Support order expiry at the end of the 30-minute delivery slot

---

## Market Books and Zone Order Books

Orders are not restricted to matching only within the same grid zone.

The Matching Engine maintains one Market Book for each 30-minute delivery slot and product type. The only supported product type is ENERGY, and all quantities are measured in kWh.

Each Market Book contains separate Zone Order Books. A Zone Order Book stores the buy and sell orders submitted by participants from that grid zone.

Cross-zone matching is allowed only when the Grid Transfer Policy allows energy transfer between the seller's grid zone and the buyer's grid zone.

Example:

```text
Matching Engine

├── Market Book: ENERGY / 10:00–10:30
│     ├── Zone A Order Book
│     │     ├── Buy Book
│     │     └── Sell Book
│     │
│     ├── Zone B Order Book
│     │     ├── Buy Book
│     │     └── Sell Book
│     │
│     └── Zone C Order Book
│           ├── Buy Book
│           └── Sell Book
│
├── Market Book: ENERGY / 10:30–11:00
│     ├── Zone A Order Book
│     ├── Zone B Order Book
│     └── Zone C Order Book
│
└── Market Book: ENERGY / 11:00–11:30
      ├── Zone A Order Book
      ├── Zone B Order Book
      └── Zone C Order Book
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

Each Zone Order Book will use:

```cpp
std::map<Price, std::deque<Order>>
```

for both Buy Orders and Sell Orders.

The complete in-memory structure is:

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

The Market Book groups orders by delivery slot. The Zone Order Book groups orders by participant grid zone. Cross-zone matching searches eligible Zone Order Books inside the selected Market Book.

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

The map keeps price levels sorted automatically.

The deque stores orders in the order they arrive, allowing FIFO processing for orders with the same price.

This structure maintains ordered price levels and arrival order inside each Zone Order Book. The matcher then applies the full matching policy, including delivery-slot matching, cross-zone eligibility, grid fee calculation, and Effective-Price-Time Priority.

---

## Delivery Slot

Each order belongs to one fixed 30-minute delivery slot.

Example:

```text
delivery_slot_start = 10:00
delivery_slot_end   = 10:30
```

Orders are matched only against other orders in the same delivery slot. The slot duration is fixed at 30 minutes.

```cpp
constexpr int DELIVERY_SLOT_MINUTES = 30;
```

If an order is not fully matched before the slot ends, its remaining quantity expires and the order status becomes `EXPIRED`.

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

## Cross-Zone Matching

Cross-zone matching is controlled by the Grid Transfer Policy.

The Grid Transfer Policy determines:

* Whether energy transfer is allowed between two grid zones
* The grid fee for transferring energy between those zones
* The grid rule or tariff version used during matching

For a BUY order, the matching engine evaluates seller orders using:

```text
effective_ask = seller_price + grid_fee
```

The `BUY` order can match if:

```text
effective_ask <= buyer_limit_price
```

For a `SELL` order, the matching engine evaluates buyer orders using:

```text
effective_bid = buyer_limit_price - grid_fee
```

The SELL order can match if:

```
seller_limit_price <= effective_bid
```

Cross-zone matching follows Effective-Price-Time Priority.

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
3. The Matching Engine rebuilds each Market Book and its internal Zone Order Books in memory.
4. After rebuilding, the Matching Engine resumes consuming new order events from Kafka.

This approach provides low-latency matching while allowing the system to recover after a restart.

---

## Design Decisions

### Decision 1

Use one Market Book for each 30-minute delivery slot and product type.

Each Market Book contains separate Zone Order Books.

Reason:

Energy orders must be matched for the same delivery time period. Cross-zone matching is allowed, but only inside the same delivery slot and only when grid transfer rules allow it.

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
