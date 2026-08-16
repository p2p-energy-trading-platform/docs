---
connie-title: IoT Ingestion - Timescaledb Warm Storage
---


# TimescaleDB - warm storage design

TimescaleDB is Postgres with a time-series extension (hypertables) layered on top. **Confirmed from `gridx-infra`'s bootstrap SQL:** this service gets exactly one schema, `iot_data`, provisioned inside the `gridx-timescaledb` container (host port 5433, internal 5432). Everything this service owns lives inside `iot_data`.

Within that single schema, the plan splits data into two categories: **plain tables (ER-style)** for things that rarely change (grids, houses, flexible assets), and **hypertables (time-series)** for the actual telemetry stream.

**Credentials:** the schema/user bootstrap lives in `gridx-infra/init-scripts/timescaledb/01-init-timescaledb.sql`. It creates a dedicated `IOT_SERVICE_USER`, owning the `iot_data` schema exclusively, public access revoked platform-wide.

**Important operational note:** these init scripts run only **once**, the first time the container starts against an empty data volume. The application tables below should not be added by editing this bootstrap script - this service needs its own separate, versioned migration mechanism (section 6.3).

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

## Hypertables (analytical / time-series)

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

## Migration tooling

**Recommendation: [`pressly/goose`](https://github.com/pressly/goose).** Compared against `golang-migrate` on "best and simple": single-package setup vs. separate driver/source imports, native Go-migration support alongside plain SQL (useful for data seeds like section 6.4), native `embed.FS` support so migrations ship inside the compiled binary. Since this service only ever talks to one database engine, `golang-migrate`'s broader multi-database driver support isn't a relevant advantage here.

```bash
go install github.com/pressly/goose/v3/cmd/goose@latest
```

Migration files live under `internal/timescale/migrations/`, embedded via `embed.FS`, applied via `goose.Up()` programmatically on startup before the Kafka consumer starts.