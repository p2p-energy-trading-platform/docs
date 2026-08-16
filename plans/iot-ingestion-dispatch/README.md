---
connie-title: IoT Ingestion Service Plan
---

# IoT Ingestion & Dispatch Service - Plan

* **Author:** Hanan (M.S.H. Ahmed)
* **Scope:** IoT Ingestion Service (primary focus) + Dispatch Service (documented, not implemented yet) + gRPC query interface (documented, not implemented yet)
* **Stack:** Go
* **Status:** Draft v4 - revised per team member review and final pre-development pass (fixed a stale diagram contradiction, an unwired schema field, a missing proto field, and made several assumptions explicit - see inline "Correction:" notes)

---

## 1. What this service does

The IoT Ingestion Service is the receiving end of the telemetry pipeline. The IoT Simulator publishes readings over MQTT; a separate MQTT-to-Kafka bridge (built by a teammate) pushes those messages into Kafka. This service's job starts from there: **consume every message from Kafka, and persist it into the right storage tier so the rest of the platform can actually use it.**

Two storage tiers are in scope right now:

- **Redis (hot storage)** - the latest known state of every house/meter, for fast reads by anything that needs "what's happening right now" (e.g. a live dashboard).
- **TimescaleDB (warm storage)** - the full historical record, structured for time-range queries and analytics (e.g. "show me house0042's net_kw over the last 24 hours").

**Cold storage** (long-term archival, e.g. object storage) is explicitly **out of scope for now**. The warm storage design should not make cold storage harder to add later, but nothing needs to be built for it yet.

This service also owns two components that are **documented in this plan but not implemented yet**:

- **Dispatch Service** - the piece that eventually turns a trading decision into a real actuation command sent back down to the IoT Simulator over MQTT.
- **gRPC query interface** - an internal API other services can use to query hot/warm data without needing their own Kafka consumer or direct DB access.

---

## 2. Where this sits in the platform

```text
IoT Simulator --MQTT--> Kafka Connect (Confluent MQTT Source Connector) --Kafka--> IoT Ingestion Service
                                                                                            |
                                                                              +-------------+-------------+
                                                                              |                           |
                                                                           Redis                     TimescaleDB
                                                                        (hot storage)              (warm storage)
                                                                              |                           |
                                                                              +-------------+-------------+
                                                                                            |
                                                                                    gRPC query API
                                                                              (future - other platform services read here)


Order Service --(gRPC call, based on user preferences - see section 7)--> Dispatch Service --MQTT actuation topic--> IoT Simulator
```

**Confirmed from `gridx-infra`:** the MQTT-to-Kafka bridge is not custom code - it's a `kafka-connect` container running the Confluent `MqttSourceConnector` (a standard, off-the-shelf Kafka Connect plugin).

> ✅ **Topic mismatch resolved.** The connector has been split into two files, `mqtt-connector-meter.json` (`mqtt.topics: gridx/+/+/meter` → `kafka.topic: iot.meter-readings`) and `mqtt-connector-heartbeat.json` (`mqtt.topics: gridx/+/+/heartbeat` → `kafka.topic: iot.heartbeats`). Both patterns correctly match what the IoT Simulator actually publishes, confirmed directly against the simulator's `topics.ts` and `tickLoop.ts`.

**One important design rule carried over from the IoT Simulator's own plan:** the simulator only ever talks to the outside world through MQTT. It never talks to Kafka, Redis, TimescaleDB, or this service directly. This service is downstream of the simulator - it observes and stores, it doesn't reach back except through the Dispatch Service's actuation path, which itself only ever talks back to the simulator over MQTT (the exact same `gridx/actuation` topic the simulator already listens on).

## Tech stack

- **Language:** Go
- **Kafka client:** [`franz-go`](https://github.com/twmb/franz-go) (`github.com/twmb/franz-go`). Pure Go, no cgo dependency (unlike `confluent-kafka-go`, which wraps `librdkafka` and drags a C toolchain into the Docker build). Chosen over `segmentio/kafka-go` for more active maintenance and a more complete feature set. **Honesty note:** the specific claim that `kafka-go` lacks cross-partition produce batching (a throughput ceiling `franz-go` doesn't share) came from research earlier in this planning process, not independently re-verified in this pass - worth a quick confirm against each library's current docs before treating it as fully settled, since this kind of detail can shift between library versions. The broader "pure Go, more actively maintained" reasoning is on firmer ground and less likely to have changed. The trade-off either way is a slightly steeper initial learning curve, closer to the raw Kafka protocol than `kafka-go`'s thinner abstraction - a one-time cost with solid documentation available.
- **Message types:** `go-sdk` (org repo) - proto-generated Go types, installed as a Go module dependency. A new `iot/v1` package needs authoring first - see section 3.2.
- **Retry/backoff:** [`cenkalti/backoff/v5`](https://github.com/cenkalti/backoff) - see section 3.3 for the transient-vs-permanent failure handling pattern.
- **Redis client:** `go-redis`, connecting to `gridx-redis:6379`.
- **TimescaleDB/Postgres client:** `pgx`, using `IOT_SERVICE_USER`/`IOT_SERVICE_PASSWORD` and scoped to `iot_data` only. From another container on the Compose network it connects to `gridx-timescaledb:5432`; a process running directly on the host uses the published endpoint `localhost:5433`. Both endpoints belong in runtime configuration rather than application code.
- **Migrations:** `pressly/goose` - see section 6.3.
- **Testing:** `testify` (assertions) for unit and mocked-dependency tests; `testcontainers-go` (`modules/kafka`, `modules/postgres`, `modules/redis`) for integration tests - see section 10.
- **Logging:** stdlib `log/slog` - sufficient for a service this size, no reason to pull in a third-party logger.
- **gRPC (future):** protobuf-defined service, not implemented yet

---

## Plan documents

| Document | Purpose |
|---|---|
| [01-kafka-consumeption.md](01-kafka-consumeption.md) | Kafka consumption and handling |
| [02-redis-hot-storage.md](02-redis-hot-storage.md) | Redis hot storage key design and TTLs |
| [03-timescaledb-schema.md](03-timescaledb-schema.md) | TimescaleDB schema, hypertables and migrations |
| [04-heartbeat-device-discovery.md](04-heartbeat-device-discovery.md) | Heartbeat handling and device discovery flow |
| [05-dispatch-service.md](05-dispatch-service.md) | Dispatch Service design and MQTT actuation flow |
| [06-configuration-and-secrets.md](06-configuration-and-secrets.md) | Configuration, secrets, and runtime env management |
| [07-testing-and-ci.md](07-testing-and-ci.md) | Unit, integration tests and CI pipeline strategy |
| [08-observability-and-monitoring.md](08-observability-and-monitoring.md) | Logging, metrics, tracing, and alerting plan |
| [09-security-and-access-control.md](09-security-and-access-control.md) | Security, authz, and database access controls |
| [10-deployment-and-operations.md](10-deployment-and-operations.md) | Deployment, runbooks, and operational playbooks |


---

## Things we still need to decide as a team

**Resolved from `gridx-infra`'s bootstrap scripts, docker-compose, and connector config (no longer open):**

- ~~Kafka container/port~~ - confirmed `gridx-kafka:9092` (external), `kafka:29092` (internal)
- ~~TimescaleDB container/port~~ - confirmed Compose endpoint `gridx-timescaledb:5432`; host endpoint `localhost:5433`
- ~~Schema ownership~~ - confirmed `iot_data`, owned by `IOT_SERVICE_USER`
- ~~Which DB instance hosts what~~ - confirmed `gridx-postgres` is Auth/Orders/Billing/Notifications only; all IoT data lives in `iot_data` on `gridx-timescaledb`
- ~~Bridge implementation~~ - confirmed: Kafka Connect running Confluent's `MqttSourceConnector`
- ~~Kafka Connect topic mismatch~~ - **fixed**, see section 2
- ~~Exact Kafka topic names~~ - confirmed: `iot.meter-readings` and `iot.heartbeats`

**Resolved by team member (no longer open):**

- ~~Kafka ingestion wire format~~ - confirmed JSON bytes forwarded unchanged from MQTT through Kafka Connect; protobuf is reserved for future internal service contracts (section 3.1)
- ~~Meter readings vs heartbeats sharing one Kafka topic~~ - confirmed split into two, implemented (section 2)
- ~~`iot_data` table design approach~~ - confirmed: hypertables + plain tables split
- ~~Heartbeat storage~~ - confirmed: no historical hypertable, only `last_heartbeat_at` updates
- ~~Redis TTL for `house:{house_id}:status`~~ - confirmed: 10 minutes
- ~~Redis key types~~ - confirmed and documented in section 4
- ~~Heartbeat device-discovery flow~~ - confirmed and documented in section 5
- ~~Hypertable retention~~ - confirmed: 6 months
- ~~Migration tooling~~ - confirmed: `goose` (section 6.3)
- ~~ER diagram~~ - to be produced manually by team member from section 6's table definitions
- ~~Dispatch Service trigger mechanism~~ - rough direction confirmed, flagged "not properly planned," treat as tentative

**Resolved during final pre-development review (this pass):**

- ~~Grid lat/lon has no data source~~ - resolved via explicit provisioning migrations; unknown-grid telemetry is quarantined and never creates grids (sections 3.3 and 6.4)
- ~~Per-message grid validation database load~~ - resolved via fail-closed startup bootstrap plus periodic atomic in-memory snapshot refresh (sections 6.5 and 6.6)
- ~~Dead-letter / poison-message strategy~~ - resolved: two-tier retry via `cenkalti/backoff/v5` + `ingestion_failures` table (section 3.3)
- ~~Testing strategy~~ - resolved: four-tier plan (section 10)
- ~~Kafka client library~~ - resolved: `franz-go` (section 9)
- ~~Consumer group structure~~ - resolved: single group, both topics, topic-based dispatch (section 3)
- ~~Partitioning design~~ - ordering is required separately within each Kafka topic; the connector's documented topic-as-key behavior should satisfy per-house ordering within each stream without extra config. The actual keys and partitions still need live verification (see below).

**Still open:**

- **Whether the new connector configs are actually registered with Kafka Connect and verified against live simulator traffic** - files exist and topic patterns match on paper, but end-to-end verification is still pending (section 13).
- **Whether the topic-as-key partitioning assumption actually holds live** - plausible per documentation, worth confirming once traffic is flowing.
- **Compression policy** - proposed in section 6.2 but not yet confirmed by the team, unlike retention.
- The Order Service / Dispatch Service gRPC interaction (section 7, 8.2) - explicitly not properly planned yet.
- **CI/CD pipeline and final repo structure** - to be set up by the team member once this plan is confirmed.

---

## Note on the Kafka Connect connector setup

**Status: topic pattern and JSON payload handling are settled; live end-to-end verification remains before this is fully closed out.**

- ~~File(s) to change~~ - done: replaced by `mqtt-connector-meter.json` and `mqtt-connector-heartbeat.json`.
- ~~Registration script~~ - confirmed: `scripts/register-connectors.sh` correctly references both new files and POSTs each to the Kafka Connect REST API. Must be run manually after `docker compose up -d` - it does not run automatically.
- **No protobuf-related connector change is needed:** the connector continues forwarding the simulator's JSON payload bytes unchanged. Protobuf is introduced only at future internal service boundaries (section 3.1).
- **Not yet confirmed:** live, end-to-end verification - run the IoT Simulator, confirm both connectors are running via Kafka Connect's REST API or `scripts/health-check.sh`, consume sample records from `iot.meter-readings` and `iot.heartbeats`, and verify their JSON values, record keys, and partitions.
