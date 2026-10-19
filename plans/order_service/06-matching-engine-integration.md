---
connie-title: Order Service Matching Engine Integration
---

Matching Engine Integration
===========================

Purpose
-------

This document defines the proposed integration boundary between the Order Service and the Matching Engine.

The Order Service validates requests and maintains durable order records. The Matching Engine determines matching eligibility, processes the order book, and produces authoritative matching outcomes.

The Order Service must not implement a second matching algorithm or independently determine execution results.

Responsibilities
----------------

The Order Service is responsible for:

- Validating order requests and applicable business rules.
- Persisting orders and their local lifecycle records.
- Writing required outbound commands to the transactional outbox.
- Publishing commands through the agreed Kafka integration.
- Consuming authoritative Matching Engine updates.
- Maintaining its durable representation of order status and remaining quantity.
- Handling retries, duplicate events, and recovery safely.

The Matching Engine is responsible for:

- Maintaining and processing its order books.
- Enforcing the agreed price-time priority rules.
- Determining eligible matches.
- Processing partial and completed fills.
- Enforcing supported order types and market-order protection rules.
- Producing authoritative matching and execution outcomes.
- Publishing the agreed order and trade events.

The shared contracts must define the ownership of order identifiers, versions, execution identifiers, and lifecycle transitions.

Order Submission Flow
---------------------

The proposed asynchronous submission flow is:

1. Authenticate the caller and validate the order request.
2. Perform required external checks, including IoT validation for applicable SELL orders.
3. Persist the order, initial history, idempotency outcome, and outbound command in the appropriate PostgreSQL transaction. Persist an energy allocation in the same transaction if the Order Service owns that ledger.
4. Publish the committed command through the transactional outbox publisher.
5. Let the Matching Engine process the command and publish its authoritative outcome.
6. Consume the outcome and update the Order Service's durable state using the agreed versioning and deduplication rules.
7. Expose the current known status through the API without implying that an unacknowledged command has been accepted or executed.

The exact acceptance boundary must be documented. An API response indicating successful request processing or command publication does not, by itself, prove that the Matching Engine accepted the order or that a trade occurred.

Communication Boundary
----------------------

The intended architecture is for the Order Service and Matching Engine to communicate through Kafka commands and events only.

Confirm this boundary against the existing repository and service contracts before treating it as implemented.

If Kafka is the exclusive integration channel:

- Submit order and cancellation commands through the agreed command topics.
- Receive matching acknowledgements, status updates, and execution events through the agreed event topics.
- Do not add a parallel synchronous RPC path for matching operations without an explicit architectural decision.
- Define how command timeouts, missing acknowledgements, and delayed events are handled.
- Use stable identifiers and idempotent processing to make retries safe.

The Order Service must not query or mutate the Matching Engine's internal in-memory order book directly.

Contract Alignment
------------------

The shared contracts and service implementations must agree on:

- Kafka topic names and message direction.
- Serialization format and schema compatibility.
- Message keys and partitioning strategy.
- Order identifiers and command identifiers.
- BUY and SELL side enums.
- LIMIT and MARKET order types.
- LIMIT price semantics and numeric precision.
- MARKET time-in-force and IOC behavior, if supported.
- Market BUY spending or price-protection rules.
- Cancellation requests and acknowledgements.
- Partial-fill and completed-fill quantity semantics.
- Order versions or sequence numbers.
- Stable event and execution identifiers.
- Duplicate-message handling and recovery behavior.

Do not introduce new field names or enum values until the existing shared contracts have been inspected.

Order Lifecycle and Matching Outcomes
-------------------------------------

The Order Service must distinguish local order persistence from Matching Engine acceptance and execution.

The integration must define how it represents:

- A command awaiting publication.
- A published command awaiting an outcome.
- An accepted or rejected order.
- An order with partial executions.
- A fully executed order.
- A cancellation request awaiting an outcome.
- A cancellation confirmed by the Matching Engine.
- An order that expires or becomes ineligible under the agreed lifecycle rules.

These are conceptual conditions, not a prescribed final enum. The actual status values must match the shared contract and the lifecycle design.

The implementation must also handle cancellation-versus-execution races. A cancellation request does not prove that the order was cancelled; an execution may have occurred before the Matching Engine processed the cancellation.

Execution Processing
--------------------

For every authoritative execution event, the Order Service must:

- Validate the event against the agreed contract.
- Identify the associated order and execution.
- Deduplicate repeated delivery using stable execution or event identifiers.
- Apply filled and remaining quantity changes consistently.
- Reject or reconcile stale and conflicting updates.
- Persist the resulting state and processing record atomically where possible.
- Commit the Kafka offset only after the required durable processing succeeds.

The Matching Engine remains authoritative for execution prices and fill quantities. The Order Service must not recalculate or independently invent execution outcomes.

Failure Handling and Recovery
-----------------------------

The integration must define behavior for:

- Kafka publication failures.
- Duplicate command delivery.
- Matching Engine restarts.
- Delayed, duplicate, or out-of-order outcome events.
- Missing acknowledgements.
- Consumer crashes during event processing.
- Schema incompatibility or invalid messages.
- Conflicting order versions or execution results.

Recovery must use durable records, stable identifiers, and idempotent transitions. Retrying a command must not create an unintended duplicate order or trade.

Contract and Implementation Dependencies
----------------------------------------

Before enabling a capability end to end, verify that the shared contract and Matching Engine implementation support it.

In particular, the current API contract may describe LIMIT orders only. MARKET support must not be enabled merely by adding an API enum or request field.

Confirm:

1. Whether the Matching Engine currently supports MARKET orders.
2. Whether IOC behavior and market BUY protection are implemented.
3. Which commands, events, topics, and schemas already exist.
4. How the Matching Engine acknowledges accepted and rejected commands.
5. How cancellations and partial executions are represented.
6. How the Order Service reconstructs durable state after interruptions.
7. Whether Kafka is the exclusive service-to-service integration boundary.

Record confirmed decisions in the shared contracts and relevant implementation documentation. Keep unverified capabilities explicitly marked as proposed.
