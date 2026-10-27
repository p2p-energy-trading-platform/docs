---
connie-title: Order Status Synchronization
---

Order Status Synchronization
============================

Purpose
-------

The Order Service consumes authoritative Matching Engine updates and persists the corresponding order lifecycle state in PostgreSQL.

PostgreSQL remains the durable source of truth for the Order Service's order records and status history. Matching outcomes must originate from the Matching Engine rather than being independently calculated by the Order Service.

Consumer Workflow
-----------------

Process each order-update event using the following workflow:

1. Consume the Kafka message.
2. Validate the message schema, required identifiers, and supported event version.
3. Begin a PostgreSQL transaction.
4. Check whether the event has already been processed.
5. Load and lock the relevant order record, or use an equivalent concurrency-safe update.
6. Validate the event against the order's current state and version.
7. Apply the authoritative status and quantity changes when appropriate.
8. Record any new execution identifiers and update relevant energy-allocation records if the Order Service owns that responsibility.
9. Append status history for an actual state change.
10. Record successful event processing in the same transaction.
11. Commit the PostgreSQL transaction.
12. Commit the Kafka offset only after the required database changes are durable.

If persistence fails, do not acknowledge the message as successfully processed. Retry transient failures according to the consumer's retry policy.

The event-processing record, order update, status history, and any locally owned allocation changes must be atomic wherever they form one logical operation.

**Event identity and deduplication**

The shared contract must define stable event identifiers and, where applicable, execution identifiers.

- Repeated delivery of an already processed event must not repeat its business effects.
- Deduplication records must be durable across service restarts.
- A duplicate event must not create duplicate status-history entries or apply a fill twice.
- A different event concerning the same order must still be evaluated, even if the order has already received a newer update.

The exact identifiers and deduplication strategy must match the existing Kafka contracts.

Order Versions and State Transitions
------------------------------------

Use the versioning or sequence mechanism agreed with the Matching Engine to prevent stale updates from overwriting newer order state.

The implementation must distinguish between:

- A previously processed duplicate event.
- A stale order-state snapshot.
- A new execution associated with an order whose current status is already newer.
- An invalid or conflicting transition.
- A valid event that does not change the persisted status.

Do not treat these cases as equivalent.

A stale snapshot must not revert the order's current state. However, a distinct execution must not be discarded solely because its event carries an older order-state version. If the contract cannot safely reconcile the event, preserve the evidence and trigger the defined reconciliation process.

State transitions must follow the agreed lifecycle. The Order Service must not invent acceptance, rejection, cancellation, or execution outcomes.

Partial Fills and Quantities
----------------------------

An order may be filled through multiple executions before it is fully executed or otherwise completed.

The shared contract must define whether each event reports:

- Cumulative filled and remaining quantities; or
- The quantity added by an individual execution.

Do not mix these two representations.

Where the contract provides authoritative cumulative quantities, apply them with the agreed order-version rules. Where events report execution-level quantities, deduplicate each execution before applying its effects.

For every accepted update, validate the resulting quantities against the order's original quantity and the agreed precision rules. Conflicting totals, negative remaining quantities, or quantities exceeding the original order quantity must trigger reconciliation rather than silent correction.

The Matching Engine remains authoritative for execution prices and fill quantities.

Status History and Auditability
-------------------------------

Record meaningful lifecycle transitions in the order-status history.

Each history record should contain the fields required by the agreed data model, potentially including:

- Order identifier.
- Previous and resulting status.
- Event identifier and event type.
- Order version or sequence, where available.
- Event timestamp and processing timestamp.
- Execution identifier, when relevant.
- Correlation identifier, when available.

These are candidate fields, not a finalized schema. Confirm them against the existing database model and message contracts.

Repeated delivery must not generate duplicate history records for the same logical transition. A valid event that changes quantities without changing the status must still be processed correctly, even if it does not require a new status-transition record.

Energy Allocation Synchronization
---------------------------------

If the Order Service owns energy allocations, allocation changes must be coordinated with order lifecycle changes.

Define the allocation behavior for:

- Order acceptance.
- Order rejection.
- Partial execution.
- Full execution.
- Confirmed cancellation.
- Expiry or other terminal outcomes.

Do not release reserved energy merely because a cancellation was requested. Wait for the authoritative outcome and apply the agreed allocation rules.

Order-state updates and locally owned allocation changes should be committed atomically where possible. If allocation ownership belongs to another service, use the agreed integration contract instead of modifying that service's data directly.

Settlement Boundary
-------------------

The Order Service stores order lifecycle and execution references needed for its responsibilities. It must not become a duplicate wallet, balance, or financial settlement ledger.

Trade settlement and financial accounting remain with their respective owning services.

An order update or execution event must not be interpreted as proof that wallet settlement has completed unless the relevant settlement service explicitly confirms that outcome.

Error Handling and Recovery
---------------------------

Define handling for the following cases:

- Malformed or unsupported events.
- Missing orders or unknown identifiers.
- Duplicate events.
- Stale or conflicting versions.
- Impossible state transitions.
- Database failures.
- Repeated delivery and consumer restarts.
- Distinct executions received out of order.
- Events that cannot be reconciled automatically.

Use bounded retries and the project's agreed quarantine or dead-letter mechanism for messages that cannot be processed safely. Preserve enough context to investigate and replay events without duplicating their effects.

Do not silently discard conflicting execution data. Make unresolved inconsistencies observable and provide a reconciliation path.

Contract and Implementation Dependencies
----------------------------------------

Before implementing this workflow, verify:

1. The actual Matching Engine event schemas and Kafka topics.
2. Event, order, and execution identifier semantics.
3. Order versioning or sequence guarantees.
4. Whether quantity fields are cumulative or incremental.
5. The supported order lifecycle and transition rules.
6. The database transaction and consumer-offset strategy.
7. Ownership of energy allocations and settlement.
8. The retry, quarantine, replay, and reconciliation mechanisms.

Keep proposed fields and behaviors explicitly marked as unconfirmed until they are aligned with the shared contracts and existing implementation.
