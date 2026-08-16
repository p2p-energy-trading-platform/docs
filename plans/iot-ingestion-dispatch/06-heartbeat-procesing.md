---
connie-title: IoT Ingestion - Heartbeat processing
---


# Heartbeat processing - device discovery flow

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