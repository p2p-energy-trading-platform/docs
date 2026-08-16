---
connie-title: IoT Ingestion - Testing Strategy
---


# Testing strategy

Four tiers, mirroring the IoT Simulator's own testing discipline (161 tests, CI-enforced) adapted for a service whose real dependencies are Kafka/Redis/Postgres rather than pure computation.

**Tier 1 - Unit tests.** No containers, no network, milliseconds each. Table-driven, using `testify/require`. Cover JSON-to-domain mapping for every supported version and invalid boundary, size/range/time validation, transient-vs-permanent classification, unknown-grid admission, immutable snapshot replacement, Redis newest-reading comparison, replay/conflict decisions, gRPC mapping/statuses, authorization, and pagination-token tamper detection. Fuzz the JSON decoder, identifier validation, and page-token decoder. Run unit tests with `-race` in CI.

**Tier 2 - Application workflow tests.** Still no containers: use narrow fakes to test exact call order and failure behavior. Cover startup gating; last-known-good registry refresh; Postgres-before-Redis ordering; every partial-success boundary; no offset commit before completion; permanent-failure recording; failure-recorder outage; revoked partitions; cancellation; bounded concurrency; and graceful drain. Avoid mock assertions on implementation trivia.

**Tier 3 - Integration and contract tests via `testcontainers-go`.** Run the exact pinned Kafka, TimescaleDB, and Redis versions used in deployment. Test clean and previous-version migration upgrades, constraints, transactional parent/asset writes, immutable duplicate handling, Redis Lua atomicity/newest-wins behavior, six-month retention policy registration, registry refresh, unknown-grid quarantine, asset/house identity conflicts, consumer restart/replay, group rebalance while work is active, dependency recovery, and committed contiguous offsets. Start the real gRPC server and call it with generated Go and TypeScript clients; verify deadlines, status codes, authorization, pagination, message limits, health state, and shutdown.

**Tier 4 - Automated end-to-end and resilience checks.** Exercise the real simulator, MQTT broker, both Kafka Connect connectors, ingestion service, stores, and gRPC query API. Assert payload values, keys, partitions, ordering, query visibility, and duplicate behavior. Add controlled process kills and Redis/Postgres/Kafka interruptions. A short smoke path runs on release candidates; longer soak and chaos scenarios run on schedule or before production changes.

**Tier 5 - Performance and capacity tests.** Establish a workload model (houses, 5-second tick rate, heartbeat rate, payload/asset distribution, partitions, query concurrency) and test at expected peak plus agreed headroom. Record sustainable records/second, consumer lag/recovery time, DB/Redis saturation, p95/p99 ingest-to-query visibility, gRPC latency, memory, goroutines, connections, and shutdown time. A release fails when agreed thresholds regress beyond tolerance.

CI needs Docker for integration tests and must pin container images by version (preferably digest for releases). Test output should retain logs and metrics on failure without leaking secrets or full telemetry payloads. Flaky tests are quarantined only with an owner and expiry; they never become permanently ignored release gates.
