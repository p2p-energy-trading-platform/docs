---
connie-title: Billing Service Implementation Stories
---

# Billing Service Sprint Tasks (2-Week Plan)

## Workstream 1: Core Storage, Wallets, and Order Reservations

### Task 1: Database Schema and Domain Implementation

* **Reference Documents:** `01-overview-and-scope.md` and `02-domain-model-schema.md`
* **Scope:** Implement the foundational database tables, minor-unit money representations, constraints, and relational schemas as outlined in the documentation.

### Task 2: Wallet Service API Integration

* **Reference Documents:** `03-grpc-api.md` and `01-overview-and-scope.md`
* **Scope:** Set up the wallet gRPC services and gateway caller contracts for retrieving wallets and handling basic account states.

### Task 3: Reservation and Order Lifecycle Mechanics

* **Reference Documents:** `04-reservation-and-settlement-flow.md`
* **Scope:** Implement buy order reservation logic, hold tracking, rounding buffers, and market order price collar validations following the document guidelines.

### Task 4: Reservation Expiry and Background Safety Net

* **Reference Documents:** `04-reservation-and-settlement-flow.md`
* **Scope:** Implement the background sweeper worker to process expired holds and clean up abandoned order allocations safely.

---

## Workstream 2: Settlement, Fees, Payments, and Observability

### Task 5: Fee Configuration and Split Model Implementation

* **Reference Documents:** `05-fees-and-commission.md`
* **Scope:** Implement the balanced split fee configuration, append-only settings, and independent round-half-up fee calculation logic.

### Task 6: Trade Settlement Engine and Ledgers

* **Reference Documents:** `04-reservation-and-settlement-flow.md`, `02-domain-model-schema.md`, and `07-redis-idempotency-currency.md`
* **Scope:** Implement the trade execution settlement workflow, double-entry ledger lines, transactional outbox patterns, and row-level locking strategies.

### Task 7: Deposits, Withdrawals, and Stripe Provider Integration

* **Reference Documents:** `06-deposit-and-withdrawal.md`
* **Scope:** Implement the payment provider abstraction, Stripe checkout session integration, webhook signature verification, and withdrawal structures.

### Task 8: Caching, Idempotency, Testing, and Observability

* **Reference Documents:** `07-redis-idempotency-currency.md` and `08-testing-and-observation.md`
* **Scope:** Implement the Redis idempotency response cache, concurrency controls, integration/unit testing strategies, and telemetry/metrics instrumentation.

## Task 9: Testing and Observability

* **Reference Documents:** `08-testing-and-observation.md`
* **Scope:** Add integration/unit testing strategies, and telemetry/metrics instrumentation.
