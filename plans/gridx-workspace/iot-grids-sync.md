---
connie-title: IoT Grid Data Syncing
---

# IoT Grid Data Syncing

The IoT simulation is outside our system and IoT ingestion and Dispatch Service is inside our system. However grid data is crucial and must be synced with both systems before the system is run. Even matching engine requires grid to grid mapping data that must be loaded into a kafka compact topic before matching engine can use that to make cross zone matching decisions.

## Seed / Provision system

There must be a script or trigger that initializes, validates this before the whole system runs.

1. Actual Source of truth of grids: This exists in `iot-simulation` under `config/grids.yaml`
1. Our system's source of truth of grids: `iot-ingestion-dispatch` tables
