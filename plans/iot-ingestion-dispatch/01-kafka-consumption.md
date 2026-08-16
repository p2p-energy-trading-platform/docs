---
connie-title: IoT Ingestion - Kafka Consumption
---


# Kafka consumption

- This service runs as a **single Kafka consumer group**, subscribed to both `iot.meter-readings` and `iot.heartbeats`, dispatching each record to the correct handler based on which topic it arrived on.
- **Why one group, not two:** ordering isn't a factor either way - Kafka only orders within a partition, and the two message types already live on physically separate topics regardless of grouping, so there's no ordering guarantee to gain by splitting further. The real reason to split would be independent *scaling* of the much-higher-volume meter-reading stream away from heartbeat processing - at this project's scale, a single Go process handles both comfortably, and goroutines make "two topics, one process" close to free. Simpler to run and deploy while already juggling Kafka, Redis, TimescaleDB, and goose in one service.
- **One real risk worth designing around regardless of grouping:** a Go process dies on an unrecovered panic. A bug in heartbeat processing shouldn't be able to take down meter-reading processing just because they share a process. Handlers return ordinary errors (feeding into the failure-recording path in section 3.3) rather than panicking - this sidesteps the risk entirely as long as that discipline is maintained.
- **Partitioning / ordering:** ordering is required independently within each stream: all meter readings for one house must remain ordered within `iot.meter-readings`, and all heartbeats for one house must remain ordered within `iot.heartbeats`. Kafka does **not** provide ordering across the two topics, so the service must not rely on a meter reading and heartbeat having a defined order relative to each other. **Likely already satisfied within each topic:** Confluent's MQTT Source Connector documentation describes using the source MQTT topic string as the Kafka record key by default. Because each house has a unique MQTT meter topic and heartbeat topic, this should consistently partition that house's records within the corresponding Kafka topic. Treat this as *likely*, not confirmed, until the keys and partitions are inspected against live traffic (section 13).

## Message format - JSON ingestion and future protobuf contracts

The ingestion wire format is settled. The IoT Simulator serializes meter readings and heartbeats as JSON and publishes them to the MQTT broker. The MQTT Source Connector then forwards the MQTT payload bytes unchanged into Kafka; there is no JSON-to-protobuf conversion anywhere in this path:

```text
IoT Simulator --JSON/MQTT--> MQTT broker --unchanged payload bytes--> Kafka --JSON bytes--> IoT Ingestion Service
```

The Kafka consumer must therefore treat each record value as raw JSON bytes. At the ingestion boundary it unmarshals the JSON into input/wire structs that match the simulator payload, validates the data, and maps it into this service's internal domain types. Redis, TimescaleDB, and heartbeat-processing code operate only on those domain types and do not depend on the external JSON representation.

```go
// internal/kafka/decode.go
func DecodeMeterReading(raw []byte) (*models.MeterReading, error) {
    var input meterReadingJSON
    if err := json.Unmarshal(raw, &input); err != nil {
        return nil, fmt.Errorf("decode meter-reading JSON: %w", err)
    }
    return mapMeterReading(input)
}
```

Protobuf has a separate role: it is the intended transport contract for future communication between the IoT Ingestion Service and other internal services, such as the planned gRPC query interface. The `iot/v1` `.proto` contracts should still be authored in the separate `protobuf` repository and generated into the organization's `go-sdk`, but those generated types are **not** used to decode the current MQTT-to-Kafka messages and protobuf is not part of the current ingestion flow. See section 3.2 for the draft contracts.

## Proposed `iot/v1` proto contract (draft, matching established conventions)

Based on the style of the existing `grid_transfer_rule.proto` and `order_events.proto` (proto3, `gridx.<domain>.v1` package naming, `_UNSPECIFIED = 0` as the first enum value, and the `go_package` alias pattern), the draft below carries the same telemetry concepts and values currently published by the IoT Simulator. It is a proposed future internal-service contract, not a protobuf representation of the simulator's JSON wire format. Its structure should ultimately be driven by the needs of internal API consumers rather than by a requirement to mirror the external JSON object exactly.

```protobuf
syntax = "proto3";

package gridx.iot.v1;

import "google/protobuf/timestamp.proto";

option go_package = "github.com/p2p-energy-trading-platform/go-sdk/gen/gridx/iot/v1;iotv1";

enum DeviceClass {
  DEVICE_CLASS_UNSPECIFIED = 0;
  DEVICE_CLASS_CONSUMER = 1;
  DEVICE_CLASS_RESIDENTIAL_PROSUMER = 2;
  DEVICE_CLASS_COMMERCIAL = 3;
}

enum AssetType {
  ASSET_TYPE_UNSPECIFIED = 0;
  ASSET_TYPE_BESS = 1;
  ASSET_TYPE_EV = 2;
}

message StorageAssetReading {
  string asset_id = 1;
  AssetType asset_type = 2;
  double soc_pct = 3;
  double power_kw = 4;
  double capacity_kwh = 5;
  bool plugged_in = 6;
}

message MeterReading {
  string schema_version = 1;
  string meter_id = 2;
  string house_id = 3;
  string grid_id = 4;
  DeviceClass device_class = 5;
  google.protobuf.Timestamp timestamp = 6;
  uint64 seq = 7;
  double solar_kw = 8;
  double consumption_kw = 9;
  double net_kw = 10;
  repeated StorageAssetReading storage_assets = 11;
  double weather_irradiance_wm2 = 12;
  double cloud_cover_pct = 13;
}

message FlexibleAssetCapability {
  string asset_id = 1;
  AssetType asset_type = 2;
  double capacity_kwh = 3;
  double max_charge_kw = 4;
  double max_discharge_kw = 5;
  bool v2g_capable = 6;
}

message Heartbeat {
  string schema_version = 1;
  string grid_id = 2;
  string house_id = 3;
  string meter_id = 4;
  string status = 5;
  DeviceClass device_class = 6;
  double rated_solar_kw = 7;
  repeated FlexibleAssetCapability flexible_assets = 8;
}
```

**Design notes - presenting this as a real decision, not a silent pick:**

- **`readings`/`meta` nesting.** Two real options, not one default with an asterisk:
  - **Flat** (as drafted above) - matches `OrderAccepted`'s style in the existing codebase, uses fewer generated types, and is simpler for internal API consumers when all fields are read together.
  - **Nested** (`message MeterReadingData { solar_kw, consumption_kw, ... }` + `message WeatherMeta { weather_irradiance_wm2, cloud_cover_pct }`, referenced as fields inside `MeterReading`) - groups related values and may be clearer if internal consumers commonly treat measurements and weather metadata as separate concepts.

  The current draft defaults to flat because it matches established convention in this codebase, but this remains an internal API-design choice to confirm before submitting to the `protobuf` repo. It has no effect on the current JSON ingestion decoder.
- No `ActuationCommand` message drafted yet - deferred until the Dispatch Service (section 7) is actually scoped.
- This would live at `proto/gridx/iot/v1/iot_events.proto` in the `protobuf` repo, following the existing `order_events.proto` naming pattern.
- This draft is independent of the settled JSON ingestion wire format in section 3.1.

## Failure handling - dead-letter strategy

**Two failure tiers, handled differently:**

- **Transient** (a Redis timeout, a brief DB connection blip) - usually self-resolves within seconds. Retry with bounded exponential backoff.
- **Permanent** (malformed payload, a `device_class` value that doesn't map to anything known, or a `grid_id` that has not been provisioned) - retrying produces the identical error every time. Fail immediately rather than burning through retry attempts.

`github.com/cenkalti/backoff/v5` fits this directly via its `backoff.Permanent(err)` wrapper, which stops retrying immediately instead of exhausting attempts on an error that will never succeed:

```go
attempts := 0
_, err := backoff.Retry(ctx, func() (struct{}, error) {
    attempts++
    if writeErr := warmStore.WriteMeterReading(ctx, reading); writeErr != nil {
        if isPermanent(writeErr) {
            return struct{}{}, backoff.Permanent(writeErr)
        }
        return struct{}{}, writeErr // transient - Retry backs off and tries again
    }
    return struct{}{}, nil
}, backoff.WithMaxTries(3))

if err != nil {
    if failureErr := recordFailure(ctx, rawMsg, "timescale_write", err, attempts); failureErr != nil {
        // The failure was not durably recorded. Return the error and leave the
        // Kafka offset uncommitted so this record can be attempted again.
        return fmt.Errorf("record ingestion failure: %w", failureErr)
    }
    if commitErr := commitOffset(ctx, record); commitErr != nil {
        return fmt.Errorf("commit failed-record offset: %w", commitErr)
    }
}
```

**Where failures land once retries are exhausted: a Postgres table, not a second Kafka topic.** A dedicated dead-letter Kafka topic earns its complexity when other services need to independently consume or replay failures, or failures must survive even if this service's own database is down. Neither is currently required here: nothing else in the platform is designed to read IoT failures, and a queryable table is simpler to operate for a single-owned module than adding another Kafka topic and producer.

This choice has one explicit consequence: `ingestion_failures` is in the same database as warm storage. If that database is unavailable, the service cannot durably record a TimescaleDB write failure there. In that case it must leave the Kafka offset uncommitted and retry after the database recovers; it must never pretend the failure was recorded and advance the offset.

```sql
CREATE TABLE iot_data.ingestion_failures (
    id              BIGSERIAL PRIMARY KEY,
    kafka_topic     TEXT NOT NULL,
    kafka_partition INT NOT NULL,
    kafka_offset    BIGINT NOT NULL,
    raw_payload     BYTEA NOT NULL,
    failure_stage   TEXT NOT NULL,    -- 'decode' | 'grid_validation' | 'redis_write' | 'timescale_write'
    error_reason    TEXT NOT NULL,
    attempt_count   INT NOT NULL,     -- passed explicitly by the caller, not a silent default (see above)
    failed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ingestion_failures_failed_at ON iot_data.ingestion_failures (failed_at DESC);
```

No retention policy on this table - it's diagnostic, not telemetry. If it grows large quickly, that's a symptom worth investigating, not something to quietly auto-delete.

**Grid admission rule:** after decoding either a `MeterReading` or `Heartbeat`, check its `grid_id` against the in-memory grid-registry snapshot described in [05-startup-registry.md](05-startup-registry.md) before writing anything to Redis or the telemetry/registry tables. This is an O(1) map lookup and performs no per-message database query. An unknown grid is a permanent provisioning error, recorded with `failure_stage = 'grid_validation'`; its raw payload is thereby quarantined for investigation or controlled manual replay, and its Kafka offset is committed only after that failure record is durable. Ingestion must never create a grid from telemetry. This prevents configuration mistakes or untrusted messages from silently expanding the system's accepted grid boundary.

**Critical rule:** commit the Kafka offset only after either all required processing succeeds or the exhausted failure is durably recorded. A malformed poison message is recorded and then committed so it cannot block the partition forever. If recording the failure itself fails, leave the offset uncommitted and retry; temporary partition backpressure is preferable to silently losing the record.