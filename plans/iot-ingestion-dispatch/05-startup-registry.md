---
connie-title: IoT Ingestion - Startup Grid Registry
---

# Startup grid-registry bootstrap

Per-message queries to `iot_data.grids` would put database latency and load directly on both high-volume ingestion paths. Instead, each ingestion-service instance owns a small in-memory registry containing the currently provisioned grids. The snapshot may retain the full `grid_id`, `lat`, and `lon` records, although admission currently needs only an O(1) lookup by `grid_id`.

**Startup bootstrap order:**

1. Connect to TimescaleDB and apply goose migrations.
2. Load all provisioned grids with `SELECT grid_id, lat, lon FROM iot_data.grids`.
3. Validate the result and build a new immutable `map[string]Grid` snapshot. An empty registry is a startup error because this deployment expects the seed migration from section 6.4.
4. Publish the snapshot atomically, then mark grid admission ready.
5. Start the background registry refresher.
6. Only after those steps succeed, start the Kafka consumer and allow `/readyz` to report ready.

If the initial query fails or produces invalid data, fail closed: do not start Kafka consumption. The container can retry startup according to the deployment restart policy, but it must never run with an empty fallback allowlist or accept every grid as a fallback.

## Runtime grid-registry refresh

**Refreshing while the service is running:** use a configurable periodic full-snapshot refresh, defaulting to **120 seconds**. Grids are a small administrative registry, so one query per service instance every 120 seconds is inexpensive, predictable, and more reliable than using PostgreSQL `LISTEN/NOTIFY` alone, whose notifications can be missed while a connection is down.

**NOTE**: New grids will not get created frequently so having 30s interval is not really needed!

Each refresh performs the following:

1. Query all rows from `iot_data.grids` into a new map without changing the live snapshot.
2. Validate the complete result.
3. Atomically swap the new immutable snapshot into place using `atomic.Pointer` (or a short-held `RWMutex`). Readers see either the complete old snapshot or the complete new one, never a partially refreshed map.
4. Emit the loaded grid count, refresh duration, added/removed grid IDs, and `grid_registry_last_successful_refresh` metric/log field.

If a refresh fails, retain the last known-good snapshot, report the failure, and retry at the next interval. Never clear or partially mutate the live registry. Message handlers continue using the last known-good provisioned set and still perform no database query on a cache miss. This avoids turning arbitrary unknown IDs into database traffic.

For a new grid, the operational order is: provision the database row, wait until every ingestion instance reports a successful refresh containing that `grid_id`, and only then enable its telemetry publisher. Messages sent before that rollout completes are correctly quarantined as unknown-grid failures and require controlled manual replay. At this project's scale, periodic snapshot refresh is the recommended primary mechanism; a PostgreSQL notification may be added later only as a low-latency wake-up hint, while retaining periodic refresh as the recovery/reconciliation mechanism.

## Grid provisioning and admission control

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

If a new grid is added to the simulator's config later, provision it in `iot_data.grids` through a new migration (or a future authenticated administrative provisioning workflow) before enabling that grid's publisher. Deployment ordering is therefore: apply the grid-provisioning change, verify the row and its coordinates, and only then start or enable telemetry for that grid.

**Unknown grids are rejected, not auto-created.** Configuration drift between repositories is a realistic failure mode, but accepting it would turn a typo or untrusted message into a new administrative entity with incomplete metadata. Both meter-reading and heartbeat handlers therefore check the bootstrapped in-memory registry before any warm- or hot-storage write. An unknown `grid_id` follows section 3.3's permanent-failure path with `failure_stage = 'grid_validation'`. The durable failure row preserves the original payload for investigation and controlled manual replay after provisioning, while preventing the bad record from blocking its Kafka partition indefinitely.

Provisioning can be verified before enabling telemetry:

```sql
SELECT grid_id, lat, lon
FROM iot_data.grids
WHERE grid_id = $1;
```

The query must return exactly one row with the expected coordinates. `lat` and `lon` are `NOT NULL`, so partially provisioned placeholder grids cannot be admitted.