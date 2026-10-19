---
connie-title: Order Service Plan
---

# Order Service - Implementation Plan

- **Project:** GridX P2P Energy Trading Platform
- **Status:** Draft; cross-service contracts require confirmation
- **Initial order types:** `LIMIT` and `MARKET`, subject to Matching Engine support
- **Persistent source of truth:** PostgreSQL

## Purpose

The Order Service owns the durable order lifecycle for the GridX peer-to-peer energy trading platform.

Its responsibilities include:

- Validating BUY and SELL order requests.
- Checking SELL eligibility through the IoT Service gRPC API.
- Persisting accepted orders and their lifecycle changes in PostgreSQL.
- Publishing order events to Kafka through a transactional outbox.
- Consuming Matching Engine updates and synchronizing durable order state.
- Handling cancellation, expiry, retries, duplicate events, and recovery.
- Exposing order operations through the API Gateway.

The implementation must preserve consistency between durable order records, published events, and Matching Engine state, including during failures and concurrent operations.

## Architecture

```text
Client
  |
  v
API Gateway
  |
  v
Order Service <---------- IoT Service gRPC API
  |
  | Database transaction
  v
PostgreSQL
  |  - Orders and lifecycle state
  |  - Transactional outbox
  |
  v
Outbox Publisher
  |
  v
Kafka order events
  |
  v
Matching Engine
  |
  v
Kafka order status updates
  |
  v
Order Service Kafka Consumer
  |
  v
PostgreSQL order state
```

The diagram represents the intended integration flow. Exact topics, event schemas, consumer groups, and delivery guarantees must be confirmed against the existing contracts and service implementations before development.

## Documents

This plan is organized into the following documents:

1. [Order Service Validation](01-order-validation.md)
2. [Limit and Market Orders](02-limit-and-market-orders.md)
3. [Order Service IoT Energy Validation](03-iot-energy-validation.md)
4. [Order Service PostgreSQL Persistence](04-postgresql-persistence.md)
5. [Order Service Kafka Contracts and Outbox](05-kafka-contracts-and-outbox.md)
6. [Matching Engine Integration](06-matching-engine-integration.md)
7. [Order Status Synchronization](07-order-status-synchronization.md)
8. [Order Cancellation and Expiry](08-cancellation-and-expiry.md)
9. [Kafka-Based Recovery](09-kafka-based-recovery.md)
10. [Order Service API and Error Handling](10-api-and-error-handling.md)
11. [Order Service Security, Observability and Testing](11-security-observability-and-testing.md)
12. [Order Service Implementation Sequence](12-implementation-sequence.md)

## Important Boundaries

- PostgreSQL is the durable source of truth for Order Service records.
- The Matching Engine owns matching decisions and its order books. The Order Service owns durable order records and synchronizes their status from validated Matching Engine updates.
- The Order Service accesses IoT functionality through its supported gRPC API. It must not query IoT Redis or TimescaleDB directly.
- Wallet balance checks, credit reservation, and release are deferred until the Billing & Wallet Service and its contracts are available.
- LIMIT and MARKET order support depends on the actual Matching Engine capabilities and agreed cross-service contracts.
- SELL validation must use an explicitly defined energy-availability rule. A successful IoT response alone must not be assumed to guarantee that energy can be traded safely.
- Kafka publication and PostgreSQL persistence must be designed to avoid losing events when a process fails between database commits and publication.
- Duplicate event delivery, retries, out-of-order updates, and cancellation-versus-fill races must be handled explicitly.
- Recovery must follow the agreed Kafka-based recovery design. The existing direct-request recovery description must be reviewed and reconciled before implementation.
- Proposed topics, event payloads, status transitions, and API fields must not be treated as implemented contracts until verified.

## Open Decisions and Dependencies

The following items require confirmation during the implementation review:

- Supported order types and the behaviour of partially filled or unfilled MARKET orders.
- Canonical order status values and permitted transitions.
- Kafka topic names, message schemas, partitioning keys, and delivery semantics.
- Idempotency requirements for order creation and event processing.
- The authoritative Matching Engine acknowledgement and status-update contract.
- Cancellation, expiry, and matching race-handling rules.
- The recovery mechanism and its relationship to the existing Matching Engine implementation.
- The future Wallet Service integration and energy-credit reservation rules.

Unresolved items must be documented and agreed with the relevant service owners before dependent functionality is implemented.

## References

- [IoT Ingestion & Dispatch plan](../iot-ingestion-dispatch/README.md)
- [Matching Engine implementation plan](../matching-engine/matching-engine-implementation-plan.md)
- [Matching Engine crash recovery](../matching-engine/crash-recovery.md)
- [API Contracts](../api_contracts/api-contracts.md)
