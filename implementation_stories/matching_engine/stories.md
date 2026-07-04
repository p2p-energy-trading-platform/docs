---
connie-title: Matching Engine — User Stories
---

# Matching Engine — User Stories

**Epic:** Matching Engine
* **Repository:** [p2p-energy-trading-platform/matching-engine](https://github.com/p2p-energy-trading-platform/matching-engine)
**Language:** C++20
**Status:** Draft

> This document breaks the Matching Engine epic into component-level user stories mapped directly to the implementation plan, components document, matching algorithm, order book design, crash recovery, grid fee cache, domain objects, and folder structure documents. Each story includes acceptance criteria for Jira ticket creation.

---

## 1. Order Ingestion

### US-1.1 — Order ingestion via Kafka
>**As** the matching engine, <br> 
>**I want** to consume incoming order events from Kafka, <br> 
>**so that** valid orders are continuously received and forwarded into the matching pipeline.

*Maps to: `src/adapters/kafka/KafkaOrderConsumer.cpp`, `ports/OrderEventConsumer.hpp`*

**Acceptance Criteria:**
- Engine subscribes to the correct Kafka order topic on startup.
- Incoming order events are deserialized into Order objects using Protobuf (`ProtobufOrderCodec.cpp`, `OrderEventMapper.cpp`).
- Orders are forwarded to the Order Validator immediately after deserialization.
- Kafka Consumer does not start until both the Recovery Manager and GridTransferCache are fully initialized.

---

## 2. Order Validation

### US-2.1 — Order validation before matching
>**As** the matching engine, <br>
>**I want** to validate each incoming order before it enters the matching process, <br>
>**so that** only well-formed, non-expired orders proceed to matching.

*Maps to: Order Validator component*

**Acceptance Criteria:**
- Validation checks: grid zone exists, valid order type, valid quantity, valid price, valid delivery slot, 30-minute slot duration, order not expired, all required fields present.
- All required Order object fields are validated: orderId, userId, marketId, gridZone, side, orderType, price, quantity, remainingQuantity, deliverySlotStart, deliverySlotEnd, expiresAt, status, timestamp.
- Invalid orders are rejected immediately with no matching attempted.
- Business validations already handled by the Order Service are not repeated.

---

## 3. Market Book & Zone Order Book Management

### US-3.1 — Market Book selection by delivery slot
>**As** the matching engine, <br>
>**I want** to select the correct Market Book for each order based on its delivery slot and product type, <br>
**so that** orders are only matched within the same 30-minute energy delivery window.

*Maps to: `MarketBook.hpp`, `MarketBookManager.hpp`, `MarketId.hpp`*

**Acceptance Criteria:**
- Market Book is identified by delivery_slot_start + product_type (maps to MarketId struct).
- Only ENERGY product type is supported in the initial implementation.
- Delivery slot duration is fixed at 30 minutes (DELIVERY_SLOT_MINUTES = 30).
- Orders from different delivery slots are never matched against each other.

---

### US-3.2 — Zone Order Book management
>**As** the matching engine, <br>
>**I want** to maintain separate Zone Order Books inside each Market Book, <br>
>**so that** orders are organized by participant grid zone and cross-zone matching can be correctly evaluated.

*Maps to: `ZoneOrderBook.hpp`, `OrderBookSide.hpp`, `PriceLevel.hpp`*

**Acceptance Criteria:**
- Each Market Book contains one Zone Order Book per active grid zone.
- Each Zone Order Book has a separate Buy Book and Sell Book.
- Orders are inserted into the correct Zone Order Book based on their gridZone field.
- std::map<Price, std::deque<Order>> is used for both Buy and Sell Books.
- Price levels are maintained in sorted order automatically.
- Orders within the same price level are processed FIFO by timestamp field.

---

### US-3.3 — Market Book update after matching
>**As** the matching engine, <br>
>**I want** the Market Book to be updated after every matching operation, <br>
>**so that** it always reflects the current accurate state of active orders.

*Maps to: `MarketBook.hpp`, Market Book Manager component*

**Acceptance Criteria:**
- Fully matched orders are removed from the Order Book.
- Partially matched orders have their remainingQuantity updated in place.
- Unmatched limit orders are inserted into the correct Zone Order Book.
- No Order Book update is visible to downstream services until matching is fully complete.

---

## 4. Matching Algorithm

### US-4.1 — Same-zone order matching
>**As** the matching engine, <br>
>**I want** to match buy and sell orders within the same grid zone, <br>
>**so that** local energy trades are executed with zero grid fee.

*Maps to: `Matcher.hpp`, `MatchingAlgorithm.hpp`, Order Matcher component*

**Acceptance Criteria:**
- Incoming BUY searches same-zone SELL orders; incoming SELL searches same-zone BUY orders.
- Same-zone grid fee is zero (grid_fee = 0).
- Match condition for BUY: seller_price <= buyer_limit_price.
- Match condition for SELL: seller_limit_price <= buyer_limit_price.
- Matched orders produce a Trade object via the Trade Manager.
- Unmatched orders are stored in the correct Zone Order Book.

---

### US-4.2 — Cross-zone matching with Grid Transfer Policy
>**As** the matching engine, <br>
>**I want** to support cross-zone order matching when the Grid Transfer Policy permits it, <br>
>**so that** participants in different grid zones can trade energy with grid fees applied.

*Maps to: `CrossZoneMatcher.hpp`, `GridTransferCache.hpp`, `EffectivePriceCalculator.hpp`*

**Acceptance Criteria:**
- Cross-zone matching is only attempted when GridTransferRule.allowed = true for the seller/buyer zone pair.
- Grid fee is retrieved from the in-memory GridTransferCache — no external service call during matching.
- Effective price for BUY: effective_ask = seller_price + grid_fee.
- Effective price for SELL: effective_bid = buyer_limit_price - grid_fee.
- If no rule exists for a zone pair, transfer is treated as not allowed by default.
- Trade object includes: buyerGridZone, sellerGridZone, energyPrice, gridFee, buyerTotalPrice, gridRuleVersion.

---

### US-4.3 — Effective-Price-Time Priority
>**As** the matching engine, <br>
>**I want** to apply Effective-Price-Time Priority when selecting among multiple matching candidates, <br>
>**so that** the best-priced, earliest-submitted orders are always matched first.

*Maps to: `MatchingAlgorithm.hpp`, `EffectivePriceCalculator.hpp`*

**Acceptance Criteria:**
- Priority Rule 1: Best effective price matched first (lowest effective ask for BUY, highest effective bid for SELL).
- Priority Rule 2: If effective prices are equal, earliest timestamp wins.
- Priority Rule 3: If effective price and timestamp are equal, same-zone match is preferred over cross-zone.
- Priority is applied consistently across both same-zone and cross-zone candidates.

---

### US-4.4 — Partial fill and multiple trade generation
>**As** the matching engine, <br>
>**I want** to support partial order fills and generate multiple trades from a single incoming order, <br>
>**so that** large orders can be matched against several smaller orders without being blocked.

*Maps to: `MatchingResult.hpp`, `Trade.hpp`, Trade Manager component*

**Acceptance Criteria:**
- Matching continues until the incoming order is fully filled or no suitable orders remain.
- Each successful match with a distinct counterparty produces a separate Trade object.
- Remaining unmatched quantity of a partially matched order stays active in the Order Book.
- Example: BUY 100 kWh matched against SELL 40 + SELL 30 + SELL 50 generates 3 trades (40, 30, 30), leaving 20 kWh in the last SELL order.
- Each Trade object captures: tradeId, buyOrderId, sellOrderId, buyerId, sellerId, buyerGridZone, sellerGridZone, deliverySlotStart, deliverySlotEnd, energyPrice, gridFee, buyerTotalPrice, quantity, gridRuleVersion, timestamp.

---

## 5. Order Expiry

### US-5.1 — Order expiry at delivery slot end
>**As** the matching engine, <br>
>**I want** unmatched order quantities to expire automatically when their 30-minute delivery slot ends, <br>
>**so that** stale orders are never matched against future delivery periods.

*Maps to: `ExpiryManager.hpp`, Expiry Manager component*

**Acceptance Criteria:**
- Expiry Manager detects when a delivery slot's deliverySlotEnd time has passed.
- Remaining unmatched quantity for that slot is marked as EXPIRED.
- Expired orders are removed from the active Market Book.
- An order expiry status update event is published to Kafka.

---

## 6. Event Publishing

### US-6.1 — Trade and order event publishing via Kafka
>**As** a downstream service (Settlement, Market Data, Notification), <br>
>**I want** completed trade events and order status updates published to Kafka after each matching cycle, <br>
>**so that** I can process trades and notify users without polling the Matching Engine directly.

*Maps to: `TradeEventPublisher.hpp`, `KafkaEventPublisher.cpp`, `ProtobufTradeCodec.cpp`, `TradeEventMapper.cpp`*

**Acceptance Criteria:**
- Events published include: Trade Executed, Order Updated, Order Filled, Order Partially Filled, Order Expired, Order Cancelled.
- Events are published only after all matching operations and Order Book updates are complete.
- Trade events are serialized using Protobuf before publishing.
- No incomplete or partial matching results are published mid-cycle.

---

## 7. Grid Transfer Cache

### US-7.1 — Grid Transfer Cache startup loading from Kafka compacted topic
>**As** the matching engine, <br>
>**I want** to load all grid transfer rules from a Kafka compacted topic at startup, <br>
>**so that** cross-zone matching decisions are available before the first order is processed.

*Maps to: `GridTransferCache.hpp`, `TariffCache.hpp`, `KafkaConfigConsumer.cpp`, `ProtobufGridRuleCodec.cpp`*

**Acceptance Criteria:**
- On startup, the engine subscribes to grid.transfer-rules.v1 (configured as a compacted Kafka topic with cleanup.policy=compact).
- The engine reads the topic from the beginning to load the latest rule for every zone pair.
- Each rule entry is keyed by seller_zone:buyer_zone (e.g. ZONE_A:ZONE_B).
- Cache stores per zone pair: allowed (boolean), grid_fee_per_kwh, version, updated_at.
- Matching Engine does not begin consuming order events until GridTransferCache is fully loaded.

---

### US-7.2 — Grid Transfer Cache runtime updates
>**As** the matching engine, <br>
>**I want** the Grid Transfer Cache to update in memory when new grid fee rules are published to Kafka, <br>
>**so that** new orders use the latest grid fees without requiring a restart.

*Maps to: `GridTransferCache.hpp`, `KafkaConfigConsumer.cpp`*

**Acceptance Criteria:**
- Engine continues consuming grid.transfer-rules.v1 after startup.
- When a new rule event arrives for a zone pair, the in-memory cache is updated immediately.
- Trades already executed are not changed — each trade event carries the gridRuleVersion used at execution time.
- New orders received after the update use the new grid fee.
- Cache update does not interrupt or delay active order matching.

---

## 8. Crash Recovery

### US-8.1 — Order Book rebuild after crash or restart
>**As** the matching engine, <br>
>**I want** to rebuild all active Order Books from the Order Service after an unexpected restart, <br>
>**so that** no active orders are lost and matching resumes from a correct state.

*Maps to: `RecoveryManager.hpp`, `RecoveryClient.hpp`, `src/adapters/recovery/`*

**Acceptance Criteria:**
- Recovery Manager requests all OPEN and PARTIALLY_FILLED orders from the Order Service on startup.
- Orders with status FILLED, CANCELLED, REJECTED, EXPIRED are ignored during recovery.
- Orders are grouped first by delivery_slot_start + product_type (Market Book), then by gridZone (Zone Order Book).
- Partially filled orders are restored using remainingQuantity only — not original quantity.
- Orders whose deliverySlotEnd has already passed are rejected from the in-memory book and an EXPIRED status update is published.
- Kafka Consumer starts only after all Market Books and Zone Order Books are fully rebuilt.
- If the Order Service is unavailable, recovery retries continuously without starting the consumer.
- Engine moves through states: STARTING -> RECOVERING -> READY -> RUNNING.

---

### US-8.2 — Orders received during recovery are not lost
>**As** the matching engine, <br>
>**I want** new orders that arrive while recovery is running to be safely buffered in Kafka, <br>
>**so that** no incoming orders are lost during the startup window.

*Maps to: `RecoveryManager.hpp`, Kafka Consumer startup sequence*

**Acceptance Criteria:**
- Kafka Consumer remains stopped for the entire duration of recovery.
- New order events published during recovery remain stored in Kafka until the consumer starts.
- After recovery completes, the consumer starts and processes all buffered events in order.
- No incoming order is dropped or skipped due to the recovery window.

---

## 9. Concurrency & Thread Safety

### US-9.1 — Thread safety for Market Book access
>**As** the matching engine, <br>
>**I want** Market Books and Zone Order Books to be protected by locks during concurrent access, <br>
>**so that** matching operations remain consistent and free from race conditions.

*Maps to: `MatchingEngine.hpp`, Concurrency Model*

**Acceptance Criteria:**
- Each Market Book is protected by a shared Read-Write Lock (RWLock).
- Each Zone Order Book has its own mutex.
- Lock ordering follows a top-down approach (Market Book lock acquired before Zone Order Book lock) to prevent deadlocks.
- All std::map<Price, std::deque<Order>> access is mutex-protected.

---

## 10. Domain Objects

### US-10.1 — Core domain object definitions
>**As** a developer, <br>
>**I want** well-defined C++ domain objects for Order, Trade, MarketId, PriceLevel, GridTransferRule, and MatchingResult, <br>
>**so that** all components share a consistent, typed data model with no ambiguity.

*Maps to: `include/gridx/matching/domain/Order.hpp`, `Trade.hpp`, `MarketId.hpp`, `Price.hpp`, `Quantity.hpp`*

**Acceptance Criteria:**
- Order struct contains all required fields: orderId, userId, marketId, gridZone, side (BUY/SELL), orderType (LIMIT), price, quantity, remainingQuantity, deliverySlotStart, deliverySlotEnd, expiresAt, status, timestamp.
- Trade struct contains all required fields: tradeId, buyOrderId, sellOrderId, buyerId, sellerId, buyerGridZone, sellerGridZone, deliverySlotStart, deliverySlotEnd, energyPrice, gridFee, buyerTotalPrice, quantity, gridRuleVersion, timestamp.
- GridTransferRule struct contains: sellerGridZone, buyerGridZone, allowed, gridFee, version.
- MatchingResult contains: generated trades, updated orders, remaining quantity.
- MarketId identifies a Market Book by delivery_slot_start + product_type.
- All types defined under include/gridx/matching/domain/ and common/Types.hpp.

---

## 11. Build System & Developer Tooling

### US-11.1 — CMake + Ninja + Conan build system setup
>**As** a developer, <br>
>**I want** a fully configured CMake/Ninja/Conan build system, <br>
>**so that** any team member can build, test, and run the matching engine locally with a consistent setup.

*Maps to: `CMakeLists.txt`, `CMakePresets.json`, `conanfile.txt`*

**Acceptance Criteria:**
- CMakeLists.txt defines the project, C++20 standard, source files, library targets, executable, and header include paths.
- CMakePresets.json includes at minimum debug and release presets using Ninja as the generator.
- conanfile.txt declares all external dependencies: protobuf, librdkafka, yaml-cpp, spdlog, fmt, gtest, benchmark, gridx-sdk-cpp.
- Running conan install followed by cmake --preset debug and cmake --build build/debug produces a working executable.
- CI pipeline (.github/workflows/ci.yml) runs the full build on pull requests.

---

### US-11.2 — Code quality tooling (clang-format + clang-tidy)
>**As** a developer, <br>
>**I want** automated formatting and static analysis enforced via clang-format and clang-tidy, <br>
>**so that** code quality standards are consistent across all contributors.

*Maps to: `.clang-format`, `.clang-tidy`*

**Acceptance Criteria:**
- .clang-format configured with at minimum: BasedOnStyle: Google, IndentWidth: 4, ColumnLimit: 100.
- .clang-tidy enables checks: bugprone-*, performance-*, modernize-*, readability-*, cppcoreguidelines-*.
- clang-format runs cleanly across all .cpp and .hpp files in the repo.
- CI pipeline runs clang-tidy as part of the build step.

---

## 12. Testing

### US-12.1 — Unit and integration test coverage
>**As** a developer, <br>
>**I want** unit and integration tests covering all matching engine components, <br>
>**so that** matching correctness, priority rules, and recovery behaviour can be verified automatically.

*Maps to: `tests/unit/OrderBookTest.cpp`, `tests/unit/MatcherTest.cpp`, `tests/unit/TariffCacheTest.cpp`, `tests/integration/KafkaFlowTest.cpp`, `tests/integration/RecoveryTest.cpp`*

**Acceptance Criteria:**
- Unit tests cover: Order validation, PriceLevel FIFO handling, Order Book add/remove/update, same-zone matching, cross-zone matching, Trade generation, Recovery Manager rebuild, TariffCache lookup.
- Integration tests cover: Kafka Consumer to Validator to Matcher to Publisher full pipeline, Recovery rebuild across multiple zones.
- All 8 functional scenarios verified: single match, partial fill, multiple trades, no match (order stored), cross-zone allowed, cross-zone blocked, order expiry, invalid order rejection.
- Test framework: Google Test. Test runner: CTest. CI runs tests on every pull request via ci.yml.

---

### US-12.2 — Performance and stress testing
>**As** a developer, <br>
>**I want** benchmark and stress tests measuring matching engine performance under load, <br>
>**so that** latency and throughput targets are verified before deployment.

*Maps to: `tests/benchmark/OrderBookBenchmark.cpp`, `tests/benchmark/MatchingBenchmark.cpp`, `scripts/benchmark.sh`*

**Acceptance Criteria:**
- Average matching latency target: less than 10ms.
- Order matching accuracy: 100%. Price-Time Priority accuracy: 100%.
- Stress tests cover: thousands of active orders, continuous submissions, large Order Books, multiple active grid zones simultaneously.
- Performance metrics tracked: matching latency, queue size, active orders, completed trades, memory consumption, CPU usage, recovery duration.
- Benchmarks run via scripts/benchmark.sh using Google Benchmark library.

---

## Summary Table

| ID | Story | Component |
|---|---|---|
| US-1.1 | Order ingestion via Kafka | `KafkaOrderConsumer.cpp`, `OrderEventConsumer.hpp` |
| US-2.1 | Order validation before matching | Order Validator |
| US-3.1 | Market Book selection by delivery slot | `MarketBook.hpp`, `MarketBookManager.hpp` |
| US-3.2 | Zone Order Book management | `ZoneOrderBook.hpp`, `OrderBookSide.hpp`, `PriceLevel.hpp` |
| US-3.3 | Market Book update after matching | `MarketBook.hpp` |
| US-4.1 | Same-zone order matching | `Matcher.hpp`, `MatchingAlgorithm.hpp` |
| US-4.2 | Cross-zone matching with Grid Transfer Policy | `CrossZoneMatcher.hpp`, `GridTransferCache.hpp` |
| US-4.3 | Effective-Price-Time Priority | `MatchingAlgorithm.hpp`, `EffectivePriceCalculator.hpp` |
| US-4.4 | Partial fill and multiple trade generation | `MatchingResult.hpp`, `Trade.hpp` |
| US-5.1 | Order expiry at delivery slot end | `ExpiryManager.hpp` |
| US-6.1 | Trade and order event publishing via Kafka | `TradeEventPublisher.hpp`, `KafkaEventPublisher.cpp` |
| US-7.1 | Grid Transfer Cache startup loading | `GridTransferCache.hpp`, `KafkaConfigConsumer.cpp` |
| US-7.2 | Grid Transfer Cache runtime updates | `GridTransferCache.hpp`, `KafkaConfigConsumer.cpp` |
| US-8.1 | Order Book rebuild after crash or restart | `RecoveryManager.hpp`, `RecoveryClient.hpp` |
| US-8.2 | Orders received during recovery are not lost | `RecoveryManager.hpp`, Kafka Consumer startup |
| US-9.1 | Thread safety for Market Book access | `MatchingEngine.hpp` |
| US-10.1 | Core domain object definitions | `domain/Order.hpp`, `Trade.hpp`, `MarketId.hpp` |
| US-11.1 | CMake + Ninja + Conan build system setup | `CMakeLists.txt`, `CMakePresets.json`, `conanfile.txt` |
| US-11.2 | Code quality tooling (clang-format + clang-tidy) | `.clang-format`, `.clang-tidy` |
| US-12.1 | Unit and integration test coverage | `tests/unit/`, `tests/integration/` |
| US-12.2 | Performance and stress testing | `tests/benchmark/`, `scripts/benchmark.sh` |

---
