---
connie-title: Order Service Security, Observability and Testing
---

Security, Observability and Testing
===================================

Purpose
-------

This document defines the security controls, operational visibility, and verification strategy for the Order Service.

Tests must verify the implemented behavior and agreed contracts. Proposed features must remain identified as future work until their implementations and tests have been verified.

Security
--------

**Authentication and authorization**

- Require authenticated users for protected operations.
- Enforce order ownership for order retrieval and cancellation.
- Apply the required administrative permissions to privileged operations.
- Derive user identity from the trusted authentication context, not untrusted request fields.
- Avoid leaking another user's private order information through error messages.
- Apply rate limits and request-size limits according to the gateway's security policy.

**Input and contract validation**

- Validate API requests against the shared request schemas.
- Validate Kafka messages against the agreed schemas and supported versions.
- Reject unsupported order types, invalid enum values, malformed identifiers, and invalid numeric values.
- Enforce quantity, price, delivery-slot, and applicable market-order protection limits.
- Prevent invalid or duplicate messages from producing unintended business effects.
- Handle malformed messages without exposing internal implementation details.

**Service and data security**

- Use authenticated internal service communication according to the project's security architecture.
- Apply least-privilege PostgreSQL and Kafka credentials.
- Keep secrets in the approved configuration or secret-management mechanism.
- Protect sensitive data in transit and at rest according to project requirements.
- Use parameterized database operations and safe error handling.
- Avoid logging credentials, access tokens, secrets, or sensitive user and meter information.
- Fail closed when a required production security or business validation cannot be completed safely.

**Idempotency and concurrency**

- Enforce idempotency for order creation and other operations where required.
- Protect against concurrent requests that attempt to reuse an idempotency key.
- Prevent duplicate event delivery from repeating executions, state changes, or energy-allocation releases.
- Use database constraints, transactions, and concurrency controls where needed rather than relying only on application-level checks.

Observability
-------------

**Metrics**

Monitor:

- Order creation requests, successful persistence, and validation rejections.
- Matching Engine acceptance and rejection outcomes, where available.
- API latency and error rates.
- IoT query latency, timeouts, and unavailable-service rates.
- Stale or unavailable meter readings.
- Outbox backlog, oldest unpublished record age, and publication failures.
- Kafka consumer lag and processing failures.
- Duplicate, stale, and conflicting events.
- Order-status synchronization delay.
- Cancellation and expiry outcomes.
- Energy-allocation conflicts and reconciliation failures.
- Matching Engine recovery duration, progress, and failed attempts.
- Wallet integration failures once that integration exists.

Use low-cardinality metric labels. Do not use order IDs, user IDs, event IDs, or other unbounded identifiers as metric labels.

**Structured logging and tracing**

Use structured logs with the identifiers needed to correlate work across the API, PostgreSQL, outbox publisher, Kafka consumers, and Matching Engine.

Include appropriate request, correlation, command, event, order, and execution identifiers when available and permitted by the logging policy.

Do not assume all identifiers exist in the current contracts; verify and propagate them consistently where supported.

Logs must omit secrets, access tokens, and sensitive telemetry. Keep client-facing error messages separate from internal diagnostic details.

**Alerts and operational response**

Define actionable alerts for:

- Sustained outbox publication failures or growing backlog.
- Excessive Kafka consumer lag.
- Repeated database or IoT dependency failures.
- Unexpected order-state or execution inconsistencies.
- Energy-allocation reconciliation failures.
- Orders stuck in pending states beyond an agreed threshold.
- Recovery sessions that fail or exceed their expected duration.

Set thresholds based on measured behavior and service-level requirements. Document the response and reconciliation procedure for critical alerts.

Testing Strategy
----------------

Testing should cover unit, integration, contract, concurrency, security, and end-to-end behavior as appropriate.

Use deterministic test data and verify durable outcomes, not just HTTP responses or mocked method calls.

Order Validation
----------------

Test:

- Valid and invalid LIMIT orders.
- Valid and invalid MARKET orders, if supported.
- Unsupported order types.
- Missing or malformed fields.
- Invalid quantity, precision, price, and delivery slots.
- Missing or invalid market BUY protection fields.
- Authentication and authorization failures.
- Duplicate idempotency keys with equivalent and conflicting payloads.
- Concurrent requests using the same idempotency key.
- Correct response semantics for persisted, pending, accepted, rejected, and executed orders.

IoT Validation and Energy Allocation
------------------------------------

Test:

- Unregistered meters.
- Unauthorized sellers.
- Offline meters and stale readings.
- Missing or invalid readings.
- IoT timeouts and unavailable service behavior.
- Insufficient sellable energy.
- Concurrent SELL orders attempting to allocate the same energy.
- Allocation conflicts and rollback behavior.
- Duplicate cancellation or expiry outcomes that could release energy twice.
- Correct allocation handling after partial execution and cancellation.

Verify that concurrent requests cannot oversell energy when the system owns the allocation mechanism. If allocation ownership remains undecided, document the required test as blocked on that architectural decision.

Kafka and Persistence
---------------------

Test:

- Atomic order, status-history, idempotency, and outbox persistence.
- Outbox publication retries after temporary failures.
- Duplicate command delivery.
- Duplicate event delivery.
- Out-of-order and stale order-state updates.
- Distinct executions arriving out of order.
- Database failure before transaction commit.
- Consumer crash before and after durable processing.
- Kafka offset handling when persistence fails.
- Restart and replay without duplicate business effects.
- Schema incompatibility and malformed messages.
- Reconciliation of conflicting or missing outcomes.

Verify that an event is not acknowledged as successfully processed before its required durable changes have committed.

Matching Engine Integration
---------------------------

Test:

- Order acceptance and rejection outcomes.
- Full and partial fills.
- Correct remaining-quantity updates.
- Duplicate and conflicting execution events.
- MARKET orders with no available liquidity, if supported.
- IOC residual handling, if supported.
- Market BUY spend protection, if supported.
- Cancellation racing with execution.
- Expiry racing with execution or cancellation.
- Delayed acknowledgements and retry behavior.
- Matching Engine restart and recovery during concurrent order changes.

Contract tests must verify the actual shared message schemas, topic configuration, identifiers, and lifecycle semantics. Do not mark unsupported capabilities as passing tests.

Recovery
--------

Test:

- Snapshot generation and completion.
- Recovery while new orders are created.
- Recovery while orders are cancelled, filled, or expired.
- Duplicate snapshot records and replayed events.
- Missing or incomplete snapshot records.
- Recovery-session failure and restart.
- Correct preservation of order priority.
- Prevention of cancelled or executed orders being restored as active.
- Prevention of duplicate executions during replay.
- Matching remaining disabled until recovery consistency is verified.

These tests depend on an agreed and implemented snapshot-boundary and replay protocol.

API and Security
----------------

Test:

- Unauthorized order reads and cancellation attempts.
- Access attempts using another user's order identifier.
- Invalid authentication and insufficient permissions.
- Malformed requests and unsupported fields.
- Safe error responses without stack traces or internal dependency details.
- Request and correlation identifier propagation.
- Rate limiting and request-size limits.
- Secret and sensitive-data redaction in logs.
- Dependency failures and appropriate client-facing status codes.

Wallet Boundary
---------------

The Billing & Wallet Service has not yet been implemented.

Verify that production BUY orders follow the agreed fail-closed policy while required credit reservation is unavailable.

When wallet integration is implemented, add tests for:

- Concurrent credit reservations.
- Idempotent reservation and release requests.
- Partial execution and reservation adjustment.
- Cancellation and expiry.
- Timeouts with unknown reservation outcomes.
- Retry, reconciliation, and compensation behavior.
- Prevention of duplicate financial effects.

Do not report wallet integration tests as passing before the integration exists.

Release and Verification Criteria
---------------------------------

Before declaring a feature complete:

1. Confirm that the implementation matches the shared contracts.
2. Run the relevant automated tests.
3. Verify persistence and event-processing behavior under failure.
4. Confirm that security and authorization checks are enforced.
5. Review logs and metrics for sensitive-data exposure.
6. Record unresolved dependencies and unsupported capabilities.
7. Confirm that the documented recovery and reconciliation procedures are usable.

A passing Markdown lint check verifies document formatting only. It does not demonstrate that the described controls, tests, or service capabilities have been implemented.
