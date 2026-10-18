---
connie-title: IoT ingestion and IoT simulation Connection
---

# IoT ingestion and IoT simulation Connection

This triggers after iot ingestion and DEWA registration flow is done. At this stage, our system will have a user id and a corresponding smart meter id. But we need more info in our system to actually make it work. Info such as house, grid which it is connected to, etc...

## The Registration Flow trigger

After the first registration flow is done, IoT ingestion and dispatch service must sent a actuation command over mqtt to iot simulation. THen it must await a response from iot simulation over mqtt. This response will have the details to successfully register the smart meter info and user registration to database.

### 1. Actuation command

* **MQTT Topic:** `gridx/simulator/actuation/commands` (or `ACTUATION_COMMAND_TOPIC`)
* **Request Payload Example:**

```json
{
  "action": "ACTIVATE_METER",
  "house_id": "HOUSE-456",
  "meter_id": "METER-123",
  "timestamp": "2026-10-18T02:00:00Z"
}
```

### 2. Simulation Response & Registration Payload

Upon receiving the ACTIVATE_METER command:

1. The simulation updates its SQLite database, flipping `is_active = 1` for the specified house/meter and attaching default metadata.
1. The simulation immediately publishes a rich Registration / Onboarding Payload back to the core ingestion pipeline.
    - Payload Structure:

    ```json
    {
        "event_type": "METER_REGISTERED",
        "timestamp": "2026-10-18T02:00:05Z",
        "data": {
            "house_id": "HOUSE-456",
            "smart_meter_id": "METER-123",
            "grid_id": "Grid01",
        }
    }
    ```

**NOTE**: The payload structure is subject to change. The above is just an example!

### 3. Core Processing

The core IoT Service consumes this `METER_REGISTERED` event from Kafka,, and performs an UPSERT into the core production database tables, fully satisfying the ER diagram constraints. Subsequent simulation ticks will then stream standard telemetry readings tied to this newly registered active meter.