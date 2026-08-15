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

---

## 3. Kafka consumption

- This service runs as a **single Kafka consumer group**, subscribed to both `iot.meter-readings` and `iot.heartbeats`, dispatching each record to the correct handler based on which topic it arrived on.
- **Why one group, not two:** ordering isn't a factor either way - Kafka only orders within a partition, and the two message types already live on physically separate topics regardless of grouping, so there's no ordering guarantee to gain by splitting further. The real reason to split would be independent *scaling* of the much-higher-volume meter-reading stream away from heartbeat processing - at this project's scale, a single Go process handles both comfortably, and goroutines make "two topics, one process" close to free. Simpler to run and deploy while already juggling Kafka, Redis, TimescaleDB, and goose in one service.
- **One real risk worth designing around regardless of grouping:** a Go process dies on an unrecovered panic. A bug in heartbeat processing shouldn't be able to take down meter-reading processing just because they share a process. Handlers return ordinary errors (feeding into the failure-recording path in section 3.3) rather than panicking - this sidesteps the risk entirely as long as that discipline is maintained.
- **Partitioning / ordering:** ordering is required independently within each stream: all meter readings for one house must remain ordered within `iot.meter-readings`, and all heartbeats for one house must remain ordered within `iot.heartbeats`. Kafka does **not** provide ordering across the two topics, so the service must not rely on a meter reading and heartbeat having a defined order relative to each other. **Likely already satisfied within each topic:** Confluent's MQTT Source Connector documentation describes using the source MQTT topic string as the Kafka record key by default. Because each house has a unique MQTT meter topic and heartbeat topic, this should consistently partition that house's records within the corresponding Kafka topic. Treat this as *likely*, not confirmed, until the keys and partitions are inspected against live traffic (section 13).

### 3.1 Message format - JSON ingestion and future protobuf contracts

The ingestion wire format is settled. The IoT Simulator serializes meter readings and heartbeats as JSON and publishes them to the MQTT broker. The MQTT Source Connector then forwards the MQTT payload bytes unchanged into Kafka; there is no JSON-to-protobuf conversion anywhere in this path:

```text
IoT Simulator --JSON/MQTT--> MQTT broker --unchanged payload bytes--> Kafka --JSON bytes--> IoT Ingestion Service
```

The Kafka consumer must therefore treat each record value as raw JSON bytes. At the ingestion boundary it unmarshals the JSON into input/wire structs that match the simulator payload, validates the data, and maps it into this service's internal domain types. Redis, TimescaleDB, and heartbeat-processing code operate only on those domain types and do not depend on the external JSON representation.

```go
// internal/kafka/decode.go
func DecodeMeterReading(raw []byte) (*models.MeterReading, error) {
    var input meterReadingJSON
    if err := json.Unmarshal(raw, &input); err != nil {
        return nil, fmt.Errorf("decode meter-reading JSON: %w", err)
    }
    return mapMeterReading(input)
}
```

Protobuf has a separate role: it is the intended transport contract for future communication between the IoT Ingestion Service and other internal services, such as the planned gRPC query interface. The `iot/v1` `.proto` contracts should still be authored in the separate `protobuf` repository and generated into the organization's `go-sdk`, but those generated types are **not** used to decode the current MQTT-to-Kafka messages and protobuf is not part of the current ingestion flow. See section 3.2 for the draft contracts.

### 3.2 Proposed `iot/v1` proto contract (draft, matching established conventions)

Based on the style of the existing `grid_transfer_rule.proto` and `order_events.proto` (proto3, `gridx.<domain>.v1` package naming, `_UNSPECIFIED = 0` as the first enum value, and the `go_package` alias pattern), the draft below carries the same telemetry concepts and values currently published by the IoT Simulator. It is a proposed future internal-service contract, not a protobuf representation of the simulator's JSON wire format. Its structure should ultimately be driven by the needs of internal API consumers rather than by a requirement to mirror the external JSON object exactly.

```protobuf
syntax = "proto3";

package gridx.iot.v1;

import "google/protobuf/timestamp.proto";

option go_package = "github.com/p2p-energy-trading-platform/go-sdk/gen/gridx/iot/v1;iotv1";

enum DeviceClass {
  DEVICE_CLASS_UNSPECIFIED = 0;
  DEVICE_CLASS_CONSUMER = 1;
  DEVICE_CLASS_RESIDENTIAL_PROSUMER = 2;
  DEVICE_CLASS_COMMERCIAL = 3;
}

enum AssetType {
  ASSET_TYPE_UNSPECIFIED = 0;
  ASSET_TYPE_BESS = 1;
  ASSET_TYPE_EV = 2;
}

message StorageAssetReading {
  string asset_id = 1;
  AssetType asset_type = 2;
  double soc_pct = 3;
  double power_kw = 4;
  double capacity_kwh = 5;
  bool plugged_in = 6;
}

message MeterReading {
  string schema_version = 1;
  string meter_id = 2;
  string house_id = 3;
  string grid_id = 4;
  DeviceClass device_class = 5;
  google.protobuf.Timestamp timestamp = 6;
  uint64 seq = 7;
  double solar_kw = 8;
  double consumption_kw = 9;
  double net_kw = 10;
  repeated StorageAssetReading storage_assets = 11;
  double weather_irradiance_wm2 = 12;
  double cloud_cover_pct = 13;
}

message FlexibleAssetCapability {
  string asset_id = 1;
  AssetType asset_type = 2;
  double capacity_kwh = 3;
  double max_charge_kw = 4;
  double max_discharge_kw = 5;
  bool v2g_capable = 6;
}

message Heartbeat {
  string schema_version = 1;
  string grid_id = 2;
  string house_id = 3;
  string meter_id = 4;
  string status = 5;
  DeviceClass device_class = 6;
  double rated_solar_kw = 7;
  repeated FlexibleAssetCapability flexible_assets = 8;
}
```

**Correction:** `status` was missing from this draft entirely. The simulator currently publishes it as `"online"`, and it is useful state for future internal consumers, so it has been added as field 5. This shifted the numbering of every field after it; double-check that no code was generated from the earlier draft before the contract is submitted.

**Design notes - presenting this as a real decision, not a silent pick:**

- **`readings`/`meta` nesting.** Two real options, not one default with an asterisk:
  - **Flat** (as drafted above) - matches `OrderAccepted`'s style in the existing codebase, uses fewer generated types, and is simpler for internal API consumers when all fields are read together.
  - **Nested** (`message MeterReadingData { solar_kw, consumption_kw, ... }` + `message WeatherMeta { weather_irradiance_wm2, cloud_cover_pct }`, referenced as fields inside `MeterReading`) - groups related values and may be clearer if internal consumers commonly treat measurements and weather metadata as separate concepts.

  The current draft defaults to flat because it matches established convention in this codebase, but this remains an internal API-design choice to confirm before submitting to the `protobuf` repo. It has no effect on the current JSON ingestion decoder.
- No `ActuationCommand` message drafted yet - deferred until the Dispatch Service (section 7) is actually scoped.
- This would live at `proto/gridx/iot/v1/iot_events.proto` in the `protobuf` repo, following the existing `order_events.proto` naming pattern.
- This draft is independent of the settled JSON ingestion wire format in section 3.1.

### 3.3 Failure handling - dead-letter strategy

**Two failure tiers, handled differently:**

- **Transient** (a Redis timeout, a brief DB connection blip) - usually self-resolves within seconds. Retry with bounded exponential backoff.
- **Permanent** (malformed payload, a `device_class` value that doesn't map to anything known, or a `grid_id` that has not been provisioned) - retrying produces the identical error every time. Fail immediately rather than burning through retry attempts.

`github.com/cenkalti/backoff/v5` fits this directly via its `backoff.Permanent(err)` wrapper, which stops retrying immediately instead of exhausting attempts on an error that will never succeed:

```go
attempts := 0
_, err := backoff.Retry(ctx, func() (struct{}, error) {
    attempts++
    if writeErr := warmStore.WriteMeterReading(ctx, reading); writeErr != nil {
        if isPermanent(writeErr) {
            return struct{}{}, backoff.Permanent(writeErr)
        }
        return struct{}{}, writeErr // transient - Retry backs off and tries again
    }
    return struct{}{}, nil
}, backoff.WithMaxTries(3))

if err != nil {
    if failureErr := recordFailure(ctx, rawMsg, "timescale_write", err, attempts); failureErr != nil {
        // The failure was not durably recorded. Return the error and leave the
        // Kafka offset uncommitted so this record can be attempted again.
        return fmt.Errorf("record ingestion failure: %w", failureErr)
    }
    if commitErr := commitOffset(ctx, record); commitErr != nil {
        return fmt.Errorf("commit failed-record offset: %w", commitErr)
    }
}
```

**Correction:** the schema originally included an `attempt_count` column that the retry code never actually populated - it would have silently stayed at its default of 1 even after a transient failure genuinely retried 3 times, which is misleading for anyone debugging later from the table. Fixed by threading the real attempt count through to `recordFailure()` above.

**Where failures land once retries are exhausted: a Postgres table, not a second Kafka topic.** A dedicated dead-letter Kafka topic earns its complexity when other services need to independently consume or replay failures, or failures must survive even if this service's own database is down. Neither is currently required here: nothing else in the platform is designed to read IoT failures, and a queryable table is simpler to operate for a single-owned module than adding another Kafka topic and producer.

This choice has one explicit consequence: `ingestion_failures` is in the same database as warm storage. If that database is unavailable, the service cannot durably record a TimescaleDB write failure there. In that case it must leave the Kafka offset uncommitted and retry after the database recovers; it must never pretend the failure was recorded and advance the offset.

```sql
CREATE TABLE iot_data.ingestion_failures (
    id              BIGSERIAL PRIMARY KEY,
    kafka_topic     TEXT NOT NULL,
    kafka_partition INT NOT NULL,
    kafka_offset    BIGINT NOT NULL,
    raw_payload     BYTEA NOT NULL,
    failure_stage   TEXT NOT NULL,    -- 'decode' | 'grid_validation' | 'redis_write' | 'timescale_write'
    error_reason    TEXT NOT NULL,
    attempt_count   INT NOT NULL,     -- passed explicitly by the caller, not a silent default (see above)
    failed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ingestion_failures_failed_at ON iot_data.ingestion_failures (failed_at DESC);
```

No retention policy on this table - it's diagnostic, not telemetry. If it grows large quickly, that's a symptom worth investigating, not something to quietly auto-delete.

**Grid admission rule:** after decoding either a `MeterReading` or `Heartbeat`, check its `grid_id` against the in-memory grid-registry snapshot described in section 6.5 before writing anything to Redis or the telemetry/registry tables. This is an O(1) map lookup and performs no per-message database query. An unknown grid is a permanent provisioning error, recorded with `failure_stage = 'grid_validation'`; its raw payload is thereby quarantined for investigation or controlled manual replay, and its Kafka offset is committed only after that failure record is durable. Ingestion must never create a grid from telemetry. This prevents configuration mistakes or untrusted messages from silently expanding the system's accepted grid boundary.

**Critical rule:** commit the Kafka offset only after either all required processing succeeds or the exhausted failure is durably recorded. A malformed poison message is recorded and then committed so it cannot block the partition forever. If recording the failure itself fails, leave the offset uncommitted and retry; temporary partition backpressure is preferable to silently losing the record.

---

## 4. Redis - hot storage design

Hot storage answers one question fast: **"what is this house doing right now?"** No history, just the latest state, overwritten every time a new reading arrives.

Key structure, with explicit Redis data types:

| Key pattern | Redis type | Value / fields | Purpose |
|---|---|---|---|
| `meter:{grid_id}:{house_id}:latest` | **STRING** (JSON-serialized) | Full JSON blob of the most recent meter reading | Fast lookup of current solar/consumption/net_kw/storage state per house. Written wholesale every tick via `SET`, read via `GET` - a STRING is the right fit since the whole reading always replaces the previous one atomically, never partially updated. |
| `house:{house_id}:status` | **HASH** | `status` (online/offline), `last_heartbeat_at` | Two related fields updated together on every heartbeat via `HSET`, read via `HGETALL`. A HASH (not a STRING) is used here since it's a small structured record where individual fields make sense to reference directly. |
| `grid:{grid_id}:houses` | **SET** | Members = house IDs | Membership set for "which houses exist in this grid," via `SADD`/`SREM`/`SMEMBERS`. `SADD` is naturally idempotent, so it's safe to call on every heartbeat without checking existence first. |

**TTL behavior:** `house:{house_id}:status` gets a **10-minute TTL** (confirmed by team member) via `EXPIRE`, refreshed on every heartbeat - if no heartbeat arrives within that window, the key expires and a consumer can infer the house has gone quiet. `meter:{grid_id}:{house_id}:latest` has no TTL (always overwritten). `grid:{grid_id}:houses` also has no TTL - grid membership shouldn't silently expire just because a house happened to go quiet for a while.

**Atomic heartbeat update:** execute the heartbeat's `HSET`, `EXPIRE`, and `SADD` operations in one small Redis Lua script. Redis runs a script atomically, preventing a crash between `HSET` and `EXPIRE` from leaving a status key without its required TTL and preventing readers from observing a partially-applied heartbeat update. Pass the status and grid-membership keys through `KEYS` and values/TTL through `ARGV`; load the script once and invoke it by SHA rather than sending its source on every heartbeat. Keep the script limited to these constant-time commands because a running Lua script blocks other Redis work until it completes. If Redis Cluster is introduced later, the multi-key script will also require both keys to use a compatible hash-tag strategy so they occupy the same hash slot.

---

## 5. Heartbeat processing - device discovery flow

This section spells out the exact flow, since a heartbeat can represent either a completely new device being seen for the first time, or a known device simply checking in again - both cases need to be handled cleanly, in both storage tiers, without creating duplicates.

When a `Heartbeat` message is consumed from Kafka, this service performs the following, **in order**:

**Step 0 - Admission, validate the provisioned grid (see sections 6.4 and 6.5):**

Look up `grid_id` in the current immutable in-memory grid-registry snapshot. Continue only when the grid exists. This lookup must not query Postgres. If the ID is absent, perform no house, asset, telemetry, or Redis writes; record the raw heartbeat in `ingestion_failures` with `failure_stage = 'grid_validation'` as described in section 3.3. Grids are administrative provisioning data and must never be discovered or created from a heartbeat.

**Step 1 - Warm storage, house registry:**

```sql
-- device_class / rated_solar_kw intentionally are not overwritten on conflict:
-- changing them requires a deliberate administrative operation.
INSERT INTO iot_data.houses (house_id, grid_id, device_class, rated_solar_kw, first_seen_at, last_heartbeat_at)
VALUES ($1, $2, $3, $4, now(), now())
ON CONFLICT (house_id) DO UPDATE SET
    last_heartbeat_at = now()
WHERE iot_data.houses.grid_id = EXCLUDED.grid_id
RETURNING house_id;
```

This single `INSERT ... ON CONFLICT` handles both cases in one statement: if `house_id` has never been seen before, it's inserted as a brand-new row. If it already exists in the same grid, only `last_heartbeat_at` is refreshed. No returned row means the known house was reported under a different grid; treat that as a permanent validation failure rather than silently moving it or adding it to the wrong Redis grid-membership set.

**Step 2 - Warm storage, flexible asset registry (for each asset in the heartbeat's `flexible_assets` array):**

```sql
INSERT INTO iot_data.flexible_assets (asset_id, house_id, asset_type, capacity_kwh, max_charge_kw, max_discharge_kw, v2g_capable, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
ON CONFLICT (asset_id) DO UPDATE SET
    capacity_kwh = EXCLUDED.capacity_kwh,
    max_charge_kw = EXCLUDED.max_charge_kw,
    max_discharge_kw = EXCLUDED.max_discharge_kw,
    v2g_capable = EXCLUDED.v2g_capable,
    updated_at = now();
```

Unlike the house record, asset specs **are** refreshed on every heartbeat - reasonable, since hardware specs being corrected/updated is plausible and there's no strong reason to lock them the way `device_class` is treated above.

**Step 3 - Hot storage (Redis):**

```text
HSET house:{house_id}:status status "online" last_heartbeat_at "<now>"
EXPIRE house:{house_id}:status 600
SADD grid:{grid_id}:houses {house_id}
```

Both operations are safe to run unconditionally on every heartbeat, new device or not.

**What does NOT get written to Redis on a heartbeat:** asset specs (capacity, max charge/discharge kw) are only stored in TimescaleDB's registry tables, not duplicated into Redis. Hot storage is for *live, frequently-changing state* - static hardware specs that change rarely are already fast to look up in Postgres via primary key.

---

## 6. TimescaleDB - warm storage design

TimescaleDB is Postgres with a time-series extension (hypertables) layered on top. **Confirmed from `gridx-infra`'s bootstrap SQL:** this service gets exactly one schema, `iot_data`, provisioned inside the `gridx-timescaledb` container (host port 5433, internal 5432). Everything this service owns lives inside `iot_data`.

Within that single schema, the plan splits data into two categories: **plain tables (ER-style)** for things that rarely change (grids, houses, flexible assets), and **hypertables (time-series)** for the actual telemetry stream.

**Credentials:** the schema/user bootstrap lives in `gridx-infra/init-scripts/timescaledb/01-init-timescaledb.sql`. It creates a dedicated `IOT_SERVICE_USER`, owning the `iot_data` schema exclusively, public access revoked platform-wide.

**Important operational note:** these init scripts run only **once**, the first time the container starts against an empty data volume. The application tables below should not be added by editing this bootstrap script - this service needs its own separate, versioned migration mechanism (section 6.3).

**Confirmed by team member: heartbeats are not stored as time-series history.** A heartbeat only ever updates `last_heartbeat_at` on the relevant row in `iot_data.houses` - there is no `heartbeats` hypertable.

**ER diagram:** the team member will produce this manually from the table definitions below.

**NOTE**: The below schema definitions are not totally finalized yet but they serve as a starting point.

### 6.1 Plain Postgres tables (schema: `iot_data`)

```sql
-- Registry of explicitly provisioned grids. Telemetry cannot create these rows.
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
```

These get populated/updated from **heartbeat** messages (section 5), since a heartbeat is exactly what tells us a house or asset exists and what it's capable of.

### 6.2 Hypertables (analytical / time-series)

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
    schema_version TEXT NOT NULL
    PRIMARY KEY (house_id, time, seq)
);

-- Default 7-day chunks don't fit a 5-second tick rate well - explicit 1-day
-- chunks keep individual chunks a manageable size at this ingestion volume.
SELECT create_hypertable('iot_data.meter_readings', 'time', chunk_time_interval => INTERVAL '1 day');
CREATE INDEX idx_meter_readings_grid_time ON iot_data.meter_readings (grid_id, time DESC);

-- One row per storage asset, per meter reading (normalized out of the meter
-- reading's storage_assets array - a house can have more than one asset).
CREATE TABLE iot_data.storage_asset_readings (
    time         TIMESTAMPTZ NOT NULL,
    seq          BIGINT NOT NULL,
    asset_id     TEXT NOT NULL,
    soc_pct      DOUBLE PRECISION NOT NULL,
    power_kw     DOUBLE PRECISION NOT NULL,
    asset_type     TEXT NOT NULL,
    capacity_kwh   DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (time, seq. asset_id)
);
SELECT create_hypertable('iot_data.storage_asset_readings', 'time', chunk_time_interval => INTERVAL '1 day');
CREATE INDEX idx_storage_asset_readings_house_time ON iot_data.storage_asset_readings (house_id, time DESC);
```

**Confirmed by team member: retention window is 6 months.**

```sql
SELECT add_retention_policy('iot_data.meter_readings', INTERVAL '6 months');
SELECT add_retention_policy('iot_data.storage_asset_readings', INTERVAL '6 months');
```

Since cold storage isn't set up yet, this permanently deletes data older than 6 months rather than archiving it - confirmed acceptable for now.

**Recommended, not yet confirmed by the team:** a compression policy for chunks past their "hot query" window:

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

### 6.3 Migration tooling

**Recommendation: [`pressly/goose`](https://github.com/pressly/goose).** Compared against `golang-migrate` on "best and simple": single-package setup vs. separate driver/source imports, native Go-migration support alongside plain SQL (useful for data seeds like section 6.4), native `embed.FS` support so migrations ship inside the compiled binary. Since this service only ever talks to one database engine, `golang-migrate`'s broader multi-database driver support isn't a relevant advantage here.

```bash
go install github.com/pressly/goose/v3/cmd/goose@latest
```

Migration files live under `internal/timescale/migrations/`, embedded via `embed.FS`, applied via `goose.Up()` programmatically on startup before the Kafka consumer starts.

### 6.4 Grid provisioning and admission control

**The gap this closes:** neither `MeterReading` nor `Heartbeat` ever carries a grid's lat/lon - it's simulator-internal config (`grids.yaml`), never published over MQTT. A smart meter reports what it measures, not where its zone's coordinates are; location is provisioning data, decided once, not telemetry.

**Provision known grids before starting their telemetry**, using a migration sourced directly from the simulator's actual `config/grids.yaml`:

> ⚠️ **Assumption flagged explicitly:** the lat/lon values below are recalled from earlier in this planning process, not freshly re-checked against the current `config/grids.yaml`. **Pull the real, current values from that file before running this migration** - do not trust the numbers below as-is.

```sql
-- 20260810_seed_known_grids.sql
INSERT INTO iot_data.grids (grid_id, lat, lon) VALUES
    ('grid01', 6.9271, 79.8612),
    ('grid02', 9.6615, 80.0255),
    ('grid03', 7.8731, 80.6550)
ON CONFLICT (grid_id) DO NOTHING;
```

If a new grid is added to the simulator's config later, provision it in `iot_data.grids` through a new migration (or a future authenticated administrative provisioning workflow) before enabling that grid's publisher. Never edit an already-applied migration. Deployment ordering is therefore: apply the grid-provisioning change, verify the row and its coordinates, and only then start or enable telemetry for that grid.

**Unknown grids are rejected, not auto-created.** Configuration drift between repositories is a realistic failure mode, but accepting it would turn a typo or untrusted message into a new administrative entity with incomplete metadata. Both meter-reading and heartbeat handlers therefore check the bootstrapped in-memory registry before any warm- or hot-storage write. An unknown `grid_id` follows section 3.3's permanent-failure path with `failure_stage = 'grid_validation'`. The durable failure row preserves the original payload for investigation and controlled manual replay after provisioning, while preventing the bad record from blocking its Kafka partition indefinitely.

Provisioning can be verified before enabling telemetry:

```sql
SELECT grid_id, lat, lon
FROM iot_data.grids
WHERE grid_id = $1;
```

The query must return exactly one row with the expected coordinates. `lat` and `lon` are `NOT NULL`, so partially provisioned placeholder grids cannot be admitted.

### 6.5 Startup grid-registry bootstrap

Per-message queries to `iot_data.grids` would put database latency and load directly on both high-volume ingestion paths. Instead, each ingestion-service instance owns a small in-memory registry containing the currently provisioned grids. The snapshot may retain the full `grid_id`, `lat`, and `lon` records, although admission currently needs only an O(1) lookup by `grid_id`.

**Startup bootstrap order:**

1. Connect to TimescaleDB and apply goose migrations.
2. Load all provisioned grids with `SELECT grid_id, lat, lon FROM iot_data.grids`.
3. Validate the result and build a new immutable `map[string]Grid` snapshot. An empty registry is a startup error because this deployment expects the seed migration from section 6.4.
4. Publish the snapshot atomically, then mark grid admission ready.
5. Start the background registry refresher.
6. Only after those steps succeed, start the Kafka consumer and allow `/readyz` to report ready.

If the initial query fails or produces invalid data, fail closed: do not start Kafka consumption. The container can retry startup according to the deployment restart policy, but it must never run with an empty fallback allowlist or accept every grid as a fallback.

### 6.6 Runtime grid-registry refresh

**Refreshing while the service is running:** use a configurable periodic full-snapshot refresh, defaulting to **120 seconds**. Grids are a small administrative registry, so one query per service instance every 120 seconds is inexpensive, predictable, and more reliable than using PostgreSQL `LISTEN/NOTIFY` alone, whose notifications can be missed while a connection is down.

**NOTE**: New grids will not get created frequently so having 30s interval is not really needed!

Each refresh performs the following:

1. Query all rows from `iot_data.grids` into a new map without changing the live snapshot.
2. Validate the complete result.
3. Atomically swap the new immutable snapshot into place using `atomic.Pointer` (or a short-held `RWMutex`). Readers see either the complete old snapshot or the complete new one, never a partially refreshed map.
4. Emit the loaded grid count, refresh duration, added/removed grid IDs, and `grid_registry_last_successful_refresh` metric/log field.

If a refresh fails, retain the last known-good snapshot, report the failure, and retry at the next interval. Never clear or partially mutate the live registry. Message handlers continue using the last known-good provisioned set and still perform no database query on a cache miss. This avoids turning arbitrary unknown IDs into database traffic.

For a new grid, the operational order is: provision the database row, wait until every ingestion instance reports a successful refresh containing that `grid_id`, and only then enable its telemetry publisher. Messages sent before that rollout completes are correctly quarantined as unknown-grid failures and require controlled manual replay. At this project's scale, periodic snapshot refresh is the recommended primary mechanism; a PostgreSQL notification may be added later only as a low-latency wake-up hint, while retaining periodic refresh as the recovery/reconciliation mechanism.

---

## 7. Dispatch Service (planned - not implemented in this phase)

**This section reflects the team's current best understanding, explicitly flagged by the team member as "not properly planned" yet - treat everything below as a rough direction, not a locked design.**

- **The current rough idea:** an **Order Service** (not yet part of this plan's scope) makes a **gRPC call** to the Dispatch Service to request a change - e.g. "reduce this house's battery stored energy" - based on **user preferences** rather than a raw trade signal.
- **Dispatch Service's job**, once triggered: translate that request into an actuation command and publish it to the IoT Simulator's `gridx/actuation` MQTT topic, targeting the correct `house_id` and `asset_id`.

The IoT Simulator already has the receiving end of this built and tested - this service is the missing sender.

**Not being built this phase.**

---

## 8. gRPC interfaces (planned - not implemented in this phase)

**8.1 Ingestion query interface** - other services will need to *read* hot/warm data:

- `GetLatestReading(house_id)` - hits Redis
- `GetHistoricalReadings(house_id, start_time, end_time)` - hits TimescaleDB
- `GetGridSummary(grid_id)` - aggregate view across a grid's houses

**8.2 Dispatch command interface** - per section 7, the Order Service would make a gRPC call *to* the Dispatch Service to *trigger* an actuation - a command/write interface, belonging to Dispatch rather than Ingestion.

**Neither is being built this phase.** The Ingestion query interface may reuse relevant telemetry messages from section 3.2 as response types once those contracts are finalized. The Dispatch command interface needs its own request/response contracts, including an `ActuationCommand`, and those should be designed when Dispatch is properly scoped rather than forced into the current telemetry messages.

---

## 9. Tech stack

- **Language:** Go
- **Kafka client:** [`franz-go`](https://github.com/twmb/franz-go) (`github.com/twmb/franz-go`). Pure Go, no cgo dependency (unlike `confluent-kafka-go`, which wraps `librdkafka` and drags a C toolchain into the Docker build). Chosen over `segmentio/kafka-go` for more active maintenance and a more complete feature set. **Honesty note:** the specific claim that `kafka-go` lacks cross-partition produce batching (a throughput ceiling `franz-go` doesn't share) came from research earlier in this planning process, not independently re-verified in this pass - worth a quick confirm against each library's current docs before treating it as fully settled, since this kind of detail can shift between library versions. The broader "pure Go, more actively maintained" reasoning is on firmer ground and less likely to have changed. The trade-off either way is a slightly steeper initial learning curve, closer to the raw Kafka protocol than `kafka-go`'s thinner abstraction - a one-time cost with solid documentation available.
- **Message types:** `go-sdk` (org repo) - proto-generated Go types, installed as a Go module dependency. A new `iot/v1` package needs authoring first - see section 3.2.
- **Retry/backoff:** [`cenkalti/backoff/v5`](https://github.com/cenkalti/backoff) - see section 3.3 for the transient-vs-permanent failure handling pattern.
- **Redis client:** `go-redis`, connecting to `gridx-redis:6379`.
- **TimescaleDB/Postgres client:** `pgx`, using `IOT_SERVICE_USER`/`IOT_SERVICE_PASSWORD` and scoped to `iot_data` only. From another container on the Compose network it connects to `gridx-timescaledb:5432`; a process running directly on the host uses the published endpoint `localhost:5433`. Both endpoints belong in runtime configuration rather than application code.
- **Migrations:** `pressly/goose` - see section 6.3.
- **Testing:** `testify` (assertions) for unit and mocked-dependency tests; `testcontainers-go` (`modules/kafka`, `modules/postgres`, `modules/redis`) for integration tests - see section 10.
- **Logging:** stdlib `log/slog` - sufficient for a service this size, no reason to pull in a third-party logger.
- **gRPC (future):** protobuf-defined service, not implemented yet - see section 8.
- **Infrastructure:** runs as a new container alongside the existing `gridx-infra` services - Kafka, Redis, and TimescaleDB are already bootstrapped there.

---

## 10. Testing strategy

Four tiers, mirroring the IoT Simulator's own testing discipline (161 tests, CI-enforced) adapted for a service whose real dependencies are Kafka/Redis/Postgres rather than pure computation.

**Tier 1 - Unit tests.** No containers, no network, milliseconds each. Table-driven, using `testify/require`. For the current ingestion path, covers JSON→domain mapping for every `device_class`/`asset_type` value plus at least one invalid one, the missing-`storage_assets` case, the transient-vs-permanent error classifier from section 3.3, unknown grids as permanent validation failures, and atomic grid-registry snapshot replacement. Protobuf/domain mapping tests belong to the future internal gRPC boundary when that interface is implemented.

**Tier 2 - Mocked-dependency tests.** Still no containers - these test *control flow*, not whether Redis/Postgres itself behaves correctly. Define narrow interfaces (`HotStore`, `WarmStore`, `GridLoader`) that real clients implement in production and fakes implement in tests. Answers questions like: does Kafka consumption remain stopped until the initial grid snapshot loads? Does a failed runtime refresh preserve the last known-good snapshot? Does an unknown grid skip all registry, telemetry, and Redis writes and go straight to `ingestion_failures` without querying Postgres? Does the offset remain uncommitted until either normal processing succeeds or the failure is durably recorded?

**Tier 3 - Integration tests via `testcontainers-go`.** Real, ephemeral containers spun up per test run: `testcontainers-go/modules/kafka` (KRaft-mode), `testcontainers-go/modules/postgres` (works against a `timescale/timescaledb` image too, since it's still Postgres underneath), `testcontainers-go/modules/redis`. Answers: do goose migrations apply clean on a fresh schema? Does startup bootstrap load the seeded grids before consumption begins? Does inserting a new grid become visible after a runtime refresh without restarting the service? Does a refresh failure retain the old snapshot? Is the `meter_readings` upsert genuinely idempotent (write the same `house_id`/`time`/`seq` twice, assert exactly one row)? Does a second heartbeat for a known house update only `last_heartbeat_at`, not `device_class`? Are unknown-grid meter readings and heartbeats quarantined without creating a grid or writing to Redis? Is a known house rejected if a heartbeat reports it under a different grid?

**Tier 4 - Manual, one-time, end-to-end.** Real simulator, real Kafka Connect, real this-service, actually pointed at each other. This is where section 13's still-open live-verification item gets closed for good - no amount of testcontainers substitutes for checking the actual seam between this service and the real upstream pipeline.

**CI note for whoever sets up the pipeline (team member, per section 12):** Tier 3 needs Docker available on the runner. GitHub's default `ubuntu-latest` runners have it preinstalled, so this is usually a non-issue, but worth confirming before debugging a mysteriously failing pipeline.

---

## 11. Repository structure (proposed)

**Note on `internal/health/` below:** `/healthz` provides basic process liveness to match the other services in `gridx-infra`. `/readyz` is now required by the startup-bootstrap design in section 6.5: it must remain false until the initial grid registry has loaded and Kafka consumption is safe to start.

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

---

## 12. Things we still need to decide as a team

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

## 13. Note on the Kafka Connect connector setup

**Status: topic pattern and JSON payload handling are settled; live end-to-end verification remains before this is fully closed out.**

- ~~File(s) to change~~ - done: replaced by `mqtt-connector-meter.json` and `mqtt-connector-heartbeat.json`.
- ~~Registration script~~ - confirmed: `scripts/register-connectors.sh` correctly references both new files and POSTs each to the Kafka Connect REST API. Must be run manually after `docker compose up -d` - it does not run automatically.
- **No protobuf-related connector change is needed:** the connector continues forwarding the simulator's JSON payload bytes unchanged. Protobuf is introduced only at future internal service boundaries (section 3.1).
- **Not yet confirmed:** live, end-to-end verification - run the IoT Simulator, confirm both connectors are running via Kafka Connect's REST API or `scripts/health-check.sh`, consume sample records from `iot.meter-readings` and `iot.heartbeats`, and verify their JSON values, record keys, and partitions.
