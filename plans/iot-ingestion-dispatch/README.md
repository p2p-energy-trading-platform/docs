---
connie-title: IoT Ingestion Service Plan
---

# IoT Ingestion & Dispatch Service - Plan

- **Author:** Hanan (M.S.H. Ahmed)
- **Implementation language:** Go
- **Status:** Validated draft; unresolved release-blocking decisions are listed below
- **Scope:** Kafka ingestion, validation/admission, Redis latest-state projection, TimescaleDB telemetry/registry storage, heartbeat processing, and a production gRPC query API
- **Not Planned:** Dispatch service
- **Out of scope:** Browser-facing streaming

## System boundary

```text
IoT Simulator --JSON/MQTT--> MQTT broker -- Kafka Connect--> Kafka
                                                                |
                                                        IoT Ingestion Service
                                                +-----------------+-----------------+
                                                |                 |                 |
                                        TimescaleDB          Redis          gRPC query API
                                        durable authority   projection       internal callers
```

The simulator never connects directly to Kafka, Redis, TimescaleDB, or gRPC. Kafka Connect forwards the current JSON MQTT payloads unchanged to `iot.meter-readings` and `iot.heartbeats`. Protobuf is used for the internal gRPC API, not for decoding the existing Kafka records.

The service provides at-least-once processing. TimescaleDB, Redis, and Kafka offsets are not one atomic transaction, so database writes and cache projection updates are designed to be idempotent and replay-safe. TimescaleDB is the durable source of truth; Redis is a rebuildable latest-state projection.

## Plan documents

| Document | Purpose |
|---|---|
| [01-kafka-consumeption.md](01-kafka-consumeption.md) | Kafka consumption and handling |
| [02-redis-hot-storage.md](02-redis-hot-storage.md) | Redis hot storage key design and TTLs |
| [03-timescaledb-schema.md](03-timescaledb-schema.md) | TimescaleDB schema, hypertables and migrations |
| [04-heartbeat-processing.md](04-heartbeat-processing.md) | Heartbeat handling and device discovery flow |
| [05-dispatch-service.md](05-dispatch-service.md) | Dispatch Service design and MQTT actuation flow |
| [06-configuration-and-secrets.md](06-configuration-and-secrets.md) | Configuration, secrets, and runtime env management |
| [07-testing-and-ci.md](07-testing-and-ci.md) | Unit, integration tests and CI pipeline strategy |
| [08-observability-and-monitoring.md](08-observability-and-monitoring.md) | Logging, metrics, tracing, and alerting plan |
| [09-security-and-access-control.md](09-security-and-access-control.md) | Security, authz, and database access controls |
| [10-deployment-and-operations.md](10-deployment-and-operations.md) | Deployment, runbooks, and operational playbooks |
| [11-production-readiness.md](09-production-readiness.md) | Configuration, security, observability, deployment, recovery, SLOs, and decision gate |

## Technology decisions

- `franz-go` Kafka client with auto-commit disabled and explicit partition-safe commits.
- `pgx` for TimescaleDB/Postgres access.
- `go-redis` for the Redis projection.
- `pressly/goose` migrations, executed by one deployment job/command rather than every replica.
- `grpc-go` and SDK-generated protobuf types for the internal query server.
- `log/slog`, OpenTelemetry-compatible tracing, and Prometheus metrics.
- `testify` plus pinned `testcontainers-go` dependencies for integration tests.

Dependencies and container images must be version-pinned and validated in CI. The TimescaleDB version is especially important because recent releases use Hypercore/columnstore APIs in place of the older compression API.

## Release-blocking decisions

The design is implementable after owners settle these items:

1. Redis failure policy: must successful TimescaleDB writes wait for Redis before offset commit, or may cache repair happen asynchronously?
2. Authoritative JSON schemas and validation ranges, including heartbeat asset snapshot semantics.
3. Verified live Kafka Connect key/partition behavior and production topic sizing/settings.
4. Pinned TimescaleDB version and migration syntax for retention/columnstore.
5. gRPC caller identity, per-grid/house authorization, query limits, and SLOs.
6. Capacity model, replica/partition topology, backup RPO/RTO, and telemetry/failure-data retention policy.

## Definition of done

Production readiness requires more than implementation:

- All migrations pass clean-install and previous-version upgrade tests.
- Duplicate/replayed records cannot duplicate history or regress Redis latest state.
- Active rebalances and shutdowns do not commit unfinished records.
- The gRPC API passes generated Go/TypeScript contract tests, authorization checks, bounded-query tests, and load thresholds.
- End-to-end tests verify simulator payloads, connector record keys/partitions, durable storage, and query visibility.
- Dashboards, alerts, runbooks, backup restore, Redis rebuild, and controlled failure replay are exercised.
- Security, dependency/container scanning, non-root image, secrets handling, and production TLS/workload identity are enabled.
- The unresolved decisions above have named owners and accepted values.

Cold storage and dispatch are intentionally absent from this service plan. If either becomes a funded capability later, it should receive a separate service boundary and plan rather than an empty placeholder package here.
