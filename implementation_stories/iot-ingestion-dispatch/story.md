---
connie-title: IoT Ingestion - 4 Week Implementation Story
---

# IoT Ingestion Service - 4 Week Implementation Story

## Goal

Deliver the in-scope IoT Ingestion Service in four incremental weeks, starting with the repository and storage foundations, then implementing reliable Kafka ingestion and heartbeat processing, exposing the read-only gRPC query API, and finishing with testing, observability, security, and production-readiness work.

The four-week scope includes:

- Kafka consumption of `iot.meter-readings` and `iot.heartbeats`.
- JSON decode, validation, admission, retry, failure recording, and partition-safe offset handling.
- TimescaleDB/Postgres durable storage.
- Redis latest-state and heartbeat/liveness projection.
- Startup in-memory grid registry and periodic refresh.
- Heartbeat processing and observed asset synchronization.
- Read-only production gRPC query API.
- Unit, workflow, integration, contract, end-to-end, resilience, and performance testing.
- Configuration, health checks, observability, security, deployment, recovery, and release-readiness work.

The following are intentionally **not part of these four weeks**:

- Dispatch Service implementation.
- Cold-storage/archive implementation.
- Browser-facing streaming.

---

# Week 1 - Service Foundation, Storage, and Startup Admission

## Weekly story

**As the IoT platform team, we want the ingestion service skeleton, durable schema, Redis projection model, configuration, migrations, and startup grid registry in place, so that later ingestion logic can be implemented on stable infrastructure and clear package boundaries.**

## Main outcome

By the end of Week 1, the Go service should start successfully against its dependencies, apply migrations through the dedicated migration command, load the provisioned grid registry into memory, expose basic health/readiness endpoints, and provide tested storage adapters for TimescaleDB and Redis.

## Work items

### 1. Repository and application structure

Create the validated single-module, single-process Go repository structure.

Implement the initial packages for:

- `cmd/iot-ingestion`
- `cmd/migrate`
- `internal/app`
- `internal/config`
- `internal/domain`
- `internal/ingestion`
- `internal/admission`
- `internal/query`
- `internal/store/postgres`
- `internal/store/redis`
- `internal/transport/grpc`
- `internal/transport/httphealth`
- `internal/observability`
- `migrations`
- test directories and helpers

Keep package dependencies aligned with the documented boundaries:

- `cmd` performs composition only.
- domain types do not import Kafka, Redis, Postgres, gRPC, or generated protobuf packages.
- storage adapters remain behind narrow consumer-owned interfaces.
- generated gRPC types remain at the transport boundary.

### 2. Typed configuration and validation

Add typed configuration for the dependencies and runtime limits needed by the service.

At minimum include configuration for:

- Kafka brokers, topics, consumer group, security, fetch limits, and rebalance/session settings.
- TimescaleDB DSN, TLS, pool limits, and timeouts.
- Redis address, credentials, TLS, pool limits, retries, key prefix, and liveness TTL.
- gRPC and health listen addresses.
- shutdown deadline.
- grid-registry refresh interval.
- retry/backoff values.
- observability/log level settings.

Fail fast on missing, contradictory, or invalid production settings.

### 3. Migration command and initial TimescaleDB schema

Introduce versioned migrations owned by the service rather than editing infrastructure bootstrap SQL.

Create the initial `iot_data` schema objects required by the plan:

- `grids`
- `houses`
- `flexible_assets`
- `meter_readings`
- `storage_asset_readings`

Configure the telemetry tables as TimescaleDB hypertables.

Add required indexes, identity/range constraints, and the agreed six-month telemetry retention policy.

Keep heartbeats out of a dedicated time-series table; heartbeat liveness is represented by `houses.last_heartbeat_at`.

### 4. Redis hot-storage adapters

Implement Redis key construction and adapters for:

- `meter:{grid_id}:{house_id}:latest`
- `house:{house_id}:status`
- `grid:{grid_id}:houses`

Add Lua scripts for:

- newest-reading-wins updates based on event time and sequence;
- atomic heartbeat `HSET + EXPIRE + SADD`.

Use the documented ten-minute heartbeat TTL.

### 5. Startup grid-registry bootstrap

Implement startup admission bootstrap:

1. Connect to TimescaleDB.
2. Ensure migrations are at the expected version.
3. Load all provisioned grids.
4. Validate the complete result.
5. Publish an immutable in-memory `map[string]Grid` snapshot atomically.
6. Start the periodic refresher.
7. Only then allow ingestion readiness.

Use a default refresh interval of 120 seconds unless configuration overrides it.

If refresh fails after startup, retain the last-known-good snapshot.

### 6. Basic application lifecycle and health

Implement:

- `/healthz` for process liveness only.
- `/readyz` for readiness according to startup/bootstrap state.
- signal handling and bounded shutdown scaffolding.
- basic structured logging.

## Acceptance criteria

- The repository follows the agreed package layout and boundary rules.
- `.env` and local credentials are excluded from version control.
- A clean database can be migrated successfully by `cmd/migrate`.
- Migration tests verify a clean install.
- Provisioned grids can be loaded into an immutable in-memory registry.
- Kafka consumption does not become ready before grid bootstrap succeeds.
- A failed grid refresh keeps the last-known-good registry.
- Redis heartbeat operations are atomic.
- Redis latest-state updates cannot be overwritten by an older reading.
- `/healthz` and `/readyz` have distinct semantics.
- Unit tests exist for configuration validation, Redis comparison behavior, and registry replacement.

## End-of-week demo

Start TimescaleDB and Redis, run migrations, start the service, verify the in-memory grid registry has loaded, demonstrate `/healthz` and `/readyz`, write/read a Redis latest-state projection, and show that an older projection cannot replace a newer one.

---

# Week 2 - Kafka Ingestion, Durable Telemetry, and Heartbeat Processing

## Weekly story

**As the IoT platform team, we want Kafka records to be consumed, validated, durably stored, projected into Redis, and acknowledged safely, so that meter readings and heartbeats can be processed reliably under retries, replays, failures, and rebalances.**

## Main outcome

By the end of Week 2, both Kafka topics should flow through the real ingestion pipeline with at-least-once, replay-safe behavior. Meter readings should persist to TimescaleDB and update Redis latest state, while heartbeats should update house liveness and observed asset information using the documented transactional workflow.

## Work items

### 1. Kafka consumer loop

Implement a `franz-go` consumer with:

- one stable consumer group initially;
- subscriptions to `iot.meter-readings` and `iot.heartbeats`;
- auto-commit disabled;
- strict topic-to-handler routing;
- bounded partition-aware workers;
- explicit offset management;
- cancellation and rebalance handling.

Preserve ordering independently within each Kafka topic/partition.

### 2. JSON wire decoding and validation

Implement private JSON wire structs matching the simulator payloads.

Add decode/map functions for:

- meter readings;
- heartbeats.

Validate before side effects:

- schema version;
- IDs and identifier grammar;
- required fields;
- numeric bounds and finite values;
- time/clock-skew limits;
- asset types and capability values;
- duplicate asset IDs inside a heartbeat.

Kafka records remain JSON bytes. Generated protobuf types must not be used as Kafka ingestion models.

### 3. Meter-reading durable write path

Implement the meter-reading workflow in this order:

1. Decode and validate.
2. Check `grid_id` through the in-memory admission registry.
3. Begin Postgres transaction.
4. Insert the meter-reading parent row.
5. Insert all storage-asset reading rows.
6. Commit the Postgres transaction.
7. Update Redis latest state only when the incoming `(event_time, seq)` is newer.
8. Commit the Kafka offset only after all required processing succeeds.

Use immutable history semantics. Replays of the same telemetry must not duplicate history, and conflicting duplicates must be treated as integrity failures rather than silently updating historical values.

### 4. Heartbeat processing workflow

Implement the heartbeat sequence exactly in the agreed order:

1. Decode and validate heartbeat.
2. Check `grid_id` in memory.
3. Validate duplicate asset IDs in the payload.
4. Begin PostgreSQL transaction.
5. Validate existing house identity and update `last_heartbeat_at`.
6. Validate asset ownership.
7. Insert/update only changed asset capabilities.
8. Commit PostgreSQL transaction.
9. Perform the atomic Redis heartbeat update.
10. Commit the Kafka offset.

Use one application-generated receive timestamp for both Postgres liveness and Redis heartbeat state.

### 5. Asset discovery versus registration rules

Keep heartbeat discovery separate from authoritative asset registration.

Heartbeat processing may:

- observe assets;
- validate an already-known asset against its house;
- update permitted capability fields when changed;
- optionally represent an unknown observed asset as pending/discovered if the finalized schema supports it.

Heartbeat processing must not silently grant:

- ownership;
- trading permission;
- dispatch permission;
- settlement eligibility;
- user consent.

An asset already assigned to another house is a permanent identity conflict and rolls back the heartbeat transaction.

### 6. Retry and permanent-failure handling

Implement failure classification:

- transient failures use bounded exponential backoff;
- permanent validation/provisioning failures do not waste retry attempts.

Persist exhausted/permanent failures through the failure-recorder path before committing their Kafka offsets.

If failure recording itself fails, leave the source Kafka offset uncommitted.

### 7. Delivery and rebalance safety

Ensure:

- no offset is committed for unfinished work;
- only contiguous completed offsets are committed;
- revoked partitions stop accepting new work and drain bounded in-flight work;
- replay remains safe after consumer restart;
- handler panics are contained at worker boundaries and surfaced as alerts/errors.

## Acceptance criteria

- Real JSON meter readings from Kafka are decoded into internal domain types.
- Real JSON heartbeats are decoded into internal domain types.
- Unknown grids are rejected without per-message database lookup.
- Meter reading plus storage-asset rows are written transactionally.
- Duplicate/replayed meter readings do not duplicate history.
- An older replay cannot regress Redis latest state.
- Heartbeat updates durable house liveness before Redis.
- Duplicate asset IDs in one heartbeat are rejected before starting a database transaction.
- Asset ownership conflicts roll back the complete heartbeat transaction.
- Unchanged asset capabilities avoid unnecessary updates.
- Redis heartbeat state is updated atomically with TTL and grid membership.
- Kafka offsets are committed only after successful required work.
- Transient and permanent failures follow different retry paths.
- Unit and application-workflow tests cover partial-success boundaries and replay behavior.

## End-of-week demo

Publish simulator-compatible meter readings and heartbeats into Kafka. Show durable telemetry in TimescaleDB, latest-state and liveness data in Redis, heartbeat asset synchronization, rejection of an unknown grid, replay safety, and an uncommitted record during a simulated dependency failure.

---

# Week 3 - gRPC Query API and Full Integration

## Weekly story

**As an authorized internal platform service, we want bounded read-only gRPC access to current and historical IoT data, so that the API Gateway and other trusted internal callers can consume telemetry without direct access to Redis or TimescaleDB.**

## Main outcome

By the end of Week 3, the ingestion process should also run the production-oriented gRPC query server, backed by the storage-neutral query service, with validation, pagination, authorization hooks, error mapping, health behavior, and generated-client interoperability tests.

## Work items

### 1. Pin and consume the `iot/v1` SDK contract

Use the versioned protobuf contract from the organization protobuf repository and consume a pinned generated Go SDK release.

Implement the v1 methods:

- `GetLatestReading`
- `ListHistoricalReadings`
- `GetHouseStatus`

Do not add live browser subscriptions or an unbounded grid-summary query in this phase.

### 2. Query application service

Implement storage-neutral query use cases for:

- latest reading;
- historical readings;
- house status.

Keep Redis/Postgres details out of transport handlers.

### 3. Latest-state query behavior

`GetLatestReading` should:

- validate and authorize grid/house scope;
- read from Redis first;
- optionally perform one bounded TimescaleDB fallback on cache miss according to policy;
- optionally repair Redis after fallback;
- distinguish an unknown house from a temporarily unavailable dependency.

### 4. Historical query behavior

`ListHistoricalReadings` should:

- require UTC `[start_time, end_time)` semantics;
- validate `start < end`;
- enforce configured maximum query span;
- use a bounded default and hard maximum `page_size`;
- use keyset pagination rather than offset pagination;
- use opaque, versioned, integrity-protected page tokens;
- enforce row and serialized-response-size limits;
- execute parameterized queries with context deadlines.

### 5. House-liveness query

`GetHouseStatus` should derive online/offline status from `last_heartbeat_at` and the configured liveness threshold.

An expired/missing Redis status key may indicate an offline known house, but must not automatically mean the house does not exist.

### 6. gRPC middleware and error mapping

Add ordered unary interceptors for:

- panic recovery;
- request and trace context;
- authentication;
- authorization;
- validation;
- concurrency/rate limits;
- metrics;
- safe logging.

Map application errors into stable gRPC statuses such as:

- `INVALID_ARGUMENT`
- `UNAUTHENTICATED`
- `PERMISSION_DENIED`
- `NOT_FOUND`
- `DEADLINE_EXCEEDED`
- `RESOURCE_EXHAUSTED`
- `UNAVAILABLE`
- `INTERNAL`

Never expose SQL, Redis keys, stack traces, topology, or raw dependency errors.

### 7. gRPC lifecycle and health

Run Kafka ingestion, gRPC, and HTTP health under one application lifecycle.

Add standard gRPC health reporting.

On shutdown:

1. mark readiness false;
2. mark gRPC health `NOT_SERVING`;
3. stop new Kafka polling;
4. drain in-flight work and RPCs within the shutdown deadline;
5. commit only contiguous completed Kafka offsets;
6. gracefully stop gRPC, then force-stop only if the deadline expires;
7. close dependency clients.

### 8. Integration and contract tests

Using pinned `testcontainers-go` dependencies, verify:

- TimescaleDB migrations and constraints;
- Redis Lua behavior;
- registry refresh behavior;
- Kafka restart/replay;
- group rebalance with work in flight;
- dependency recovery;
- gRPC behavior against real Redis and TimescaleDB;
- generated Go client interoperability;
- generated TypeScript client interoperability from the API Gateway side;
- deadlines, authorization, pagination, message limits, health, and shutdown.

## Acceptance criteria

- The service exposes all three planned v1 unary query methods.
- Generated protobuf types exist only at the transport boundary.
- Latest reads use Redis with a bounded durable fallback policy.
- Historical reads are range-limited and keyset-paginated.
- Page tokens are opaque and reject tampering.
- gRPC error statuses are stable and do not leak dependency details.
- Authorization is checked before storage access.
- Client/server deadlines and cancellation propagate to Redis/Postgres.
- gRPC health changes correctly during startup, dependency degradation according to policy, and shutdown.
- Go and TypeScript generated clients pass contract smoke tests.
- Integration tests run against the pinned real dependency versions.

## End-of-week demo

Run the simulator-to-Kafka ingestion flow and then query the stored data through the generated gRPC client. Demonstrate latest reading, paginated historical readings, online/offline house status, invalid request handling, permission denial, a cache-miss fallback, and graceful server shutdown.

---

# Week 4 - Testing, Observability, Security, Performance, and Release Readiness

## Weekly story

**As the platform operations team, we want the IoT ingestion service to be measurable, secure, recoverable, capacity-tested, and safely deployable, so that the service can move from functional implementation to an evidence-based production release decision.**

## Main outcome

By the end of Week 4, the service should have CI-enforced tests, operational metrics and logs, production configuration controls, security boundaries, recovery procedures, load-test evidence, container/release hardening, and an explicit decision record for any remaining release blockers.

## Work items

### 1. Complete the automated test pyramid

Finish and enforce the documented test tiers.

#### Tier 1 - Unit tests

Cover:

- JSON-to-domain mappings and invalid boundaries;
- identifier and numeric validation;
- transient/permanent failure classification;
- unknown-grid admission;
- registry snapshot replacement;
- Redis newest-reading comparison;
- replay/conflict decisions;
- gRPC status mapping and authorization;
- pagination-token validation/tamper detection;
- decoder and token fuzz tests;
- race-detector execution in CI.

#### Tier 2 - Application workflow tests

Cover:

- startup gating;
- last-known-good registry refresh;
- Postgres-before-Redis ordering;
- partial-success boundaries;
- no premature offset commit;
- failure-recorder outage;
- partition revocation;
- cancellation;
- bounded concurrency;
- graceful drain.

#### Tier 3 - Integration and contract tests

Run the exact pinned Kafka, TimescaleDB, and Redis versions and verify migrations, transactions, Lua scripts, retries/replay, rebalances, dependency recovery, gRPC contract behavior, and shutdown.

#### Tier 4 - End-to-end and resilience tests

Exercise:

`Simulator -> MQTT -> Kafka Connect -> Kafka -> IoT Ingestion -> TimescaleDB/Redis -> gRPC`

Add controlled process kills and Kafka/Redis/Postgres interruptions.

#### Tier 5 - Performance and capacity tests

Measure the expected workload plus agreed headroom, including:

- sustainable records/second;
- consumer lag and catch-up time;
- DB/Redis saturation;
- p95/p99 ingest-to-query visibility;
- gRPC latency;
- memory and goroutine growth;
- connection counts;
- shutdown duration.

### 2. Observability

Implement structured `slog`, OpenTelemetry-compatible tracing, and Prometheus metrics.

At minimum record:

- consumed, processed, and failed records by safe stage/topic;
- consumer lag and rebalances;
- processing and commit latency;
- durable-write and query-visibility latency;
- Postgres/Redis errors, latency, pool usage, and retries;
- unresolved failure count and age;
- registry refresh status and last-success age;
- gRPC count/status/latency/in-flight/rejected calls;
- response rows/bytes;
- process CPU, memory, goroutines, file descriptors, restarts, and shutdown duration.

Do not use high-cardinality metric labels such as raw house, grid, meter, asset, request, or Kafka-key values.

<!-- ### 3. Alerts and runbooks

Create alert definitions and runbooks for at least:

- sustained consumer lag growth;
- no successful durable writes;
- exhausted DB connections;
- stale grid registry;
- failure-table surge;
- repeated crash loops;
- dependency outages;
- Redis rebuild;
- controlled failure replay;
- stuck migration recovery;
- lag catch-up;
- credential rotation.

Each alert should have an owner, severity, threshold/window, and linked runbook.

### 4. Security hardening

Apply production controls for:

- least-privilege migration/runtime DB identities;
- restricted Kafka topics/group access;
- restricted Redis key access;
- gRPC caller allowlisting;
- TLS or authenticated service-mesh mTLS for production dependency traffic;
- network policy/firewall restrictions;
- input size limits and bounded concurrency;
- dependency/container vulnerability scanning;
- secret scanning;
- SBOM generation;
- non-root runtime image;
- secret redaction in logs.

Document the unresolved production device-enrollment and identity-binding requirement instead of treating payload IDs as authentication.

### 5. Deployment and shutdown validation

Build a pinned multi-stage container image with a minimal non-root runtime.

Validate rollout order:

1. migrations;
2. compatible SDK/contract;
3. ingestion replicas;
4. callers.

Test canary rollout signals and graceful termination behavior.

Use at least two replicas when the availability target requires it, subject to Kafka partition and capacity-test evidence.

### 6. Data protection and recovery

Document and test:

- TimescaleDB backup and point-in-time recovery process;
- an actual restore drill;
- Redis rebuild/reconciliation process and expected duration;
- Kafka retention sufficient for expected outage/replay windows;
- telemetry/failure retention expectations;
- RPO/RTO decisions once owners approve them. -->

### 3. Close or explicitly carry the release blockers

Before declaring the service production-ready, obtain named owners and accepted values for:

1. Redis acknowledgement/failure policy.
2. Final simulator JSON schema, validation ranges, clock-skew rules, and heartbeat asset snapshot semantics.
3. Kafka partition/replication/retention settings and verified connector key behavior.
4. Pinned TimescaleDB version and matching retention/columnstore migration syntax.
5. gRPC caller identity and per-grid/house authorization model.
6. Query limits and SLOs.
7. Capacity assumptions and deployment topology.
8. Backup RPO/RTO and retention decisions.
9. Production device enrollment and MQTT identity binding.

If any remain unresolved, record them as explicit release blockers rather than silently choosing values in code.

## Acceptance criteria

- CI runs formatting, static analysis, unit tests with race detection, migration tests, integration/contract tests, dependency/vulnerability checks, and container build.
- End-to-end tests prove simulator payloads reach durable storage and are visible through gRPC.
- Resilience tests cover dependency interruption and process restart.
- Load tests produce measurable capacity and latency results.
- Required metrics, traces, logs, dashboards, and alerts exist.
- High-cardinality IDs are not used as metrics labels.
- Production secrets are not committed or logged.
- Runtime/container runs as non-root.
- Backup restore and Redis rebuild are exercised, not just documented.
- Graceful shutdown does not commit unfinished Kafka work.
- Release-blocking decisions have owners and accepted values, or the release remains explicitly blocked.

<!-- ## End-of-week demo

Run the full end-to-end flow under load, show dashboards and alert signals, interrupt Redis/Postgres/Kafka in controlled scenarios, demonstrate recovery/replay behavior, perform a graceful deployment shutdown, run the release CI pipeline, and present the final production-readiness checklist with any unresolved blockers clearly identified. -->

---

# Four-week delivery summary

| Week | Story | Primary deliverable |
|---|---|---|
| **Week 1** | Build the service foundation and storage/admission layer | Runnable Go service, migrations, TimescaleDB schema, Redis adapters, grid registry, health/readiness |
| **Week 2** | Make ingestion reliable | Kafka meter-reading + heartbeat workflows, replay-safe storage, retry/failure handling, explicit commits |
| **Week 3** | Make IoT data consumable internally | Production-oriented read-only gRPC API, pagination, auth hooks, contract/integration tests |
| **Week 4** | Make the service release-ready | Full test pyramid, observability, security, recovery, load testing, CI, release gate |
