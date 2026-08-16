---
connie-title: IoT Ingestion - Dispatch Service
---


# Dispatch Service (planned - not implemented in this phase)

**This section reflects the team's current best understanding, explicitly flagged by the team member as "not properly planned" yet - treat everything below as a rough direction, not a locked design.**

- **The current rough idea:** an **Order Service** (not yet part of this plan's scope) makes a **gRPC call** to the Dispatch Service to request a change - e.g. "reduce this house's battery stored energy" - based on **user preferences** rather than a raw trade signal.
- **Dispatch Service's job**, once triggered: translate that request into an actuation command and publish it to the IoT Simulator's `gridx/actuation` MQTT topic, targeting the correct `house_id` and `asset_id`.

The IoT Simulator already has the receiving end of this built and tested - this service is the missing sender.

**Not being built this phase.**