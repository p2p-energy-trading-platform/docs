---
connie-title: MQTT to Kafka Pipeline
---

# MQTT-to-Kafka Connect Pipeline

* **Repository:** `gridx-infra`
* **Status:** Verified
* **Component:** IoT Data Ingestion Layer

> This document details the configuration, implementation, and verification steps for the MQTT-to-Kafka integration pipeline. The system bridges edge device telemetry from the Mosquitto MQTT broker into the Kafka commit log using Kafka Connect running the Lenses MQTT Source Plugin.

---

## Table of Contents

1. [Overview](#1-overview)
2. [System Components & Port Architecture](#2-system-components--port-architecture)
3. [Connector Configuration](#3-connector-configuration)
4. [Operational Loop Verification](#4-operational-loop-verification)
5. [Payload Serialization & Decoding](#5-payload-serialization--decoding)

---

## 1. Overview

The MQTT-to-Kafka pipeline consists of three layers:

```text
Edge Device / IoT Simulator
        │
        ▼ MQTT Publish
Mosquitto MQTT Broker (gridx-mqtt)
        │
        ▼ Kafka Connect (Lenses MQTT Source Plugin)
Kafka Connect Engine (gridx-kafka-connect)
        │
        ▼ Kafka Topic
Kafka Cluster (gridx-kafka)
Topic: gridx_telemetry__TOPIC
        │
        ▼
Downstream Sinks (TimescaleDB, S3, Market Data Service)
```

This architecture allows IoT simulators and edge devices to publish telemetry over lightweight MQTT while the platform consumes it from the persistent, replayable Kafka commit log.

---

## 2. System Components & Port Architecture

The following containerized services run under Docker Compose:

| Service | Container Name | Internal Port | External Port | Purpose |
|---|---|---|---|---|
| Mosquitto MQTT Broker | `gridx-mqtt` | `1883` | `1883` (Linux) / `8883` (Windows) | Ingests edge device telemetry over MQTT |
| Kafka Cluster | `gridx-kafka` | `29092` | `9092` | Persistent commit log for all platform events |
| Kafka Connect Engine | `gridx-kafka-connect` | — | — | Runs the Lenses MQTT Source Connector instance |

> **Note:** On Windows, port `1883` is reserved by WSL 2 / Hyper-V. The host port is mapped to `8883` instead. The internal container port remains `1883` in all environments.

---

## 3. Connector Configuration

The connector is instantiated via a JSON payload submitted to the Kafka Connect REST API.

**File:** `mqtt-connector.json`

```json
{
  "name": "mqtt-dynamic-source",
  "config": {
    "connector.class": "io.lenses.streamreactor.connect.mqtt.source.MqttSourceConnector",
    "tasks.max": "1",
    "connect.mqtt.hosts": "tcp://gridx-mqtt:1883",
    "connect.mqtt.client.id": "gridx_kafka_dynamic_bridge",
    "connect.mqtt.service.quality": "1",
    "connect.mqtt.kcql": "INSERT INTO gridx_telemetry__TOPIC SELECT * FROM gridx/devices/+/telemetry",
    "key.converter": "org.apache.kafka.connect.storage.StringConverter",
    "value.converter": "org.apache.kafka.connect.json.JsonConverter",
    "value.converter.schemas.enable": "false"
  }
}
```

### Configuration Field Reference

| Field | Value | Description |
|---|---|---|
| `connector.class` | `MqttSourceConnector` | Lenses MQTT Source Plugin class |
| `tasks.max` | `1` | Number of connector task workers |
| `connect.mqtt.hosts` | `tcp://gridx-mqtt:1883` | Internal Docker network address of the Mosquitto broker |
| `connect.mqtt.client.id` | `gridx_kafka_dynamic_bridge` | Unique MQTT client identifier for the bridge |
| `connect.mqtt.service.quality` | `1` | MQTT QoS level — at least once delivery |
| `connect.mqtt.kcql` | See below | Kafka Connect Query Language routing rule |
| `key.converter` | `StringConverter` | Kafka message key serialization format |
| `value.converter` | `JsonConverter` | Kafka message value serialization format |
| `value.converter.schemas.enable` | `false` | Disables embedded Avro/JSON schema metadata in payload |

### KCQL Routing Rule

```sql
INSERT INTO gridx_telemetry__TOPIC SELECT * FROM gridx/devices/+/telemetry
```

The `+` wildcard matches any single-level MQTT topic segment, meaning all device telemetry messages published to:

```plaintext
gridx/devices/{deviceId}/telemetry
```

are captured and routed into the Kafka topic `gridx_telemetry__TOPIC`.

> **Note:** The double underscore in `gridx_telemetry__TOPIC` is intentional — it is part of the configured topic name.

### Step 3.1 — Initialize the Infrastructure Stack

Before registering any configurations, ensure your Docker daemon is active and spin up the container infrastructure stack in detached mode from the root directory of your project:

```bash
sudo docker compose up -d
```

Verify that the core infrastructure containers (`gridx-mqtt`, `gridx-kafka`, and `gridx-kafka-connect`) are running and healthy:

```bash
docker ps
```

> **Note:** Wait approximately 10–15 seconds after the containers start to allow the Kafka Connect REST API engine to fully initialize its internal HTTP servers before proceeding to the next step.

---

### Step 3.2 — Register the Connector with Kafka Connect API

Submit the `mqtt-connector.json` file to the Kafka Connect REST interface using `curl`:

```bash
curl -X POST -H "Content-Type: application/json"   --data @mqtt-connector.json   http://localhost:8083/connectors
```

To verify that the connector was registered successfully and is actively running, query its status endpoint:

```bash
curl http://localhost:8083/connectors/mqtt-dynamic-source/status
```

A healthy response will show `"state": "RUNNING"` for both the connector and its tasks:

```json
{
  "name": "mqtt-dynamic-source",
  "connector": {
    "state": "RUNNING",
    "worker_id": "gridx-kafka-connect:8083"
  },
  "tasks": [
    {
      "id": 0,
      "state": "RUNNING",
      "worker_id": "gridx-kafka-connect:8083"
    }
  ]
}
```

---

## 4. Operational Loop Verification

Follow these steps to generate telemetry streams and verify data transit across the live pipeline.

### Step 4.1 — Publish a Telemetry Event from the Edge

Publish a JSON mock payload directly into the Mosquitto container targeting the dynamic routing path:

```bash
sudo docker exec -it gridx-mqtt mosquitto_pub   -t "gridx/devices/device001/telemetry"   -m '{"voltage": 230, "current": 5}'
```

This simulates an IoT edge device publishing a telemetry reading to the MQTT broker on the topic `gridx/devices/device001/telemetry`.

---

### Step 4.2 — Inspect Kafka Connect Activity

Observe the internal operations of Kafka Connect to confirm event ingestion and consumer offset commits:

```bash
sudo docker logs gridx-kafka-connect --tail 50
```

When operating correctly, the logs will show offset commit confirmations:

```text
INFO WorkerSourceTask{id=mqtt-dynamic-source-0} Committing offsets for 1 acknowledged messages
```

---

### Step 4.3 — Verify Stream Integrity in Kafka

Open a **new terminal tab or separate split window** (leaving your existing sessions open), then start a live console consumer session to read from the target Kafka topic from the beginning offset:

```bash
sudo docker exec -it gridx-kafka kafka-console-consumer   --bootstrap-server localhost:9092   --topic gridx_telemetry__TOPIC   --from-beginning
```

> **Note:** This command blocks the terminal and listens continuously for incoming messages. Keep it running in its own window while you execute the `mosquitto_pub` command in a separate session. Successfully ingested messages will appear here confirming end-to-end flow from MQTT through to Kafka.

---

## 5. Payload Serialization & Decoding

### How Payloads Are Stored

The connector uses `org.apache.kafka.connect.json.JsonConverter` with `schemas.enable: false`. Kafka Connect wraps the raw JSON string inside an internal binary payload structure before committing it to the topic. In a standard console consumer session this appears as a base64-encoded string:

```text
"eyJ2b2x0YWdlIjogMjMwLCAiY3VycmVudCI6IDV9"
```

### Decoding for Debug Verification

To verify the physical content of the payload during debugging, decode the base64 string manually:

```bash
echo "eyJ2b2x0YWdlIjogMjMwLCAiY3VycmVudCI6IDV9" | base64 --decode
```

**Output:**

```json
{"voltage": 230, "current": 5}
```

### Downstream Consumption

Downstream database sinks (such as TimescaleDB) using the matching `JsonConverter` class will automatically decode these records back into native row schemas upon ingestion — no manual decoding is required in production.

```text
Kafka Topic (gridx_telemetry__TOPIC)
        │
        ▼ JsonConverter decodes automatically
TimescaleDB / S3 / Market Data Service
```
