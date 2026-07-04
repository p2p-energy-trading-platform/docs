---
connie-title: IoT Ingestion & Dispatch Service
---

# IoT Ingestion & Dispatch Service

This service sits behind the apache kafka. It is part of data pipeline and handles both iot smart meter feed data ingestion as well as dispatch pipeline for houses with batteries and energy storage mediums.

## 1. IoT Smart Meter data ingestion and storage

**NOTE**: Plan will be added later

## 2. Register IoT smart meter, check liveliness and ensure security

Handles registration of IoT smart meter (full flow of this is explained in [registration plan](../auth/registration_plan.md)), checks liveliness and can be used to register additional energy storage mediums on the fly and finally validates the payload by performing cryptogtaphic checks.

**NOTE**: Plan will be added later

## Dispatch Service

This service works alongside ingestion and it sends physical adjustment commands over MQTT to the simulation.

When the Dispatch Service confirms a physical adjustment must be applied to an energy storage medium, it connects as an MQTT client and issues an actuation packet directly down to the simulator's hardware control topic

Example topic structure: `grid01/[house_id]/actuator/battery/[battery_id]`

Example command / dispatch schedule:

```json
{
  "dispatch_id": "dsp_20260616_0042_001",
  "asset_id": "bat_001",
  "asset_type": "bess",
  "command": "set_power_kw",
  "target_kw": -3.0,
  "duration_seconds": 3600,
  "issued_at": "2026-06-16T14:00:00Z",
  "expires_at": "2026-06-16T15:00:00Z"
}
```

**NOTE**: This json structure and MQTT topic format is not finalized and some changes need to be made..
