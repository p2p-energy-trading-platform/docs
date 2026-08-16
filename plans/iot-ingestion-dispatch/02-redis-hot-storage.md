---
connie-title: IoT Ingestion - Redis Hot Storage
---


# Redis - hot storage design

Hot storage answers one question fast: **"what is this house doing right now?"** No history, just the latest state, overwritten every time a new reading arrives.

Key structure, with explicit Redis data types:

| Key pattern | Redis type | Value / fields | Purpose |
|---|---|---|---|
| `meter:{grid_id}:{house_id}:latest` | **STRING** (JSON-serialized internal projection) | Latest reading plus `event_time` and `seq` | Fast lookup of current solar/consumption/net/storage state. Updated conditionally, not with an unconditional `SET`. |
| `house:{house_id}:status` | **HASH** | `status` (online/offline), `last_heartbeat_at` | Two related fields updated together on every heartbeat via `HSET`, read via `HGETALL`. A HASH (not a STRING) is used here since it's a small structured record where individual fields make sense to reference directly. |
| `grid:{grid_id}:houses` | **SET** | Members = house IDs | Membership set for "which houses exist in this grid," via `SADD`/`SREM`/`SMEMBERS`. `SADD` is naturally idempotent, so it's safe to call on every heartbeat without checking existence first. |

**TTL behavior:** `house:{house_id}:status` gets a **10-minute TTL** (confirmed by team member) via `EXPIRE`, refreshed on every heartbeat - if no heartbeat arrives within that window, the key expires and a consumer can infer the house has gone quiet. `meter:{grid_id}:{house_id}:latest` has no TTL (always overwritten). `grid:{grid_id}:houses` also has no TTL - grid membership shouldn't silently expire just because a house happened to go quiet for a while.

**Atomic heartbeat update:** execute the heartbeat's `HSET`, `EXPIRE`, and `SADD` operations in one small Redis Lua script. Redis runs a script atomically, preventing a crash between `HSET` and `EXPIRE` from leaving a status key without its required TTL and preventing readers from observing a partially-applied heartbeat update. Pass the status and grid-membership keys through `KEYS` and values/TTL through `ARGV`; load the script once and invoke it by SHA rather than sending its source on every heartbeat. Keep the script limited to these constant-time commands because a running Lua script blocks other Redis work until it completes. If Redis Cluster is introduced later, the multi-key script will also require both keys to use a compatible hash-tag strategy so they occupy the same hash slot.

**Out-of-order protection:** at-least-once delivery and retries mean an older reading can arrive after a newer one. A second Lua script compares incoming `event_time` and `seq` with the stored projection and writes only if the input is newer. Duplicate input is a no-op. This prevents a replay from regressing the gRPC `GetLatestReading` response. Unit and integration tests must cover older, equal, and newer inputs.

**Cache role:** TimescaleDB is the durable authority; Redis is a rebuildable projection. Define a bounded rebuild/reconciliation command that repopulates latest readings and current memberships from TimescaleDB after Redis loss. Readiness should distinguish ingestion capability from query degradation: if the chosen acknowledgement policy requires Redis success, consumption pauses; otherwise ingestion continues and exposes a degraded-cache metric until reconciliation completes.

**Production controls:** configure TLS/authentication according to the deployment network, connection and command timeouts, a bounded pool, maximum retries, memory limit, and an explicit eviction policy. Do not allow a generic `allkeys-*` eviction policy to silently remove liveness or latest-state keys without accepting that behavior at the product level. Redis key values are internal projections and must not reuse the external JSON wire struct by accident.
