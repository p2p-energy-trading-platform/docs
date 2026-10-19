---
connie-title: Order Cancellation and Expiry
---

Order Cancellation and Expiry
=============================

Purpose
-------

This document defines the proposed cancellation and expiry workflows for orders managed by the Order Service.

Cancellation and expiry must be coordinated with the Matching Engine so that order state, execution outcomes, and energy allocations remain consistent.

Cancellation Flow
-----------------

The proposed cancellation workflow is:

1. Authenticate the caller.
2. Verify that the caller owns the order or has the required administrative permission.
3. Load the order and check whether its current state permits a cancellation request.
4. Persist the pending cancellation state and cancellation command in the transactional outbox within the same PostgreSQL transaction.
5. Publish the committed command through Kafka.
6. Consume the Matching Engine's authoritative cancellation outcome.
7. Persist the resulting order status, quantities, and status history.
8. Release or adjust any unused SELL energy allocation according to the confirmed outcome and allocation-ownership rules.

The actual status values must match the shared contracts and existing lifecycle implementation. A pending cancellation must not be represented as a confirmed cancellation.

Cancellation and Execution Races
--------------------------------

A cancellation request does not guarantee that no execution occurred.

An order may be partially or fully executed before the Matching Engine processes the cancellation command. The final outcome must reflect the Matching Engine's authoritative processing order.

The integration must support the following cases:

- Cancellation succeeds without an additional fill.
- A partial fill occurs before cancellation succeeds.
- The order is fully executed before cancellation can take effect.
- The order is already cancelled or otherwise terminal.
- The cancellation command is duplicated or delivered after a delay.
- The cancellation result conflicts with a previously received execution or status event.

The Order Service must not overwrite a newer execution outcome with an older cancellation response. Apply the agreed event-version, execution-deduplication, and lifecycle-transition rules.

The shared contract must define how the Matching Engine reports the cancelled quantity, remaining quantity, and any executions associated with the cancellation outcome.

Retry and Idempotency
---------------------

Cancellation commands and requests must be safe to retry.

- Use stable identifiers to correlate a cancellation request with its command and outcome.
- Repeated requests must not create unintended duplicate cancellation operations.
- Repeated delivery of the same outcome must not duplicate status history or allocation releases.
- A timeout must not be interpreted as proof that cancellation failed or succeeded.
- Before retrying an operation whose outcome is unknown, follow the agreed command-idempotency and reconciliation rules.

Persist the cancellation state and outbound command atomically. Process the authoritative result using the same durable event-deduplication and transaction rules as other Matching Engine updates.

Expiry
------

Orders must expire according to the agreed expiry timestamp, delivery-slot boundary, or other applicable lifecycle rule.

The expiry policy must define:

- Which order types and states are eligible for expiry.
- Whether expiry is determined by the Order Service, Matching Engine, or a coordinated process.
- The authoritative time source and time-zone conventions.
- The handling of partially filled orders at expiry.
- The treatment of expiry and execution events that race.
- The behavior of delayed expiry commands and service outages.

The expiry workflow must:

- Be idempotent.
- Coordinate removal of eligible orders from the Matching Engine.
- Persist the authoritative resulting status and quantities.
- Release or adjust unused SELL energy allocation where applicable.
- Detect and reconcile orders whose expiry processing was missed during an outage.
- Prevent stale expiry events from reverting a newer execution or cancellation outcome.

An order must not be marked definitively expired solely because a local timer fired if the architecture requires confirmation from the Matching Engine. The authoritative expiry boundary must be established in the shared contracts.

Energy Allocation Release
-------------------------

If the Order Service owns SELL energy allocations, release only the quantity that is no longer reserved under the agreed lifecycle rules.

The release operation must account for:

- Confirmed cancellation.
- Expiry.
- Partial and completed executions.
- Concurrent cancellation and execution processing.
- Duplicate outcome events.
- Recovery after a failed database transaction or service restart.

Allocation changes must be idempotent and coordinated with the corresponding durable order-state update wherever they share the same database and transaction boundary.

If allocation ownership belongs to another service, use its agreed integration contract rather than directly modifying its data.

Wallet Integration
------------------

The Billing & Wallet Service has not yet been implemented. The following are future integration requirements, not existing capabilities.

Define the integration contract for:

- Available-credit checks.
- Credit reservations.
- Reservation release.
- Reservation adjustment after partial execution.
- Idempotency keys and stable transaction identifiers.
- Correlation identifiers and audit records.
- Retry, timeout, reconciliation, and compensation behavior.
- Ownership of financial settlement and final balance updates.

A balance check alone does not reserve funds and cannot prevent concurrent orders from committing to spend the same available balance.

The future integration must define how credit reservations interact with order acceptance, cancellation, expiry, and execution. Do not treat order cancellation as proof that a wallet reservation has already been released.

BUY Order Readiness
-------------------

Before enabling production BUY orders, decide whether they must remain blocked until credit reservation is available.

Document the decision and enforce it consistently across the API, service validation, and relevant deployment configuration.

Any development-only bypass must be disabled by default, explicitly restricted to permitted non-production environments, and prevented from being enabled accidentally in production.

Do not claim that wallet checks, reservations, releases, or settlement are implemented until the Billing & Wallet integration exists and has been verified.

Failure Handling and Recovery
-----------------------------

Define recovery behavior for:

- Kafka publication failures.
- Missing cancellation or expiry acknowledgements.
- Duplicate and out-of-order events.
- Matching Engine restarts.
- Database transaction failures.
- Conflicting execution, cancellation, and expiry outcomes.
- Failed or repeated energy-allocation releases.
- Unknown wallet reservation outcomes once wallet integration exists.

Use durable state, idempotent operations, bounded retries, and reconciliation. Do not silently discard conflicting outcomes or release resources based solely on an unconfirmed request.

Contract and Implementation Dependencies
----------------------------------------

Before implementation, verify:

1. The supported order lifecycle and cancellable states.
2. Cancellation and expiry command and event schemas.
3. Matching Engine acknowledgement semantics.
4. Event ordering, versioning, and execution-deduplication rules.
5. Expiry ownership and authoritative time rules.
6. SELL energy-allocation ownership and release semantics.
7. BUY order restrictions before wallet integration.
8. Retry, recovery, and reconciliation mechanisms.

Keep unimplemented wallet functionality and unconfirmed lifecycle behavior explicitly marked as future work or open decisions.
