---
connie-title: IoT Ingestion - Redis Hot Storage
---


# Redis - hot storage design

Hot storage answers one question fast: **"what is this house doing right now?"** No history, just the latest state, overwritten every time a new reading arrives.

Key structure, with explicit Redis data types:

| Key pattern | Redis type | Value / fields | Purpose |
|---|---|---|---|
| `meter:{grid_id}:{house_id}:latest` | **STRING** (JSON-serialized) | Full JSON blob of the most recent meter reading | Fast lookup of current solar/consumption/net_kw/storage state per house. Written wholesale every tick via `SET`, read via `GET` - a STRING is the right fit since the whole reading always replaces the previous one atomically, never partially updated. |
| `house:{house_id}:status` | **HASH** | `status` (online/offline), `last_heartbeat_at` | Two related fields updated together on every heartbeat via `HSET`, read via `HGETALL`. A HASH (not a STRING) is used here since it's a small structured record where individual fields make sense to reference directly. |
| `grid:{grid_id}:houses` | **SET** | Members = house IDs | Membership set for "which houses exist in this grid," via `SADD`/`SREM`/`SMEMBERS`. `SADD` is naturally idempotent, so it's safe to call on every heartbeat without checking existence first. |

**TTL behavior:** `house:{house_id}:status` gets a **10-minute TTL** (confirmed by team member) via `EXPIRE`, refreshed on every heartbeat - if no heartbeat arrives within that window, the key expires and a consumer can infer the house has gone quiet. `meter:{grid_id}:{house_id}:latest` has no TTL (always overwritten). `grid:{grid_id}:houses` also has no TTL - grid membership shouldn't silently expire just because a house happened to go quiet for a while.

**Atomic heartbeat update:** execute the heartbeat's `HSET`, `EXPIRE`, and `SADD` operations in one small Redis Lua script. Redis runs a script atomically, preventing a crash between `HSET` and `EXPIRE` from leaving a status key without its required TTL and preventing readers from observing a partially-applied heartbeat update. Pass the status and grid-membership keys through `KEYS` and values/TTL through `ARGV`; load the script once and invoke it by SHA rather than sending its source on every heartbeat. Keep the script limited to these constant-time commands because a running Lua script blocks other Redis work until it completes. If Redis Cluster is introduced later, the multi-key script will also require both keys to use a compatible hash-tag strategy so they occupy the same hash slot.