---
connie-title: Order Service Kafka-Based Recovery
---

Kafka-Based Recovery
====================

Purpose
-------

This document defines how the Matching Engine rebuilds its in-memory state after a restart or crash, using only Kafka as the channel to the Order Service.

The engine keeps its order books in memory. The Order Service keeps the durable order records in PostgreSQL. After a restart the engine must regain exactly the state it had at its last committed step: the resting orders, the quantities and sequence numbers, and the knowledge of orders it already handled. Otherwise it could lose orders, match the same quantity twice, or execute a redelivered command again.

Recovery must fail safely. If a consistent state cannot be established, the engine stays out of service until it can.

Verified State
--------------

| Item | State | Source |
|---|---|---|
| Engine state | In memory only. No persistence and no recovery code. | `matching-engine` |
| Existing recovery design | The engine requests OPEN and PARTIALLY_FILLED orders from the Order Service over gRPC, in batches. | `matching-engine/crash-recovery.md`, `api-contracts.md` §5.4 |
| Required architecture | Kafka is the only channel between the two services. | Matching Engine integration document |
| Broker transactions | The dev broker sets the transaction state log to replication 1, so transactions work. | `gridx-infra` `docker-compose.yml` |
| Engine Kafka client | librdkafka (C++ wrapper). Transactions are in its C API, reachable through the wrapper's `c_ptr()`. | `CMakeLists.txt` |
| Durable order record | `orders` with `me_seq`, `remaining_quantity_wh`, status, price, slot, `created_at` | persistence document |

The gRPC recovery path in the older documents is replaced by this protocol.

Design Summary
--------------

| Decision | Choice |
|---|---|
| Source of recovered state | The Order Service's PostgreSQL records, delivered over Kafka as a snapshot |
| Exactly-once engine output | The engine publishes all outputs of a command batch together with its offset commit in one Kafka transaction |
| Snapshot boundary | The engine's committed offset on `gridx.orders.v1`. Commands at or after it are delivered normally. |
| Marker of what the engine knows | `me_seq > 0` on the order |
| One active engine | A fixed `transactional.id` fences any second instance |
| After any transaction error | The engine exits and recovers. It never continues with in-memory state it cannot trust. |
| Trade IDs | Time-based, so they stay unique across restarts |

Alternatives Considered
-----------------------

| Alternative | Why it was rejected |
|---|---|
| Replay `gridx.orders.v1` from the start through the matcher | Matching depends on the clock (expiry) and on the grid transfer rules at the time. A replay could produce different trades from those already published. |
| Engine writes its own snapshot to disk | Adds state outside the agreed architecture, and a recreated container loses it. |
| Engine asks the Order Service over gRPC | Violates the Kafka-only boundary. |
| Order Service snapshot without exactly-once engine output | After a crash in the middle of a command, the outputs may be partly published. The redelivered command would match again and could fill an incoming order more than its quantity. |
| Rebuild only from `OrderUpdated` events | Updates do not carry price, side, zone, or slot. |

Foundation: Exactly-Once Engine Processing
------------------------------------------

For the snapshot to be correct, the Order Service's stored state must equal the engine's state after its last committed step. That holds only if each unit of engine work is atomic.

**Engine rules**

1. The engine uses a **transactional producer** with a fixed `transactional.id` (for example `matching-engine-1`).
2. For each batch of commands it consumes, it begins a transaction, produces every resulting `OrderUpdated` and `TradeExecuted`, adds the consumer offsets with `send_offsets_to_transaction`, and commits. Either all outputs and the offset advance become visible, or none do.
3. On any transaction error, fencing, or abort, the engine **exits**. It does not retry with the in-memory state, because that state already includes the aborted batch's changes. The restart goes through recovery.
4. The fixed `transactional.id` makes `init_transactions` abort any open transaction of a previous instance and fence it. Only one engine instance can be active, which the in-memory book requires anyway.

**Consumer rules.** Every consumer of `gridx.orders.updates.v1` and `gridx.trades.v1` must use `isolation.level=read_committed`, so it never sees outputs of an aborted transaction. This covers the Order Service, Settlement, Billing, Notification, and Market Data.

**Invariant R.** After the Order Service has applied every committed `OrderUpdated`, then for each order with `me_seq > 0` the stored status and remaining quantity equal the engine's state after its last committed transaction. Commands at offsets below the engine's committed offset are reflected in that state, and commands at or after it are not.

**Boundary argument.**

1. The engine's state is a function of its committed transactions.
2. After restart, `init_transactions` aborts any open transaction, so no more outputs can appear from the old instance.
3. The Order Service applies every committed output, so by Invariant R its records equal the engine's last committed state.
4. Commands at offsets below the committed offset are already reflected. Commands at or after it are not, and the restarted engine will consume them.
5. An order with `me_seq = 0` has had no committed engine output, so its command is not yet reflected and will be delivered from the committed offset.

So the snapshot plus normal consumption from the committed offset reproduces the engine's state exactly, with no separate replay phase and no double counting.

What the Snapshot Contains
--------------------------

The Order Service computes two sets from PostgreSQL, using orders with `me_seq > 0`:

| Set | Definition | Used by the engine for |
|---|---|---|
| **Resting orders** | Engine-visible status `NEW` or `PARTIALLY_FILLED` and `expires_at > now` | Rebuilding the order books |
| **Known orders** | All orders with `me_seq > 0` created within the known-order window (4 days, longer than the 3-day topic retention) | Recognising redelivered commands as duplicates, continuing `order_seq`, and echoing terminal state |

Orders with `me_seq = 0` are excluded, including `PENDING` orders and `CANCEL_PENDING` orders the engine never acknowledged. Their commands are delivered from Kafka as usual.

The **engine-visible status** is derived from the stored fields:

| Stored status | Engine-visible status |
|---|---|
| `OPEN` | `NEW` |
| `PARTIALLY_FILLED` | `PARTIALLY_FILLED` |
| `CANCEL_PENDING` | `NEW` if remaining equals quantity, otherwise `PARTIALLY_FILLED` (the order still rests until its cancel is processed) |
| `FILLED`, `CANCELLED`, `EXPIRED`, `REJECTED` | The same status |

MARKET orders never rest, so they appear only as terminal known orders.

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT order_id, trader_id AS user_id, user_id AS user_uuid, grid_zone_id, side, order_type,
       limit_price AS price, quantity_wh, remaining_quantity_wh,
       delivery_slot_start, expires_at, status, me_seq, created_at
  FROM orders
 WHERE me_seq > 0
   AND created_at > now() - interval '96 hours'
 ORDER BY created_at, order_id;

COMMIT;
```

The service sends the rows in chunks in that order. It converts the stored status to the engine-visible status before sending.

**Refusal conditions.** The Order Service refuses to produce a snapshot, and answers `RecoveryUnavailable`, when:

- The Order Service's consumer of `gridx.orders.updates.v1` has not applied everything up to the last stable offset of every partition (`UPDATES_LAG`).
- Any order in the window has `needs_reconciliation`, or any dead letter from the updates topic is still `PENDING` (`UNRECONCILED_ORDERS`). Such an order's stored state may be stale, and restoring a stale remaining quantity could execute the same quantity twice. An operator resolves the flags first. This trades availability for correctness.
- The database is unreachable (`DATABASE_UNAVAILABLE`), or any other internal error (`INTERNAL`).

Topics and Messages
-------------------

| Topic | Producer | Consumer | Partitions | Retention |
|---|---|---|---|---|
| `gridx.orders.recovery.requests.v1` | Matching Engine | Order Service (group `order-service-recovery`) | 1 | 1 hour |
| `gridx.orders.recovery.snapshots.v1` | Order Service | Matching Engine | 1 | 1 hour |

One partition each keeps a session's messages in order. Both are created by the infrastructure repository alongside the other order topics. Messages are plain Protocol Buffers.

```proto
// order_recovery_events.proto  (package gridx.order.v1)
message RecoveryRequested {
  string request_id = 1;                       // UUID, one per attempt
  string engine_instance_id = 2;
  google.protobuf.Timestamp requested_at = 3;
}

message RecoveredOrder {
  uint64 order_id = 1;
  uint64 user_id = 2;                          // numeric trader number
  string user_uuid = 3;
  uint32 grid_zone_id = 4;
  Side side = 5;
  OrderType order_type = 6;
  int64 price = 7;                             // micro-AED per kWh
  int64 quantity = 8;                          // Wh
  int64 remaining_quantity = 9;                // Wh
  google.protobuf.Timestamp delivery_slot_start = 10;
  google.protobuf.Timestamp expires_at = 11;
  OrderStatus status = 12;                     // engine-visible status
  uint64 last_order_seq = 13;
  google.protobuf.Timestamp created_at = 14;   // time priority
}

message RecoverySnapshotChunk {
  string request_id = 1;
  uint32 chunk_index = 2;                      // 0-based, contiguous
  repeated RecoveredOrder orders = 3;          // up to 500, sorted by (created_at, order_id) across chunks
}

message RecoverySnapshotComplete {
  string request_id = 1;
  uint32 chunk_count = 2;
  uint64 order_count = 3;
  google.protobuf.Timestamp snapshot_at = 4;
}

enum RecoveryUnavailableReason {
  RECOVERY_UNAVAILABLE_REASON_UNSPECIFIED = 0;
  RECOVERY_UNAVAILABLE_REASON_UPDATES_LAG = 1;
  RECOVERY_UNAVAILABLE_REASON_UNRECONCILED_ORDERS = 2;
  RECOVERY_UNAVAILABLE_REASON_DATABASE_UNAVAILABLE = 3;
  RECOVERY_UNAVAILABLE_REASON_INTERNAL = 4;
}

message RecoveryUnavailable {
  string request_id = 1;
  RecoveryUnavailableReason reason = 2;
  string detail = 3;
}
```

The snapshot messages are keyed by `request_id`. The schema is versioned by the `v1` package. A consumer that meets an unknown enum value fails the attempt rather than guessing.

Protocol
--------

### Engine startup sequence

| State | Action |
|---|---|
| `STARTING` | Load configuration. Do not consume `gridx.orders.v1`. |
| `FENCING` | Create the transactional producer and call `init_transactions`. This aborts and fences any earlier instance. |
| `LOADING_RULES` | Load the grid transfer rules from their topic up to its current end, so cross-zone fees are known before any matching. |
| `REQUESTING` | Generate a new `request_id`. Publish `RecoveryRequested` in its own small transaction. |
| `LOADING_SNAPSHOT` | Consume the snapshot topic (`read_committed`), keeping only messages for this `request_id`, until `RecoverySnapshotComplete` or a 60 s timeout. A `RecoveryUnavailable` for this request, or a timeout, returns to `REQUESTING` after a backoff of 5 s growing to 60 s. |
| `BUILDING` | Validate the snapshot (below), build the known-order set and the books, schedule expiries, and initialise trade IDs. A validation failure discards everything and returns to `REQUESTING`. |
| `CLOSING_EXPIRED` | For every snapshot order whose engine-visible status is `NEW` or `PARTIALLY_FILLED` but whose `expires_at` has passed, publish `EXPIRED` (reason `SLOT_ENDED`, next `order_seq`) in the first transaction and keep it out of the book. |
| `READY` | Subscribe to `gridx.orders.v1` from the committed offsets and process normally, with transactions. |

Nothing is committed during recovery. A crash at any state restarts from `STARTING`, and the whole procedure is repeatable.

### Snapshot validation by the engine

The engine accepts a snapshot only if all of these hold, otherwise it discards the attempt and logs which rule failed:

- Chunk indexes are exactly `0` to `chunk_count - 1` with no gaps or duplicates, and the order count equals `order_count`.
- Every `order_id` is unique.
- Each order satisfies the contract: positive price, `0 <= remaining <= quantity`, status and remaining quantity consistent (`NEW` means remaining equals quantity, `PARTIALLY_FILLED` means partly filled, `FILLED` means 0), and a valid zone and slot.
- Orders are in `(created_at, order_id)` order.

### Order Service handling

1. Consume `RecoveryRequested` from the requests topic.
2. **Drain check.** Poll until the consumer group `order-service-updates` has applied everything up to the last stable offset of every updates partition, at most 60 s. Otherwise answer `RecoveryUnavailable(UPDATES_LAG)`.
3. **Refusal check** for flagged orders and pending dead letters.
4. Read the snapshot in one read-only `REPEATABLE READ` transaction.
5. Publish the chunks, then `RecoverySnapshotComplete` after all chunks are acknowledged.
6. Serve at most one request every 10 s. A repeated `request_id` is answered again identically, and the engine discards duplicate chunks by `(request_id, chunk_index)`.

The Order Service does not need to stop its normal work while serving a request. The engine is down and fenced, so the updates topic cannot change between the drain check and the read.

Concurrent Changes
------------------

| Case | Handling |
|---|---|
| Order created before, during, or after the snapshot | It has `me_seq = 0`, is not in the snapshot, and is delivered from the committed offset. |
| Order cancelled around the snapshot | The cancel command is at an offset at or after the committed offset and is processed against the restored book. If the order was `CANCEL_PENDING` with `me_seq > 0`, it is restored as resting and the cancel is redelivered. |
| Fills during recovery | None occur: the engine does not match until `READY`. Fills before the crash were committed with their outputs, so they are in the snapshot exactly once. |
| Orders expiring during recovery | Excluded from the book, and `EXPIRED` is published in the first transaction. The Order Service reconciler covers any that remain after its grace period. |
| Order Service applying engine updates during the snapshot | The drain check ensures none remain, and the engine cannot produce new ones. |
| Order Service changing other columns concurrently | The `REPEATABLE READ` snapshot is internally consistent. |

Priority Preservation
---------------------

Resting orders are inserted into the books sorted by `(created_at, order_id)`, so within a price level the earlier order keeps the front. This reproduces the live first-in-first-out order except when two orders reached the engine through different partitions in an order different from their creation times. That window is the Kafka delivery jitter, and the rule is documented rather than hidden. The snapshot carries `created_at` directly from the Order Service, and nothing is inferred.

*Needs sign-off: Matching Engine, to apply the same `(created_at, order_id)` rule at live insertion if exact equality between live and recovered priority is required.*

Idempotency and Restart Safety
------------------------------

- Each attempt has a unique `request_id`. The engine ignores messages for any other id, so an incomplete or obsolete session cannot contaminate a newer one.
- The snapshot is immutable per request. A restarted engine always begins a new attempt from scratch and persists no partial progress.
- Duplicate chunks are discarded by `(request_id, chunk_index)`. Duplicate completion markers are ignored. A completion marker whose counts do not match the chunks received fails the attempt.
- Redelivered commands after the restart are recognised through the known-order set: a known `order_id` is echoed, never matched again.
- The engine never resumes matching before `READY`, which is reached only after validation of a complete snapshot.

Failure Handling
----------------

| Case | Behaviour |
|---|---|
| Order Service unavailable | The engine retries with backoff and stays out of service. Orders accumulate in Kafka and remain `PENDING`. |
| Missing or incomplete chunks, missing completion marker | Timeout after 60 s, discard, retry with a new `request_id`. |
| Duplicate completion marker or chunk | Ignored. |
| Kafka publication or consumption failure | The attempt fails or times out and is retried. |
| PostgreSQL read failure | `RecoveryUnavailable(DATABASE_UNAVAILABLE)`. The engine retries. |
| Engine crash during loading or building | Restart from `STARTING`. Nothing was committed. |
| Conflicting order versions or sequence data | Snapshot validation fails, the attempt is discarded, an alert fires. The engine never "fixes" data. |
| Unsupported or unknown snapshot schema | The attempt fails with an alert. |
| Updates lag too large | `UPDATES_LAG`, the engine retries until the Order Service catches up. |
| Flagged orders or pending dead letters | `UNRECONCILED_ORDERS`. The engine stays out of service until an operator resolves them. |
| Stale or foreign session messages | Ignored by `request_id`. |
| Transaction error or fencing during normal operation | The engine exits and recovers. |
| Two engine instances started | The second fences the first through the fixed `transactional.id`. |

While the engine is out of service, creation still works and orders remain `PENDING`. MARKET orders expire after 30 s and LIMIT orders at slot end, through the engine's rejection of late commands and the Order Service reconciler.

Trade IDs and Grid Transfer Rules
---------------------------------

**Trade IDs.** The current in-memory counter would repeat IDs after a restart. Trade IDs become time-based: `trade_id = (unix_ms << 20) | counter`, where the 20-bit counter resets each millisecond and the generator never goes below the highest value it has issued. They are unique across restarts without reading Kafka. They exceed 2^53, so JavaScript clients receive them as strings.

**Grid transfer rules.** The engine reads them from their topic from the earliest offset before accepting commands. The topic must be compacted or must retain at least the latest rule for every zone pair, otherwise a restart could lose fees.

Observability
-------------

| Side | Signal | Meaning |
|---|---|---|
| Engine | `me_recovery_state` | Current state of the startup sequence |
| Engine | `me_recovery_attempts_total{result}` | Attempts by outcome |
| Engine | `me_recovery_duration_seconds` | Time spent out of service |
| Engine | `me_recovery_orders_restored{kind}` | Resting and known orders loaded |
| Engine | `me_recovery_snapshot_chunks_received` | Progress |
| Order Service | `order_recovery_requests_total{result}` | `served`, `unavailable` by reason |
| Order Service | `order_recovery_snapshot_orders` | Size of the last snapshot |
| Both | Logs with `request_id` | Correlate a session across services |

Alerts: engine out of service for more than 2 minutes, repeated `RecoveryUnavailable`, snapshot validation failure, and any snapshot refusal for `UNRECONCILED_ORDERS`.

Configuration
-------------

| Variable | Default | Where |
|---|---|---|
| `KAFKA_TRANSACTIONAL_ID` | `matching-engine-1` | Engine |
| `KAFKA_RECOVERY_REQUEST_TOPIC` | `gridx.orders.recovery.requests.v1` | Both |
| `KAFKA_RECOVERY_SNAPSHOT_TOPIC` | `gridx.orders.recovery.snapshots.v1` | Both |
| `RECOVERY_ATTEMPT_TIMEOUT` | 60 s | Engine |
| `RECOVERY_KNOWN_ORDER_WINDOW` | 96 h | Order Service |
| `RECOVERY_CHUNK_SIZE` | 500 | Order Service |
| `RECOVERY_DRAIN_TIMEOUT` | 60 s | Order Service |
| `RECOVERY_MIN_INTERVAL` | 10 s | Order Service |

Required Tests
--------------

- **Crash injection.** Kill the engine at random points (before consuming, mid-transaction, after commit) in a long randomised run. After every recovery, for every order, the sum of executed trade quantities never exceeds the quantity, and the Order Service state equals the engine state.
- **Redelivery.** A redelivered command for an already filled order produces an echo and no trade.
- **Mid-transaction crash.** No partial outputs are visible to a `read_committed` consumer, and the command is processed once after recovery.
- **Snapshot validation.** Each rejection rule (gap, duplicate, bad quantities, wrong order) fails the attempt.
- **Refusals.** Lag, flagged orders, and pending dead letters each produce the right `RecoveryUnavailable`.
- **Concurrent changes.** Orders created and cancelled during recovery end in a consistent state.
- **Restart during recovery.** A new attempt starts cleanly and stale chunks are ignored.
- **Fencing.** A second instance fences the first, and the first exits.
- **Priority.** A restored book matches in the same order as before the crash for orders created at distinct times.
- **Trade IDs.** IDs after a restart are all greater than any before it.

Decisions and Dependencies
--------------------------

### Resolved decisions

| ID | Open item | Decision |
|---|---|---|
| R-1 | Kafka topics and partitioning | The two recovery topics above (1 partition each), plus the order topics with key `order_id`. |
| R-2 | The Order Service's definition of an active order | Resting set and known set as defined above, derived from `me_seq > 0`, the stored status, and `expires_at`. |
| R-3 | Snapshot schema and versioning | `order_recovery_events.proto`, versioned by the `v1` package. |
| R-4 | Consistent snapshot boundary | The engine's committed offset, made precise by transactional output and the drain check. No Kafka timestamps or independent markers are relied on. |
| R-5 | How concurrent live events are captured | They are not in the snapshot and arrive from the committed offset. There is no separate replay phase. |
| R-6 | How priority is preserved | `(created_at, order_id)` taken from the Order Service's record. |
| R-7 | Duplicate commands and executions | Known-order set (echo, never re-match) and exactly-once transactional outputs. |
| R-8 | How incomplete sessions are detected and restarted | `request_id`, contiguous chunk indexes, completion counts, a 60 s timeout, and restart from `STARTING`. |
| R-9 | Conditions before matching resumes | `READY` only after fencing, rules loaded, and a validated complete snapshot. |

### Remaining items needing sign-off

| ID | Item | Owner |
|---|---|---|
| R-O1 | Adopt exactly-once processing: transactional producer, offsets in the transaction, exit on error, fixed `transactional.id`. Confirm the installed librdkafka version supports the transactional C API. | Matching Engine |
| R-O2 | Implement the startup sequence, snapshot validation, and `CLOSING_EXPIRED`. | Matching Engine |
| R-O3 | Build the snapshot service and the refusal rules in the Order Service. | Order Service team |
| R-O4 | All consumers of the engine's topics use `read_committed`. | Order Service, Billing and Settlement, Notification, Market Data |
| R-O5 | Create the two recovery topics, and confirm the grid transfer rules topic is compacted or fully retained. | Infrastructure, IoT owner |
| R-O6 | Time-based trade IDs. | Matching Engine, Billing and Settlement |
| R-O7 | Accept the availability trade-off of refusing recovery on unreconciled orders. | Product, operations |
| R-O8 | Add `order_recovery_events.proto` to `protobuf`. | protobuf maintainers |

Record confirmed decisions in the shared contracts and the Matching Engine documentation before describing them as existing behaviour.
