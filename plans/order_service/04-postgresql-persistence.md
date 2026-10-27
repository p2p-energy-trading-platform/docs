---
connie-title: Order Service PostgreSQL Persistence
---

PostgreSQL Persistence
======================

Purpose
-------

PostgreSQL provides durable storage for Order Service records, including order data, lifecycle transitions, and pending outbound events.

The Matching Engine's in-memory order book is runtime state and must be reconstructable from the agreed durable records and event-recovery mechanisms.

The authoritative ownership of matching decisions and execution results must remain consistent with the shared contracts. Persisted order state must not be interpreted as proof that a command was accepted by the Matching Engine or that a trade was executed.

Suggested Tables
----------------

**`orders`**

Stores durable order attributes, current lifecycle status, remaining quantity, version, idempotency reference where applicable, and creation and update timestamps.

The schema must support the agreed order types, price-protection rules, delivery slots, and quantity precision.

**`order_status_history`**

Stores an append-only audit record of order lifecycle transitions.

Each transition should identify the order, previous and resulting states where applicable, event or transition identifier, timestamp, and relevant source or reason.

**`outbox_events`**

Stores events or commands that must be published to Kafka. Suggested attributes include event ID, aggregate or order ID, event type, payload, creation timestamp, and publication or retry metadata.

The schema must support safe concurrent publishing and recovery after publisher failures.

**`idempotency_records`**

Stores request idempotency information if the required information is not represented directly in the order table.

Records must identify the applicable request scope, idempotency key, request fingerprint, and stored outcome needed to handle retries consistently.

**`energy_allocations`**

Stores SELL energy allocations if the Order Service is selected as the authoritative allocation owner.

The allocation schema and transaction rules must prevent concurrent orders from allocating the same eligible energy more than once. If another service owns the allocation ledger, use that service's agreed API and consistency mechanism instead.

**Execution Records**

Determine where authoritative execution records are stored and how they are referenced by orders.

If the Order Service persists execution results, execution identifiers must be unique so that a retried or duplicated matching event cannot create a duplicate fill.

Atomic Order Creation
---------------------

Order creation must persist the required local records consistently.

Before opening a database transaction, perform external checks such as authentication, request validation, and required IoT gRPC calls. These checks must not be treated as a substitute for concurrency-safe database validation.

Within the PostgreSQL transaction:

1. Check the idempotency record and relevant persisted state.
2. Revalidate any allocation conditions that must be protected against concurrent requests.
3. Insert the order.
4. Insert its initial status-history record.
5. Insert the corresponding command or event into the outbox.
6. Create or update the required energy allocation when applicable and when owned by the Order Service.
7. Persist the idempotency outcome where applicable.
8. Commit the transaction.

If a required database operation fails, roll back the transaction so that a partially created order, history record, allocation, or outbox record is not committed independently.

Do not hold a database transaction open while waiting for an external IoT service or Kafka broker.

Transactional Outbox
--------------------

The outbox publisher must publish only records belonging to committed transactions.

The publisher should:

- Retry transient Kafka publishing failures.
- Record publication progress safely.
- Handle process restarts without losing committed unpublished events.
- Avoid unsafe concurrent processing of the same outbox record.
- Tolerate publishing the same event more than once.
- Retain sufficient metadata for diagnosis and recovery.

A publisher may successfully send an event to Kafka and fail before recording the publication result in PostgreSQL. Retrying that event can produce a duplicate delivery.

Therefore, consumers must be idempotent. Use stable event identifiers and durable deduplication or equivalent business-level safeguards.

Idempotency
-----------

Retries of the same logical request must not create duplicate orders or allocations.

The implementation must define:

- The scope and uniqueness rules for idempotency keys.
- How long idempotency records are retained.
- How the original request is associated with its stored outcome.
- How concurrent requests using the same key are serialized or resolved.
- How a repeated key with a different request payload is rejected or otherwise handled by the agreed API contract.

A repeated key with a different payload must not silently create an unrelated order or return an outcome for a different request without detecting the mismatch.

Concurrency and State Transitions
---------------------------------

Concurrent updates must not silently overwrite newer order state.

Use appropriate transactions, unique constraints, row locks, conditional updates, or optimistic version checks to protect relevant operations.

The implementation must ensure that:

- Order IDs and other required unique identifiers cannot be duplicated.
- State transitions follow the agreed lifecycle rules.
- Stale updates cannot reopen terminal orders or overwrite newer state.
- Remaining quantity cannot become negative or exceed the valid order quantity.
- Cancellation and execution races resolve consistently with the Matching Engine contract.
- Energy allocations remain consistent with the order lifecycle.
- Duplicate execution events do not apply the same fill twice.

An order version check must be performed as part of the relevant atomic update, not as an unprotected read followed by a separate write.

Data Types and Time
-------------------

- Use exact numeric representations compatible with the shared contract for energy quantities and prices.
- Define energy units, price units, scale, rounding, and supported ranges explicitly.
- Avoid floating-point arithmetic for monetary calculations.
- Use UTC timestamps consistently and define how timestamps are serialized across services.
- Apply appropriate database constraints to required fields, allowed values, and valid quantity ranges.

The PostgreSQL types and precision must be selected from the agreed domain requirements rather than assumed independently by each service.

Recovery and Reconciliation
---------------------------

The persistence and recovery design must explain how the Order Service reconciles durable records with asynchronous Matching Engine outcomes.

It must cover:

- Orders committed locally but not yet published.
- Commands published to Kafka but not yet acknowledged or processed.
- Duplicate and delayed events.
- Matching Engine restarts and order-book reconstruction.
- Execution results received after retries or temporary disconnection.
- Outbox records that repeatedly fail to publish.
- Inconsistent order status or remaining quantity detected during recovery.

Recovery must use stable identifiers and idempotent transitions so that replaying events does not duplicate orders, fills, or energy-allocation changes.

Open Decisions and Dependencies
-------------------------------

Confirm the following against the current implementation and shared contracts:

1. Which order, history, outbox, and idempotency tables already exist?
2. Which component owns authoritative execution records?
3. Which component owns the energy-allocation ledger?
4. Which events and commands are written to the outbox?
5. How does the publisher record progress and recover after partial failure?
6. How are duplicate requests and duplicate execution events detected?
7. What are the supported numeric precision and timestamp conventions?
8. How are order state and remaining quantity reconciled with Matching Engine outcomes?
9. What retention and cleanup rules apply to history, outbox, and idempotency records?

Treat the suggested tables and mechanisms as design requirements until their implementation has been verified.
