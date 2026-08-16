---
connie-title: IoT Ingestion - Folder Structure
---


# Repository structure (proposed)

**Note on `internal/health/` below:** `/healthz` provides basic process liveness to match the other services in `gridx-infra`. `/readyz` is now required by the startup-bootstrap design, it must remain false until the initial grid registry has loaded and Kafka consumption is safe to start.

```text
iot-ingestion/
├── go.mod                          # depends on github.com/p2p-energy-trading-platform/go-sdk
├── go.sum
├── cmd/
│   └── ingestion/
│       └── main.go              # migrations → grid bootstrap/refresher → Kafka consumer (sections 6.5-6.6)
├── internal/
│   ├── kafka/
│   │   ├── consumer.go          # single consumer group, both topics, dispatch by topic name (section 3)
│   │   └── decode.go            # JSON wire structs, validation, and JSON→domain mapping (section 3.1)
│   ├── admission/
│   │   ├── registry.go          # immutable snapshot and O(1) grid admission lookup
│   │   ├── postgres_loader.go   # loads complete grid snapshots from iot_data.grids
│   │   └── refresher.go         # startup bootstrap and periodic atomic refresh (sections 6.5-6.6)
│   ├── redis/
│   │   ├── client.go            # hot storage writes/reads (section 4)
│   │   └── keys.go              # builders for meter latest-state, house status, and grid membership keys
│   ├── timescale/
│   │   ├── client.go            # DB connection setup
│   │   ├── migrations/          # goose migration files, embedded via embed.FS (section 6.3), incl. grid seed (section 6.4)
│   │   ├── writer.go            # writes meter_readings / storage_asset_readings / registry tables
│   │   └── failures.go          # writes to ingestion_failures (section 3.3)
│   ├── heartbeat/
│   │   └── processor.go         # device discovery within pre-provisioned grids (section 5)
│   ├── models/
│   │   └── domain.go            # this service's own internal domain structs (NOT go-sdk proto types - see section 3.1)
│   ├── health/
│   │   ├── handler.go           # minimal /healthz liveness endpoint
│   │   └── readiness.go         # /readyz stays false until grid bootstrap succeeds
│   └── dispatch/                # placeholder package, not implemented yet
├── test/
│   └── integration/             # testcontainers-go tests (section 10, Tier 3)
├── grpc/                        # placeholder for future gRPC service, using go-sdk types
├── config/
│   └── config.yaml              # Kafka/Redis/DB/topics + grid_registry_refresh_interval
├── .env.example
├── .env
└── README.md
```

`internal/redis/keys.go` is the single source of truth for Redis key formats. It exposes functions that build keys from domain identifiers, so callers never construct strings such as `meter:{grid_id}:{house_id}:latest` themselves. Keeping these builders beside the Redis client makes their ownership clear.

`internal/admission/registry.go` is the single admission path shared by meter-reading and heartbeat handlers. `postgres_loader.go` owns the only query that loads `iot_data.grids`, while `refresher.go` controls initial bootstrap, the refresh ticker, validation, and atomic snapshot replacement. Keeping those responsibilities separate makes it straightforward to test that high-volume handlers never call Postgres directly.

Kafka topic names, broker addresses, the consumer-group name remain runtime configuration in `config/config.yaml`. A Kafka record key is different from both a topic name and a Redis key: producers attach it to a record to influence partitioning and per-key ordering. This ingestion service only consumes records created by the MQTT Source Connector, so it does not need a `kafka_keys.go` file unless it later starts producing Kafka records or explicitly validating incoming record keys.