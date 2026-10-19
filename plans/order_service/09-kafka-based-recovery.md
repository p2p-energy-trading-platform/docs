---
connie-title: Order Service Kafka-Based Recovery
---

Kafka-Based Recovery
====================

Purpose
-------

This document defines the proposed recovery protocol for reconstructing the Matching Engine's active order books after startup, restart, or loss of in-memory state.

The recovery process must reconstruct a consistent view of eligible orders without losing concurrent updates, restoring terminal orders, or applying commands and executions more than once.

Architecture Requirement
------------------------

The Matching Engine and Order Service must communicate through Kafka only, as required by the proposed architecture.

Existing crash-recovery documentation describes a direct request from the Matching Engine to the Order Service for active orders. Update that documentation and the implementation if they conflict with this requirement.

Recovery must use an agreed Kafka-based request, snapshot, boundary, and replay protocol. The exact protocol must be compatible with the existing topic topology, partitioning, message schemas, and persistence model.

Recovery Objective
------------------

Before matching resumes, the Matching Engine must establish a consistent set of active orders and account for all relevant changes across the recovery boundary.

The recovered state must:

- Include eligible orders that existed at the snapshot boundary.
- Include relevant orders created after that boundary.
- Reflect cancellations, executions, and expirations that occurred during recovery.
- Exclude orders that are no longer eligible for matching.
- Avoid applying the same placement or execution more than once.
- Preserve the agreed price-time priority semantics.
- Fail safely if the snapshot or replay cannot be completed consistently.

Recovery Protocol Requirements
------------------------------

The proposed recovery workflow is:

1. The Matching Engine starts in `RECOVERING` mode and does not resume normal matching.
2. A recovery coordinator establishes a unique recovery-session identifier.
3. The Matching Engine initiates recovery through the agreed Kafka protocol.
4. The recovery process establishes a consistent snapshot boundary and a way to account for relevant live events.
5. The Order Service reads a consistent PostgreSQL snapshot of eligible active orders.
6. The snapshot records contain the fields required to reconstruct each order, including its identifier, version, remaining quantity, type, side, price or protection fields, delivery slot, expiry, and priority-relevant data where applicable.
7. The Order Service publishes the snapshot records through the agreed Kafka protocol, associated with the recovery session.
8. The snapshot producer publishes a completion marker only after all records for that snapshot have been published successfully.
9. The Matching Engine validates and loads the snapshot.
10. The Matching Engine replays all relevant changes after the established boundary, using the agreed ordering, versioning, and deduplication rules.
11. The recovery process verifies that the snapshot and replay are complete and consistent.
12. The Matching Engine resumes normal matching only after successful verification.

This sequence describes required behavior, not a complete implementation of the consistency mechanism. The boundary, live-event capture, replay, and completion semantics must be specified before implementation.

Snapshot Consistency and Event Boundaries
-----------------------------------------

A PostgreSQL snapshot alone does not establish a consistent boundary with Kafka events.

Likewise, a completion marker on a separate topic or partition does not guarantee that all earlier live events have been consumed or that later events have been captured.

The recovery design must define how it coordinates:

- The PostgreSQL snapshot.
- Concurrent order creation and lifecycle changes.
- Kafka command and event publication.
- The snapshot boundary.
- Live-event capture and replay.
- Recovery completion.

Choose and document a concrete barrier or equivalent coordination protocol with the Matching Engine team. Depending on the existing architecture, this may require durable event sequence information, a coordinated event log, a buffered live stream, or another mechanism that can establish the required consistency guarantees.

Do not assume that Kafka timestamps, a snapshot completion marker, or independent topic offsets alone provide a globally consistent ordering.

Concurrent Order Changes
------------------------

The protocol must explicitly handle orders that change while the snapshot is being generated or consumed.

**Order creation**

An order created after the snapshot boundary must be included in replay or another defined recovery mechanism. It must not be omitted simply because it was absent from the snapshot.

**Cancellation**

An order cancelled after the snapshot boundary must not be restored as active once its authoritative cancellation outcome has been applied.

**Execution**

Fills occurring during recovery must be accounted for exactly once. Replayed state must not restore already executed quantity or create duplicate executions.

**Expiry**

Orders that expire during recovery must be excluded from the final active set according to the agreed expiry rules.

**Conflicting or out-of-order updates**

Use the agreed order versions, sequence information, and stable event or execution identifiers to reconcile updates. If consistency cannot be established, recovery must fail safely rather than resume matching with an uncertain order book.

Snapshot Schema and Ordering
----------------------------

Define a versioned snapshot schema compatible with the Matching Engine's order representation.

Confirm the actual fields and types against the shared contracts. Candidate data includes:

- Recovery-session identifier.
- Order identifier and order version.
- Side and order type.
- Original, filled, and remaining quantities as required by the contract.
- LIMIT price or MARKET protection fields, where applicable.
- Delivery-slot information.
- Expiry information.
- Priority-relevant ordering data.
- Snapshot schema version.

The snapshot must contain enough information to reconstruct the intended active order state and preserve the Matching Engine's required ordering semantics.

Do not invent missing priority data or infer the original order sequence from snapshot publication order. The Matching Engine team must define how priority is preserved during recovery.

Idempotency and Restart Safety
------------------------------

Recovery operations must be safe to retry after a crash, timeout, or partial failure.

- Identify each recovery attempt with a unique session identifier.
- Prevent records from an incomplete or obsolete session from contaminating a newer session.
- Deduplicate snapshot records and replayed events using stable identifiers and the agreed versioning rules.
- Do not apply the same order placement or execution twice.
- Define how incomplete snapshots are discarded or resumed.
- Define how failed sessions are marked and how a new attempt is initiated.
- Prevent normal matching from resuming before the current recovery session is verified as complete.

Recovery must not rely solely on in-memory progress markers that disappear when a service restarts.

Recovery Failure Handling
-------------------------

Define behavior for:

- Missing or incomplete snapshot records.
- Missing or duplicate completion markers.
- Kafka publication or consumption failures.
- PostgreSQL snapshot-read failures.
- Matching Engine crashes during snapshot loading or replay.
- Conflicting order versions or event sequences.
- Unsupported snapshot schemas.
- Excessive replay lag or recovery timeouts.
- Recovery-session restarts and stale session messages.

If recovery fails, keep the Matching Engine in recovery mode until the consistency issue is resolved. Provide a documented retry, restart, and reconciliation process.

Observability
-------------

Record and monitor:

- Recovery-session identifier and outcome.
- Recovery start and completion timestamps.
- Snapshot record count and expected completion status.
- Snapshot publication and consumption progress.
- Replay progress and lag.
- Duplicate and conflicting event counts.
- Failed recovery attempts and reasons.
- Time spent in recovery mode.
- The number of active orders reconstructed, where measurable.

Logs and metrics should make it possible to diagnose incomplete snapshots, replay gaps, and inconsistencies without exposing sensitive user data.

Contract and Implementation Dependencies
----------------------------------------

Before implementing recovery, verify:

1. The actual Kafka topics and partitioning strategy.
2. The Order Service's durable definition of an active order.
3. The snapshot schema and versioning approach.
4. The mechanism establishing a consistent snapshot boundary.
5. How concurrent live events are captured and replayed.
6. How order priority is preserved.
7. How duplicate commands and execution events are handled.
8. How incomplete sessions are detected and restarted.
9. The conditions required before matching resumes.

The snapshot, barrier, and replay protocol must be agreed with the Matching Engine team, documented in the shared contracts, and tested under concurrent order creation, cancellation, execution, expiry, and service restarts.

Keep any unimplemented recovery mechanism explicitly marked as proposed until it has been verified end to end.
