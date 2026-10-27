---
connie-title: Order Service Implementation Sequence
---

Order Service Implementation Sequence and Open Decisions
========================================================

Purpose
-------

This document defines the proposed implementation sequence, architectural decisions, and readiness criteria for the Order Service.

Implementation must build on the existing repository, shared contracts, and Matching Engine capabilities. Proposed functionality must not be treated as implemented until verified against the code and tests.

Phase 1: Contract and Architecture Alignment
--------------------------------------------

1. Inspect the existing API Gateway routes, shared schemas, Kafka configuration, and Matching Engine implementation.
2. Confirm canonical topic names, serialization formats, schema ownership, and compatibility rules.
3. Agree on order identifiers, command and event identifiers, order versions, execution identifiers, and deduplication semantics.
4. Confirm supported order types, LIMIT price rules, partial-fill semantics, and cancellation behavior.
5. Define the asynchronous submission and acceptance contract.
6. Confirm IoT API capabilities and identify any required contract changes.
7. Document unresolved decisions and identify which capabilities must remain disabled until those decisions are resolved.

**Readiness gate:** The relevant contracts and service boundaries are documented, and proposed changes have been reviewed by the owning teams.

Phase 2: Durable Order Foundation
---------------------------------

1. Define and implement the order persistence model and required database constraints.
2. Implement request validation and authenticated-user authorization.
3. Implement idempotent order creation, including concurrent requests using the same idempotency key.
4. Implement order lifecycle transitions and status history.
5. Implement the transactional outbox and reliable publication.
6. Implement the Matching Engine outcome consumer with durable deduplication and concurrency-safe updates.
7. Ensure PostgreSQL transactions and Kafka offset handling prevent acknowledged events from being lost before durable processing.
8. Add unit and integration tests for transaction rollback, duplicate delivery, and failure recovery.

**Readiness gate:** Orders and outbound commands are persisted atomically, and retries do not create unintended duplicate orders or state changes.

Phase 3: IoT Validation and SELL Energy Allocation
--------------------------------------------------

1. Confirm the IoT contract for meter registration, ownership, authorization, reading freshness, and available energy.
2. Implement the required SELL-order eligibility checks.
3. Decide which service owns energy allocation and reservation.
4. Implement concurrency-safe allocation to prevent multiple orders from reserving the same available energy.
5. Define allocation changes for partial execution, completed execution, cancellation, and expiry.
6. Add tests for stale readings, unavailable dependencies, concurrent SELL orders, and allocation rollback.

**Readiness gate:** SELL-order eligibility and allocation ownership are explicit, and the chosen allocation mechanism prevents overselling under concurrent requests.

If allocation ownership or the required IoT capabilities remain unresolved, record the affected functionality as blocked rather than assuming the protections exist.

Phase 4: Cancellation and Expiry
-------------------------------

1. Implement authenticated cancellation requests and the pending-cancellation lifecycle.
2. Persist cancellation commands through the transactional outbox.
3. Consume authoritative cancellation outcomes.
4. Handle cancellation-versus-execution races and duplicate responses.
5. Implement expiry according to the agreed lifecycle and time rules.
6. Add reconciliation for missed expiry processing and failed allocation releases.
7. Verify idempotency across cancellation, expiry, and energy-allocation updates.

**Readiness gate:** Cancellation and expiry cannot overwrite newer execution outcomes or cause duplicate resource releases.

Phase 5: Matching Engine Recovery
---------------------------------

1. Inspect and update the existing Matching Engine crash-recovery documentation.
2. Agree on the Kafka-only recovery request, snapshot, consistency boundary, and replay protocol.
3. Define the snapshot schema and how order priority is preserved.
4. Implement snapshot generation, publication, validation, and completion signaling.
5. Implement replay, deduplication, and reconciliation of concurrent order changes.
6. Test recovery during order creation, cancellation, execution, expiry, and service restarts.
7. Keep matching disabled until the recovered order book is verified as consistent.

**Readiness gate:** Recovery restores a consistent order book without losing relevant updates, duplicating executions, or resurrecting terminal orders.

A snapshot completion marker alone is not sufficient evidence that recovery is consistent. The agreed boundary and replay mechanism must be implemented and tested.

Phase 6: MARKET and IOC Support
-------------------------------

1. Confirm that the Matching Engine and shared contracts support MARKET orders.
2. Agree on IOC behavior and market BUY spend-protection semantics.
3. Implement any required contract, validation, and persistence changes.
4. Verify execution outcomes, partial fills, and unfilled residual handling.
5. Test behavior when liquidity is unavailable and when protection limits are reached.
6. Enable the capability only after end-to-end contract and integration tests pass.

**Readiness gate:** Enable MARKET and IOC functionality only if the required semantics are supported and verified across the Order Service and Matching Engine.

If support is not available or the design remains undecided, keep these order types disabled and document the dependency.

Phase 7: Wallet Integration Planning
------------------------------------

1. Define the future integration contract with the Billing & Wallet Service when the owning team and service are available.
2. Agree on available-credit checks, reservations, releases, idempotency, and settlement ownership.
3. Define behavior for partial execution, cancellation, expiry, timeouts, retries, and reconciliation.
4. Decide whether production BUY orders must remain blocked until credit reservation is available.
5. Ensure any development-only bypass is disabled by default and cannot be enabled accidentally in production.

**Readiness gate:** Production BUY-order behavior follows the agreed wallet-readiness policy.

Wallet reservations and settlement remain deferred until the service contract and implementation are available. Do not represent this integration as completed before then.

Phase 8: End-to-End Verification and Release Readiness
-----------------------------------------------------

1. Complete API, IoT, Kafka, persistence, and Matching Engine contract tests.
2. Run security and authorization tests.
3. Test concurrent requests, duplicate events, out-of-order events, and partial failures.
4. Verify cancellation, expiry, and energy-allocation consistency.
5. Verify the agreed recovery protocol under concurrent updates and service restarts.
6. Run relevant performance and load tests.
7. Confirm that logs, metrics, alerts, and reconciliation procedures are usable.
8. Update the implementation documentation and record any remaining limitations.
9. Run the applicable automated test suites and formatting checks.

**Readiness gate:** The implemented scope meets its acceptance criteria, unresolved dependencies are documented, and unsupported capabilities remain disabled.

Open Decisions
--------------

**Contracts and matching**

- [ ] Confirm canonical Kafka topic names.
- [ ] Confirm serialization format and schema ownership.
- [ ] Confirm Matching Engine support for MARKET and IOC.
- [ ] Choose market BUY spend-protection semantics.
- [ ] Define cumulative-fill and remaining-quantity semantics.
- [ ] Agree on order-version, event-deduplication, and execution-identifier rules.
- [ ] Confirm cancellation acknowledgement and race-handling semantics.

**Persistence and energy**

- [ ] Confirm the order persistence model and transaction boundaries.
- [ ] Confirm the IoT API's meter-registration and available-energy contract.
- [ ] Decide which service owns SELL energy allocation.
- [ ] Define allocation changes for partial execution, cancellation, and expiry.
- [ ] Define currency and energy units, numeric precision, and rounding rules.

**Recovery and operations**

- [ ] Agree on the Kafka recovery snapshot, consistency-boundary, and replay protocol.
- [ ] Update existing Matching Engine crash-recovery documentation.
- [ ] Define recovery failure, restart, and reconciliation procedures.
- [ ] Define operational alerts and measurable readiness criteria.

**Wallet and production readiness**

- [ ] Decide whether production BUY orders are blocked until wallet reservations exist.
- [ ] Define the future Billing & Wallet integration contract.
- [ ] Define the development-only bypass policy, if one is needed.
- [ ] Confirm which proposed capabilities remain disabled pending implementation.

Definition of Done
------------------

The Order Service is ready for integration within its declared scope when:

- PostgreSQL durably stores order records and lifecycle history.
- Order creation and outbox creation are atomic.
- Idempotency and concurrent request handling are verified.
- Kafka consumers process events without duplicate business effects.
- API behavior accurately distinguishes persistence, submission, acceptance, and execution.
- IoT validation and SELL energy allocation follow their agreed ownership and consistency rules.
- Cancellation and expiry correctly handle execution races.
- Kafka-only recovery follows an implemented and tested consistency protocol, if recovery is included in the declared release scope.
- API, IoT, Kafka, and Matching Engine contracts are aligned.
- Security, resilience, and operational checks pass for the declared scope.
- MARKET and IOC are enabled only if supported and verified end to end.
- Wallet integration remains explicitly deferred until its contract and implementation exist.
- Remaining limitations and blocked capabilities are documented.

A passing Markdown lint check verifies formatting only. It does not establish implementation completeness or runtime correctness.
