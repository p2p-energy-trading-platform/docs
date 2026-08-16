---
connie-title: IoT Ingestion - Testing Strategy
---


## Testing strategy

Four tiers, mirroring the IoT Simulator's own testing discipline (161 tests, CI-enforced) adapted for a service whose real dependencies are Kafka/Redis/Postgres rather than pure computation.

**Tier 1 - Unit tests.** No containers, no network, milliseconds each. Table-driven, using `testify/require`. For the current ingestion path, covers JSON→domain mapping for every `device_class`/`asset_type` value plus at least one invalid one, the missing-`storage_assets` case, the transient-vs-permanent error classifier from section 3.3, unknown grids as permanent validation failures, and atomic grid-registry snapshot replacement. Protobuf/domain mapping tests belong to the future internal gRPC boundary when that interface is implemented.

**Tier 2 - Mocked-dependency tests.** Still no containers - these test *control flow*, not whether Redis/Postgres itself behaves correctly. Define narrow interfaces (`HotStore`, `WarmStore`, `GridLoader`) that real clients implement in production and fakes implement in tests. Answers questions like: does Kafka consumption remain stopped until the initial grid snapshot loads? Does a failed runtime refresh preserve the last known-good snapshot? Does an unknown grid skip all registry, telemetry, and Redis writes and go straight to `ingestion_failures` without querying Postgres? Does the offset remain uncommitted until either normal processing succeeds or the failure is durably recorded?

**Tier 3 - Integration tests via `testcontainers-go`.** Real, ephemeral containers spun up per test run: `testcontainers-go/modules/kafka` (KRaft-mode), `testcontainers-go/modules/postgres` (works against a `timescale/timescaledb` image too, since it's still Postgres underneath), `testcontainers-go/modules/redis`. Answers: do goose migrations apply clean on a fresh schema? Does startup bootstrap load the seeded grids before consumption begins? Does inserting a new grid become visible after a runtime refresh without restarting the service? Does a refresh failure retain the old snapshot? Is the `meter_readings` upsert genuinely idempotent (write the same `house_id`/`time`/`seq` twice, assert exactly one row)? Does a second heartbeat for a known house update only `last_heartbeat_at`, not `device_class`? Are unknown-grid meter readings and heartbeats quarantined without creating a grid or writing to Redis? Is a known house rejected if a heartbeat reports it under a different grid?

**Tier 4 - Manual, one-time, end-to-end.** Real simulator, real Kafka Connect, real this-service, actually pointed at each other. This is where section 13's still-open live-verification item gets closed for good - no amount of testcontainers substitutes for checking the actual seam between this service and the real upstream pipeline.

**CI note for whoever sets up the pipeline (team member, per section 12):** Tier 3 needs Docker available on the runner. GitHub's default `ubuntu-latest` runners have it preinstalled, so this is usually a non-issue, but worth confirming before debugging a mysteriously failing pipeline.