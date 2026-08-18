---
connie-title: IoT Ingestion - Repository Structure
---

# Validated repository structure

The service remains one Go module and one deployable process. Package boundaries follow capabilities and dependency direction; they are not separate microservices. Do not create empty placeholder packages.

```text
iot-ingestion/
├── cmd/
│   ├── iot-ingestion/
│   │   └── main.go                   # parse config, build app, handle signals
│   └── migrate/
│       └── main.go                   # single-owner migration command/job
├── internal/
│   ├── app/
│   │   ├── app.go                    # dependency wiring and lifecycle
│   │   └── shutdown.go               # readiness off, drain, bounded stop
│   ├── config/
│   │   ├── config.go                 # typed runtime configuration
│   │   └── validate.go               # fail-fast cross-field validation
│   ├── domain/
│   │   ├── telemetry.go              # internal domain types and invariants
│   │   ├── heartbeat.go
│   │   └── errors.go                 # typed domain/application errors
│   ├── ingestion/
│   │   ├── consumer.go               # poll loop, partition workers, commits
│   │   ├── router.go                 # strict topic-to-handler routing
│   │   ├── decoder.go                # private JSON wire structs to domain
│   │   ├── meter_handler.go          # ordered meter workflow
│   │   ├── heartbeat_handler.go      # ordered heartbeat workflow
│   │   ├── retry.go                  # transient/permanent policy
│   │   └── failure_recorder.go       # failure application port
│   ├── admission/
│   │   ├── registry.go               # immutable in-memory snapshot
│   │   └── refresher.go              # bootstrap and atomic refresh
│   ├── query/
│   │   ├── service.go                # storage-neutral query use cases
│   │   └── pagination.go             # opaque keyset-token logic
│   ├── store/
│   │   ├── postgres/
│   │   │   ├── pool.go
│   │   │   ├── telemetry_writer.go
│   │   │   ├── heartbeat_writer.go
│   │   │   ├── query_repository.go
│   │   │   ├── grid_loader.go
│   │   │   └── failures.go
│   │   └── redis/
│   │       ├── client.go
│   │       ├── latest.go
│   │       ├── heartbeat.go
│   │       ├── keys.go
│   │       └── scripts/
│   │           ├── set_latest_if_newer.lua
│   │           └── update_heartbeat.lua
│   ├── transport/
│   │   ├── grpc/
│   │   │   ├── server.go             # options, registration, lifecycle
│   │   │   ├── telemetry_handler.go  # generated API to query service
│   │   │   ├── mapper.go
│   │   │   ├── errors.go             # typed errors to gRPC status
│   │   │   └── interceptors.go
│   │   └── httphealth/
│   │       └── server.go             # /healthz, /readyz only
│   └── observability/
│       ├── logging.go
│       ├── metrics.go
│       └── tracing.go
├── migrations/
│   ├── embed.go                      # embed.FS exposed to migrate command
│   └── 00001_initial_schema.sql
├── test/
│   ├── integration/                  # real Kafka/Redis/TimescaleDB
│   ├── contract/                     # generated-client interoperability
│   ├── endtoend/                     # simulator -> query API smoke path
│   ├── load/                         # reproducible ingest/query scenarios
│   ├── fixtures/
│   └── helpers/
├── docs/
│   └── runbooks/
│       ├── consumer-lag.md
│       ├── dependency-outage.md
│       ├── failure-replay.md
│       └── redis-rebuild.md
├── .github/workflows/ci.yml
├── .dockerignore
├── .env.example                      # names and safe examples, no secrets
├── .gitignore                        # must exclude .env and local credentials
├── Dockerfile                        # pinned multi-stage, non-root runtime
├── docker-compose.yaml               # local development only
├── go.mod
├── go.sum
└── README.md
```

## Boundary rules

- `cmd` contains composition only. Business workflows are testable without starting listeners.
- `domain` imports no Kafka, Redis, Postgres, gRPC, or generated protobuf package.
- `ingestion` owns delivery/order behavior and depends on narrow store/admission interfaces defined by the consuming package. Kafka-specific records do not leak into handlers.
- `query` owns pagination and query rules. gRPC handlers only validate/map/authorize and delegate.
- `store` contains dependency adapters. SQL is colocated with the repository that executes it; Redis key construction exists only in `store/redis/keys.go`.
- `transport/grpc` imports SDK-generated types and maps them to/from domain types. There is no top-level placeholder `grpc/` directory.
- `migrations` is top-level because schema artifacts are operational assets shared by the migration command and CI. Production application replicas do not race to apply migrations.
- `.env` is never committed. Secrets arrive through the deployment secret mechanism; config supports environment variables and may use a non-secret local YAML file if needed.
- Dispatch, MQTT publishing, and cold-storage packages are absent because those capabilities are out of scope.

## Interfaces to define early

Keep interfaces narrow and consumer-owned. Expected seams are `TelemetryWriter`, `HeartbeatWriter`, `FailureRecorder`, `HotProjection`, `GridRegistry`, and read-only query repositories. Do not create a generic repository or a large `utils`/`common` package.

The gRPC contract itself remains in the separate protobuf repository. This repository consumes a pinned `go-sdk` release. If local contract development is needed, use a temporary Go workspace/replace directive that is never committed.

## Build and release requirements

CI runs formatting, vet/static analysis, unit tests with the race detector, migration tests, integration/contract tests, vulnerability and dependency checks, and the container build. The image uses a pinned Go builder and minimal non-root runtime, includes CA certificates/time-zone data only if needed, exposes separate gRPC and health ports, and records version/commit metadata. Release artifacts and dependencies must be reproducible and version-pinned.
