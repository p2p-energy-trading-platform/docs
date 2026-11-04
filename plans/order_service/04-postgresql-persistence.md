---
connie-title: Order Service PostgreSQL Persistence
---

PostgreSQL Persistence
======================

Purpose
-------

PostgreSQL provides durable storage for Order Service records: orders, lifecycle history, pending outbound events, energy allocations, and consumer deduplication state.

The Matching Engine's in-memory order book is runtime state. It is reconstructed from the durable records in this schema and from the Kafka recovery protocol. Persisted order state is never proof that a command was accepted by the Matching Engine or that a trade was executed. The Order Service stores the order's cumulative remaining quantity as reported by the engine. It does not store individual trades.

Database Setup
--------------

| Item | Value | Source |
|---|---|---|
| Server | PostgreSQL 16 | `gridx-infra` `postgres:16-alpine` |
| Schema | `order_management_data`, owned by the Order Service role | `gridx-infra/init-scripts/postgres/01-init-schemas.sql` |
| Role | `ORDER_SERVICE_USER`, with `search_path` set to `order_management_data, public` | same |
| Migrations | Goose, embedded SQL, applied only by `cmd/migrate` as a deployment job | `iot-ingestion-dispatch` convention |
| Startup check | The service verifies that the applied migration version equals the embedded latest version and refuses to start otherwise | same |
| Isolation | `READ COMMITTED` (the default). Correctness comes from unique constraints, row locks, and conditional updates, not from `SERIALIZABLE`. | this document |

All objects use schema-qualified names, as in the IoT migrations. The schema currently contains no tables, so migration `00001` creates everything.

Tables
------

| Table | Purpose |
|---|---|
| `trader_accounts` | Maps an Auth user UUID to the numeric `trader_id` the Matching Engine requires |
| `orders` | One row per order: current state, remaining quantity, idempotency key |
| `order_status_history` | Append-only record of every status change |
| `outbox_events` | Kafka commands waiting to be published |
| `processed_events` | Matching Engine events already applied (deduplication) |
| `consumer_dead_letters` | Events that could not be applied, kept for inspection and controlled replay |
| `energy_slot_capacity` | Per meter and slot: capacity and allocated energy |
| `energy_allocations` | Per SELL order: energy allocated and released |

There is no `idempotency_records` table. The idempotency key and request fingerprint live on the order row (see Order Validation, D-05). There is no executions table in v1, because trades belong to the Matching Engine and Settlement.

Migration 00001: Initial Schema
-------------------------------

```sql
-- +goose Up
CREATE TYPE order_management_data.order_side AS ENUM ('BUY', 'SELL');
CREATE TYPE order_management_data.order_type AS ENUM ('LIMIT', 'MARKET');
CREATE TYPE order_management_data.order_status AS ENUM (
    'PENDING', 'OPEN', 'PARTIALLY_FILLED', 'CANCEL_PENDING',
    'FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED'
);
CREATE TYPE order_management_data.terminal_source AS ENUM ('ME', 'RECONCILER');
CREATE TYPE order_management_data.dead_letter_status AS ENUM ('PENDING', 'REPLAYED', 'DISCARDED');

-- Numeric trader number sent to the Matching Engine as user_id (uint64).
CREATE TABLE order_management_data.trader_accounts (
    trader_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    UUID NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE order_management_data.orders (
    order_id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id               UUID   NOT NULL,
    trader_id             BIGINT NOT NULL REFERENCES order_management_data.trader_accounts (trader_id),
    house_id              TEXT   NOT NULL,
    meter_id              TEXT   NOT NULL,
    grid_id               TEXT   NOT NULL,
    grid_zone_id          INTEGER NOT NULL CHECK (grid_zone_id > 0),

    side                  order_management_data.order_side NOT NULL,
    order_type            order_management_data.order_type NOT NULL,
    requested_price       BIGINT,                      -- micro-AED per kWh, as supplied by the client
    limit_price           BIGINT NOT NULL CHECK (limit_price > 0),  -- effective price sent to the engine
    price_defaulted       BOOLEAN NOT NULL DEFAULT FALSE,
    quantity_wh           BIGINT NOT NULL CHECK (quantity_wh > 0),
    remaining_quantity_wh BIGINT NOT NULL,

    delivery_slot_start   TIMESTAMPTZ NOT NULL,
    delivery_slot_end     TIMESTAMPTZ NOT NULL,
    expires_at            TIMESTAMPTZ NOT NULL,

    status                order_management_data.order_status NOT NULL DEFAULT 'PENDING',
    status_reason         TEXT,
    version               BIGINT NOT NULL DEFAULT 0,
    me_seq                BIGINT NOT NULL DEFAULT 0,
    terminal_source       order_management_data.terminal_source,
    terminal_at           TIMESTAMPTZ,
    needs_reconciliation  BOOLEAN NOT NULL DEFAULT FALSE,

    idempotency_key       TEXT  NOT NULL,
    request_fingerprint   BYTEA NOT NULL,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT orders_user_idempotency_key UNIQUE (user_id, idempotency_key),
    CONSTRAINT orders_idempotency_key_format CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,64}$'),
    CONSTRAINT orders_fingerprint_length CHECK (octet_length(request_fingerprint) = 32),
    CONSTRAINT orders_remaining_range CHECK (remaining_quantity_wh BETWEEN 0 AND quantity_wh),
    CONSTRAINT orders_slot_aligned CHECK (EXTRACT(EPOCH FROM delivery_slot_start) % 1800 = 0),
    CONSTRAINT orders_slot_length CHECK (delivery_slot_end = delivery_slot_start + INTERVAL '30 minutes'),
    CONSTRAINT orders_expiry_within_slot CHECK (expires_at <= delivery_slot_end),
    CONSTRAINT orders_price_semantics CHECK (
        (order_type = 'LIMIT'
            AND requested_price IS NOT NULL AND requested_price = limit_price AND NOT price_defaulted)
        OR
        (order_type = 'MARKET' AND (
            (requested_price IS NULL AND price_defaulted)
            OR (requested_price IS NOT NULL AND requested_price = limit_price AND NOT price_defaulted)))
    ),
    CONSTRAINT orders_status_quantity CHECK (
        (status IN ('PENDING', 'OPEN') AND remaining_quantity_wh = quantity_wh)
        OR (status = 'PARTIALLY_FILLED' AND remaining_quantity_wh BETWEEN 1 AND quantity_wh - 1)
        OR (status = 'FILLED' AND remaining_quantity_wh = 0)
        OR (status = 'REJECTED' AND remaining_quantity_wh = quantity_wh)
        OR status IN ('CANCEL_PENDING', 'CANCELLED', 'EXPIRED')
    ),
    CONSTRAINT orders_terminal_columns CHECK (
        (status IN ('FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED')
            AND terminal_source IS NOT NULL AND terminal_at IS NOT NULL)
        OR
        (status NOT IN ('FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED')
            AND terminal_source IS NULL AND terminal_at IS NULL)
    ),
    CONSTRAINT orders_reconciler_only_expires CHECK (terminal_source IS DISTINCT FROM 'RECONCILER' OR status = 'EXPIRED'),
    CONSTRAINT orders_market_never_rests CHECK (order_type = 'LIMIT' OR status NOT IN ('OPEN', 'PARTIALLY_FILLED')),
    CONSTRAINT orders_status_reason_length CHECK (status_reason IS NULL OR length(status_reason) <= 64)
);

CREATE INDEX idx_orders_user_order_id
    ON order_management_data.orders (user_id, order_id DESC);
CREATE INDEX idx_orders_active_expiry
    ON order_management_data.orders (expires_at)
    WHERE status IN ('PENDING', 'OPEN', 'PARTIALLY_FILLED', 'CANCEL_PENDING');
CREATE INDEX idx_orders_active_slot
    ON order_management_data.orders (delivery_slot_start)
    WHERE status IN ('PENDING', 'OPEN', 'PARTIALLY_FILLED', 'CANCEL_PENDING');
CREATE INDEX idx_orders_pending_created
    ON order_management_data.orders (created_at)
    WHERE status IN ('PENDING', 'CANCEL_PENDING');
CREATE INDEX idx_orders_needs_reconciliation
    ON order_management_data.orders (order_id)
    WHERE needs_reconciliation;

CREATE TABLE order_management_data.order_status_history (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id              BIGINT NOT NULL REFERENCES order_management_data.orders (order_id),
    from_status           order_management_data.order_status,
    to_status             order_management_data.order_status NOT NULL,
    source                TEXT NOT NULL CHECK (source IN ('USER', 'ME', 'RECONCILER', 'SYSTEM')),
    event_id              UUID,
    me_seq                BIGINT,
    remaining_quantity_wh BIGINT NOT NULL CHECK (remaining_quantity_wh >= 0),
    reason                TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_order_status_history_order
    ON order_management_data.order_status_history (order_id, id);

-- +goose StatementBegin
CREATE FUNCTION order_management_data.forbid_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'order_status_history is append-only';
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER order_status_history_append_only
    BEFORE UPDATE OR DELETE ON order_management_data.order_status_history
    FOR EACH ROW EXECUTE FUNCTION order_management_data.forbid_history_mutation();

CREATE TABLE order_management_data.outbox_events (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id        UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    aggregate_id    BIGINT NOT NULL,                       -- order_id
    topic           TEXT   NOT NULL,
    record_key      TEXT   NOT NULL,
    message_type    TEXT   NOT NULL CHECK (message_type IN ('order.accepted', 'order.cancel_requested')),
    payload         BYTEA  NOT NULL,                       -- serialized protobuf
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at    TIMESTAMPTZ,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_by       TEXT,
    locked_until    TIMESTAMPTZ
);
CREATE INDEX idx_outbox_unpublished
    ON order_management_data.outbox_events (id)
    WHERE published_at IS NULL;
CREATE INDEX idx_outbox_unpublished_aggregate
    ON order_management_data.outbox_events (aggregate_id, id)
    WHERE published_at IS NULL;
CREATE INDEX idx_outbox_published_at
    ON order_management_data.outbox_events (published_at)
    WHERE published_at IS NOT NULL;

CREATE TABLE order_management_data.processed_events (
    event_id     UUID PRIMARY KEY,
    source_topic TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_processed_events_processed_at
    ON order_management_data.processed_events (processed_at);

CREATE TABLE order_management_data.consumer_dead_letters (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    topic        TEXT    NOT NULL,
    kafka_partition INTEGER NOT NULL,
    kafka_offset BIGINT  NOT NULL,
    record_key   TEXT,
    event_id     TEXT,
    stage        TEXT NOT NULL CHECK (stage IN ('DECODE', 'VALIDATE', 'APPLY', 'UNKNOWN_ORDER', 'STALE_TERMINAL')),
    error        TEXT NOT NULL,
    payload      BYTEA NOT NULL,
    status       order_management_data.dead_letter_status NOT NULL DEFAULT 'PENDING',
    attempts     INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at  TIMESTAMPTZ,
    CONSTRAINT dead_letters_unique_record UNIQUE (topic, kafka_partition, kafka_offset)
);
CREATE INDEX idx_dead_letters_pending
    ON order_management_data.consumer_dead_letters (created_at)
    WHERE status = 'PENDING';

CREATE TABLE order_management_data.energy_slot_capacity (
    meter_id            TEXT NOT NULL,
    delivery_slot_start TIMESTAMPTZ NOT NULL,
    capacity_wh         BIGINT NOT NULL,
    allocated_wh        BIGINT NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (meter_id, delivery_slot_start),
    CONSTRAINT energy_slot_capacity_range CHECK (allocated_wh >= 0 AND allocated_wh <= capacity_wh)
);

CREATE TABLE order_management_data.energy_allocations (
    order_id            BIGINT PRIMARY KEY REFERENCES order_management_data.orders (order_id),
    meter_id            TEXT NOT NULL,
    delivery_slot_start TIMESTAMPTZ NOT NULL,
    allocated_wh        BIGINT NOT NULL CHECK (allocated_wh > 0),
    released_wh         BIGINT NOT NULL DEFAULT 0,
    released_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (meter_id, delivery_slot_start)
        REFERENCES order_management_data.energy_slot_capacity (meter_id, delivery_slot_start),
    CONSTRAINT energy_allocations_released_range CHECK (released_wh BETWEEN 0 AND allocated_wh),
    CONSTRAINT energy_allocations_released_consistent CHECK ((released_at IS NULL) = (released_wh = 0 AND released_at IS NULL))
);

-- +goose Down
DROP TABLE IF EXISTS order_management_data.energy_allocations;
DROP TABLE IF EXISTS order_management_data.energy_slot_capacity;
DROP TABLE IF EXISTS order_management_data.consumer_dead_letters;
DROP TABLE IF EXISTS order_management_data.processed_events;
DROP TABLE IF EXISTS order_management_data.outbox_events;
DROP TRIGGER IF EXISTS order_status_history_append_only ON order_management_data.order_status_history;
DROP TABLE IF EXISTS order_management_data.order_status_history;
DROP FUNCTION IF EXISTS order_management_data.forbid_history_mutation();
DROP TABLE IF EXISTS order_management_data.orders;
DROP TABLE IF EXISTS order_management_data.trader_accounts;
DROP TYPE IF EXISTS order_management_data.dead_letter_status;
DROP TYPE IF EXISTS order_management_data.terminal_source;
DROP TYPE IF EXISTS order_management_data.order_status;
DROP TYPE IF EXISTS order_management_data.order_type;
DROP TYPE IF EXISTS order_management_data.order_side;
```

### Design notes on the schema

- **No hard-coded business limits.** Price tick, price band, and quantity limits are configurable, so they are enforced in the service. The database holds only invariants that never change: positive values, 30-minute aligned slots, and the consistency rules between status, quantity, and terminal columns.
- **The status rules are a safety net.** For example, a `FILLED` order must have zero remaining quantity, a `PARTIALLY_FILLED` order must have some but not all quantity left, and a MARKET order can never be `OPEN`. A bug in the transition code fails loudly instead of corrupting data.
- **`released_at` consistency:** an allocation is either unreleased (`released_at IS NULL`) or released at a point in time. The release statement below only writes where `released_at IS NULL`, which makes the release idempotent.
- **No default privileges needed.** The Order Service role owns the schema, so it owns every object it creates.

Atomic Order Creation
---------------------

Before opening the transaction, perform request validation, the permission check, the idempotency lookup, and the IoT calls. These are not a substitute for the database constraints below. Never hold a transaction open while waiting for IoT, Auth, or Kafka.

Within one transaction, in this order:

1. **Ensure the trader account.** Idempotent and harmless for duplicate requests.

   ```sql
   WITH ins AS (
       INSERT INTO trader_accounts (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING trader_id
   )
   SELECT trader_id FROM ins
   UNION ALL
   SELECT trader_id FROM trader_accounts WHERE user_id = $1
   LIMIT 1;
   ```

2. **Insert the order.** This statement serializes concurrent duplicates:

   ```sql
   INSERT INTO orders (user_id, trader_id, house_id, meter_id, grid_id, grid_zone_id, side, order_type,
                       requested_price, limit_price, price_defaulted, quantity_wh, remaining_quantity_wh,
                       delivery_slot_start, delivery_slot_end, expires_at, idempotency_key, request_fingerprint)
   VALUES (..., $quantity, ..., $key, $fingerprint)
   ON CONFLICT (user_id, idempotency_key) DO NOTHING
   RETURNING order_id, created_at;
   ```

   Zero rows means a concurrent or earlier duplicate. Roll back, read the existing order, then replay (same fingerprint) or return `IDEMPOTENCY_CONFLICT`. No allocation has happened yet, so a duplicate never allocates energy.
3. **SELL only: allocate energy** with the conditional update in the IoT energy validation document, then insert the `energy_allocations` row. Zero rows updated rolls back with `ENERGY_INSUFFICIENT`.
4. **Insert the history row** (`from_status` null, `to_status` `PENDING`, source `USER`).
5. **Insert the outbox row** with the serialized `OrderAccepted`, topic `gridx.orders.v1`, `record_key` equal to the order ID, and `message_type` `order.accepted`.
6. **Commit.**

If any statement fails, the whole transaction rolls back. No partial order, history row, allocation, or outbox row is ever committed independently.

The lock order is always **orders row, then `energy_slot_capacity` row**, in every code path, to avoid deadlocks. Deadlock (`40P01`) and serialization (`40001`) failures are retried up to three times, then surface as `ENERGY_ALLOCATION_CONFLICT` for SELL orders and `INTERNAL_ERROR` for others.

Transactional Outbox
--------------------

The outbox holds two message types in v1: `order.accepted` (placement) and `order.cancel_requested`. The Order Service publishes nothing else. Notifications derive from Matching Engine updates.

- `event_id` is generated once when the row is inserted and reused on every republish, so downstream deduplication by `event_id` works.
- The publisher publishes only committed rows.
- **Per-order ordering.** A row is claimable only if no earlier unpublished row exists for the same order, which keeps placement ahead of cancel with several workers or a backoff on an earlier row.

Claiming uses a short transaction and a lease, so no transaction is held open during the Kafka send:

```sql
WITH picked AS (
    SELECT e.id
      FROM outbox_events e
     WHERE e.published_at IS NULL
       AND e.next_attempt_at <= NOW()
       AND (e.locked_until IS NULL OR e.locked_until < NOW())
       AND NOT EXISTS (SELECT 1 FROM outbox_events p
                        WHERE p.aggregate_id = e.aggregate_id
                          AND p.id < e.id AND p.published_at IS NULL)
     ORDER BY e.id
     LIMIT $batch
       FOR UPDATE OF e SKIP LOCKED
)
UPDATE outbox_events o
   SET locked_by = $worker, locked_until = NOW() + INTERVAL '30 seconds', attempts = attempts + 1
  FROM picked
 WHERE o.id = picked.id
RETURNING o.*;
```

After broker acknowledgement the publisher sets `published_at = NOW()` and clears the lease. On failure it records `last_error` and sets `next_attempt_at` with bounded exponential backoff. A crashed worker's lease expires and another worker retries.

A publisher can send to Kafka and fail before recording the result, or its lease can expire mid-send. Both cause a duplicate delivery, so delivery is **at-least-once** and consumers must deduplicate by `event_id`. The Matching Engine must ignore a placement whose order ID it already holds.

Applying Matching Engine Updates
--------------------------------

Within one transaction:

```sql
-- 1. dedupe by event
INSERT INTO processed_events (event_id, source_topic) VALUES ($1, $2) ON CONFLICT DO NOTHING;
-- 0 rows inserted => duplicate: commit, advance the offset, stop.

-- 2. lock the order
SELECT order_id, status, quantity_wh, remaining_quantity_wh, me_seq, terminal_source, version
  FROM orders WHERE order_id = $3 FOR UPDATE;
-- no row => quarantine as UNKNOWN_ORDER

-- 3. the service applies the rules from Order Validation (stale me_seq, transition table, quantity checks)

-- 4. conditional update
UPDATE orders
   SET status = $4, remaining_quantity_wh = $5, me_seq = $6, status_reason = $7,
       terminal_source = $8, terminal_at = $9,
       version = version + 1, updated_at = NOW()
 WHERE order_id = $3 AND version = $10;
-- 0 rows => internal error: the row lock should make this impossible

-- 5. append history; for a terminal status release unused SELL allocation
```

The `version` check is part of the same atomic update statement, not a separate read followed by a write. The row lock makes it a defensive check, not the primary guard.

### Releasing an allocation

```sql
UPDATE energy_allocations
   SET released_wh = $remaining, released_at = NOW()
 WHERE order_id = $1 AND released_at IS NULL
RETURNING meter_id, delivery_slot_start, released_wh;

UPDATE energy_slot_capacity
   SET allocated_wh = allocated_wh - $released, updated_at = NOW()
 WHERE meter_id = $2 AND delivery_slot_start = $3;
```

If the first statement returns no row, the allocation was already released, and nothing else changes. If the allocation was released by a reconciler expiry and a later engine event reports a lower remaining quantity, set `released_wh` to the new remaining quantity and add the difference back to `allocated_wh` in the same transaction.

Idempotency
-----------

Creation idempotency is the unique index `orders_user_idempotency_key` plus `request_fingerprint` (SHA-256 of `side`, `order_type`, `requested_price`, `quantity_wh`, `delivery_slot_start`). A repeated key with a different fingerprint is detected by comparing fingerprints and returns `IDEMPOTENCY_CONFLICT`. It never creates an unrelated order and never returns another request's outcome. The key is bound to its order for the order's lifetime, so there is no key expiry.

Event idempotency is `processed_events` (by `event_id`) plus the permanent `me_seq` check on the order. Cancellation is idempotent by `order_id`.

Concurrency and State Transitions
---------------------------------

- Every writer that changes an order locks its row with `SELECT ... FOR UPDATE` first.
- Every update increments `version` and is guarded by `WHERE version = $expected`.
- A stale update can never overwrite newer state: the `me_seq` check rejects stale events, and terminal states are never changed except by the superseding rule in Order Validation.
- The check constraints on `orders` reject impossible status and quantity combinations even if the service code has a bug.
- Allocation changes use conditional updates, never a read followed by an unprotected write.

Data Types and Time
-------------------

| Concept | PostgreSQL type | Notes |
|---|---|---|
| Energy | `BIGINT` | Watt-hours |
| Price | `BIGINT` | Micro-AED per kWh |
| Timestamps | `TIMESTAMPTZ` | Stored and compared in UTC |
| Identifiers | `BIGINT` identity (orders, history, outbox, trader) and `UUID` (users, events) | |
| Binary payloads | `BYTEA` | Serialized protobuf |
| Statuses and sides | `ENUM` types | As in the IoT schema |

No `NUMERIC`, `REAL`, or `DOUBLE PRECISION` column exists in this schema. The largest possible product `price x quantity` with the default limits is about 1e11, which fits easily in `BIGINT`.

Recovery and Reconciliation
---------------------------

The Order Service reconciles durable records with asynchronous Matching Engine outcomes with these background queries. Each one raises a metric and an alert. Only the expiry fallback changes state.

| Case | Query condition | Action |
|---|---|---|
| Order never acknowledged | `status = 'PENDING' AND created_at < NOW() - 30 s` | Alert. The outbox row may be republished (safe, the engine deduplicates). |
| Cancel never resolved | `status = 'CANCEL_PENDING' AND updated_at < NOW() - 30 s` | Alert. Cancel command may be republished. |
| Expiry overdue | `status IN (PENDING, OPEN, PARTIALLY_FILLED, CANCEL_PENDING) AND expires_at + grace < NOW()` | Apply `EXPIRED` with source `RECONCILER`, release allocation, alert. Use `FOR UPDATE SKIP LOCKED` with a batch limit. |
| Flagged order | `needs_reconciliation` | Alert. An operator resolves it. |
| Outbox backlog | oldest unpublished age | Alert. |
| Dead letters | `status = 'PENDING'` | Alert. Replay through `cmd/dead-letter-replay`. |
| Ledger drift | allocated total differs from the sum of unreleased allocations | Alert only, never auto-correct. |

The active set the Matching Engine needs after a restart is `status IN ('PENDING', 'OPEN', 'PARTIALLY_FILLED', 'CANCEL_PENDING') AND expires_at > NOW()`. The recovery protocol document defines how it is delivered.

Replaying events never duplicates orders or allocation changes, because every step is guarded by `processed_events`, `me_seq`, and the `released_at IS NULL` condition.

Listing Orders
--------------

`ListOrders` pages by `order_id` descending, using the index `idx_orders_user_order_id`:

```sql
SELECT * FROM orders
 WHERE user_id = $1 AND ($2::BIGINT IS NULL OR order_id < $2)
 ORDER BY order_id DESC
 LIMIT $3;
```

The page token is the last `order_id` returned.

Retention
---------

| Table | Retention |
|---|---|
| `orders`, `order_status_history` | Indefinite in v1 (financial record). Archival is a later decision. |
| `energy_slot_capacity`, `energy_allocations` | Indefinite in v1. |
| `outbox_events` | Published rows deleted after 7 days. Unpublished rows are never deleted automatically. |
| `processed_events` | Deleted after 7 days. This must exceed the Kafka topic retention. The permanent `me_seq` check still rejects stale events afterwards. |
| `consumer_dead_letters` | Resolved rows deleted after 90 days. Pending rows are kept. |
| `trader_accounts` | Indefinite. |

A `retention_cleaner` background worker deletes the expired rows in batches.

Decisions and Dependencies
--------------------------

### Resolved decisions

| ID | Open item | Decision |
|---|---|---|
| P-1 | Which tables already exist | None. The schema is provisioned but empty. Migration `00001` creates all tables above. |
| P-2 | Who owns execution records | The Matching Engine and Settlement own trades. The Order Service stores only the cumulative remaining quantity and the status history. There is no executions table in v1. |
| P-3 | Who owns the allocation ledger | The Order Service (`energy_slot_capacity`, `energy_allocations`). |
| P-4 | Events written to the outbox | `order.accepted` and `order.cancel_requested` only. |
| P-5 | How the publisher tracks progress and recovers | `published_at`, attempt counters, backoff, and a 30 s lease. Another worker takes over an expired lease. Per-order ordering is enforced in the claim query. |
| P-6 | How duplicates are detected | Requests: unique `(user_id, idempotency_key)` plus the request fingerprint. Events: `processed_events` by `event_id` plus the `me_seq` check. |
| P-7 | Numeric precision and time | `BIGINT` Wh, `BIGINT` micro-AED per kWh, `TIMESTAMPTZ` in UTC, no floating point. |
| P-8 | Reconciling state with engine outcomes | The reconciliation queries above and the update rules in Order Validation. |
| P-9 | Retention and cleanup | See the Retention table. Orders and history are kept indefinitely in v1. |

### Remaining items needing sign-off

| ID | Item | Owner |
|---|---|---|
| P-O1 | Run `cmd/migrate` as a deployment job with the Order Service role, and add the Order Service to the infra compose and environment files. | Infrastructure |
| P-O2 | Confirm indefinite retention of orders and history, or agree an archival policy. | Product |
| P-O3 | Confirm the Matching Engine sends a valid UUID `event_id` on every `OrderUpdated`. A non-UUID value is dead-lettered as malformed. | Matching Engine |

Record confirmed decisions in the shared contracts and in the migration files before describing them as existing behaviour.
