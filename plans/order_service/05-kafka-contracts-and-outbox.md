---
connie-title: Order Service Kafka Contracts and Outbox
---

Kafka Contracts and Outbox
==========================

Purpose
-------

This document defines the Kafka topics, message contracts, identifiers, partitioning, and reliability rules between the Order Service and the Matching Engine. It also defines how the Order Service publishes commands (the transactional outbox) and consumes updates.

Kafka provides asynchronous delivery. PostgreSQL remains the durable source of truth for order state. A message being published, received, or processed is never treated as proof of an outcome until the status rules in Order Validation say so.

Verified State
--------------

| Item | State | Source |
|---|---|---|
| Broker | Single-node Kafka 7.7 (KRaft), no explicit topic defaults. Topics created on demand would get 1 partition. Default retention is 7 days. | `gridx-infra` `docker-compose.yml` |
| Order topics | None exist yet. | `gridx-infra` |
| Existing topics | `iot.meter-readings`, `iot.heartbeats`, produced through Kafka Connect and consumed by the IoT service. | `iot-ingestion-dispatch` |
| Serialization | Protocol Buffers. The engine maps generated protobuf types. | `matching-engine` `OrderEventMapper`, `protobuf` repository |
| Schema registry | None. | `gridx-infra` |
| Engine topic names | Read from environment variables with no defaults: `KAFKA_ORDER_TOPIC`, `KAFKA_ORDER_STATE_TOPIC`, `KAFKA_TRADE_TOPIC`. | `matching-engine` `EnvConfigLoader` |
| Engine consumer | Manual commits, `auto.offset.reset=earliest`, group from `KAFKA_ORDER_CONSUMER_GROUP_ID`. | `KafkaOrderConsumer.cpp` |
| Engine producer | Sets only `bootstrap.servers` and `client.id`. Sends records with **no key** and no idempotence setting. | `KafkaProducer.cpp` |
| Go conventions | `franz-go`, manual commits, `BlockRebalanceOnPoll`, optional TLS and SASL (`PLAIN`, `SCRAM-SHA-256`, `SCRAM-SHA-512`). | `iot-ingestion-dispatch` |

Topics
------

### Canonical names

| Topic | Producer | Consumers | Key | Message types |
|---|---|---|---|---|
| `gridx.orders.v1` | Order Service | Matching Engine | `order_id` | `OrderAccepted`, `OrderCancelRequested` |
| `gridx.orders.updates.v1` | Matching Engine | Order Service, Notification | `order_id` | `OrderUpdated` |
| `gridx.trades.v1` | Matching Engine | Settlement, Market Data, Notification | `trade_id` | `TradeExecuted` |

The Order Service does not consume `gridx.trades.v1`. Fill state reaches it through `OrderUpdated`.

These names replace every earlier variant: `order-placements`, `completed-trades`, and the unversioned `orders` and `trades`. The `v1` suffix is the compatibility boundary. A breaking contract change creates a `v2` topic and runs both during migration. No parallel unversioned topics are created. The existing `iot.*` topics are produced by Kafka Connect and are unaffected.

### Configuration

| Topic | Partitions | Retention | Cleanup | Replication | Min in-sync replicas |
|---|---|---|---|---|---|
| `gridx.orders.v1` | 6 | 3 days | delete | 1 (dev), 3 (prod) | 1 (dev), 2 (prod) |
| `gridx.orders.updates.v1` | 6 | 3 days | delete | 1 (dev), 3 (prod) | 1 (dev), 2 (prod) |
| `gridx.trades.v1` | 6 | 7 days | delete | 1 (dev), 3 (prod) | 1 (dev), 2 (prod) |

- **Partitions:** ordering is guaranteed only per key, so the count only affects throughput. Six allows up to six Order Service consumers and cannot be reduced later.
- **Order topics retention (3 days):** orders are valid for at most about 25 hours (a 24 h booking horizon plus a 30-minute slot), so 3 days covers the order lifetime and a long weekend outage. It is also shorter than the 7-day `processed_events` retention, which is required for correct deduplication.
- **Trades retention (7 days)** gives Settlement time to catch up.
- With a single dev broker, `acks=all` waits only for the one replica. The production values above are what give the guarantee its meaning.

### Provisioning

Topics are created explicitly by the infrastructure repository, never by auto-creation, because auto-created topics get one partition and default settings:

```bash
kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists \
  --topic gridx.orders.v1 --partitions 6 --replication-factor 1 \
  --config retention.ms=259200000 --config cleanup.policy=delete --config min.insync.replicas=1
kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists \
  --topic gridx.orders.updates.v1 --partitions 6 --replication-factor 1 \
  --config retention.ms=259200000 --config cleanup.policy=delete --config min.insync.replicas=1
kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists \
  --topic gridx.trades.v1 --partitions 6 --replication-factor 1 \
  --config retention.ms=604800000 --config cleanup.policy=delete --config min.insync.replicas=1
```

Outside development, topic auto-creation is disabled (`KAFKA_AUTO_CREATE_TOPICS_ENABLE=false`) so that a misspelled topic name fails instead of silently creating an unmonitored topic.

### Consumer groups

| Group | Service |
|---|---|
| `order-service-updates` | Order Service, consuming `gridx.orders.updates.v1` |
| `matching-engine-orders` | Matching Engine, consuming `gridx.orders.v1` (value of `KAFKA_ORDER_CONSUMER_GROUP_ID`) |

Serialization and Compatibility
-------------------------------

- Messages are plain Protocol Buffers binary, serialized from the types in the `protobuf` repository (`go-sdk` for Go, generated C++ for the engine).
- There is no schema registry and no Confluent framing. Compatibility is enforced by `buf breaking` (rule set `FILE`) in the `protobuf` repository's CI and by the contract tests in each service.
- Only additive changes are allowed within `v1`: new fields with new numbers and new enum values. Fields are never removed, renumbered, or retyped.
- Consumers must ignore unknown fields. A consumer that receives an unknown enum value treats the message as malformed and dead-letters it rather than guessing.

Message Contracts
-----------------

A **command** asks another service to act. An **event** reports an outcome. Publishing a command does not prove it was applied.

| Message | Kind | Meaning |
|---|---|---|
| `OrderAccepted` | Command | "Place this order." Sent by the Order Service after it durably recorded the order. The name means accepted by the Order Service, not by the engine. |
| `OrderCancelRequested` | Command | "Cancel this order." |
| `OrderUpdated` | Event | The engine reports the order's status and cumulative remaining quantity after a change. |
| `TradeExecuted` | Event | The engine reports one executed trade. |

### Required proto changes

These changes are additive and pass `buf breaking`. They go in one pull request to the `protobuf` repository, and field numbers are taken from the current files.

```proto
// ---- order_events.proto ----
enum OrderType {
  ORDER_TYPE_UNSPECIFIED = 0;
  ORDER_TYPE_LIMIT = 1;
  ORDER_TYPE_MARKET = 2;   // price is the protection price. Never rests. Remainder cancelled.
}

enum OrderStatus {
  // ... existing values 0-5 ...
  ORDER_STATUS_REJECTED = 6;
}

message OrderAccepted {
  // ... existing fields 1-13 ...
  // Units: price is micro-AED per kWh, quantity is watt-hours.
  // remaining_quantity always equals quantity on placement. Deprecated: use OrderUpdated.remaining_quantity.
  // double remaining_quantity = 11 [deprecated = true];
  string user_uuid = 14;   // Auth user ID. user_id (3) is the numeric trader number.
}

message OrderCancelRequested {
  string event_id = 1;                               // command ID, UUID. The engine deduplicates on it.
  uint64 order_id = 2;
  uint64 user_id = 3;                                // numeric trader number
  string user_uuid = 4;
  google.protobuf.Timestamp requested_at = 5;
}

// ---- order_update_events.proto ----
enum OrderUpdateType {
  // ... existing values 0-5 ...
  ORDER_UPDATE_TYPE_REJECTED = 6;
}

enum OrderUpdateReason {
  ORDER_UPDATE_REASON_UNSPECIFIED = 0;
  ORDER_UPDATE_REASON_USER_REQUEST = 1;
  ORDER_UPDATE_REASON_NO_LIQUIDITY = 2;     // MARKET, nothing matched
  ORDER_UPDATE_REASON_IOC_REMAINDER = 3;    // MARKET, partly matched
  ORDER_UPDATE_REASON_SLOT_ENDED = 4;
  ORDER_UPDATE_REASON_ORDER_EXPIRED = 5;    // arrived after expires_at
  ORDER_UPDATE_REASON_INVALID_ORDER = 6;
  ORDER_UPDATE_REASON_UNKNOWN_ORDER = 7;
}

message OrderUpdated {
  // ... existing fields 1-6 (event_id must now be a UUID, never empty) ...
  uint64 order_seq = 7;                  // strictly increasing per order, for every event the engine emits about it
  string causation_id = 8;               // event_id of the command being answered, empty if not a response
  OrderUpdateReason reason = 9;
}

// ---- trade_events.proto ----
message TradeExecuted {
  // ... existing fields 1-13. quantity is watt-hours. execution_price and grid_fee_per_kwh are micro-AED per kWh. ...
  string buyer_user_uuid = 14;
  string seller_user_uuid = 15;
  google.protobuf.Timestamp delivery_slot_start = 16;
}
```

### Identifier requirements

| Field | Requirement |
|---|---|
| `event_id` (all messages) | A version-4 UUID string, generated once per logical message. Never empty. The engine currently publishes an empty string, which must be fixed. |
| `order_id` | `uint64`, assigned by the Order Service. Unique for the life of the system. |
| `order_seq` | Starts at 1 for each order and increases by 1 for every `OrderUpdated` the engine emits for that order, including echo responses. |
| `causation_id` | Set only on responses to a command. |

Keys, Partitioning, and Headers
-------------------------------

- **Key encoding:** the decimal ASCII string of the ID (for example `"4821"`). The orders and updates topics use `order_id`. The trades topic uses `trade_id`.
- **Why `order_id`:** all messages about one order, placement, cancel, and every update, land in one partition and are consumed in order. That is what lets the engine see a cancel after its placement.
- **One producer implementation per topic.** `gridx.orders.v1` is produced only by the Order Service (franz-go) and `gridx.orders.updates.v1` only by the engine (librdkafka). Their hash functions differ, but that does not matter, because no rule depends on two topics sharing a partition number.
- **The engine must set record keys.** Today it sends unkeyed records, so updates for one order can arrive out of order. Setting keys is a required engine change.

| Header | Topic | Value | Required |
|---|---|---|---|
| `x-message-type` | `gridx.orders.v1` | `order.accepted` or `order.cancel_requested` | Yes. The topic carries two payload types. |
| `x-message-type` | `gridx.orders.updates.v1`, `gridx.trades.v1` | `order.updated`, `trade.executed` | Set by the engine. A missing value is treated as the topic's only type. |
| `x-event-id` | all | the payload's `event_id` | Yes, so tools can filter without decoding |
| `x-request-id` | `gridx.orders.v1` | gateway request ID | Yes, for tracing |
| `traceparent` | all | W3C trace context | If present |

An unknown `x-message-type` on `gridx.orders.v1` is a contract violation. The engine dead-letters or logs it. It must never guess the payload type.

Transactional Outbox
--------------------

The Order Service writes each outbound command to `outbox_events` in the same PostgreSQL transaction as the state change that causes it (see the persistence document). It never publishes directly from the request path.

### Publisher

1. Claim a batch of committed, unpublished rows with a 30-second lease, only if no earlier unpublished row exists for the same order (the exact query is in the persistence document). This keeps placement ahead of cancel even with several workers.
2. Publish each row to its `topic` with `record_key`, the `x-message-type`, `x-event-id`, and `x-request-id` headers, and the stored protobuf `payload`.
3. After broker acknowledgement, set `published_at` and clear the lease.
4. On failure, record `last_error` and set `next_attempt_at` with bounded exponential backoff (1 s, doubling, capped at 60 s). A failing row blocks later rows of the same order only.
5. A worker that crashes leaves an expired lease, and another worker retries.

### Producer settings (franz-go)

| Setting | Value |
|---|---|
| Required acks | all in-sync replicas |
| Idempotent producer | Enabled (the franz-go default must not be disabled) |
| Records in flight per partition | Default. Ordering is preserved because idempotence is on. |
| Request timeout and retries | Bounded. A stuck send ends in a failed attempt and a retry, never in silence. |
| Security | TLS and SASL options as in the IoT service. Plaintext is a development-only default, and production validation rejects it. |

### What the outbox guarantees

The outbox gives reliable publication **intent**, not exactly-once delivery. If the broker accepts a message and the publisher crashes before recording success, or the lease expires during a send, the message is sent again. Downstream consumers must deduplicate.

A Kafka outage never fails order creation. Orders are durable, rows accumulate, and the backlog alerts fire.

Message Identity and Deduplication
----------------------------------

| Logical message | Identity | Deduplicated by | How |
|---|---|---|---|
| Placement | `order_id` (and `event_id`) | Matching Engine | Ignores a placement whose `order_id` it already holds. |
| Cancel | command `event_id` | Matching Engine | Ignores a command it already processed. Cancelling an already-terminal order is also harmless, and the engine echoes the terminal status. |
| Order update | `event_id` and `order_seq` | Order Service | `processed_events` by `event_id` in the same transaction as the state change, plus the permanent `me_seq` check. |
| Trade | `trade_id` | Settlement and other consumers | Unique `trade_id`. |
| Execution | not tracked by the Order Service | | Order state uses cumulative quantities, so no per-execution identity is needed. |

Deduplication is atomic with the state change. Recording an event as processed in a separate transaction from applying it is not allowed, because a crash between the two would lose or duplicate the effect.

Trade IDs currently come from an in-memory counter in the engine, so a restart can reuse IDs. The engine must persist or derive trade IDs monotonically across restarts, or Settlement's deduplication will drop real trades.

Ordering and Partitioning
-------------------------

- Order is guaranteed **per key within a partition**. For one `order_id`, the Order Service consumes updates in the order the engine produced them.
- There is no order across different orders, and none is needed. The engine serializes matching itself.
- Partitioning does not solve cross-service races. The Order Service's cancel and the engine's own fill or expiry can still interleave. `order_seq` and the state rules in Order Validation resolve these races.
- Partitioning does not protect against redelivery. Duplicates and stale updates are handled by deduplication, never by assuming order.

Consumer Reliability (Order Service)
------------------------------------

The Order Service consumes `gridx.orders.updates.v1` with group `order-service-updates`.

| Rule | Detail |
|---|---|
| Offsets | Auto-commit is disabled. An offset is committed only after the database transaction for that record (or batch) committed. |
| Rebalances | `BlockRebalanceOnPoll`, so a partition is not revoked while records are being applied. |
| First start | `auto.offset.reset=earliest`, so no updates are missed. Replays are safe because of deduplication. |
| Processing | Records of one partition are applied sequentially. Different partitions may be processed concurrently, and one order never spans partitions. |
| Transient failure (database down, timeout) | Do **not** commit and do not skip. Back off and retry the same record. |
| Permanent failure | Write a dead-letter row (own transaction), then commit the offset so the partition is not blocked. |
| Never skip | A failed record is never passed over by committing a later offset without a dead-letter row. (The engine's consumer currently can do this, and must be fixed.) |

Permanent failures and their dead-letter stages:

| Condition | Stage | Also |
|---|---|---|
| Protobuf cannot be decoded, or `event_id` is not a UUID, or an enum value is unknown | `DECODE` | |
| Fields violate the contract (for example negative quantity) | `VALIDATE` | |
| Update names an order that does not exist | `UNKNOWN_ORDER` | Alert. The order row always commits before its command exists, so this means the database and the engine disagree. |
| Update is invalid for the order's state, or arrives after an engine-sourced terminal state | `STALE_TERMINAL` | Set `needs_reconciliation`. |
| The same record fails to apply five times for a non-transient reason | `APPLY` | |

Quarantine, Replay, and Reconciliation
--------------------------------------

- **Quarantine** is the `consumer_dead_letters` table (topic, partition, offset, key, `event_id`, stage, error, payload, status). The unique `(topic, partition, offset)` prevents duplicates. This matches the IoT service's convention of a queryable table instead of a dead-letter topic.
- **Replay** is `cmd/dead-letter-replay`, run by an operator. It feeds the stored payload through the same apply function in a normal transaction and marks the row `REPLAYED` or `DISCARDED`. Replay is safe because of `processed_events`, `me_seq`, and the idempotent allocation release.
- **Reconciliation** is the background queries in the persistence document (stuck `PENDING`, stuck `CANCEL_PENDING`, overdue expiry, flagged orders, ledger drift). Republishing a stuck placement or cancel is safe because the engine deduplicates.
- Messages are never deleted from the dead-letter table by consumers. Resolved rows are removed by the retention job after 90 days.

Delivery, Retention, and Monitoring
-----------------------------------

| Message | Delivery | Topic retention | Monitoring |
|---|---|---|---|
| `OrderAccepted` | At-least-once | 3 days | Oldest unpublished outbox age, outbox backlog size, `PENDING` age |
| `OrderCancelRequested` | At-least-once | 3 days | Same, plus `CANCEL_PENDING` age |
| `OrderUpdated` | At-least-once | 3 days | Consumer lag, dead-letter count by stage, stale-event count |
| `TradeExecuted` | At-least-once | 7 days | Settlement consumer lag (not the Order Service) |

| Metric | Alert condition |
|---|---|
| `order_outbox_oldest_unpublished_seconds` | Above 30 s |
| `order_outbox_backlog` | Above 1000 rows |
| `order_updates_consumer_lag` | Above 100 records for 1 minute |
| `order_dead_letters_pending{stage}` | Above 0 |
| `order_pending_age_seconds` | Any order above 30 s |

Configuration
-------------

Names follow the IoT service where a counterpart exists.

| Variable | Default | Purpose |
|---|---|---|
| `KAFKA_BROKER` | `localhost:9092` | Bootstrap broker |
| `KAFKA_CONSUMER_GROUP` | `order-service-updates` | Updates consumer group |
| `KAFKA_ORDERS_TOPIC` | `gridx.orders.v1` | Commands topic |
| `KAFKA_ORDER_UPDATES_TOPIC` | `gridx.orders.updates.v1` | Updates topic |
| TLS and SASL settings | none (development only) | Same options as the IoT service |
| Outbox batch size, lease, and backoff cap | 100, 30 s, 60 s | Publisher tuning |

Required Tests
--------------

- **Contract:** every message round-trips through the `go-sdk` types, and an unknown enum value or empty `event_id` is rejected.
- **Outbox:** a crash after broker acknowledgement and before `published_at` republishes the same `event_id`. A placement is never published after its cancel when several workers run. A failing row blocks only its own order.
- **Consumer:** a duplicate `event_id`, a stale `order_seq`, a record for an unknown order, a malformed payload, and a transient database failure each behave as specified, and no offset is committed for an unapplied record.
- **Integration:** with real Kafka and PostgreSQL, a full create, acknowledge, fill, and cancel flow ends with consistent order and ledger state.

Decisions and Dependencies
--------------------------

### Resolved decisions

| ID | Open item | Decision |
|---|---|---|
| K-1 | Which topics exist and which names are canonical | None of the order topics exist. The canonical names are `gridx.orders.v1`, `gridx.orders.updates.v1`, and `gridx.trades.v1`, created explicitly. All other names are retired. |
| K-2 | Serialization used by the Matching Engine | Protocol Buffers, plain binary, no schema registry. Compatibility is enforced by `buf breaking`. |
| K-3 | Commands and events defined in the shared contracts | `OrderAccepted`, `OrderUpdated`, `TradeExecuted` exist. `OrderCancelRequested`, `REJECTED`, `MARKET`, the reason, `order_seq`, `causation_id`, and the user UUID fields are added by the proto block above. |
| K-4 | Identifiers for deduplication | See the identity table. |
| K-5 | Keys and partitioning | Key is the decimal `order_id` (`trade_id` for trades). Six partitions per topic. |
| K-6 | Outbox claim, retry, and publication tracking | 30-second lease, per-order ordering predicate, bounded backoff, `published_at` (persistence document). |
| K-7 | Atomic state change and processed-message record | One transaction inserts `processed_events` and applies the update. The offset is committed after the transaction. |
| K-8 | Quarantine, replay, and reconciliation | `consumer_dead_letters`, `cmd/dead-letter-replay`, and the background reconciliation queries. |
| K-9 | Delivery, retention, and monitoring | See the delivery table and metrics. |

The persistence document's open item P-O2 is resolved here: order topics keep messages for 3 days and `processed_events` for 7.

### Remaining items needing sign-off

| ID | Item | Owner |
|---|---|---|
| K-O1 | Engine producer: set record keys, enable idempotence and `acks=all`, generate UUID `event_id`, set `x-message-type`, and persist trade IDs. | Matching Engine |
| K-O2 | Engine consumer: never advance past a failed record without a dead-letter or reject outcome. Set `KAFKA_ORDER_TOPIC`, `KAFKA_ORDER_STATE_TOPIC`, `KAFKA_TRADE_TOPIC`, and the group ID to the values above. | Matching Engine |
| K-O3 | Open one `protobuf` pull request with the proto block, run `buf breaking`, and release a new version for `go-sdk`. | protobuf maintainers, Matching Engine |
| K-O4 | Create the three topics with the settings above, disable auto-creation outside development, and use replication 3 and min in-sync replicas 2 in production. | Infrastructure |
| K-O5 | Settlement and Notification confirm they consume `TradeExecuted` with the new `user_uuid` and slot fields. | Billing and Settlement |
| K-O6 | Enable TLS and SASL for production Kafka, as the IoT service does. | Infrastructure, security |

Record confirmed decisions in the `protobuf` repository and the Matching Engine documentation so that all services use the same topic names and message rules.
