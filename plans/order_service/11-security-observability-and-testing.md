---
connie-title: Order Service Security, Observability and Testing
---

Security, Observability and Testing
===================================

Purpose
-------

This document defines the security controls, operational visibility, and verification strategy for the Order Service. It consolidates the requirements stated in the other order documents into one plan, so that every rule has a control, a signal, and a test.

Tests verify implemented behaviour and agreed contracts. A feature whose dependency does not exist yet (the wallet, parts of the Matching Engine) is tested against a fake and is reported as blocked, never as passing against the real dependency.

Verified Conventions
--------------------

| Area | Existing convention | Source |
|---|---|---|
| Metrics | Prometheus. The namespace is the service name, so a metric `records_total` in namespace `iot_ingestion` is `iot_ingestion_records_total`. | `iot-ingestion-dispatch` |
| Logging | `log/slog`, JSON handler in production, text for development. | `internal/observability/logging.go` |
| Tracing | OpenTelemetry over OTLP/gRPC. An empty endpoint disables tracing. | `internal/observability/tracing.go` |
| Health | HTTP `GET /healthz` and `GET /readyz`, plus metrics. | `internal/transport/httphealth` |
| CI | Format check, `go mod verify`, `go vet`, `golangci-lint`, tests, tests with `-race`, short fuzzing of decoders, `govulncheck`, and an integration job using service containers and the migration runner. | `.github/workflows/ci.yml` |
| Runbooks | `docs/runbooks` (consumer lag, dependency outage, failure replay, and others). | `iot-ingestion-dispatch` |
| Monitoring stack | **None in `gridx-infra`.** No Prometheus, Grafana, alerting, or trace collector is provisioned. | `gridx-infra` |

The Order Service follows these conventions. The metric namespace is `order`.

Security
--------

### Trust boundaries

| Boundary | Control |
|---|---|
| Client to gateway | TLS, token authentication, CORS, CSRF Origin check for cookie sessions, rate limits, strict request schemas, body size limit |
| Gateway to Order Service | Network-level restriction to the gateway only. Identity is forwarded as `owner_user_id` and `x-gridx-user-id`, and the Order Service requires them to match. |
| Order Service to IoT, Auth, Billing | Internal network only. IoT has no authentication of its own, so access is restricted at the network level and every call sends a non-empty owner. |
| Order Service to PostgreSQL | A dedicated role that owns only `order_management_data`, with no superuser rights |
| Order Service and Matching Engine to Kafka | TLS and SASL outside development, with topic ACLs (below) |

The Order Service must never be reachable from outside the platform network.

### Identity, authorization, and ownership

- Identity comes only from the gateway. A user ID in an order payload is never trusted, and the request field and the metadata must agree, otherwise the call fails `UNAUTHENTICATED`.
- Creating an order requires the `trade:create` permission, checked through Auth. A failure to reach Auth fails closed.
- Every read and cancel checks ownership. A non-owner sees `NOT_FOUND`, so order IDs cannot be probed.
- There is no administrative bypass in v1. Operator corrections are applied by an authorised person as audited `SYSTEM` history entries, not through the API.

### Input and abuse controls

- Strict schemas at the gateway, authoritative validation in the Order Service, and parameterised SQL only (string-built SQL is banned by a lint rule).
- Idempotency keys are limited to `[A-Za-z0-9_-]{8,64}`. Quantities, prices, and slots are bounded.
- Rate limits at the gateway (initially 30 writes and 120 reads per minute per user) and a 4 KB body limit.
- Every external call has a deadline, and no transaction is held open across one.
- Whether to cap the number of open orders per user is an open product question (T-O5). The rate limit is the control in v1.

### Data protection and logging

- The Order Service stores a user UUID and order data. It stores no names, emails, tokens, or credentials.
- Logs never contain access tokens, secrets, request bodies, or full Kafka payloads. The idempotency key is logged only as a short hash. Error messages to clients never expose internals.
- Dead-letter rows and the outbox hold message payloads. They are internal data, readable only by operators, and dead letters are removed 90 days after resolution.
- Secrets come from the environment or a secret store, never from the repository. Startup fails if a required value is missing or invalid. `.env.example` holds placeholders only.

### Financial and energy integrity

- Database constraints reject impossible states even if the code has a bug (status and quantity rules, positive values, slot rules, allocation bounds).
- Status history is append-only, enforced by a trigger.
- Every state change after the engine has acted is explained by a stored event ID and sequence number.
- Overselling is prevented by the atomic allocation update, and duplicates by the unique idempotency key.

### Kafka access

| Principal | May produce | May consume |
|---|---|---|
| Order Service | `gridx.orders.v1`, `gridx.orders.recovery.snapshots.v1` | `gridx.orders.updates.v1`, `gridx.orders.recovery.requests.v1` |
| Matching Engine | `gridx.orders.updates.v1`, `gridx.trades.v1`, `gridx.orders.recovery.requests.v1` (transactional ID `matching-engine-1`) | `gridx.orders.v1`, `gridx.orders.recovery.snapshots.v1`, the grid transfer rules topic |
| Billing | none | `gridx.orders.updates.v1`, `gridx.trades.v1` |
| Notification, Market Data | none | `gridx.orders.updates.v1`, `gridx.trades.v1` |

Each consumer has its own group, and the engine has a transactional ID ACL.

### Threats and controls

| Threat | Control |
|---|---|
| Spoofed or swapped identity | Gateway token check, request and metadata must match, network restriction |
| Reading or cancelling someone else's order | Ownership check, `NOT_FOUND` for non-owners |
| Overselling energy | Atomic allocation, unique idempotency key |
| Duplicate order from a retry | Idempotency key and fingerprint |
| Replayed or duplicated Kafka messages | `event_id` deduplication, `order_seq`, engine deduplication |
| Tampered or malformed message | Schema decoding, contract validation, dead letter |
| Poison message blocking a partition | Dead-letter then commit, never skip silently |
| Flooding the book or API | Gateway rate limits, request limits |
| Information leakage through errors | Generic 5xx messages, stable codes only, redacted logs |
| Stale or wrong data restored to the engine after a crash | Exactly-once engine output, drain check, refusal on unreconciled orders |
| Unfunded BUY orders in production | `BUY_RESERVATION_MODE` defaults to `blocked`, startup refuses `disabled` in production |
| Dependency compromise | `go mod verify`, `govulncheck`, pinned images |

Observability
-------------

### Metrics

All metrics use the namespace `order`. Labels are low-cardinality (RPC name, result, reason, stage, kind). Order IDs, user IDs, and event IDs are never labels. Gauges for ages and backlogs are computed by a periodic collector querying PostgreSQL.

| Group | Metric | Type and labels |
|---|---|---|
| API | `order_grpc_requests_total` | counter: `rpc`, `code`, `reason` |
| | `order_grpc_request_duration_seconds` | histogram: `rpc` |
| | `order_orders_created_total` | counter: `side`, `type`, `result` |
| | `order_idempotent_replays_total`, `order_idempotency_conflicts_total` | counters |
| Dependencies | `order_iot_call_duration_seconds` | histogram: `rpc`, `code` |
| | `order_auth_check_duration_seconds`, `order_billing_call_duration_seconds` | histograms (`code`, and `rpc` for Billing) |
| SELL validation | `order_sell_validation_rejections_total` | counter: `reason` |
| Allocation | `order_energy_allocated_wh`, `order_ledger_drift_total` | gauge, counter |
| Database | `order_db_tx_retries_total` | counter: `kind` (`deadlock`, `serialization`) |
| Outbox | `order_outbox_backlog`, `order_outbox_oldest_unpublished_seconds` | gauges |
| | `order_outbox_publish_attempts_total` | counter: `result` |
| Updates consumer | `order_updates_consumer_lag` | gauge |
| | `order_updates_applied_total` | counter: `transition` |
| | `order_updates_ignored_total` | counter: `kind` (`duplicate`, `stale`, `echo`) |
| | `order_updates_quarantined_total`, `order_dead_letters_pending` | counter, gauge: `stage` |
| | `order_update_apply_duration_seconds` | histogram |
| Lifecycle | `order_pending_age_seconds`, `order_cancel_pending_age_seconds` | gauges (oldest) |
| | `order_me_ack_latency_seconds` | histogram |
| | `order_cancel_requests_total` | counter: `result` |
| | `order_orders_needing_reconciliation` | gauge |
| | `order_expiry_reconciled_total`, `order_expiry_superseded_total` | counters |
| BUY readiness | `order_unfunded_buy_total` | counter |
| Recovery | `order_recovery_requests_total`, `order_recovery_snapshot_orders` | counter (`result`), gauge |

The engine exposes its own `me_*` recovery metrics (recovery document).

### Logs

Structured JSON through `slog`. Each line carries only what is needed to correlate work:

| Field | When |
|---|---|
| `ts`, `level`, `msg`, `service` | Always |
| `request_id`, `correlation_id`, `trace_id` | Requests and background work started by a request |
| `rpc` | gRPC handlers |
| `order_id` | Once known |
| `event_id`, `command_id`, `me_seq` | Kafka work |
| `stage`, `reason`, `code` | Quarantine and errors |
| `idempotency_key_hash` | Create, replay, conflict |
| `duration_ms` | Calls and transactions |

Levels: `INFO` for lifecycle transitions and recovery steps, `WARN` for quarantined events, conflicts, and fallbacks, `ERROR` for unexpected failures. Payload bodies and secrets are never logged.

### Tracing

OpenTelemetry over OTLP/gRPC. An empty endpoint disables it, as in the IoT service. The W3C `traceparent` travels in gRPC metadata and in Kafka record headers, so one trace spans gateway, Order Service, Kafka, and engine.

Spans: `CreateOrder` with children for the permission check, each IoT call, Billing, and the database transaction; `outbox.publish`; and `consumer.apply` linked to the publishing span.

### Health

| Endpoint | Meaning |
|---|---|
| `GET /healthz` | The process is alive |
| `GET /readyz` | PostgreSQL reachable, migration version equals the embedded version, Kafka producer and consumer connected |
| `GET /metrics` | Prometheus metrics |

Readiness does **not** depend on IoT, Auth, Billing, or the Matching Engine. Their failures affect individual requests, not whether the service can take traffic.

### Alerts

Severity: **page** needs a person now, **ticket** is handled in working hours. Thresholds are initial values to be tuned from measured behaviour.

| Condition | Severity | Runbook |
|---|---|---|
| Any `PENDING` order older than 30 s | ticket (page if more than 20 orders or older than 5 min) | `pending-orders.md` |
| Any `CANCEL_PENDING` order older than 30 s | ticket | `pending-orders.md` |
| Oldest unpublished outbox row older than 30 s, or backlog above 1000 | page | `outbox-backlog.md` |
| Updates consumer lag above 100 for 1 minute | page | `consumer-lag.md` |
| Any pending dead letter | ticket | `dead-letters.md` |
| Any order needing reconciliation | ticket | `dead-letters.md` |
| Ledger drift above 0 | page | `ledger-drift.md` |
| Expiry fallback applied | ticket | `expiry-reconciliation.md` |
| IoT, Auth, or Billing error rate above 5 percent for 5 minutes | ticket | `dependency-outage.md` |
| Database transaction retries rising | ticket | `dependency-outage.md` |
| Engine out of service for more than 2 minutes | page | `engine-recovery.md` |
| Recovery refused for unreconciled orders | page | `engine-recovery.md` |
| Unfunded BUY in `production` | page | `buy-mode.md` |
| Readiness failing | page | `dependency-outage.md` |

Alert rules are kept in the repository (`deploy/alerts`) as Prometheus rule files, so they can be loaded once a monitoring stack exists.

### Runbooks

`docs/runbooks` contains: `outbox-backlog.md`, `pending-orders.md`, `dead-letters.md`, `expiry-reconciliation.md`, `dependency-outage.md`, `consumer-lag.md`, `engine-recovery.md`, `ledger-drift.md`, and `buy-mode.md`. Each states the symptom, the likely causes, the checks, and the safe actions, including which actions are safe to repeat.

Testing Strategy
----------------

### Levels

| Level | Scope | Tools and rules |
|---|---|---|
| Unit | Domain rules, validation, units, slots, transition matrix, fingerprints | Plain Go tests. Injected clock. No network. |
| Component | Use cases with fake ports (IoT, Auth, Billing, store, publisher) | In-process fakes. A gRPC fake via an in-memory listener. |
| Integration | Real PostgreSQL 16 and Kafka | Service containers in CI (the IoT pattern) and `testcontainers-go` locally. Migrations applied by `cmd/migrate`. |
| Contract | Every message and the gRPC service against the generated SDK | Round trips, unknown-enum and empty-ID rejection |
| Cross-service | Order Service, a Matching Engine, Kafka, and PostgreSQL together | Compose. The scripted fake engine until the real engine is wired. |
| End to end | Through the real gateway | Compose |
| Security | Authorization, leakage, redaction, rate limits | Automated cases below |
| Concurrency and fault injection | Races, crashes, outages | `-race`, repeated runs, container kill and pause |

### Conventions

- **Deterministic time.** A `Clock` interface is injected everywhere. Slots are computed relative to the injected now, and the 30 s, 60 s, and 5 min rules are tested at their boundaries (just under, exactly at, just over).
- **Deterministic data.** Fixed UUIDs and a seeded random generator. A failing random test prints its seed.
- **Durable outcomes.** Tests assert database and Kafka state, not only the response.
- **Test names carry an ID** from the catalogue below, so a missing requirement is visible.

### The scripted fake engine

Until the real engine is wired, `test/fakeengine` consumes `gridx.orders.v1` and emits `OrderUpdated` and `TradeExecuted` as scripted. It can: acknowledge with `NEW`, fill fully or partly, reject with a reason, answer a cancel, echo a duplicate, emit stale or duplicate or out-of-order sequence numbers, delay or drop an acknowledgement, send `REJECTED` with `UNKNOWN_ORDER`, and publish inside an aborted transaction. It also stands in as the recovery counterpart. This lets the Order Service be built and verified independently of the engine's milestones.

### Test catalogue

**Validation (Order Validation)**

| ID | Test |
|---|---|
| VAL-01 | Every validation rule returns its reason code, including boundaries: quantity min, max, and step, price band and tick, slot alignment, gate closure, and horizon |
| VAL-02 | MARKET: rejected when the flag is off. When on, the protection price defaults to the band bound, and is required in `required` mode |
| VAL-03 | `UNSPECIFIED` enums and a missing key are rejected. A request and metadata identity mismatch is rejected. |
| VAL-04 | Permission granted, denied, and Auth unavailable (including the 60 s cache) |
| VAL-05 | Idempotency: replay, conflict, and 20 concurrent requests with one key create exactly one order |
| VAL-06 | A validation failure persists no order, no outbox row, and no allocation |
| VAL-07 | Cheap checks run before network calls. The fake IoT receives no call when local validation fails. |
| VAL-08 | The BUY mode matrix: `blocked`, `disabled`, `required`, and startup failure for `disabled` in production |

**IoT validation and allocation**

| ID | Test |
|---|---|
| IOT-01 | Every IoT call carries a non-empty `owner_user_id` (the fake asserts it) |
| IOT-02 | No house, two houses, and an unmapped grid return the right codes |
| IOT-03 | Offline meter, reading at 59.9, 60, and 60.1 s, future-dated beyond 5 s, not-a-number and negative solar, and a missing reading |
| IOT-04 | IoT unavailable, timeout, and `INVALID_ARGUMENT` map to the right codes and persist nothing |
| IOT-05 | Capacity formula: 5.0 kW gives 2500 Wh, and a tiny rating gives 0 |
| IOT-06 | 200 concurrent SELL orders for one meter and slot never exceed capacity |
| IOT-07 | A duplicate key allocates once |
| IOT-08 | Release on every terminal status, idempotent release, and recompute after a superseding engine event |
| IOT-09 | The ledger audit detects injected drift |

**Persistence and outbox**

| ID | Test |
|---|---|
| PER-01 | Migrations apply up and down on an empty database. The startup version check refuses a mismatch. |
| PER-02 | Each check constraint rejects an invalid row, and a valid row is accepted |
| PER-03 | The status history rejects update and delete |
| PER-04 | Trader account creation is safe under 50 concurrent first orders for one user |
| PER-05 | Outbox claiming with several workers keeps placement before cancel and respects backoff and leases |
| PER-06 | A crash after publishing and before `published_at` republishes the same `event_id` |
| PER-07 | Lock order (order row, then capacity row) never deadlocks under stress |
| PER-08 | The retention cleaner deletes only eligible rows |
| PER-09 | `ListOrders` pagination is stable while orders are inserted |

**Kafka consumer and contracts**

| ID | Test |
|---|---|
| KAF-01 | Every message round trips through the SDK. An unknown enum or an empty or non-UUID `event_id` is rejected. |
| KAF-02 | Duplicate `event_id`, stale `order_seq`, unknown order, malformed payload, and a transient database failure each behave as specified |
| KAF-03 | No offset is committed before the database transaction commits, and none for an unapplied record |
| KAF-04 | A consumer reading `read_committed` never sees outputs of an aborted transaction |
| KAF-05 | A rebalance in the middle of a batch causes no loss and no double apply |
| KAF-06 | The producer is configured with all-acks and idempotence (asserted) |

**Status synchronization**

| ID | Test |
|---|---|
| STS-01 | Every cell of the transition matrix, for LIMIT and MARKET and for every stored status |
| STS-02 | The status, event type, and quantity consistency table, and each mismatch |
| STS-03 | Sequence rules: stale, equal and identical, equal and different, gap |
| STS-04 | Terminal rules: echo, supersede, invalid, for both terminal sources |
| STS-05 | Convergence: random valid event sequences with duplication and stale redelivery end in the same state and never increase remaining quantity |
| STS-06 | Crash before commit, after commit before the offset, and during dead-letter handling |
| STS-07 | History rows are written only for applied changes |

**Cancellation and expiry**

| ID | Test |
|---|---|
| CXL-01 | Cancel from every stored status, and a repeated cancel |
| CXL-02 | Cancel racing a fill, in both orders, ends in exactly one of `CANCELLED` or `FILLED` |
| CXL-03 | A partly filled order releases exactly the remaining quantity |
| CXL-04 | Only one cancel command can exist per order |
| CXL-05 | The reconciler skips an order an engine event just finished, and a later engine event supersedes a reconciler expiry |
| CXL-06 | MARKET orders are cancellable only while `PENDING`, and expire after the TTL |

**Matching Engine integration**

| ID | Test |
|---|---|
| MEI-01 | With the fake engine: create, acknowledge, fill, partial fill, reject, cancel, and a lost acknowledgement |
| MEI-02 | The ten cross-service scenarios from the integration document, with the real engine once it is wired |
| MEI-03 | Republishing the same placement creates no second order and no second trade |

**Recovery**

| ID | Test |
|---|---|
| REC-01 | The Order Service derives the engine-visible status for every stored status, and builds the resting and known sets correctly |
| REC-02 | Refusals: updates lag, flagged orders, pending dead letters |
| REC-03 | Chunking, ordering, the completion marker, and a repeated request |
| REC-04 | Orders created and cancelled during a request end in a consistent state |
| REC-05 | Crash injection in the engine over a long randomised run: executed quantity never exceeds order quantity, and the Order Service state equals the engine state (cross-service) |

**API and gateway**

| ID | Test |
|---|---|
| API-01 | Every reason code maps to its gRPC status, HTTP status, `error.code`, and `retryable` |
| API-02 | Gateway schema errors: unknown field, bad enum, bad date, bad pagination |
| API-03 | `Idempotency-Key` rules, replay `200` with its headers, conflict `409` |
| API-04 | Cursor pagination and filters |
| API-05 | `CreateOrder` returns `202 PENDING` and `CancelOrder` returns `202 CANCEL_PENDING` |
| API-06 | Dependency failures give 503, deadlines give 504, and Kafka or engine failure never fails creation |

**Security**

| ID | Test |
|---|---|
| SEC-01 | A non-owner receives `NOT_FOUND` from `GetOrder`, `CancelOrder`, and in `ListOrders` sees none of another user's orders |
| SEC-02 | A request and metadata identity mismatch is rejected |
| SEC-03 | 5xx responses carry no internal detail. 4xx messages carry no data about other users. |
| SEC-04 | Logs contain no tokens, secrets, or payloads, and the idempotency key appears only as a hash |
| SEC-05 | Rate limits and the body size limit apply |
| SEC-06 | No string-built SQL exists in the code (lint rule) |
| SEC-07 | A missing or invalid required configuration value fails startup |

**Wallet boundary**

| ID | Test | Status |
|---|---|---|
| WAL-01 | The BUY mode matrix and fail-closed behaviour in production | Runs now |
| WAL-02 | `ReserveFunds` success, insufficient funds, frozen wallet, unavailable, unknown outcome, and retry with the same key | Blocked until the Billing contract exists. Runs against a fake until then. |
| WAL-03 | Hold release and settlement with the real Billing service | Blocked until Billing ships |

### Blocked tests

A test that depends on a missing dependency is tagged with the dependency name and skipped with a fixed reason. CI lists the skipped tests and their blocking dependency. Nothing is reported as passing against a dependency that does not exist, and the release checklist below cannot be ticked for a blocked test.

### Performance and fault injection

Initial targets, to be measured and then adjusted:

| Measure | Target |
|---|---|
| `CreateOrder` p95 excluding dependency time | Under 300 ms |
| Sustained creation | 50 orders per second without errors |
| Update apply p95 | Under 50 ms |
| Outbox publish delay under normal load | Under 1 s |

Fault injection (containers stopped, paused, or slowed) covers: the Order Service killed mid-create, the publisher killed mid-send, Kafka down and back, PostgreSQL down and back, IoT slow and down, Auth and Billing down, and the engine down. After each, every order must reach a consistent state, with no duplicates, no lost allocations, and no unexplained flags.

CI Pipeline
-----------

The pipeline mirrors the IoT service and adds the integration and contract stages.

| Stage | Content |
|---|---|
| Quality | Format check, `go mod verify`, `go vet`, `golangci-lint` |
| Unit and component | `go test ./...`, then `go test -race ./...` |
| Fuzz | A short run (20 s each) over the protobuf decoders and the request fingerprint |
| Security | `govulncheck`, plus the SEC lint rule for SQL |
| Integration | PostgreSQL 16 and Kafka 7.7 service containers (kept in step with `gridx-infra`), apply migrations with `cmd/migrate up`, run integration tests with `-race` |
| Contract | Tests against the generated SDK |
| Build | Docker image build, and migration up and down on an empty database |
| Nightly | Cross-service and fault-injection suites with the engine image, once the engine is wired |

Task names in `Taskfile.yaml`: `test`, `test:race`, `test:integration`, `lint`, `vuln`, `db:up`, `db:down`, `db:status`.

Release and Verification Criteria
---------------------------------

A feature is complete only when every item is true:

1. Every requirement in its document has at least one test from the catalogue, and the tests pass (or are explicitly blocked with a named dependency).
2. Its contracts are merged in the shared repositories, and the contract tests pass.
3. Its migration is applied cleanly up and down.
4. Its metrics exist, its alerts are defined, and its runbook is written.
5. Its security controls are in place and the relevant SEC tests pass.
6. Its documentation matches its behaviour, and no sign-off item for it remains open.
7. Its dependencies are in the state the document assumes. Where a dependency is a fake, the feature is labelled so.

A passing Markdown lint check verifies formatting only. It does not demonstrate that behaviour is correct.

Decisions and Dependencies
--------------------------

### Resolved decisions

| ID | Open item | Decision |
|---|---|---|
| T-1 | Test tooling | Go `testing`, `testcontainers-go` locally, service containers in CI, an in-memory gRPC listener for fakes. |
| T-2 | CI pipeline | The IoT pipeline plus integration, contract, build, and nightly stages. |
| T-3 | Metrics conventions | Prometheus, namespace `order`, low-cardinality labels, the catalogue above. |
| T-4 | Logging conventions | `slog` JSON, the field list above, no payloads or secrets. |
| T-5 | Tracing | OpenTelemetry OTLP/gRPC, disabled when the endpoint is empty, `traceparent` through gRPC and Kafka. |
| T-6 | Health | `/healthz`, `/readyz` (database, migration version, Kafka), `/metrics`. Readiness excludes downstream services. |
| T-7 | Testing without the engine | The scripted fake engine, replaced by the real one in the nightly cross-service suite. |
| T-8 | Blocked tests | Tagged, skipped with a reason, and never reported as passing. |
| T-9 | Alert thresholds | The initial values above, tuned from measurements. |
| T-10 | Security controls | The trust boundaries, ACL matrix, and threat table above. |

### Remaining items needing sign-off

| ID | Item | Owner |
|---|---|---|
| T-O1 | Provision a monitoring stack (Prometheus, alert delivery, dashboards, trace collector). None exists in `gridx-infra`, so alerts are defined but not delivered. | Infrastructure |
| T-O2 | Kafka TLS, SASL, and the ACL matrix in production. | Infrastructure, security |
| T-O3 | Network policy so only the gateway reaches the Order Service, and only trusted services reach IoT, Auth, and Billing. | Infrastructure |
| T-O4 | Secret storage for the database role and Kafka credentials. | Infrastructure |
| T-O5 | Decide whether to cap open orders per user, beyond the gateway rate limit. | Product |
| T-O6 | Make the Matching Engine image available to the nightly cross-service job. | Matching Engine |
| T-O7 | Confirm the performance targets and alert thresholds. | Product, operations |
| T-O8 | A security review of the threat table. | Team lead |

Record confirmed decisions in the shared contracts and runbooks before describing them as existing behaviour.