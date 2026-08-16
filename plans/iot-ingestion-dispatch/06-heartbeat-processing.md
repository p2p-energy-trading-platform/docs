---
connie-title: IoT Ingestion - Heartbeat processing
---


# Heartbeat processing - device discovery flow

This section spells out the exact flow, since a heartbeat can represent either a completely new device being seen for the first time, or a known device simply checking in again - both cases need to be handled cleanly, in both storage tiers, without creating duplicates.

When a `Heartbeat` message is consumed from Kafka, this service performs the following, **in order**:

**Step 0 - Admission, validate the provisioned grid:**

Look up `grid_id` in the current immutable in-memory grid-registry snapshot from [05-startup-registry.md](05-startup-registry.md). Continue only when the grid exists. This lookup must not query Postgres. If absent, perform no house, asset, telemetry, or Redis writes and use the permanent-failure path from [01-kafka-consumption.md](01-kafka-consumption.md).

**Step 1 - Warm storage transaction, house registry:**

```sql
-- device_class / rated_solar_kw intentionally are not overwritten on conflict:
-- changing them requires a deliberate administrative operation.
INSERT INTO iot_data.houses (house_id, meter_id, grid_id, device_class, rated_solar_kw, first_seen_at, last_heartbeat_at)
VALUES ($1, $2, $3, $4, $5, now(), now())
ON CONFLICT (house_id) DO UPDATE SET
    last_heartbeat_at = now()
WHERE iot_data.houses.grid_id = EXCLUDED.grid_id
  AND iot_data.houses.meter_id = EXCLUDED.meter_id
RETURNING house_id;
```

This handles simulator discovery and repeat liveness updates. No returned row means a known house was reported under a different grid or meter identity; treat that as a permanent identity failure. For production devices, replace insert-on-first-heartbeat with an enrollment lookup: telemetry must not self-authorize a new house merely by naming a known grid.

**Step 2 - In the same transaction, flexible asset registry (for each asset in the heartbeat's `flexible_assets` array):**

```sql
INSERT INTO iot_data.flexible_assets (asset_id, house_id, asset_type, capacity_kwh, max_charge_kw, max_discharge_kw, v2g_capable, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
ON CONFLICT (asset_id) DO UPDATE SET
    capacity_kwh = EXCLUDED.capacity_kwh,
    max_charge_kw = EXCLUDED.max_charge_kw,
    max_discharge_kw = EXCLUDED.max_discharge_kw,
    v2g_capable = EXCLUDED.v2g_capable,
    updated_at = now()
WHERE iot_data.flexible_assets.house_id = EXCLUDED.house_id
RETURNING asset_id;
```

Unlike the house record, asset specs **are** refreshed on every heartbeat. No returned row means an existing asset was reported for a different house; roll back the whole heartbeat transaction and classify it as a permanent identity conflict. Validate that asset IDs are unique within the heartbeat before starting the transaction.

The house and all asset updates commit atomically. A database error must not leave a house updated with only some of its assets. The payload needs an explicit asset-inventory semantic: if omitted assets mean "removed," mark or delete them transactionally; if the array is only a partial report, never infer removal. The current plan assumes a complete snapshot, but this must be confirmed against the simulator contract before implementation.

**Step 3 - Hot storage (Redis):**

```text
HSET house:{house_id}:status status "online" last_heartbeat_at "<now>"
EXPIRE house:{house_id}:status 600
SADD grid:{grid_id}:houses {house_id}
```

Both operations are safe to run unconditionally on every heartbeat, new device or not.

Run the Redis update only after the Postgres transaction commits. If Redis then fails, retrying is safe because the database statements and Redis commands are idempotent. Store the broker-receive time as `last_heartbeat_at`; if device event time is later added, keep it separately so a bad device clock cannot make a house appear online indefinitely.

**What does NOT get written to Redis on a heartbeat:** asset specs (capacity, max charge/discharge kw) are only stored in TimescaleDB's registry tables, not duplicated into Redis. Hot storage is for *live, frequently-changing state* - static hardware specs that change rarely are already fast to look up in Postgres via primary key.
