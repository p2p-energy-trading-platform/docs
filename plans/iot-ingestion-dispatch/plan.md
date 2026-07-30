# IoT Ingestion & Dispatch Service - Plan

* **Author:** Hanan (M.S.H. Ahmed)
* **Scope:** IoT Ingestion Service (primary focus) + Dispatch Service (documented, not implemented yet) + gRPC query interface (documented, not implemented yet)
* **Stack:** Go
* **Status:** Draft v1

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

```
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
                                                                               (future - web/mobile/AI/matching engine read here)


Matching Engine --(trade signal, mechanism TBD)--> Dispatch Service --MQTT actuation topic--> IoT Simulator
```

**Confirmed from `gridx-infra`:** the MQTT-to-Kafka bridge is not custom code - it's a `kafka-connect` container running the Confluent `MqttSourceConnector` (a standard, off-the-shelf Kafka Connect plugin), configured via `mqtt-connector.json`.

> ⚠️ **Blocking issue found while reviewing this config, needs to be raised immediately:** the connector's `mqtt.topics` is set to `gridx/devices/+/telemetry`. The IoT Simulator actually publishes to `gridx/{grid_id}/{house_id}/meter` and `gridx/{grid_id}/{house_id}/heartbeat`. MQTT's `+` wildcard only replaces a single topic level and cannot match literal segments - `devices` and `telemetry` in the connector's pattern are fixed literal strings, and neither matches what the simulator actually publishes. **As currently configured, this connector will never receive a single message from the simulator.** This needs to be fixed before the ingestion service has any real data to consume - see section 10.

**One important design rule carried over from the IoT Simulator's own plan:** the simulator only ever talks to the outside world through MQTT. It never talks to Kafka, Redis, TimescaleDB, or this service directly. This service is downstream of the simulator - it observes and stores, it doesn't reach back except through the Dispatch Service's actuation path, which itself only ever talks back to the simulator over MQTT (the exact same `gridx/actuation` topic the simulator already listens on).

---

## 3. Kafka consumption

- This service runs as a Kafka **consumer group**, reading from two separate topics (decided below), produced to by the Kafka Connect MQTT source connector(s).
- **Confirmed decision (team lead):** meter readings and heartbeats will be split into **two separate Kafka topics**, not shared in one - `gridx_telemetry_devices` as currently configured is not suitable for both. Exact topic names still to be finalized with whoever owns the connector, but the design now assumes two, e.g. `iot.meter-readings` and `iot.heartbeats`.
- **Confirmed decision (team lead):** a partitioning key is needed to guarantee message ordering (e.g. partition by `house_id`, so all of one house's readings land in the same partition and are processed in order). This needs to be set up on the connector/producer side, not something this service can enforce after the fact - worth confirming with whoever configures the connector that keying is actually applied.
- **Confirmed payload format:** the connector uses `value.converter: ByteArrayConverter` - meaning the raw MQTT JSON bytes are forwarded into Kafka completely unchanged, with no schema/transformation applied by the bridge. This service must `json.Unmarshal` the message body itself; nothing arrives pre-parsed or wrapped.
- **Delivery semantics:** Kafka consumer groups are at-least-once by default. This means the same message could theoretically be processed twice (e.g. after a consumer restart before an offset commit). Both the Redis and TimescaleDB writes need to be **idempotent** - writing the same reading twice should never corrupt state or create duplicate rows. For TimescaleDB, this likely means an upsert keyed on `(house_id, time, seq)` rather than a blind insert.
- **Offset commit strategy:** commit offsets only after both the Redis write and the TimescaleDB write for that message have succeeded, not immediately on receipt. This avoids losing data if the service crashes mid-processing.

---

## 4. Redis - hot storage design

Hot storage answers one question fast: **"what is this house doing right now?"** No history, just the latest state, overwritten every time a new reading arrives.

Proposed key structure:

| Key pattern | Value | Purpose |
|---|---|---|
| `meter:{grid_id}:{house_id}:latest` | JSON blob of the most recent meter reading | Fast lookup of current solar/consumption/net_kw/storage state per house |
| `house:{house_id}:status` | `{ status: online/offline, last_heartbeat_at }` | Derived from heartbeat messages, lets other services check liveness without scanning TimescaleDB |
| `grid:{grid_id}:houses` | Set of house IDs | Quick "which houses exist in this grid" lookup, avoids a DB round-trip for grid membership |

No TTL is needed on the `:latest` keys since they're always overwritten by the next reading. **Confirmed decision (team lead):** `house:{house_id}:status` uses a **10-minute TTL** as a staleness signal - if no heartbeat refreshes the key within that window, the key expires and a consumer can infer the house has gone quiet without needing to actively poll or scan TimescaleDB.

---

## 5. TimescaleDB - warm storage design

TimescaleDB is Postgres with a time-series extension (hypertables) layered on top. **Confirmed from `gridx-infra`'s bootstrap SQL:** this service gets exactly one schema, `iot_data`, provisioned inside the `gridx-timescaledb` container (host port 5433, internal 5432) - not a separate database instance, and not the `gridx-postgres` container (which is scoped to Auth/Orders/Billing/Notifications only and has no schema for IoT). Everything this service owns lives inside `iot_data`.

Within that single schema, the plan splits data into two categories, matching how the data actually behaves - both live in `iot_data`, just as different table types. **Confirmed by team lead: this split (hypertables for analytical/time-series data, plain Postgres tables for everything else) is the correct design direction, not just a proposal.**

- **Plain tables (ER-style)** - for things that rarely change: which grids and houses exist, and their static characteristics. Normal relational tables, normal foreign keys.
- **Hypertables (time-series)** - for the actual telemetry stream: every meter reading. These are the tables that grow continuously and get queried by time range.

**Credentials:** the schema/user bootstrap lives in `gridx-infra/init-scripts/timescaledb/01-init-timescaledb.sql` (with the `sys_env()` helper defined in `00-config.sql` in the same folder). It creates a dedicated `IOT_SERVICE_USER` (password from `IOT_SERVICE_PASSWORD`), owning the `iot_data` schema exclusively, with public schema/database access explicitly revoked platform-wide. This service should connect using those env vars, not a shared/superuser credential.

**Important operational note:** these init scripts are mounted to Postgres/TimescaleDB's standard Docker entrypoint (`/docker-entrypoint-initdb.d`), which only runs them **once**, the first time the container starts against an empty data volume. This means the actual application tables in section 5.1/5.2 below **should not be added by editing this bootstrap script** - once the container has started once, edits here won't retroactively apply. This service needs its own separate, versioned migration mechanism (e.g. `golang-migrate` or `goose`), run by the Go service itself on startup, applying migrations against the already-provisioned `iot_data` schema.

**Confirmed by team lead:** `AI_SERVICE_USER`'s write access (`INSERT, UPDATE, DELETE`, not just `SELECT`) on `iot_data` is intentional - the forecasting engine will be built later and is expected to write into this schema. Table design needs to account for this as a second writer from the start, not added on later.

**Confirmed by team lead: heartbeats are not stored as time-series history.** A heartbeat only ever updates the `last_heartbeat_at` field on the relevant row in `iot_data.houses` (see below) - there is no `heartbeats` hypertable. This keeps write volume down since heartbeats have limited analytical value on their own.

### 5.1 Plain Postgres tables (schema: `iot_data`)

```sql
-- Registry of grids, essentially static
CREATE TABLE iot_data.grids (
    grid_id       TEXT PRIMARY KEY,
    lat           DOUBLE PRECISION NOT NULL,
    lon           DOUBLE PRECISION NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Registry of houses, updated occasionally (e.g. when a heartbeat reports new info).
-- last_heartbeat_at is updated in place on every heartbeat. There is deliberately no
-- separate "status" column here - online/offline is computed on read from
-- last_heartbeat_at (e.g. status = now() - last_heartbeat_at < interval '10 minutes'),
-- so there is exactly one source of truth for liveness, not a Postgres column that
-- could drift out of sync with the Redis TTL key from section 4.
CREATE TABLE iot_data.houses (
    house_id            TEXT PRIMARY KEY,
    grid_id             TEXT NOT NULL REFERENCES iot_data.grids(grid_id),
    device_class        TEXT NOT NULL CHECK (device_class IN ('consumer','residential_prosumer','commercial')),
    rated_solar_kw      DOUBLE PRECISION,
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_heartbeat_at   TIMESTAMPTZ
);
CREATE INDEX idx_houses_grid_id ON iot_data.houses(grid_id);

-- Registry of flexible assets (batteries/EVs) attached to a house
CREATE TABLE iot_data.flexible_assets (
    asset_id          TEXT PRIMARY KEY,
    house_id          TEXT NOT NULL REFERENCES iot_data.houses(house_id),
    asset_type        TEXT NOT NULL CHECK (asset_type IN ('bess','ev')),
    capacity_kwh      DOUBLE PRECISION NOT NULL,
    max_charge_kw     DOUBLE PRECISION NOT NULL,
    max_discharge_kw  DOUBLE PRECISION NOT NULL,
    v2g_capable       BOOLEAN NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_flexible_assets_house_id ON iot_data.flexible_assets(house_id);

-- Placeholder for the AI/forecasting engine's own output. AI_SERVICE_USER currently
-- has write access to the whole iot_data schema (confirmed intentional by team lead),
-- but nothing here is actually meant for it to write INTO - raw sensor tables above
-- should stay single-writer (this service only). This table gives the AI service a
-- sensible place to write predictions without touching raw ingestion data.
-- NOT being built now - included so the schema doesn't need reworking once it is.
CREATE TABLE iot_data.forecasts (
    id              BIGSERIAL PRIMARY KEY,
    house_id        TEXT NOT NULL REFERENCES iot_data.houses(house_id),
    forecast_for    TIMESTAMPTZ NOT NULL,
    predicted_net_kw DOUBLE PRECISION NOT NULL,
    model_version   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

These get populated/updated from **heartbeat** messages, since a heartbeat is exactly what tells us a house or asset exists and what it's capable of - not from meter readings.

### 5.2 Hypertables (analytical / time-series)

```sql
-- One row per meter reading, per house, per tick
CREATE TABLE iot_data.meter_readings (
    time                     TIMESTAMPTZ NOT NULL,
    house_id                 TEXT NOT NULL,
    grid_id                  TEXT NOT NULL,
    seq                      BIGINT NOT NULL,
    solar_kw                 DOUBLE PRECISION NOT NULL,
    consumption_kw           DOUBLE PRECISION NOT NULL,
    net_kw                   DOUBLE PRECISION NOT NULL,
    weather_irradiance_wm2   DOUBLE PRECISION,
    cloud_cover_pct          DOUBLE PRECISION,
    PRIMARY KEY (house_id, time, seq)
);

-- Default 7-day chunks don't fit a 5-second tick rate well - explicit 1-day
-- chunks keep individual chunks a manageable size at this ingestion volume.
SELECT create_hypertable('iot_data.meter_readings', 'time', chunk_time_interval => INTERVAL '1 day');
CREATE INDEX idx_meter_readings_grid_time ON iot_data.meter_readings (grid_id, time DESC);

-- One row per storage asset, per meter reading (normalized out of the meter
-- reading's storage_assets array - a house can have more than one asset,
-- e.g. a battery AND an EV, each ticking independently).
CREATE TABLE iot_data.storage_asset_readings (
    time         TIMESTAMPTZ NOT NULL,
    house_id     TEXT NOT NULL,
    asset_id     TEXT NOT NULL,
    soc_pct      DOUBLE PRECISION NOT NULL,
    power_kw     DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (asset_id, time)
);
SELECT create_hypertable('iot_data.storage_asset_readings', 'time', chunk_time_interval => INTERVAL '1 day');
CREATE INDEX idx_storage_asset_readings_house_time ON iot_data.storage_asset_readings (house_id, time DESC);
```

**Confirmed by team lead: retention window is 6 months.**

```sql
SELECT add_retention_policy('iot_data.meter_readings', INTERVAL '6 months');
SELECT add_retention_policy('iot_data.storage_asset_readings', INTERVAL '6 months');
```

**Worth flagging explicitly, not just noting quietly:** since cold storage isn't set up yet, this retention policy permanently deletes data older than 6 months rather than archiving it. Confirmed as acceptable for now, but worth keeping in mind if anyone later assumes older data still exists somewhere.

**Recommended, not yet confirmed by the team - worth raising separately:** a compression policy for chunks past their "hot query" window. Recent data (last ~7 days) is queried far more often than older data, so compressing anything past that point saves substantial storage with only a minor query-speed tradeoff on old data:

```sql
ALTER TABLE iot_data.meter_readings SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'house_id'
);
SELECT add_compression_policy('iot_data.meter_readings', INTERVAL '7 days');

ALTER TABLE iot_data.storage_asset_readings SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'asset_id'
);
SELECT add_compression_policy('iot_data.storage_asset_readings', INTERVAL '7 days');
```

**Note:** this is now a fairly complete working schema based on the IoT Simulator's actual published payload shapes (`MeterReadingPayload` / `HeartbeatPayload`) - still worth a final review pass with the team, but no longer a rough sketch.

---

## 6. Dispatch Service (planned - not implemented in this phase)

**This section reflects the team's current best understanding, explicitly flagged by the team lead as "not properly planned" yet - treat everything below as a rough direction, not a locked design.**

The Dispatch Service is the other direction of the loop - it's what makes a trade or a user's preference become a real physical instruction a battery can act on. The current thinking on how this triggers:

- **The Matching Engine does not deal with individual assets at all** - it has no visibility into specific batteries/EVs, so it is *not* the thing that directly triggers Dispatch.
- **The current rough idea:** an **Order Service** (not yet part of this plan's scope, likely a separate component in the wider platform) makes a **gRPC call** to the Dispatch Service to request a change - e.g. "reduce this house's battery stored energy" or "increase battery capacity usage" - based on **user preferences** rather than a raw trade signal.
- **Dispatch Service's job**, once triggered: translate that request into an actuation command and publish it to the IoT Simulator's `gridx/actuation` MQTT topic, targeting the correct `house_id` and `asset_id`.

The IoT Simulator already has the receiving end of this built and tested (its own ingestion backlog covered subscribing to `gridx/actuation` and applying charge/discharge commands to battery state) - this service is the missing sender.

**Not being built this phase.** This section exists so the plan reflects the current direction, even tentative, rather than leaving it blank - revisit and firm up once the Order Service side is actually designed.

---

## 7. gRPC interfaces (planned - not implemented in this phase)

Two distinct gRPC needs have come up, worth keeping conceptually separate even though neither is being built yet:

**7.1 Ingestion query interface** - once data is sitting in Redis and TimescaleDB, other services (web dashboard backend, mobile backend, forecasting/AI service) will need to *read* it. Rather than every consumer needing its own Kafka consumer group or direct DB credentials, this service would expose a gRPC API with calls roughly like:

- `GetLatestReading(house_id)` - hits Redis
- `GetHistoricalReadings(house_id, start_time, end_time)` - hits TimescaleDB
- `GetGridSummary(grid_id)` - aggregate view across a grid's houses

**7.2 Dispatch command interface** - separately, per section 6's current (unconfirmed) direction, the Order Service would make a gRPC call *to* the Dispatch Service to *trigger* an actuation - this is a command/write interface, not a read query, and belongs to Dispatch rather than Ingestion.

**Neither is being built this phase.** Documented here so the schema/storage design doesn't accidentally make either harder to add later (e.g. keeping Redis keys and TimescaleDB tables named in a way a query layer could reasonably wrap).

---

## 8. Tech stack

- **Language:** Go
- **Kafka client:** TBD - a mainstream Go Kafka client library (e.g. `segmentio/kafka-go` or `confluent-kafka-go`), decision to be finalized once the bridge's exact topic/partitioning setup is known. Broker confirmed reachable at `gridx-kafka:9092`.
- **Redis client:** `go-redis`, connecting to `gridx-redis:6379` (already running - same instance the IoT Simulator's infra setup uses, so confirm whether this service gets its own key namespace/DB index or shares the instance cleanly via key prefixing as proposed in section 4).
- **TimescaleDB/Postgres client:** `pgx` (or `database/sql` with the `pgx` driver), connecting to `gridx-timescaledb` (host port 5433, internal 5432), using the `IOT_SERVICE_USER` / `IOT_SERVICE_PASSWORD` credentials already provisioned by `gridx-infra`'s init scripts (`init-scripts/timescaledb/01-init-timescaledb.sql`), scoped to the `iot_data` schema only. **Migrations for this service's own tables (grids/houses/flexible_assets/meter_readings) must be managed separately from that init script** - see the operational note in section 5 - via a dedicated migration tool (e.g. `golang-migrate` or `goose`), since the init script only runs once against an empty volume and won't pick up new tables added later.
- **gRPC (future):** protobuf-defined service, not implemented yet
- **Infrastructure:** runs as a new container alongside the existing `gridx-infra` services. Kafka, Redis, and TimescaleDB are already bootstrapped in `gridx-infra` (per its README) - this service is a new consumer/writer on top of existing infra, not something that needs to stand up its own database or broker.

---

## 9. Repository structure (proposed)

```
iot-ingestion/
├── go.mod
├── go.sum
├── cmd/
│   └── ingestion/
│       └── main.go              # starts the Kafka consumer + storage writers
├── internal/
│   ├── kafka/
│   │   └── consumer.go          # Kafka consumer group setup
│   ├── redis/
│   │   └── client.go            # hot storage writes/reads
│   ├── timescale/
│   │   ├── client.go            # DB connection setup
│   │   ├── migrations/          # schema migrations for iot_data
│   │   └── writer.go            # writes meter_readings / storage_asset_readings / registry tables
│   ├── models/
│   │   └── payloads.go          # Go structs mirroring MeterReadingPayload / HeartbeatPayload
│   └── dispatch/                # placeholder package, not implemented yet
├── grpc/                        # placeholder for future gRPC service + proto definitions
├── config/
│   └── config.yaml              # Kafka brokers, Redis host, DB connection, topic names
└── README.md
```

---

## 10. Things we still need to decide as a team

> 🔴 **Top priority, blocking:** the MQTT topic pattern in `mqtt-connector.json` (`gridx/devices/+/telemetry`) does not match what the IoT Simulator actually publishes (`gridx/{grid_id}/{house_id}/meter` and `.../heartbeat`). As configured, **no simulator data can ever reach Kafka.** This needs to be fixed before ingestion work can be tested against real data - see section 2 for the detail. Likely fix: update `mqtt.topics` to something like `gridx/+/+/meter` and add a second connector (or pattern) for `gridx/+/+/heartbeat`, or a single broader pattern like `gridx/+/+/+` if this service will differentiate meter vs. heartbeat by payload shape instead.

**Resolved from `gridx-infra`'s bootstrap scripts, docker-compose, and connector config (no longer open):**
- ~~Kafka container/port~~ - confirmed `gridx-kafka:9092` (external), `kafka:29092` (internal)
- ~~TimescaleDB container/port~~ - confirmed `gridx-timescaledb`, host port 5433
- ~~Schema ownership~~ - confirmed `iot_data`, owned by `IOT_SERVICE_USER`, public access revoked platform-wide
- ~~Which DB instance hosts what~~ - confirmed `gridx-postgres` is Auth/Orders/Billing/Notifications only; all IoT data (both ER-style and time-series) lives in `iot_data` on `gridx-timescaledb`
- ~~Bridge implementation~~ - confirmed: Kafka Connect running Confluent's `MqttSourceConnector`, not custom code
- ~~Payload transformation~~ - confirmed: raw bytes, unmodified (`ByteArrayConverter`) - this service parses the JSON itself

**Resolved by team lead (no longer open):**
- ~~Meter readings vs heartbeats sharing one Kafka topic~~ - confirmed: **split into two separate topics**, one shared topic is not suitable.
- ~~Kafka partitioning~~ - confirmed: a partitioning key (e.g. `house_id`) is needed for per-house message ordering; needs to be set up on the producer/connector side.
- ~~`iot_data` table design approach~~ - confirmed: hypertables for analytical/time-series data, plain Postgres tables for everything else (registry/static data) - this service designs the exact schema itself.
- ~~`AI_SERVICE_USER` write access~~ - confirmed intentional; the forecasting engine will write into `iot_data` once built. Table design must account for this as a second writer.
- ~~Heartbeat storage~~ - confirmed: no historical hypertable for heartbeats; only `last_heartbeat_at` on `iot_data.houses` gets updated.
- ~~Redis TTL for `house:{house_id}:status`~~ - confirmed: 10 minutes.
- ~~Hypertable retention~~ - confirmed: 6-month retention window (data is dropped after 6 months since cold storage isn't set up yet - accepted tradeoff for now).
- ~~Dispatch Service trigger mechanism~~ - rough direction confirmed by team lead, though explicitly flagged as **"not properly planned"**: an Order Service (not yet in scope) would call Dispatch via gRPC based on user preferences, not a Matching Engine trade signal directly. See section 6 - treat as tentative, to be revisited.

**Still open:**
- **The topic mismatch is the one true blocker** - `mqtt-connector.json`'s `mqtt.topics` (`gridx/devices/+/telemetry`) does not match the simulator's real topics and needs to be fixed by whoever owns the connector before this service has any real data to consume. See section 2 and the note below on exactly which file(s) need to change.
- Exact new Kafka topic names for the now-confirmed two-topic split (e.g. `iot.meter-readings` / `iot.heartbeats` or similar) - needs to be agreed with whoever owns the connector config.
- ~~Exact `iot_data` table schema~~ - now a fairly complete working design (section 5.1/5.2), not just a rough sketch. Worth a final review pass with the team rather than treating as fully locked.
- **Compression policy** - proposed in section 5.2 (compress chunks older than 7 days) but not yet confirmed by the team, unlike retention which was explicitly confirmed. Worth raising alongside the retention discussion.
- **What the `forecasts` table (section 5.1) should actually look like, and whether it's even the right home for AI-service output** - added as a placeholder so `AI_SERVICE_USER`'s write grant has something sensible to target instead of raw ingestion tables, but this hasn't been discussed with whoever owns the AI/forecasting work yet.
- The Order Service / Dispatch Service gRPC interaction (section 6, 7.2) - explicitly not properly planned yet; needs real design once the Order Service itself is scoped.

---

## 11. Note on fixing the Kafka Connect topic mismatch

For whoever updates the connector config (see section 2's flagged issue):

- **File to change:** `mqtt-connector.json` in `gridx-infra` - specifically the `mqtt.topics` field, currently `gridx/devices/+/telemetry`.
- **Given the two-topic decision (section 3), this likely means creating a second connector config file** rather than editing one - e.g. `mqtt-connector-meter.json` with `mqtt.topics: gridx/+/+/meter` and `kafka.topic: iot.meter-readings` (name TBD), plus `mqtt-connector-heartbeat.json` with `mqtt.topics: gridx/+/+/heartbeat` and `kafka.topic: iot.heartbeats` (name TBD).
- **Not yet confirmed:** whether there's a startup/init script in `gridx-infra` that registers connector configs with the Kafka Connect REST API (port 8083) - if `mqtt-connector.json` is currently registered via such a script, that script would also need updating to register both new connector files. Worth checking directly with whoever owns the connector setup rather than assuming.
