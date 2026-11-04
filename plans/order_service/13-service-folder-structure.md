---
connie-title: Order Service Folder Structure
---

Order Service Folder Structure
==============================

Purpose
-------

This document defines the repository layout, package responsibilities, and conventions for the Order Service implementation. It exists so that the service is built consistently with the other GridX Go services and so that each concern has one agreed location.

Decisions
---------

| ID | Decision | Evidence |
|---|---|---|
| S-1 | The Order Service is a Go service in a new repository named `order-service`. Module path: `github.com/p2p-energy-trading-platform/order-service`. | `iot-ingestion-dispatch` and `billing-wallet-service` are Go services with the same layout. `docs/architecture/base.md` labels the order service "Node.js + Prisma", but the same diagram labels the Matching Engine "Node.js" (it is C++) and the gateway "Express" (it is Fastify), so the label is not reliable. |
| S-2 | Generated protobuf types come from `go-sdk` (`github.com/p2p-energy-trading-platform/go-sdk`). The service does not generate or vendor its own protobuf code. | IoT service imports `go-sdk` (v1.17.1). |
| S-3 | The Order Service gRPC contract lives in the `protobuf` repository at `proto/gridx/order/v1/order_service.proto`. | `protobuf` is the source of truth for contracts. |
| S-4 | PostgreSQL uses the `order_management_data` schema and the `ORDER_SERVICE_USER` role already provisioned by `gridx-infra`. Migrations use Goose with embedded SQL files. | `gridx-infra/init-scripts/postgres/01-init-schemas.sql`. |
| S-5 | Libraries follow the IoT service: `pgx/v5`, `franz-go`, `goose`, `slog`, Prometheus, OpenTelemetry, `testcontainers-go`. | `iot-ingestion-dispatch/go.mod`. |
| S-6 | Build and task automation uses `go-task` (`Taskfile.yaml`). | `docs/architecture/repository-configuration.md`. |

Repository Layout
-----------------

```text
order-service/
├── cmd/
│   ├── order/                       # Service entrypoint: load config, wire dependencies, start servers and workers
│   │   └── main.go
│   ├── migrate/                     # Goose migration runner
│   │   └── main.go
│   └── dead-letter-replay/          # Controlled replay of dead-lettered or quarantined events
│       └── main.go
├── internal/
│   ├── app/                         # Wiring, lifecycle, graceful shutdown, migration-version check
│   │   ├── app.go
│   │   ├── shutdown.go
│   │   └── migration_check.go
│   ├── config/                      # Typed env configuration and startup validation
│   │   ├── config.go
│   │   └── validate.go
│   ├── domain/                      # Pure domain model, no I/O
│   │   ├── order.go                 # Order, Side, OrderType
│   │   ├── status.go                # Status enum and mapping to proto OrderStatus
│   │   ├── transitions.go           # Allowed transition table and transition guard
│   │   ├── units.go                 # Wh and micro-AED types, tick and step checks
│   │   ├── slot.go                  # 30-minute slot alignment, gate closure, horizon
│   │   └── errors.go                # Sentinel errors carrying stable reason codes
│   ├── validation/                  # Request validation rules (pure functions)
│   │   ├── request.go
│   │   ├── price_quantity.go
│   │   └── slot.go
│   ├── service/                     # Use cases and the ports they depend on
│   │   ├── create_order.go
│   │   ├── cancel_order.go
│   │   ├── get_order.go
│   │   ├── list_orders.go
│   │   ├── apply_order_update.go    # Applies Matching Engine updates (order_seq rules)
│   │   ├── idempotency.go           # Fingerprinting and replay decision
│   │   └── ports.go                 # Interfaces implemented by store, clients, messaging
│   ├── energy/                      # SELL energy rules
│   │   ├── policy.go                # SellableEnergyPolicy interface
│   │   ├── capacity_policy.go       # v1 capacity-based policy
│   │   └── ledger.go                # Allocation and release use cases
│   ├── clients/                     # Outbound gRPC clients
│   │   ├── iot/client.go
│   │   ├── auth/client.go           # CheckPermission with short in-process cache
│   │   └── billing/client.go        # Reserve and Release (disabled until the contract exists)
│   ├── store/
│   │   └── postgres/
│   │       ├── pool.go
│   │       ├── tx.go
│   │       ├── orders.go
│   │       ├── status_history.go
│   │       ├── outbox.go
│   │       ├── processed_events.go
│   │       ├── dead_letters.go
│   │       ├── energy_ledger.go
│   │       └── trader_accounts.go
│   ├── messaging/
│   │   └── kafka/
│   │       ├── topics.go            # Canonical topic names
│   │       ├── headers.go           # x-message-type and other record headers
│   │       ├── producer.go
│   │       ├── updates_consumer.go  # Consumes gridx.orders.updates.v1
│   │       ├── recovery_consumer.go
│   │       └── codec.go
│   ├── worker/
│   │   ├── outbox_relay.go          # Publishes committed outbox rows in per-order order
│   │   ├── expiry_reconciler.go     # Fallback expiry after the grace period
│   │   ├── ledger_audit.go          # Checks that ledger totals match allocations
│   │   ├── retention_cleaner.go
│   │   └── pending_monitor.go       # Alerts on PENDING and CANCEL_PENDING age
│   ├── transport/
│   │   ├── grpc/
│   │   │   ├── server.go
│   │   │   ├── interceptors.go      # Logging, recovery, request ID propagation
│   │   │   ├── errors.go            # Domain error to gRPC status plus ErrorInfo.reason
│   │   │   └── services/order_handler.go
│   │   └── httphealth/              # Liveness, readiness, Prometheus metrics endpoint
│   │       ├── server.go
│   │       └── metrics.go
│   ├── observability/
│   │   ├── logging.go
│   │   ├── metrics.go
│   │   └── tracing.go
│   ├── test/helpers/
│   └── recovery/
│       ├──service.go
│       └──snapshot.go
├── migrations/                      # Goose SQL files, embedded
│   ├── embed.go
│   ├── version.go
│   └── 00001_initial_order_schema.sql
├── test/
│   ├── integration/                 # Real PostgreSQL and Kafka via testcontainers
│   └── contract/                    # Encode and decode checks against go-sdk protobuf types
├── docs/
│   └── runbooks/
│       ├── outbox-backlog.md
│       ├── pending-orders.md
│       ├── dead-letters.md
│       ├── expiry-reconciliation.md
│       └── dependency-outage.md
├── .github/workflows/ci.yml
├── .env.example
├── .dockerignore
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── Taskfile.yaml
├── go.mod
├── go.sum
└── README.md
```

Package Responsibilities
------------------------

| Package | Owns | Must not |
|---|---|---|
| `domain` | Types, units, slot rules, status enum, transition table | Import any other internal package or perform I/O |
| `validation` | Stateless request checks returning stable reason codes | Call the network or database |
| `service` | Use cases, transaction boundaries, and the interfaces (ports) it needs | Import `store`, `clients`, `messaging`, or `transport` directly |
| `energy` | Sellable-energy policy and the allocation ledger rules | Read IoT Redis or TimescaleDB |
| `clients` | gRPC clients for IoT, Auth, Billing with deadlines | Contain business rules |
| `store/postgres` | SQL, transactions, row locking, outbox and dedupe tables | Publish to Kafka |
| `messaging/kafka` | Producer, consumer, headers, topic names | Write to PostgreSQL |
| `worker` | Background loops that call `service` and `store` | Hold business logic of their own |
| `transport/grpc` | Request mapping, error mapping, interceptors | Contain business rules or SQL |

Dependency direction: `transport` and `worker` depend on `service`. `service` depends on `domain`, `validation`, `energy`, and its own port interfaces. `store`, `clients`, and `messaging` implement those ports. `app` is the only package that wires concrete implementations together.

Contracts and Where They Live
-----------------------------

| Contract | Location |
|---|---|
| Order Service gRPC (`OrderService`) | `protobuf/proto/gridx/order/v1/order_service.proto` |
| Kafka order commands and updates | `protobuf/proto/gridx/order/v1/order_events.proto`, `order_update_events.proto` |
| Trade events | `protobuf/proto/gridx/trade/v1/trade_events.proto` |
| IoT read API | `protobuf/proto/gridx/iot/v1/iot.proto` |
| Auth `CheckPermission` | `protobuf/proto/gridx/auth/v1/auth.proto` |
| Database schema | `order-service/migrations` |

Configuration
-------------

All settings come from environment variables. A missing required variable or an invalid value fails startup, as in the IoT service.

| Group | Variables |
|---|---|
| Database | Connection settings built from `ORDER_SERVICE_USER` and `ORDER_SERVICE_PASSWORD` (already defined in `gridx-infra`), schema `order_management_data` |
| Kafka | Brokers, consumer group, and the three canonical topic names |
| Dependencies | IoT, Auth, and Billing gRPC addresses and per-call deadlines |
| Business limits | Quantity step, min, max, price tick, min, max, slot horizon, IoT reading max age, expiry reconcile grace |
| Grid zones | Interim `grid_id` to `grid_zone_id` map, validated at startup |
| Feature flags | 'ORDER_CREATION_ENABLED'|

Migrations
----------

- Goose, embedded with `go:embed`, applied by `cmd/migrate`.
- Sequential numeric names, as in `iot-ingestion-dispatch` (`00001_`, `00002_`).
- Every object is created inside `order_management_data`.
- The service verifies at startup that the applied migration version matches the embedded one.

Testing Layout
--------------

| Location | Purpose |
|---|---|
| `internal/**/_test.go` | Unit tests for domain, validation, and service logic |
| `test/integration` | PostgreSQL and Kafka through testcontainers: atomic creation, idempotency races, allocation races, outbox ordering, duplicate and stale updates |
| `test/contract` | Round-trip encode and decode with `go-sdk` types, so schema drift fails CI |

Plan Folder in the `docs` Repository
------------------------------------

```text
plans/order_service/
├── README.md
├── 01-order-validation.md
├── 02-limit-and-market-orders.md
├── 03-iot-energy-validation.md
├── 04-postgresql-persistence.md
├── 05-kafka-contracts-and-outbox.md
├── 06-matching-engine-integration.md
├── 07-order-status-synchronization.md
├── 08-cancellation-and-expiry.md
├── 09-kafka-based-recovery.md
├── 10-api-and-error-handling.md
├── 11-security-observability-and-testing.md
├── 12-implementation-sequence.md
└── 13-service-folder-structure.md
```

Decisions and Dependencies
--------------------------

### Resolved decisions

| ID | Item | Decision |
|---|---|---|
| S-1 | Implementation language and repository | Go, repository `order-service`. |
| S-2 | Protobuf types | Consumed from `go-sdk`, never generated in this repository. |
| S-3 | Service contract location | `protobuf` repository, `order_service.proto`. |
| S-4 | Database | `order_management_data` schema, Goose migrations. |
| S-5 | Libraries and conventions | As in `iot-ingestion-dispatch`. |

### Remaining items needing sign-off

| ID | Item | Owner |
|---|---|---|
| S-O1 | Confirm Go over the Node.js label in `architecture/base.md`, then correct the diagram. | Team lead |
| S-O2 | Create the `order-service` repository and add it to `gridx-workspace` `REPOS`. | Team lead |
| S-O3 | Add Order Service environment variables and compose service to `gridx-infra`. | Infrastructure |
