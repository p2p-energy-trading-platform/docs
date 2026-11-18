---
connie-title: Order Service Kafka Contracts and Outbox
---

Kafka Contracts and Outbox
==========================

Purpose
-------

This document defines the topics this service publishes and consumes, the fields it sets, and the outbox rules. PostgreSQL remains the record of order state. A published command is not an engine acknowledgement.

Topics
------

These are the names the matching-engine process is configured to use. See `gridx-workspace/matching-engine/.env`.

| Topic | Producer | This service |
|---|---|---|
| `order.accepted` | Order Service | Publishes `OrderAccepted`, keyed by the decimal `order_id` |
| `order.state` | Matching Engine | Consumes `OrderUpdated`, group `order-service-updates` |
| `trade.executed` | Matching Engine | Does not consume. Fill state arrives on `order.state` |
| `grid.transfer` | Grid-fee publisher | Does not consume. The engine uses this compacted topic |

Cancel does not go on `order.accepted`. The engine consumer decodes only `OrderAccepted` today, and a second payload on that topic would be misread. Cancel is a separate topic the engine does not consume yet:

| Topic | Producer | This service |
|---|---|---|
| `order.cancel_requested` | Order Service | Publishes `OrderCancelRequested`, keyed by the decimal `order_id` |

Recovery uses two further topics, also not in the engine today. The snapshot duty is in [Recovery Snapshot](09-kafka-based-recovery.md).

| Topic | This service |
|---|---|
| `order.recovery.requests` | Consumes, group `order-service-recovery` |
| `order.recovery.snapshots` | Publishes the snapshot |

Do not create `gridx.orders.v1`, `gridx.orders.updates.v1`, or `gridx.trades.v1`. The names `order.updated`, `order.cancelled`, and `order.expired` appear in an unused engine header. They are not topics. All status outcomes, including cancel and expiry, arrive on `order.state`.

| Topic | Partitions | Retention |
|---|---|---|
| `order.accepted` | 6 | 3 days |
| `order.cancel_requested` | 6 | 3 days |
| `order.state` | 6 | 3 days |
| `trade.executed` | 6 | 7 days |
| `order.recovery.requests` | 1 | 1 hour |
| `order.recovery.snapshots` | 1 | 1 hour |

`grid.transfer` is compacted and is not created by this service. Topics are created in the infrastructure repository. Auto-creation stays off outside development.

Keys are the decimal text of the id (`"4821"`). `order.accepted` and `order.cancel_requested` are different topics, so Kafka does not order a cancel against its placement. The engine handles a cancel that arrives first. This service stays in `CANCEL_PENDING` until `order.state` answers.

| Header | Where | Value |
|---|---|---|
| `x-message-type` | commands | `order.accepted` or `order.cancel_requested` |
| `x-event-id` | all | the payload `event_id` |
| `x-request-id` | commands | the gateway request id |
| `traceparent` | all | when the request has one |

Messages
--------

Serialization is Protocol Buffers from `go-sdk`, generated from `protobuf/proto/gridx/order/v1/`. The files on disk still use `uint64 user_id`, `uint32 grid_zone_id`, a `double` remaining quantity, and no MARKET value. Those are breaking corrections, listed in [proposed engine changes](../matching-engine/proposed-engine-changes.md). This service sends the corrected contract:

`OrderAccepted` fields this service sets:

| Field | Value |
|---|---|
| `event_id` | UUID, the outbox `event_id` |
| `order_id` | the identity value |
| `user_id` | Auth UUID string |
| `market_id.delivery_slot_start` | slot start |
| `grid_id` | IoT `Grid.grid_id` |
| `side`, `order_type` | as stored. `order_type` is `LIMIT` or `MARKET` |
| `status` | `ORDER_STATUS_NEW` |
| `price` | LKR minor units per kWh. LIMIT price or MARKET protection price |
| `quantity` | watt-hours |
| `expires_at`, `created_at` | as stored |

It does not send a separate remaining quantity on the command. Remaining quantity lives on `OrderUpdated`.

`OrderCancelRequested` fields: `event_id`, `order_id`, `user_id` (UUID), `requested_at`.

`OrderUpdated` fields this service reads: `event_id` (UUID), `event_type`, `order_id`, `status`, `remaining_quantity` (int64 Wh, cumulative), `updated_at`, `order_seq`, `reason`, `user_id`. `user_id` must equal the stored user. A mismatch is quarantined.

`ORDER_TYPE_MARKET = 2` and `ORDER_STATUS_REJECTED` are part of that contract change. They are required here because both order types are in scope.

Outbox
------

Commands are written to `outbox_events` in the same transaction as the state change. The request path does not publish to Kafka.

1. Claim a batch with a 30 s lease, skipping a row when an earlier unpublished row exists for the same order. The query is in the persistence document.
2. Publish with `acks=all` and the idempotent producer. Do not disable the franz-go idempotent default.
3. After acknowledgement, set `published_at` and clear the lease.
4. On failure, record `last_error` and back off (1 s, doubling, cap 60 s). A failing row blocks later rows of that order only.
5. An expired lease is retried by another worker.

A Kafka outage does not fail `CreateOrder`. Rows wait, and the unpublished-age alert fires. If the broker accepts a record and the process dies before `published_at` is set, the record is sent again. Consumers deduplicate.

| Message | Identity | Who deduplicates |
|---|---|---|
| Placement | `order_id` and `event_id` | Engine, by `order_id` |
| Cancel | command `event_id` | Engine |
| `OrderUpdated` | `event_id` and `order_seq` | This service, in the same transaction as the state change |

Consumer
--------

Group `order-service-updates` reads `order.state`.

- Manual offset commits. Commit only after the database transaction commits.
- `auto.offset.reset=earliest` for a new group.
- A message that cannot be decoded, or whose `event_id` is not a UUID, is inserted into `consumer_dead_letters` with stage `DECODE` and the offset is then committed so the partition is not stuck.
- An update for an unknown `order_id` uses stage `UNKNOWN_ORDER`, raises an alert, and does not create an order.
- `processed_events` is retained for 7 days. Topic retention for `order.state` is 3 days.

Producer and consumer TLS and SASL follow the IoT service. Plaintext is development only. Production startup rejects it.
