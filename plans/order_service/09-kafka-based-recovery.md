---
connie-title: Order Service Recovery Snapshot
---

Recovery Snapshot
=================

Purpose
-------

After a restart the Matching Engine has an empty book. It asks this service for a snapshot of orders it has already acknowledged. This document is only that duty. How the engine rebuilds the book, fences a second instance, and publishes inside a Kafka transaction is in [proposed engine changes](../matching-engine/proposed-engine-changes.md).

Topics
------

| Topic | Direction | Partitions | Retention |
|---|---|---|---|
| `order.recovery.requests` | engine to this service, group `order-service-recovery` | 1 | 1 hour |
| `order.recovery.snapshots` | this service to the engine | 1 | 1 hour |

Messages are Protocol Buffers in package `gridx.order.v1`. They are not in the protobuf repository yet. Add them with the other contract changes in the engine document. This service sends the shape below.

```proto
message RecoveryRequested {
  string request_id = 1;
  string engine_instance_id = 2;
  google.protobuf.Timestamp requested_at = 3;
}

message RecoveredOrder {
  uint64 order_id = 1;
  string user_id = 2;
  string grid_id = 3;
  Side side = 4;
  OrderType order_type = 5;
  int64 price = 6;                              // LKR minor units per kWh
  int64 quantity = 7;                           // Wh
  int64 remaining_quantity = 8;                 // Wh
  google.protobuf.Timestamp delivery_slot_start = 9;
  google.protobuf.Timestamp expires_at = 10;
  OrderStatus status = 11;                      // engine-visible status
  uint64 last_order_seq = 12;
  google.protobuf.Timestamp created_at = 13;
}

message RecoverySnapshotChunk {
  string request_id = 1;
  uint32 chunk_index = 2;
  repeated RecoveredOrder orders = 3;           // up to 500
}

message RecoverySnapshotComplete {
  string request_id = 1;
  uint32 chunk_count = 2;
  uint64 order_count = 3;
  google.protobuf.Timestamp snapshot_at = 4;
}

message RecoveryUnavailable {
  string request_id = 1;
  RecoveryUnavailableReason reason = 2;
  string detail = 3;
}

enum RecoveryUnavailableReason {
  RECOVERY_UNAVAILABLE_REASON_UNSPECIFIED = 0;
  RECOVERY_UNAVAILABLE_REASON_UPDATES_LAG = 1;
  RECOVERY_UNAVAILABLE_REASON_UNRECONCILED_ORDERS = 2;
  RECOVERY_UNAVAILABLE_REASON_DATABASE_UNAVAILABLE = 3;
  RECOVERY_UNAVAILABLE_REASON_INTERNAL = 4;
}
```

Snapshot keys are `request_id`.

Which orders
-----------

Only rows with `me_seq > 0` are included. A `PENDING` order, and a `CANCEL_PENDING` order the engine never acknowledged, stay out. Their commands are still on `order.accepted` or `order.cancel_requested` and will be delivered when the engine resumes.

| Stored status | Status in the snapshot |
|---|---|
| `OPEN` | `NEW` |
| `PARTIALLY_FILLED` | `PARTIALLY_FILLED` |
| `CANCEL_PENDING` | `NEW` when remaining equals quantity, otherwise `PARTIALLY_FILLED` |
| `FILLED`, `CANCELLED`, `EXPIRED`, `REJECTED` | the same status |

MARKET orders never rest, so they appear only as terminal rows. The window is orders created in the last 96 hours, which is longer than the 3-day command retention, so a redelivered command is still recognised.

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT order_id, user_id, grid_id, side, order_type,
       price, quantity_wh, remaining_quantity_wh,
       delivery_slot_start, expires_at, status, me_seq, created_at
  FROM orders
 WHERE me_seq > 0
   AND created_at > now() - interval '96 hours'
 ORDER BY created_at, order_id;

COMMIT;
```

Convert the stored status to the engine-visible status before sending. Keep the `(created_at, order_id)` order across chunks.

Handling a request
------------------

1. Read `RecoveryRequested`.
2. For at most 60 s, wait until group `order-service-updates` has applied `order.state` through the last stable offset of every partition. Otherwise publish `RecoveryUnavailable` with `UPDATES_LAG`.
3. If any order in the window has `needs_reconciliation`, or a dead letter from `order.state` is still `PENDING`, publish `UNRECONCILED_ORDERS`. Do not send a snapshot that might restore a stale remaining quantity.
4. If the database cannot be read, publish `DATABASE_UNAVAILABLE`.
5. Otherwise read the rows in one repeatable-read, read-only transaction. Publish chunks of at most 500, then `RecoverySnapshotComplete` after the chunks are acknowledged.
6. Serve at most one request every 10 s. The same `request_id` is answered again with the same rows.

Normal creates and cancels continue while a snapshot is served. Rows with `me_seq = 0` are absent on purpose.

This service does not stop matching, rebuild a book, or publish `EXPIRED` during recovery. Those are engine steps.
