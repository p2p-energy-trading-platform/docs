---
connie-title: IoT Ingestion - Timescaledb Warm Storage
---


# TimescaleDB - warm storage design

TimescaleDB is Postgres with a time-series extension (hypertables) layered on top. **Confirmed from `gridx-infra`'s bootstrap SQL:** this service gets exactly one schema, `iot_data`, provisioned inside the `gridx-timescaledb` container (host port 5433, internal 5432). Everything this service owns lives inside `iot_data`.

Within that single schema, the plan splits data into two categories: **plain tables (ER-style)** for things that rarely change (grids, houses, flexible assets), and **hypertables (time-series)** for the actual telemetry stream.

**Credentials:** the schema/user bootstrap lives in `gridx-infra/init-scripts/timescaledb/01-init-timescaledb.sql`. It currently creates `IOT_SERVICE_USER` as schema owner with public access revoked. Before production, split this into a migration owner and a runtime role: the application needs only connect/usage plus the exact table/sequence DML privileges, while `cmd/migrate` receives short-lived DDL credentials. Do not give every replica schema-owner credentials.

**Important operational note:** these init scripts run only **once**, the first time the container starts against an empty data volume. The application tables below should not be added by editing this bootstrap script - this service needs its own separate, versioned migration mechanism (see "Migration ownership" below).

**Confirmed by team member: heartbeats are not stored as time-series history.** A heartbeat only ever updates `last_heartbeat_at` on the relevant row in `iot_data.houses` - there is no `heartbeats` hypertable.

**ER diagram:** the team member will produce this manually from the table definitions below.

**NOTE**: The below schema definitions are not totally finalized yet but they serve as a starting point.

## Plain Postgres tables (schema: `iot_data`)

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
-- could drift out of sync with the Redis TTL projection.
CREATE TABLE iot_data.houses (
    house_id            TEXT PRIMARY KEY,
    meter_id            TEXT NOT NULL UNIQUE,
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

These get populated/updated from **heartbeat** messages as described in [06-heartbeat-processing.md](06-heartbeat-processing.md), since a heartbeat is what tells us a house or asset exists and what it is capable of.

This registry is not, by itself, proof that a device is authorized. In a production trust model, enrollment/provisioning must bind `meter_id`, `house_id`, and `grid_id` before telemetry is admitted, or the upstream MQTT identity/topic must provide an equivalently authenticated binding. Heartbeat discovery is suitable for the simulator environment only until that enrollment contract exists.

## Hypertables (analytical / time-series)

```sql
-- One row per meter reading, per house, per tick
CREATE TABLE iot_data.meter_readings (
    time                     TIMESTAMPTZ NOT NULL,
    meter_id                 TEXT NOT NULL,
    house_id                 TEXT NOT NULL,
    grid_id                  TEXT NOT NULL,
    seq                      BIGINT NOT NULL,
    solar_kw                 DOUBLE PRECISION NOT NULL,
    consumption_kw           DOUBLE PRECISION NOT NULL,
    net_kw                   DOUBLE PRECISION NOT NULL,
    weather_irradiance_wm2   DOUBLE PRECISION,
    cloud_cover_pct          DOUBLE PRECISION,
    schema_version           TEXT NOT NULL,
    PRIMARY KEY (meter_id, time, seq)
);

-- One day is an initial value, not a universal default. Confirm from measured
-- bytes/day and memory; target active chunk indexes that fit the capacity model.
SELECT create_hypertable('iot_data.meter_readings', 'time', chunk_time_interval => INTERVAL '1 day');
CREATE INDEX idx_meter_readings_grid_time ON iot_data.meter_readings (grid_id, time DESC);

-- One row per storage asset, per meter reading (normalized out of the meter
-- reading's storage_assets array - a house can have more than one asset).
CREATE TABLE iot_data.storage_asset_readings (
    time          TIMESTAMPTZ NOT NULL,
    seq           BIGINT NOT NULL,
    house_id      TEXT NOT NULL,
    asset_id      TEXT NOT NULL,
    soc_pct       DOUBLE PRECISION NOT NULL CHECK (soc_pct BETWEEN 0 AND 100),
    power_kw      DOUBLE PRECISION NOT NULL,
    asset_type    TEXT NOT NULL CHECK (asset_type IN ('bess','ev')),
    capacity_kwh  DOUBLE PRECISION NOT NULL CHECK (capacity_kwh > 0),
    plugged_in    BOOLEAN NOT NULL,
    PRIMARY KEY (time, seq, asset_id)
);
SELECT create_hypertable('iot_data.storage_asset_readings', 'time', chunk_time_interval => INTERVAL '1 day');
CREATE INDEX idx_storage_asset_readings_house_time ON iot_data.storage_asset_readings (house_id, time DESC);
```

The migration must also add range and identity checks that are part of the accepted wire contract (non-empty IDs, finite numeric values, non-negative generation/consumption/capacity, cloud cover in `0..100`, and a documented tolerance for `net_kw = solar_kw - consumption_kw`). The protobuf draft uses `uint64` for `seq` while Postgres uses signed `BIGINT`; either validate `seq <= math.MaxInt64` at the boundary or change both contracts before release. Reject invalid records before storage; database checks are the final guard, not the primary validation layer.

`meter_readings` is the parent record. Insert it and all of its `storage_asset_readings` in one Postgres transaction using a bounded batch or `COPY`-style path after profiling. Replays use `INSERT ... ON CONFLICT DO NOTHING`; a conflict with the same identity but different values is a data-integrity alert, not an update. The service must not silently rewrite historical telemetry.

**Confirmed by team member: retention window is 6 months.**

```sql
SELECT add_retention_policy('iot_data.meter_readings', INTERVAL '6 months');
SELECT add_retention_policy('iot_data.storage_asset_readings', INTERVAL '6 months');
```

Because archival is outside scope, this permanently deletes data older than six months. This is a product retention decision and must be reflected in privacy policy, backups, and user expectations.

**Version-dependent decision:** TimescaleDB's older compression API was replaced by [Hypercore/columnstore APIs](https://docs.timescale.com/api/latest/hypercore/add_columnstore_policy/) in recent releases. Pin the deployed TimescaleDB image first, then write and integration-test the matching migration. The following is valid only for releases that support the older compression API; do not copy it blindly into a newer image:

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

## Migration tooling

**Recommendation: [`pressly/goose`](https://github.com/pressly/goose).** It supports SQL migrations and `embed.FS`, so migrations can ship with the migration command. Since this service talks to one database engine, broader multi-database driver support is not a deciding factor.

```bash
go install github.com/pressly/goose/v3/cmd/goose@<pinned-version>
```

Migration files live under `migrations/`, embedded into the service binary from a small migration package, and are applied by a dedicated `cmd/migrate` command or one controlled deployment job. Every application replica running `goose.Up()` at startup creates avoidable lock and rollout coupling. Application startup may verify that the expected schema version is present, but production migrations have a single owner and run before replicas become ready.

Each migration needs a tested down/forward-recovery policy. Destructive rollback is not assumed safe: for an incompatible schema change, prefer expand/migrate/contract across releases. CI applies all migrations to an empty TimescaleDB instance and upgrades a fixture database from the previously released schema.
