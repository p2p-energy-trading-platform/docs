---
connie-title: IoT Ingestion - Kafka Consumption
---


# Kafka consumption

- This service runs as a **single Kafka consumer group**, subscribed to both `iot.meter-readings` and `iot.heartbeats`, dispatching each record to the correct handler based on which topic it arrived on. The group ID is stable per environment and is never shared with a different logical application.
- **Why one group initially:** ordering is per partition, and the message types are already on separate topics. One group/process is operationally simple. This is conditional on capacity tests: if high-volume readings delay heartbeat SLOs or the streams need independent scaling/release behavior, use two consumer clients/groups (each subscribed to one topic) or separate deployments of the same codebase. Do not claim one process is sufficient before the workload model is measured.
- **One real risk worth designing around regardless of grouping:** a Go process dies on an unrecovered panic. Handlers return ordinary errors into the failure-recording path; worker and gRPC recovery boundaries still contain unexpected panics and emit alerts.
- **Partitioning / ordering:** ordering is required independently within each stream: all meter readings for one house must remain ordered within `iot.meter-readings`, and all heartbeats for one house must remain ordered within `iot.heartbeats`. Kafka does **not** provide ordering across the two topics. The connector is expected to use a stable source-topic key, but this remains unconfirmed until keys and partitions are inspected against live traffic in the end-to-end tests.

## Message format - JSON ingestion and protobuf API contracts

The ingestion wire format is settled. The IoT Simulator serializes meter readings and heartbeats as JSON and publishes them to the MQTT broker. The MQTT Source Connector then forwards the MQTT payload bytes unchanged into Kafka; there is no JSON-to-protobuf conversion anywhere in this path:

```text
IoT Simulator --JSON/MQTT--> MQTT broker --unchanged payload bytes--> Kafka --JSON bytes--> IoT Ingestion Service
```

The Kafka consumer must therefore treat each record value as raw JSON bytes. At the ingestion boundary it unmarshals the JSON into input/wire structs that match the simulator payload, validates the data, and maps it into this service's internal domain types. Redis, TimescaleDB, and heartbeat-processing code operate only on those domain types and do not depend on the external JSON representation.

```go
// internal/ingestion/decoder.go
func DecodeMeterReading(raw []byte) (*models.MeterReading, error) {
    var input meterReadingJSON
    if err := json.Unmarshal(raw, &input); err != nil {
        return nil, fmt.Errorf("decode meter-reading JSON: %w", err)
    }
    return mapMeterReading(input)
}
```

Protobuf has a separate role: it is the transport contract for the in-scope [gRPC query interface](08-grpc.md). The `iot/v1` contracts are authored in the separate `protobuf` repository and generated into the organization's SDKs, but generated types are **not** used to decode MQTT-to-Kafka messages and protobuf is not part of the ingestion wire flow.

## Proposed `iot/v1` proto contract (draft, matching established conventions)

Based on the style of the existing `grid_transfer_rule.proto` and `order_events.proto` (proto3, `gridx.<domain>.v1` package naming, `_UNSPECIFIED = 0` as the first enum value, and the `go_package` alias pattern), the draft below carries the telemetry concepts currently published by the IoT Simulator. It is an internal-service contract, not a protobuf representation of the simulator's JSON wire format. Its final shape is driven by internal API consumers.

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
- No actuation command is defined because dispatch is outside this service's scope.
- This would live at `proto/gridx/iot/v1/iot_events.proto` in the `protobuf` repo, following the existing `order_events.proto` naming pattern.
- This draft is independent of the settled JSON ingestion wire format described above.

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
    kafka_key       BYTEA,
    raw_payload     BYTEA NOT NULL,
    payload_sha256  TEXT NOT NULL,
    failure_stage   TEXT NOT NULL,    -- 'decode' | 'grid_validation' | 'redis_write' | 'timescale_write'
    error_reason    TEXT NOT NULL,
    attempt_count   INT NOT NULL,     -- passed explicitly by the caller, not a silent default (see above)
    first_failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_failed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolution      TEXT NOT NULL DEFAULT 'unresolved'
                    CHECK (resolution IN ('unresolved','replayed','discarded')),
    resolved_at     TIMESTAMPTZ,
    resolved_by     TEXT,
    UNIQUE (kafka_topic, kafka_partition, kafka_offset, failure_stage)
);
CREATE INDEX idx_ingestion_failures_unresolved
    ON iot_data.ingestion_failures (last_failed_at DESC)
    WHERE resolution = 'unresolved';
```

Repeat processing upserts the same failure identity and increments/updates its attempt metadata instead of creating unlimited duplicate rows. Raw payloads may contain sensitive identifiers, so access is restricted and normal logs contain only the hash and Kafka coordinates. Unresolved rows have no automatic retention. Resolved rows may be purged under a documented audit policy. Growth and oldest-unresolved age are alerted, not quietly ignored.

Replay is an explicit operator command that selects immutable failure IDs, revalidates the current contract, writes through the same idempotent handler, and records actor/time/result. It never edits Kafka offsets or bulk-replays an unbounded query. Concurrent replay of one failure is prevented with row locking or a lease.

**Grid admission rule:** after decoding either a `MeterReading` or `Heartbeat`, check its `grid_id` against the in-memory grid-registry snapshot described in [05-startup-registry.md](05-startup-registry.md) before writing anything to Redis or the telemetry/registry tables. This is an O(1) map lookup and performs no per-message database query. An unknown grid is a permanent provisioning error, recorded with `failure_stage = 'grid_validation'`; its raw payload is thereby quarantined for investigation or controlled manual replay, and its Kafka offset is committed only after that failure record is durable. Ingestion must never create a grid from telemetry. This prevents configuration mistakes or untrusted messages from silently expanding the system's accepted grid boundary.

**Critical rule:** commit the Kafka offset only after either all required processing succeeds or the exhausted failure is durably recorded. A malformed poison message is recorded and then committed so it cannot block the partition forever. If recording the failure itself fails, leave the offset uncommitted and retry; temporary partition backpressure is preferable to silently losing the record.

## Delivery semantics, rebalances, and multi-store consistency

The service provides **at-least-once processing**, not end-to-end exactly once. Kafka, TimescaleDB, and Redis cannot participate in one atomic transaction. A crash can therefore replay a record after its database write succeeded but before its offset commit. All handlers must be replay-safe:

1. Validate and map the record without side effects.
2. Write TimescaleDB first. A meter reading and its asset readings use one Postgres transaction and immutable inserts with conflict detection.
3. Update Redis with a compare-and-set Lua script that replaces `latest` only when the incoming `(event_time, seq)` is newer than the stored value. A delayed retry must never overwrite newer live state.
4. Commit the Kafka offset only after the durable write and required Redis update succeed. Redis is treated as a rebuildable projection, but if the product requires Redis to be current before acknowledging ingestion, its exhausted write failure remains uncommitted. This policy must be explicit in configuration and tests.

Processing is sequential **within each topic-partition** and concurrent across partitions. Do not start an unbounded goroutine per record. Use bounded partition workers and pause/resume fetches for backpressure. Disable auto-commit. With `franz-go`, the implementation must follow the documented rebalance rules (for example, `BlockRebalanceOnPoll` with prompt `AllowRebalance`, or equivalent revoke draining) so work from a revoked partition cannot be committed by its former owner. A later offset must never be committed while an earlier record in the same partition is still unfinished.

Configure and test `session.timeout`, `heartbeat.interval`, `max.poll.records`, fetch sizes, maximum record bytes, retry budgets, and shutdown drain time as one system. On shutdown: stop polling, finish or cancel bounded in-flight work, commit only completed contiguous offsets, then close the client. Readiness becomes false before draining begins.

## Input contract and abuse limits

Before JSON decoding, reject records larger than a configured maximum. Use strict decoding: reject unknown required-version fields where appropriate, trailing JSON, duplicate/invalid identities, non-finite numbers, timestamps outside an allowed clock-skew window, and values outside domain ranges. Accept only supported `schema_version` values. Record topic, partition, offset, key, schema version, and a payload hash in diagnostics, but never log the full payload by default.

The Kafka record key is part of the contract. Verify in the live connector test that it is a stable per-house key and that the payload identity agrees with the key/topic. If the connector cannot guarantee this, change its key configuration before production; consumer-side validation cannot repair already-broken ordering.

Topic creation is infrastructure-owned. Production topics must have explicit partition count, replication factor, `min.insync.replicas`, retention, and maximum-message settings; the client must not rely on automatic topic creation. Capacity testing determines partition count from the expected houses, tick rate, payload size, write amplification, and failure headroom.

Implementation must be checked against the pinned [`franz-go/kgo` API documentation](https://pkg.go.dev/github.com/twmb/franz-go/pkg/kgo), especially `DisableAutoCommit`, `BlockRebalanceOnPoll`, `AllowRebalance`, and commit behavior; these options are coupled and must not be copied independently from snippets.
