---
connie-title: IoT Ingestion - Heartbeat processing
---

# Heartbeat processing - device discovery flow

The heartbeat path is responsible primarily for **liveness, identity validation, and synchronization of observed asset information**.

A heartbeat must **not be treated as the authoritative asset-registration mechanism**. Asset registration should eventually happen through a separate user-facing or administrative flow, such as an Asset Management API used by the frontend.

The heartbeat may report assets that the smart meter or IoT gateway has discovered, but discovery does not automatically mean that the asset is trusted, owned by the reporting user, approved for trading, or eligible for dispatch.

The intended separation is:

```text
User / Admin
     │
     ▼
Asset Registration Flow
     │
     ▼
Authoritative asset registry
     │
     ▼
pending / active / disabled asset


Smart Meter / Simulator
     │
     ▼
Heartbeat
     │
     ▼
Observed asset information
```

A future registration flow may therefore create an asset with a state such as `pending`, after which a heartbeat can confirm that the expected physical asset is actually visible from the corresponding house or meter.

For example:

```text
User registers battery17 for house42
        │
        ▼
flexible_assets
status = pending
        │
        ▼
Heartbeat reports battery17
        │
        ▼
Validate:
asset_id = battery17
house_id = house42
meter identity is correct
        │
        ▼
Asset may be verified / activated
```

The exact registration and verification workflow is not finalized yet, but the ingestion service should be designed so that heartbeat processing does not become the authoritative ownership or registration API.

## Heartbeat processing sequence

When a `Heartbeat` message is consumed from Kafka, this service performs the following, **in order**:

```text
Heartbeat Kafka message
        │
        ▼
Decode / validate
        │
        ▼
Check grid in-memory
        │
        ▼
Validate duplicate asset IDs in payload
        │
        ▼
BEGIN PostgreSQL transaction
        │
        ├── Validate/update house liveness
        │
        ├── Validate asset ownership
        │
        └── Insert/update ONLY changed asset capabilities
        │
        ▼
COMMIT
        │
        ▼
Atomic Redis heartbeat update
        │
        ├── HSET status
        ├── EXPIRE 600
        └── SADD grid membership
        │
        ▼
Commit Kafka offset
```

---

## Step 0 - Decode and validate the heartbeat

Decode the Kafka record into the heartbeat input type and validate required fields before starting any database transaction.

At minimum validate:

* `grid_id`
* `house_id`
* `meter_id`
* heartbeat status
* asset IDs
* asset types
* capability values

Asset IDs contained within one heartbeat must also be unique.

For example, this must be rejected before starting the database transaction:

```text
flexible_assets:
    battery17
    battery17
```

Duplicate IDs in one heartbeat make the reported asset inventory ambiguous.

---

## Step 1 - Admission, validate the provisioned grid

Look up `grid_id` in the current immutable in-memory grid-registry snapshot from [05-startup-registry.md](05-startup-registry.md).

Continue only when the grid exists.

This lookup must **not query Postgres for every heartbeat**.

If the grid is absent:

* perform no house writes;
* perform no asset writes;
* perform no telemetry writes;
* perform no Redis writes;
* use the permanent-failure path from [01-kafka-consumption.md](01-kafka-consumption.md).

Grid provisioning remains authoritative configuration. A heartbeat must never create a new grid.

---

## Step 2 - Begin PostgreSQL transaction

House identity, liveness, and asset synchronization are handled inside one PostgreSQL transaction.

```text
BEGIN

validate/update house
validate assets
synchronize changed asset capabilities

COMMIT
```

This ensures that the service does not accept the house portion of a heartbeat while only partially accepting its associated asset state.

If a permanent identity conflict or database failure occurs before commit, roll back the complete heartbeat transaction.

---

## Step 2.1 - Validate house identity and update liveness

**NOTE:** House registration integrates with a separate registration/provisioning flow that is not yet finalized.

For the initial implementation, assume that the house already exists before its heartbeat is accepted.

Use the service/broker receive timestamp for liveness rather than trusting a device-generated timestamp.

The timestamp should preferably be generated once in the application:

```go
receivedAt := time.Now().UTC()
```

and reused for both PostgreSQL and Redis.

Update the existing house:

```sql
UPDATE iot_data.houses
SET last_heartbeat_at = $4
WHERE house_id = $1
  AND grid_id = $2
  AND meter_id = $3
RETURNING house_id;
```

Parameters:

```text
$1 = house_id
$2 = grid_id
$3 = meter_id
$4 = heartbeat receive time
```

If exactly one row is returned, the house identity is valid and its durable liveness timestamp has been updated.

If no row is returned, possible causes include:

* unknown house;
* house belongs to another grid;
* meter identity does not match the registered house.

Until the house-registration flow is finalized, classify this as an identity/provisioning failure rather than automatically creating or moving the house.

Heartbeat processing must never silently change:

* house ownership;
* grid membership;
* meter identity.

---

## Step 2.2 - Asset registration versus asset discovery

Flexible assets should eventually be registered through a separate authoritative workflow.

For example:

```text
Frontend
   │
   ▼
API / Some backend flow (not finalized)
   │
   ▼
flexible_assets
```

A user might register:

* a battery;
* an EV;
* another supported flexible asset.

The authoritative registry may eventually contain fields such as:

```text
asset_id
house_id
asset_type
registration_status
trading_enabled
dispatch_enabled
created_at
updated_at
```

Possible registration states could include:

```text
pending
active
disabled
```

The exact states remain a future design decision.

A heartbeat may then be used to **observe or verify** an asset rather than establish ownership.

Conceptually:

```text
Heartbeat reports asset
        │
        ▼
Does asset exist?
        │
        ├── Yes, same house
        │      │
        │      ▼
        │   validate and synchronize
        │
        ├── Yes, different house
        │      │
        │      ▼
        │   permanent identity conflict
        │
        └── No
               │
               ▼
        discovered / pending handling
```

For the initial implementation, an unknown observed asset may be stored with a pending/discovered state if the schema supports this.

However, discovering an asset through heartbeat must **not automatically grant it**:

* ownership;
* trading permission;
* dispatch permission;
* settlement eligibility;
* user consent.

These belong to the authoritative asset-registration flow.

---

## Step 2.3 - Validate asset ownership

For every reported asset, ensure that an already-registered `asset_id` belongs to the same `house_id`.

An asset that already belongs to another house must never be silently reassigned because another smart meter reports it.

For example:

```text
Registry:

battery17 → house42

Heartbeat:

house99 reports battery17
```

This is an identity conflict.

The transaction must be rolled back and the heartbeat classified as a permanent failure.

Ownership validation and capability synchronization should be treated as logically separate operations.

A missing `RETURNING` row from an UPSERT should not by itself be used to determine ownership, because unchanged capability values may intentionally result in no update.

---

## Step 2.4 - Synchronize only changed asset capabilities

Heartbeat messages may contain device-reported technical information such as:

* `capacity_kwh`;
* `max_charge_kw`;
* `max_discharge_kw`;
* `v2g_capable`.

These values change rarely.

The ingestion service should therefore **not rewrite every asset row on every heartbeat when nothing changed**.

Repeated unnecessary updates create additional:

* PostgreSQL WAL;
* row versions;
* vacuum work;
* disk I/O;
* transaction work.

Use a conditional UPSERT.

For example:

```sql
INSERT INTO iot_data.flexible_assets (
    asset_id,
    house_id,
    asset_type,
    capacity_kwh,
    max_charge_kw,
    max_discharge_kw,
    v2g_capable,
    created_at,
    updated_at
)
VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $8
)
ON CONFLICT (asset_id) DO UPDATE SET
    capacity_kwh = EXCLUDED.capacity_kwh,
    max_charge_kw = EXCLUDED.max_charge_kw,
    max_discharge_kw = EXCLUDED.max_discharge_kw,
    v2g_capable = EXCLUDED.v2g_capable,
    updated_at = EXCLUDED.updated_at
WHERE iot_data.flexible_assets.house_id = EXCLUDED.house_id
  AND (
      iot_data.flexible_assets.capacity_kwh
          IS DISTINCT FROM EXCLUDED.capacity_kwh

      OR iot_data.flexible_assets.max_charge_kw
          IS DISTINCT FROM EXCLUDED.max_charge_kw

      OR iot_data.flexible_assets.max_discharge_kw
          IS DISTINCT FROM EXCLUDED.max_discharge_kw

      OR iot_data.flexible_assets.v2g_capable
          IS DISTINCT FROM EXCLUDED.v2g_capable
  );
```

This gives the following behavior:

```text
New asset
    → INSERT

Known asset, capability changed
    → UPDATE

Known asset, nothing changed
    → no unnecessary UPDATE
```

Heartbeat processing should not overwrite authoritative business fields such as:

* user ownership;
* trading permission;
* dispatch permission;
* registration status;
* consent.

Those values belong to the asset-management domain.

If necessary later, the platform may distinguish configured values from device-reported values, for example:

```text
configured_capacity_kwh
reported_capacity_kwh
```

That decision is not required for the initial implementation.

---

## Step 2.5 - Asset inventory semantics

The heartbeat contract must define whether `flexible_assets` represents:

### Complete snapshot

The heartbeat means:

> "These are all assets currently visible for this house."

Under this semantic, an asset previously observed but absent from a later heartbeat may represent removal or disconnection.

However, assets should generally **not be physically deleted immediately**.

A safer future approach is to update state such as:

```text
last_seen_at
observed = false
disconnected
```

rather than deleting authoritative registration records.

### Partial report

The heartbeat means:

> "These are some assets currently being reported."

Under this semantic, absence means nothing and the ingestion service must never infer asset removal.

The simulator contract must explicitly decide between these meanings before removal/disconnection logic is implemented.

Until confirmed, heartbeat processing should not delete registered assets simply because they were omitted.

---

## Step 2.6 - Possible batching of asset synchronization

Most houses are expected to have only a small number of flexible assets, for example:

```text
0-1 battery
0-1 EV
```

For this scale, processing asset synchronization inside the heartbeat transaction is acceptable and keeps the implementation straightforward.

If future devices report significantly larger asset inventories, individually executing one SQL statement per asset could increase transaction time and database round trips.

Possible future optimizations include:

* PostgreSQL multi-row `INSERT`;
* batch UPSERT;
* `pgx.Batch`;
* staging multiple capability changes and applying them in one operation.

For example:

```text
Current expected case:

Heartbeat
    ├── battery
    └── EV

2 asset operations
```

does not justify additional batching complexity.

Batching should therefore be considered an optimization for larger asset inventories rather than a requirement for the initial implementation.

Database concurrency itself should remain bounded. The Kafka consumer should not allow an unlimited number of goroutines to simultaneously acquire PostgreSQL connections.

---

## Step 2.7 - Commit the PostgreSQL transaction

The house liveness update and all asset validation/synchronization operations commit atomically.

```text
house valid
+
all assets valid
+
all required writes successful
        │
        ▼
COMMIT
```

If any permanent asset identity conflict or database error occurs:

```text
ROLLBACK
```

A database failure must not leave the house liveness record updated while only some of its reported assets were processed.

---

## Step 3 - Hot storage update in Redis

Run the Redis heartbeat update **only after the PostgreSQL transaction commits**.

Redis represents current operational liveness.

Update:

```text
HSET house:{house_id}:status status "online" last_heartbeat_at "<received_at>"
EXPIRE house:{house_id}:status 600
SADD grid:{grid_id}:houses {house_id}
```

These should be executed as one atomic heartbeat operation, using the Redis Lua-script approach described in the hot-storage design.

Conceptually:

```text
Postgres COMMIT
      │
      ▼
Redis atomic update
      │
      ├── HSET
      ├── EXPIRE
      └── SADD
```

The same broker/service receive timestamp used for PostgreSQL should be written to Redis.

If device event time is introduced later, store it separately.

Do not use an untrusted device timestamp as the authoritative liveness timestamp because an incorrect future clock could otherwise cause a device to appear online incorrectly.

---

## Step 4 - Redis failure and retry behavior

If PostgreSQL commits successfully but Redis fails:

```text
Postgres
   ✓ committed

Redis
   ✗ failed

Kafka offset
   ✗ not committed
```

The heartbeat should be retried.

The processing operations are designed to make replay safe:

* the house liveness update is repeatable;
* unchanged asset capabilities do not require repeated writes;
* asset ownership cannot silently change;
* Redis `HSET`, `EXPIRE`, and `SADD` are repeatable.

On retry:

```text
Postgres transaction
      │
      ▼
Redis update
      │
      ▼
success
```

Only after the complete required processing succeeds should the Kafka offset be committed.

---

## Step 5 - Commit Kafka offset

The Kafka offset is committed only after:

```text
PostgreSQL processing succeeded
        +
Redis heartbeat update succeeded
```

Therefore:

```text
Heartbeat
    │
    ▼
Postgres COMMIT
    │
    ▼
Redis success
    │
    ▼
Kafka offset COMMIT
```

If permanent validation fails, follow the permanent-failure handling rules from [01-kafka-consumption.md](01-kafka-consumption.md), including durable failure recording before committing the failed Kafka record.

---

# What heartbeat is allowed to update

Heartbeat processing may update operational or observed information such as:

```text
house.last_heartbeat_at

observed asset capabilities
    capacity_kwh
    max_charge_kw
    max_discharge_kw
    v2g_capable

asset last-seen/verification information
    if introduced later
```

Heartbeat processing must not independently modify authoritative configuration such as:

```text
asset owner
house ownership
grid assignment
meter assignment
trading permission
dispatch permission
user consent
```

The general rule is:

> **Registration establishes trust and ownership. Heartbeat establishes presence, liveness, identity consistency, and observed device capabilities.**

---

# What does not get written to Redis on heartbeat

Asset capability specifications are not duplicated into Redis during heartbeat processing.

For example:

```text
capacity_kwh
max_charge_kw
max_discharge_kw
v2g_capable
```

remain in the PostgreSQL registry.

Redis remains focused on live operational state:

```text
house status
last heartbeat time
grid membership
latest telemetry
```

Static or rarely changing hardware specifications are already efficiently retrievable from PostgreSQL through indexed registry queries.

---

# Performance considerations

Heartbeat processing uses ordinary PostgreSQL registry tables while analytical meter data is written into TimescaleDB hypertables.

For example:

```text
Ordinary PostgreSQL tables
    houses
    flexible_assets

Timescale hypertables
    meter_readings
    storage_asset_readings
```

Heartbeat updates therefore do not directly contend with telemetry inserts through row locking because they operate on different tables.

They still share database resources such as:

* PostgreSQL connections;
* CPU;
* WAL;
* disk I/O;
* buffer cache;
* autovacuum capacity.

The initial design keeps this overhead controlled by:

1. performing grid admission in memory;
2. updating only one house liveness row per heartbeat;
3. avoiding unnecessary asset capability updates;
4. keeping heartbeat transactions short;
5. keeping asset inventories small;
6. using bounded PostgreSQL connection/concurrency limits;
7. considering batch synchronization only if asset inventories grow significantly.

If the platform eventually operates at substantially larger scale, the durable `last_heartbeat_at` PostgreSQL update may also be rate-limited independently from Redis liveness updates.

For example:

```text
Redis
    update every heartbeat

Postgres
    persist last heartbeat less frequently
```

This is a future optimization only and should not be introduced until measurements demonstrate that heartbeat writes are a meaningful bottleneck.
