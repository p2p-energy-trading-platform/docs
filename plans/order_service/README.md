---
connie-title: Order Service Plan
---

# Order Service - Implementation Plan

- **Project:** GridX P2P Energy Trading Platform
- **Status:** Fixed for implementation
- **Order types:** `LIMIT` and `MARKET`
- **Persistent source of truth:** PostgreSQL

## Purpose

The Order Service owns the durable order lifecycle.

It validates BUY and SELL requests, checks SELL energy through the IoT gRPC API, stores orders in PostgreSQL, publishes commands through a transactional outbox, and applies Matching Engine status updates. It does not match orders, and it does not move wallet balances.

## Architecture

```text
Client
  |
  v
API Gateway
  |
  v
Order Service <---------- IoT Service gRPC (IotService)
  |
  | one database transaction
  v
PostgreSQL
  |  orders, energy ledger, transactional outbox
  v
Outbox publisher
  |
  v
Kafka  order.accepted  /  order.cancel_requested
  |
  v
Matching Engine
  |
  v
Kafka  order.state
  |
  v
Order Service consumer
  |
  v
PostgreSQL order state
```

The engine also publishes `trade.executed`. This service does not consume that topic. Status comes only from `order.state`.

## Documents

1. [Order Validation](01-order-validation.md)
2. [Limit and Market Orders](02-limit-and-market-orders.md)
3. [IoT Energy Validation](03-iot-energy-validation.md)
4. [PostgreSQL Persistence](04-postgresql-persistence.md)
5. [Kafka Contracts and Outbox](05-kafka-contracts-and-outbox.md)
6. [Matching Engine Boundary](06-matching-engine-integration.md)
7. [Order Status Synchronization](07-order-status-synchronization.md)
8. [Cancellation and Expiry](08-cancellation-and-expiry.md)
9. [Recovery Snapshot](09-kafka-based-recovery.md)
10. [API and Error Handling](10-api-and-error-handling.md)
11. [Security, Observability and Testing](11-security-observability-and-testing.md)
12. [Folder Structure](12-service-folder-structure.md)

## Fixed rules

- Energy is watt-hours. Price is an integer number of LKR minor units per kWh (1 LKR = 100). Timestamps are UTC. The user id is the Auth UUID. The grid id is the string `Grid.grid_id` from IoT. A zone is that grid.
- `LIMIT` rests until it is filled, cancelled, or the slot ends. `MARKET` is immediate-or-cancel with a required protection price. It never rests. Both types are part of this service.
- The engine is the only writer of fills, cancellations, expiry, and rejection. This service writes `PENDING` and `CANCEL_PENDING`, then follows `order.state`. It does not expire an order on its own.
- Kafka topic names are the ones the engine is configured for: `order.accepted`, `order.state`, `trade.executed`, and `grid.transfer`. Cancel uses `order.cancel_requested`, which the engine does not consume yet. Recovery uses `order.recovery.requests` and `order.recovery.snapshots`.
- Wallet calls are not part of this version. The existing contract is `OrderBillingService` in `gridx-workspace/protobuf/proto/gridx/billing/v1/order_billing.proto`. This service does not redefine it.
- Grid fees are not owned, queried, or displayed here. The engine reads them from `grid.transfer`.
- Engine work that is not in the current C++ process is specified in [proposed engine changes](../matching-engine/proposed-engine-changes.md). That document is not required reading for the order-service implementation. A fake publisher of `order.state` is enough to build and test this service.

## References

- [IoT Ingestion and Dispatch plan](../iot-ingestion-dispatch/README.md)
- [Proposed matching-engine changes](../matching-engine/proposed-engine-changes.md)
- Protobuf: `gridx-workspace/protobuf/proto/gridx/order/v1/`, `gridx/iot/v1/iot.proto`, `gridx/billing/v1/order_billing.proto`, `gridx/auth/v1/auth.proto`
