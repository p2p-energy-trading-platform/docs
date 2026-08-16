---
connie-title: IoT Ingestion - Production Readiness
---

# Production readiness and operations

This checklist is part of the implementation plan. “Works end to end” is necessary but not sufficient for production release.

## Configuration and secrets

Configuration is typed, validated at startup, and sourced from environment variables/deployment secrets. A local file may provide non-secret development defaults. Required settings include:

- Kafka brokers, topics, stable consumer group, TLS/SASL, fetch/record limits, session/rebalance settings, and worker bounds.
- TimescaleDB DSN/credentials, TLS mode, pool min/max, connect/query/transaction timeouts, expected migration version.
- Redis address/credentials/TLS, pool and command timeouts, retry limit, key prefix, liveness TTL.
- gRPC and health listen addresses, TLS mode, message/concurrency/keepalive limits, default and maximum query windows/pages.
- Retry attempts/backoff ceilings, shutdown deadline, registry refresh interval, supported schema versions, and maximum input clock skew.
- Observability endpoint/exporter settings and log level.

Reject unknown or contradictory production settings. Never log DSNs, credentials, raw authorization metadata, or full payloads. Secrets must be rotatable without an image rebuild; document whether rotation requires a rolling restart.

## Health and dependency policy

`/healthz` means the process event loop is alive and does not probe dependencies. `/readyz` and gRPC health reflect whether the instance should receive traffic. Readiness requires successful grid bootstrap and a usable gRPC query path; Kafka health and consumer assignment/lag are operational signals rather than reasons to create rapid readiness flapping.

Document degraded modes explicitly. The chosen baseline is:

- TimescaleDB unavailable: ingestion pauses without committing; historical gRPC reads return `UNAVAILABLE`.
- Redis unavailable: latest reads may use a bounded TimescaleDB fallback. Whether ingestion pauses or continues is the acknowledgement-policy decision in [01-kafka-consumption.md](01-kafka-consumption.md); choose one before implementation.
- Kafka unavailable: query API may remain ready if stores are healthy; ingestion alerts on disconnect/lag.
- Grid refresh unavailable after bootstrap: retain last-known-good snapshot and alert on its age.

## Observability

Use structured `slog`, OpenTelemetry-compatible traces, and Prometheus metrics. Required signals include:

- consumed/processed/failed records by topic and safe failure stage;
- consumer lag, assignment/rebalance count, pause duration, processing and commit latency;
- end-to-end event-time-to-durable-write and event-time-to-query visibility;
- Postgres/Redis operation latency, errors, pool usage, retries, and transaction rollbacks;
- unresolved failure count/age and replay results;
- registry size, refresh duration, failures, and last-success age;
- gRPC requests, status, latency, in-flight/rejected calls, rows and bytes;
- process CPU, memory, goroutines, file descriptors, restarts, and shutdown duration.

Never label metrics with house, grid, meter, asset, request, or Kafka key values. Use trace/log fields for sampled diagnosis with redaction. Alerts need an owner, severity, threshold/window, and linked runbook. Minimum paging conditions are sustained lag growth, no successful writes, exhausted DB connections, stale registry beyond tolerance, failure-table surge, and repeated crash loops.

## Security

- Use separate least-privilege identities: a migration role owns `iot_data`; the runtime DB role has only required DML/sequence privileges; Redis/Kafka permissions are limited to required keys/topics/group; gRPC callers are allowlisted.
- Encrypt production traffic to Kafka, Redis, TimescaleDB, and gRPC or place it behind authenticated service-mesh mTLS. Plaintext is development-only.
- Apply network policies/firewall rules so stores and gRPC are not public.
- Define the end-to-end device trust boundary. Production MQTT identities need per-device credentials and topic ACLs (or signed payloads), Kafka Connect must preserve an authenticated source identity/topic, and ingestion must verify that identity against the claimed `meter_id`/`house_id`/`grid_id`. A payload-supplied ID is not authentication. Heartbeat auto-discovery remains simulator-only until enrollment is implemented.
- Validate and size-limit every Kafka and gRPC input. Use bounded concurrency to resist resource exhaustion.
- Pin dependencies/images, run vulnerability and secret scans, produce an SBOM, sign release artifacts where platform tooling supports it, and define patch ownership.
- Define retention/access controls for telemetry and raw failure payloads, including deletion obligations and audited operator replay access.

## Deployment and shutdown

Run at least two replicas when availability matters, with Kafka partitions sufficient for useful parallelism. Use topology spread/anti-affinity where supported. Set requests and limits from load-test evidence, not guesses. Use a disruption budget compatible with partition count and drain time.

Rollout order is migrations, compatible SDK/contract, ingestion replicas, then callers. Schema/API evolution follows expand-and-contract so old and new replicas can overlap. A canary watches errors, lag, write latency, gRPC status, and resource use before full rollout. Rollback must not require reversing a destructive migration.

On termination: fail readiness, mark gRPC not serving, stop polling, drain partition workers and in-flight RPCs within the configured grace period, commit only contiguous completed offsets, close clients, then exit. The platform termination grace period must exceed the application drain deadline.

## Data protection and recovery

- Back up TimescaleDB with tested point-in-time recovery appropriate to the environment. A backup that has not been restored in a drill is not considered verified.
- Redis persistence is optional because it is a projection, but the rebuild command and expected rebuild time are tested.
- Kafka retention must exceed the maximum plausible dependency outage plus recovery/replay margin.
- Define recovery point/time objectives for telemetry and query availability.
- Provide audited, bounded commands/runbooks for failure replay, Redis rebuild, stuck migration recovery, lag catch-up, and credential rotation.

## Capacity model and SLO gate

Before sizing, record expected and peak house count, tick and heartbeat interval, average/p99 payload size, assets per house, retention, partitions/replicas, query mix, and growth horizon. Calculate baseline records/second and storage/day, then validate with the load tests in [09-testing-strategy.md](09-testing-strategy.md).

Release criteria require agreed SLOs for ingestion durability/visibility, maximum recoverable lag, gRPC availability and p95/p99 latency, plus error-budget ownership. Exact numeric targets are a product/platform decision and must not be invented in code. The first production rollout is blocked until the values, dashboards, alerts, and runbooks are approved.

## Decisions still required before implementation

1. Redis failure acknowledgement policy: pause ingestion, or acknowledge durable TimescaleDB and repair the cache asynchronously.
2. Exact simulator JSON schema, identity grammar, numeric ranges, clock-skew tolerance, and whether heartbeat assets are a complete snapshot.
3. Kafka topic partition/replication/retention settings and verified connector key behavior.
4. Pinned TimescaleDB version and matching Hypercore/columnstore policy.
5. gRPC caller authorization model and identity metadata standard.
6. Query limits/SLOs, capacity assumptions, and deployment topology.
7. Backup/RPO/RTO, telemetry privacy retention, and resolved-failure retention.
8. Production device enrollment, MQTT credential/topic authorization, and the identity binding carried through Kafka Connect.
