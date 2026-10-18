---
connie-title: IoT Simulator Data Persistence
---

# Explanation for persistence requirement

IoT simulation currently does not have a persistent store to save houses or grid info. This is needed for the registration flow.

## Recommended packages for persistence

The following packages are recommended for the persistence store:

- Sqlite
- Drizzle ORM

## ER diagram

The following structure for ER diagram is preferable:

1. `grids` table:
    - grid_id
    - lat
    - lon
1. `houses` table:
    - house_id
    - smart_meter_id
    - grid_id
    - device_class
    - load_archetype
    - load_scale_factor
    - rated_solar_kw
    - panel_efficiency_factor
    - is_active
    - (and other options)
1. `flexible_assets` table:
    - asset_id
    - house_id
    - asset_type
    - capacity_kw

## Bootstrapping & Seeding logic

Presently houses are generated randomly on every startup, to ensure that the state is persisted unless someone manually resets the tables, we have to follow the following startup rules:

1. Startup Check: When bootstrap() runs, check if the SQLite database file (e.g., sim_state.sqlite) already exists and contains records.
1. Path A (First Run / Empty DB):
    - Parse grids.yaml.
    - Run HouseFactory to generate the initial topology.
    - Seed SQLite: Insert all grids, houses, and flexible assets into SQLite. Set is_active = 0 (or 1 depending on whether we want them pre-activated for testing).

1. Path B (Subsequent Restarts / Existing DB):
    - Skip generation entirely.
    - Load existing house states, flexible assets, and their current is_active status directly from SQLite into your runtime store.

## How SimState handles house states

SimState must now query data from the sqlite database instead of storing everything in memory only.

**NOTE**: Must consider optimizations techniques for the sim state to prevent sqlite from being chocked or facing severe locks.

## Handling actuation commands for registering houses

When the iot service sends actuation command after a successful user to iot smart meter registration between frontend client (web/mobile) and DEWA mock app, the iot simulation must

## Edge cases

There are numerous edge cases that we need to watch out for:

### Yaml config changes

If we change `config.yaml` and modify any of the grid info or add extra grids, then we must manually clear the table and rerun the seed or program.

Also both iot simulation (outside our system boundary) and iot service must agree on grids beforehand. There must be a separate cli command or something that enforces and runs this before the whole system runs. This must be enforced at `gridx-workspace` level. [Will be done later]

### Concurrent writes and scaling iot simulation

When scaling iot simulation we are faced with a huge issue. The following optimizations techniques must be considered.

- Enabling `PRAGMA journal_mode = WAL;`
- Enabling `PRAGMA synchronous = NORMAL;`
- SQLite used as source of truth. It boots only on startup and when actuation commands related to registration arrive.
- In-Memory Hot Loop for Telemetry: Once the simulation boots, load the active houses into an optimized in-memory structure.
- Batch flushing / dirty tracking: For state changes over time (like battery draining or charging), mark them as dirty and eventually batch save them to sqlite (every 30 seconds to 1 minute)

**NOTE [FOR FUTURE UNDERSTANDING]**: Once we implement user to smart meter registration completely and we have also enforced that strictness in the ingestion pipeline, we will be facing a problem where we can't actually scale the iot simulation until active users are provisioned / seeded and registered with the system. This would require another seed / provisioning system on `gridx-workspace` level and also sometimes a `user-simulation` system for scaling the whole system.
