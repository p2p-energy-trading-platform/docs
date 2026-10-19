---
connie-title: Order Service Kafka Contracts and Outbox
---

Kafka Contracts and Outbox
===========================

Purpose
-------

This document defines the proposed Kafka messaging and reliability requirements for the Order Service and Matching Engine.

Kafka provides asynchronous message delivery between services. PostgreSQL remains the durable source of truth for the Order Service's persisted records, while the Matching Engine remains responsible for authoritative matching decisions and execution results.

Topic Names
-----------

The following topic names are proposals and must be verified against the existing Kafka configuration, shared contracts, and service implementations.

| Direction | Proposed topic | Purpose |
|---|---|---|
| Order Service to Matching Engine | `gridx.orders.v1` | Order commands |
| Matching Engine to Order Service | `gridx.orders.updates.v1` | Order lifecycle and matching updates |
| Matching Engine to downstream consumers | `gridx.trades.v1` | Completed trade events |

Existing documentation may refer to names such as `order-placements` or `completed-trades`. Identify the canonical topic names before implementing new publishers or consumers.

Do not introduce parallel topic names or migrate existing topics without a documented compatibility and migration plan.

Message Contracts
-----------------

Confirm whether the current C++ Matching Engine uses Protocol Buffers, JSON, or another serialization format. The producer and consumer must agree on the wire format and schema.

Each message must carry the identifiers and metadata required by its purpose. Candidate fields include:

- `event_id`: Stable identifier for a logical event.
- `event_type`: The event or command type.
- `schema_version`: Contract version or equivalent schema metadata.
- `occurred_at`: Timestamp associated with the event.
- `order_id`: Identifier of the relevant order.
- Order version or sequence number, where applicable.
- Correlation ID for tracing related operations.
- Command ID where command-level deduplication is required.
- Execution or trade ID for execution-related events.
- The payload fields required by the specific message type.

These names are illustrative until checked against the existing shared contracts. Do not duplicate identifiers or introduce incompatible fields when equivalent contract fields already exist.

The contract must represent the agreed behaviours for:

- LIMIT and MARKET order submission.
- Cancellation requests.
- Order acceptance, rejection, and lifecycle updates.
- Partial and completed executions.
- IOC remainder cancellation, if supported.
- Recovery and reconciliation where required.

Distinguish commands requesting an action from events reporting an outcome. Publishing a command does not establish that the Matching Engine accepted or completed it.

Transactional Outbox
--------------------

The Order Service must write each required outbound command or event to the outbox in the same PostgreSQL transaction as the corresponding local state change.

The publisher should:

1. Read committed, unpublished outbox records.
2. Publish each record to its configured Kafka topic.
3. Wait for the configured broker acknowledgement.
4. Record publication progress only after the acknowledgement is received.
5. Retry transient failures using bounded or otherwise controlled backoff.
6. Expose persistent failures and excessive backlog through monitoring and alerts.

The publisher must handle concurrent workers and process restarts safely. Its claim and publication-progress mechanism must prevent unsafe updates to outbox records.

If the broker accepts a message but the publisher crashes before recording success in PostgreSQL, the message may be published again after recovery.

Therefore, the outbox provides reliable publication intent, not guaranteed single delivery. Downstream consumers must handle duplicate messages.

Message Identity and Deduplication
----------------------------------

Use stable identifiers for logical messages and operations.

- A retry of the same logical command must preserve its command identity.
- A retry of the same logical event must preserve its event identity.
- Distinct commands affecting the same order must not be deduplicated solely because they share an `order_id`.
- Execution results must use stable execution identifiers so duplicate delivery cannot apply the same fill twice.
- Deduplication records or equivalent safeguards must survive process restarts for the required retention period.

The Matching Engine must deduplicate retried order commands before applying their effects. The Order Service must deduplicate incoming updates and execution events before applying durable state changes.

Deduplication must be atomic with the relevant state change. Recording an event as processed separately from applying its effect can still allow duplicate effects after a crash.

Ordering and Partitioning
-------------------------

Kafka preserves message order within a partition, not across all partitions in a topic.

The team must define:

- The message key for each topic.
- Whether messages for the same order must be routed to the same partition.
- How order versions or sequence numbers are assigned and checked.
- How out-of-order and stale messages are detected.
- How ordering requirements apply when one operation produces multiple events.

A consistent order-based partition key may be appropriate for order lifecycle messages, but the final strategy must account for the Matching Engine's processing model and any ordering requirements for executions.

Partitioning alone does not resolve races between different services or protect against stale updates. Consumers must validate versions and allowed state transitions.

Consumer Reliability
--------------------

Consumers must follow a failure-safe processing sequence.

1. Read a Kafka message.
2. Validate its schema and required fields.
3. Check whether the message has already been processed.
4. Apply the required durable state change and record successful processing atomically where possible.
5. Commit the Kafka offset only after durable processing succeeds.

If processing fails, the consumer must not commit an offset that would permanently skip the unprocessed message.

Where processing includes an external service call or a separate database, define an explicit idempotency and recovery strategy instead of assuming that the whole operation is atomic.

Invalid Messages and Recovery
-----------------------------

The messaging design must define how to handle malformed, unsupported, or repeatedly failing messages.

The failure-handling mechanism should:

- Record the relevant topic, partition, offset, message identifier, and failure reason.
- Preserve the original payload securely when required for investigation.
- Distinguish transient failures from permanent contract or validation failures.
- Prevent a poison message from causing an uncontrolled retry loop.
- Use a documented quarantine or dead-letter process where appropriate.
- Support controlled replay after the underlying problem is resolved.
- Prevent replay from duplicating orders, fills, or other business effects.

Quarantining a message must not silently discard a required business operation. Alerting and reconciliation must identify unresolved failures.

Observability
-------------

Monitor and alert on:

- Outbox backlog size and oldest unpublished record age.
- Kafka publication failures and retry counts.
- Consumer lag by topic and consumer group.
- Repeated processing failures and quarantined messages.
- Duplicate-message detection counts.
- Schema or contract validation failures.
- Delayed order acknowledgements and lifecycle updates.
- Differences between persisted order state and Matching Engine outcomes.

Use correlation IDs and stable message identifiers in logs and traces. Avoid logging credentials, access tokens, or unnecessary sensitive payload data.

Open Decisions and Dependencies
-------------------------------

Confirm these points against the actual repository and shared contracts:

1. Which Kafka topics currently exist, and which names are canonical?
2. What serialization format and schema are used by the C++ Matching Engine?
3. Which commands and events are already defined in the shared contracts?
4. What identifiers support command deduplication, event deduplication, and execution deduplication?
5. What topic keys and partitioning strategy are required?
6. How are outbox records claimed, retried, and marked as published?
7. How do consumers atomically persist state changes and processed-message identifiers?
8. What quarantine, replay, and reconciliation mechanisms are available?
9. What delivery, retention, and monitoring requirements apply to each message type?

Treat topic names, field names, and proposed mechanisms as unconfirmed until verified against the existing implementation.
