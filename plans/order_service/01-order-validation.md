---
connie-title: Order Service Validation
---

Order Validation and Lifecycle
==============================

Purpose
-------

The Order Service validates order requests, persists their durable records, and coordinates their submission to the Matching Engine. It does not perform matching itself.

Validation, persistence, event publication, and Matching Engine acceptance are separate stages. The API must communicate the outcome of the stage actually reached rather than implying that a persisted order has already been accepted or executed.

Order Model
-----------

Each order should contain the following fields, subject to confirmation against the shared contracts and database schema:

- `order_id`: unique order identifier.
- `user_id`: authenticated owner of the order.
- `grid_zone`: applicable trading zone.
- `side`: `BUY` or `SELL`.
- `order_type`: `LIMIT` or `MARKET`, if supported by the Matching Engine.
- `limit_price`: required for `LIMIT` orders; units and precision must be defined.
- `quantity_kwh`: original requested energy quantity.
- `remaining_quantity_kwh`: quantity not yet filled.
- `delivery_slot_start`: delivery interval start.
- `delivery_slot_end`: delivery interval end.
- `status`: current lifecycle state.
- `version`: concurrency-control version, if used by the persistence design.
- `created_at`: creation timestamp.
- `updated_at`: last-update timestamp.
- `expires_at`: optional order expiry timestamp.
- `idempotency_key`: request deduplication key, with its scope defined by the API contract.

Use UTC for persisted timestamps and a documented representation for delivery-slot time boundaries. Use exact decimal or integer representations with defined units and precision for energy and prices. Avoid binary floating-point arithmetic for financial calculations.

The final field names, data types, units, constraints, and nullability must match the agreed API and persistence contracts.

Validation Rules
----------------

Before an order is submitted to the Matching Engine, the Order Service must apply the following checks:

1. **Authentication:** The request must be associated with an authenticated principal.
2. **Authorization:** The principal must be permitted to create the order and must own any order they attempt to view, modify, or cancel, unless an explicitly authorized administrative operation applies.
3. **Supported values:** `side` and `order_type` must be recognized and supported by the deployed service and Matching Engine.
4. **Quantity:** The requested quantity must be positive, use the agreed precision, and comply with configured minimum and maximum limits.
5. **Delivery slot:** The start must precede the end. Both boundaries must follow the agreed time-zone and slot rules, including restrictions on past or expired slots.
6. **LIMIT price:** A `LIMIT` order must include a positive price within the configured limits and supported precision.
7. **MARKET protection:** A `MARKET BUY` order must provide the agreed spend or price protection, if required by the Matching Engine contract. The parameter name, units, and enforcement rules must be confirmed before implementation.
8. **SELL eligibility:** A `SELL` order must pass the agreed IoT-backed meter and energy-availability checks. The source of truth, freshness requirements, and treatment of unavailable or stale readings must be defined.
9. **Idempotency:** A repeated request with the same idempotency key and equivalent payload must not create a second order. Reuse of that key with a different payload must be handled explicitly, normally as a conflict.
10. **Concurrency:** Concurrent requests must not bypass quantity limits, energy-availability controls, or lifecycle constraints.
11. **Persistence and publication:** The order record and its publication intent must be committed consistently, using the agreed transactional-outbox design where applicable.

Validation failures must return a documented error response and must not cause an invalid order to be submitted for matching.

SELL Energy Validation
----------------------

The Order Service must use the supported IoT Service API rather than accessing IoT Redis or TimescaleDB directly.

The validation contract must define:

- Which meter or producer identity is associated with the authenticated user.
- Which readings or availability records determine tradeable energy.
- The acceptable data freshness and quality requirements.
- Whether the requested quantity must be available for the specified delivery slot.
- How concurrent SELL orders avoid committing more energy than is eligible for trading.
- How timeouts, unavailable dependencies, and invalid or stale readings affect order creation.

An IoT response confirming a reading must not automatically be treated as an atomic reservation of energy. Until an energy-reservation mechanism exists, the system must document the limits of its overselling protection.

Proposed Order States
---------------------

The following states are candidates for the lifecycle model, not a confirmed shared enum:

- `PENDING_VALIDATION`
- `PENDING_PUBLICATION`
- `OPEN`
- `PARTIALLY_FILLED`
- `CANCEL_PENDING`
- `FILLED`
- `CANCELLED`
- `EXPIRED`
- `REJECTED`

The implementation must establish which service owns each transition and distinguish local persistence states from Matching Engine states.

In particular:

- Persisted or queued does not necessarily mean accepted by the Matching Engine.
- `OPEN` must have one agreed meaning across the Order Service, API, and Matching Engine.
- A partially filled order must retain the correct remaining quantity.
- Cancellation requests must account for fills that race with cancellation.
- Terminal states must not be reversed by duplicate or stale events.
- A late event that conflicts with a legitimate fill or cancellation must be reconciled according to the agreed event-ordering and consistency rules.

The final state names, transition rules, and event mappings must be verified against the shared contracts and actual Matching Engine implementation.

State Management and Concurrency
--------------------------------

Persist durable order state in PostgreSQL.

For every transition, the implementation must:

1. Verify that the transition is allowed from the current state.
2. Apply the update using the agreed concurrency-control mechanism.
3. Preserve the order's quantity and lifecycle invariants.
4. Record any corresponding publication intent transactionally when required.
5. Process duplicate events safely.
6. Prevent stale updates from overwriting newer legitimate state.

Optimistic version checks, database locking, event identifiers, and processed-event records are possible implementation techniques. The appropriate combination must be selected based on the actual schema, transaction boundaries, and Kafka consumer design.

API Outcome Semantics
---------------------

Order creation responses must distinguish request validation and persistence from Matching Engine acceptance.

The API contract must define the response and status representation for at least:

- Invalid requests rejected before persistence.
- Orders persisted and awaiting publication or Matching Engine acknowledgement.
- Orders acknowledged by the Matching Engine.
- Idempotent retries of an existing request.
- Conflicts caused by incompatible idempotency-key reuse.
- Temporary dependency failures and retryable publication failures.

A successful order-creation response must not imply that a trade has occurred. Execution and fill outcomes must be communicated through the agreed order-status API or event mechanism.

Open Decisions and Dependencies
-------------------------------

Confirm these items before treating this document as an implementation contract:

- Supported order types and MARKET order protection.
- Canonical order fields, units, precision, and database constraints.
- Delivery-slot and expiry rules.
- IoT energy-availability semantics and protection against concurrent overselling.
- Idempotency-key scope and payload-conflict behaviour.
- Canonical state enum and permitted transitions.
- Matching Engine acknowledgement and status-update semantics.
- Cancellation-versus-fill reconciliation rules.
- Transactional-outbox and duplicate-event handling.
- API response codes and retry semantics.

Record decisions in the relevant shared contract or implementation document so that the Order Service, API Gateway, and Matching Engine use consistent rules.
