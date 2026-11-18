---
connie-title: Order Service PostgreSQL Persistence
---

PostgreSQL Persistence
======================

Purpose
-------

PostgreSQL stores orders, status history, the outbound outbox, the SELL energy ledger, and consumer deduplication. The Matching Engine's book is memory. This schema is not proof that the engine accepted a command or that a trade happened. Remaining quantity is whatever the last applied `OrderUpdated` said. Individual trades are not stored.

Database
--------

| Item | Value |
|---|---|
| Server | PostgreSQL 16 (`gridx-infra`) |
| Schema | `order_management_data`, owned by `ORDER_SERVICE_USER` |
| Migrations | Goose, embedded SQL, applied by `cmd/migrate` |
| Startup | Refuse to start when the applied migration is not the embedded latest |
| Isolation | `READ COMMITTED`. Correctness comes from unique constraints, row locks, and conditional updates |

The schema has no tables yet. Migration `00001` creates everything.

| Table | Purpose |
|---|---|
| `orders` | Current state, remaining quantity, idempotency key |
| `order_status_history` | Append-only status changes |
| `outbox_events` | Commands waiting for Kafka |
| `processed_events` | Engine events already applied |
| `consumer_dead_letters` | Events that could not be applied |
| `energy_slot_capacity` | Capacity and allocated energy per meter and slot |
| `energy_allocations` | Energy allocated and released per SELL order |

There is no trader-account table and no executions table.

Migration 00001
---------------

```sql
-- +goose Up
CREATE TYPE order_management_data.order_side AS ENUM ('BUY', 'SELL');
CREATE TYPE order_management_data.order_type AS ENUM ('LIMIT', 'MARKET');
CREATE TYPE order_management_data.order_status AS ENUM (
    'PENDING', 'OPEN', 'PARTIALLY_FILLED', 'CANCEL_PENDING',
    'FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED'
);
CREATE TYPE order_management_data.dead_letter_status AS ENUM ('PENDING', 'REPLAYED', 'DISCARDED');

CREATE TABLE order_management_data.orders (
    order_id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id               UUID   NOT NULL,
    house_id              TEXT   NOT NULL,
    meter_id              TEXT   NOT NULL,
    grid_id               TEXT   NOT NULL,

    side                  order_management_data.order_side NOT NULL,
    order_type            order_management_data.order_type NOT NULL,
    price                 BIGINT NOT NULL CHECK (price > 0), -- LKR minor units per kWh
    quantity_wh           BIGINT NOT NULL CHECK (quantity_wh > 0),
    remaining_quantity_wh BIGINT NOT NULL,

    delivery_slot_start   TIMESTAMPTZ NOT NULL,
    delivery_slot_end     TIMESTAMPTZ NOT NULL,
    expires_at            TIMESTAMPTZ NOT NULL,

    status                order_management_data.order_status NOT NULL DEFAULT 'PENDING',
    status_reason         TEXT,
    version               BIGINT NOT NULL DEFAULT 0,
    me_seq                BIGINT NOT NULL DEFAULT 0,
    terminal_at           TIMESTAMPTZ,
    needs_reconciliation  BOOLEAN NOT NULL DEFAULT FALSE,

    idempotency_key       TEXT  NOT NULL,
    request_fingerprint   BYTEA NOT NULL,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT orders_user_idempotency_key UNIQUE (user_id, idempotency_key),
    CONSTRAINT orders_idempotency_key_format CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,64}$'),
    CONSTRAINT orders_fingerprint_length CHECK (octet_length(request_fingerprint) = 32),
    CONSTRAINT orders_grid_id_present CHECK (length(grid_id) > 0),
    CONSTRAINT orders_remaining_range CHECK (remaining_quantity_wh BETWEEN 0 AND quantity_wh),
    CONSTRAINT orders_slot_aligned CHECK (EXTRACT(EPOCH FROM delivery_slot_start) % 1800 = 0),
    CONSTRAINT orders_slot_length CHECK (delivery_slot_end = delivery_slot_start + INTERVAL '30 minutes'),
    CONSTRAINT orders_expiry_within_slot CHECK (expires_at > delivery_slot_start AND expires_at <= delivery_slot_end),
    CONSTRAINT orders_status_quantity CHECK (
        (status IN ('PENDING', 'OPEN') AND remaining_quantity_wh = quantity_wh)
        OR (status = 'PARTIALLY_FILLED' AND remaining_quantity_wh BETWEEN 1 AND quantity_wh - 1)
        OR (status = 'FILLED' AND remaining_quantity_wh = 0)
        OR (status = 'REJECTED' AND remaining_quantity_wh = quantity_wh)
        OR status IN ('CANCEL_PENDING', 'CANCELLED', 'EXPIRED')
    ),
    CONSTRAINT orders_terminal_at CHECK (
        (status IN ('FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED') AND terminal_at IS NOT NULL)
        OR
        (status NOT IN ('FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED') AND terminal_at IS NULL)
    ),
    CONSTRAINT orders_market_never_rests CHECK (
        order_type = 'LIMIT' OR status NOT IN ('OPEN', 'PARTIALLY_FILLED')
    ),
    CONSTRAINT orders_status_reason_length CHECK (status_reason IS NULL OR length(status_reason) <= 64)
);

CREATE INDEX idx_orders_user_order_id
    ON order_management_data.orders (user_id, order_id DESC);
CREATE INDEX idx_orders_active_expiry
    ON order_management_data.orders (expires_at)
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
    source                TEXT NOT NULL CHECK (source IN ('USER', 'ME', 'SYSTEM')),
    event_id              UUID,
    me_seq                BIGINT,
    remaining_quantity_wh BIGINT NOT NULL CHECK (remaining_quantity_wh >= 0),
    reason                TEXT,
    engine_updated_at     TIMESTAMPTZ,
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
    aggregate_id    BIGINT NOT NULL,
    topic           TEXT   NOT NULL,
    record_key      TEXT   NOT NULL,
    message_type    TEXT   NOT NULL CHECK (message_type IN ('order.accepted', 'order.cancel_requested')),
    payload         BYTEA  NOT NULL,
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

CREATE TABLE order_management_data.processed_events (
    event_id     UUID PRIMARY KEY,
    source_topic TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_processed_events_processed_at
    ON order_management_data.processed_events (processed_at);

CREATE TABLE order_management_data.consumer_dead_letters (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    topic           TEXT    NOT NULL,
    kafka_partition INTEGER NOT NULL,
    kafka_offset    BIGINT  NOT NULL,
    record_key      TEXT,
    event_id        TEXT,
    stage           TEXT NOT NULL CHECK (stage IN (
        'DECODE', 'VALIDATE', 'APPLY', 'UNKNOWN_ORDER', 'STALE_TERMINAL')),
    error           TEXT NOT NULL,
    payload         BYTEA NOT NULL,
    status          order_management_data.dead_letter_status NOT NULL DEFAULT 'PENDING',
    attempts        INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ,
    CONSTRAINT dead_letters_unique_record UNIQUE (topic, kafka_partition, kafka_offset)
);
CREATE INDEX idx_dead_letters_pending
    ON order_management_data.consumer_dead_letters (created_at)
    WHERE status = 'PENDING';

CREATE TABLE order_management_data.energy_slot_capacity (
    meter_id            TEXT NOT NULL,
    delivery_slot_start TIMESTAMPTZ NOT NULL,
    capacity_wh         BIGINT NOT NULL CHECK (capacity_wh >= 0),
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
    CONSTRAINT energy_allocations_released_consistent CHECK (
        (released_at IS NULL AND released_wh = 0)
        OR (released_at IS NOT NULL AND released_wh > 0)
    )
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
DROP TYPE IF EXISTS order_management_data.dead_letter_status;
DROP TYPE IF EXISTS order_management_data.order_status;
DROP TYPE IF EXISTS order_management_data.order_type;
DROP TYPE IF EXISTS order_management_data.order_side;
```

Price tick, price band, and quantity limits are enforced in the service. The database keeps the invariants that do not change: positive price and quantity, a present grid id, 30-minute slots, and the status and quantity combinations. A MARKET order cannot be `OPEN` or `PARTIALLY_FILLED`.

Creation
--------

Validate, check permission, look up the idempotency key, and call IoT before the transaction. Do not hold the transaction open across those calls.

1. Insert the order with `ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING order_id`. Zero rows means roll back, then replay or return `IDEMPOTENCY_CONFLICT`.
2. For a SELL, run the conditional allocation in the IoT document and insert `energy_allocations`. Zero rows updated rolls back with `ENERGY_INSUFFICIENT`.
3. Insert history: `from_status` null, `to_status` `PENDING`, source `USER`.
4. Insert the outbox row: topic `order.accepted`, `record_key` the decimal order id, `message_type` `order.accepted`, payload the serialized `OrderAccepted`.
5. Commit.

Lock the order row before the capacity row on every path. Retry deadlock (`40P01`) and serialization (`40001`) up to three times, then `ENERGY_ALLOCATION_CONFLICT` for a SELL and `INTERNAL_ERROR` otherwise.

Outbox
------

The outbox contains `order.accepted` and `order.cancel_requested` only. `event_id` is generated when the row is inserted and reused on every republish.

A row can be claimed only when no earlier unpublished row exists for the same order, so placement stays ahead of cancel.

```sql
WITH picked AS (
    SELECT e.id
      FROM outbox_events e
     WHERE e.published_at IS NULL
       AND e.next_attempt_at <= NOW()
       AND (e.locked_until IS NULL OR e.locked_until < NOW())
       AND NOT EXISTS (
            SELECT 1 FROM outbox_events p
             WHERE p.aggregate_id = e.aggregate_id
               AND p.id < e.id
               AND p.published_at IS NULL)
     ORDER BY e.id
     LIMIT $batch
       FOR UPDATE OF e SKIP LOCKED
)
UPDATE outbox_events o
   SET locked_by = $worker,
       locked_until = NOW() + INTERVAL '30 seconds',
       attempts = attempts + 1
  FROM picked
 WHERE o.id = picked.id
RETURNING o.*;
```

After the broker acknowledges the record, set `published_at` and clear the lease. On failure, store `last_error` and set `next_attempt_at` with backoff from 1 s, doubling, capped at 60 s. Delivery is at-least-once. The engine deduplicates by order id and by cancel `event_id`. That behaviour is specified in the engine change document and is not implemented in the current process.

Applying an update
------------------

In one transaction: insert `processed_events` (`ON CONFLICT DO NOTHING`; zero rows means stop), lock the order, apply the status rules, then:

```sql
UPDATE orders
   SET status = $status,
       remaining_quantity_wh = $remaining,
       me_seq = $seq,
       status_reason = $reason,
       terminal_at = $terminal_at,
       version = version + 1,
       updated_at = NOW(),
       needs_reconciliation = $flag
 WHERE order_id = $id AND version = $expected;
```

Append history when status or remaining quantity changes. On a terminal status, release unused SELL energy:

```sql
UPDATE energy_allocations
   SET released_wh = $remaining, released_at = NOW()
 WHERE order_id = $id AND released_at IS NULL
RETURNING meter_id, delivery_slot_start, released_wh;

UPDATE energy_slot_capacity
   SET allocated_wh = allocated_wh - $released, updated_at = NOW()
 WHERE meter_id = $meter AND delivery_slot_start = $slot;
```

If the allocation update returns no row, it was already released.

The fingerprint is SHA-256 of `side`, `order_type`, `price`, `quantity_wh`, and `delivery_slot_start`. Event idempotency is `processed_events` plus `me_seq`. A stale `order_seq` does not overwrite a newer row. Terminal rows are not reopened.

`processed_events` rows older than 7 days may be deleted. `me_seq` still rejects a stale event after that. `order.state` retention must be shorter than 7 days so a pruned `event_id` cannot be redelivered as if it were new. The engine topics use 3 days for order topics. See the Kafka document.
