---
connie-title: IoT Simulator and IoT service Registration
---

# IoT simulation and Registration with IoT service

There is a frontend client to iot service and DEWA mock app registration flow. This is for the user facing flow. This flow will end with a user account tied to a smart meter id, but a single smart meter id is not useful, we also need additional information. The following services `iot-simulation` and `dewa-mock-app` exists outside our system but there is another issue `iot-simulation` and `dewa-mock-app` do not communicate with each other. This is for simplicity sake and also how it would function normally in a 3rd party utility service. The solution is to trigger a secondary registration flow after frontend client, `iot-ingestion-dispatch` and `dewa-mock-app` registration flow is done. This secondary registration is as follows.

## The actuation command trigger

The iot simulation will receive an actuation command that it must process during the loop and update the specific smart meter / house `is_active` status to true. It must also publish the registration payload back over mqtt to iot service. This will allow the iot service to register all the house details. 

**NOTE**: This must also sync the in memory house state according to the sqlite database.

The additional info are referenced in [iot registration doc](../iot-ingestion-dispatch/13-iot-service-simulation-connection.md)