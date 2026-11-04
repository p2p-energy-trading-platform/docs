---
connie-title: Notification Service - Data Model
---

# Data Model

All tables live in the existing `notification_data` schema, owned by `NOTIFICATION_SERVICE_USER` (created by `gridx-infra/init-scripts/postgres/01-init-schemas.sql`). Migrations are managed with `goose`.

The service does **not** copy user profile data (name, email). It stores only `user_id` and asks Auth Service at send time.

## 1. Tables

### 1.1 `notifications` (the inbox)

```sql
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL,
    type            TEXT        NOT NULL,
    category        TEXT        NOT NULL,
    title           TEXT        NOT NULL,
    body            TEXT        NOT NULL,
    data            JSONB       NOT NULL DEFAULT '{}',
    action_url      TEXT,
    group_key       TEXT,
    source_event_id TEXT        NOT NULL,
    dedupe_key      TEXT        NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at         TIMESTAMPTZ,
    archived_at     TIMESTAMPTZ,
    CONSTRAINT uq_notifications_dedupe UNIQUE (dedupe_key)
);

CREATE INDEX idx_notifications_inbox
    ON notifications (user_id, occurred_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE INDEX idx_notifications_unread
    ON notifications (user_id)
    WHERE read_at IS NULL AND archived_at IS NULL;

CREATE INDEX idx_notifications_created_at ON notifications (created_at);
```

Title and body are stored **rendered** so the inbox shows exactly what the user was told, even if templates change later.

### 1.2 `notification_deliveries` (one row per channel, also the job queue)

```sql
CREATE TYPE delivery_channel AS ENUM ('in_app', 'email', 'push');
CREATE TYPE delivery_status  AS ENUM ('pending', 'processing', 'retrying', 'sent', 'delivered', 'failed', 'skipped');

CREATE TABLE notification_deliveries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id     UUID             NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id             UUID             NOT NULL,
    channel             delivery_channel NOT NULL,
    status              delivery_status  NOT NULL DEFAULT 'pending',
    priority            SMALLINT         NOT NULL DEFAULT 0,
    attempts            INT              NOT NULL DEFAULT 0,
    next_attempt_at     TIMESTAMPTZ      NOT NULL DEFAULT now(),
    locked_until        TIMESTAMPTZ,
    provider_message_id TEXT,
    last_error_code     TEXT,
    last_error          TEXT,
    skip_reason         TEXT,
    sent_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ      NOT NULL DEFAULT now(),
    CONSTRAINT uq_delivery_per_channel UNIQUE (notification_id, channel)
);

CREATE INDEX idx_deliveries_queue
    ON notification_deliveries (channel, priority DESC, next_attempt_at)
    WHERE status IN ('pending', 'retrying');
```

### 1.3 `notification_preferences`

```sql
CREATE TABLE notification_preferences (
    user_id    UUID             NOT NULL,
    category   TEXT             NOT NULL,
    channel    delivery_channel NOT NULL,
    enabled    BOOLEAN          NOT NULL,
    updated_at TIMESTAMPTZ      NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, category, channel)
);

CREATE TABLE notification_settings (
    user_id          UUID PRIMARY KEY,
    locale           TEXT    NOT NULL DEFAULT 'en',
    time_zone        TEXT    NOT NULL DEFAULT 'Asia/Dubai',
    quiet_hours_from TIME,
    quiet_hours_to   TIME,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Only rows that **differ from the defaults** are stored. Missing row = use the default from code (see [08-preferences-and-templates.md](08-preferences-and-templates.md)). This means changing a default does not need a data migration.

### 1.4 `push_tokens`

```sql
CREATE TABLE push_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL,
    installation_id TEXT        NOT NULL,
    expo_token      TEXT        NOT NULL,
    platform        TEXT        NOT NULL CHECK (platform IN ('ios', 'android')),
    app_version     TEXT,
    device_name     TEXT,
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deactivated_at  TIMESTAMPTZ,
    CONSTRAINT uq_push_installation UNIQUE (installation_id),
    CONSTRAINT uq_push_token UNIQUE (expo_token)
);

CREATE INDEX idx_push_tokens_user ON push_tokens (user_id) WHERE is_active;
```

`installation_id` is unique, so when a different user signs in on the same phone, the row is **re-assigned** to the new user. The old user never receives the new user's notifications.

### 1.5 `push_receipts_pending`

```sql
CREATE TABLE push_receipts_pending (
    ticket_id     TEXT PRIMARY KEY,
    delivery_id   UUID NOT NULL REFERENCES notification_deliveries(id) ON DELETE CASCADE,
    push_token_id UUID NOT NULL REFERENCES push_tokens(id) ON DELETE CASCADE,
    check_after   TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 1.6 `email_suppressions`

```sql
CREATE TABLE email_suppressions (
    email_hash  TEXT PRIMARY KEY,
    reason      TEXT NOT NULL CHECK (reason IN ('hard_bounce', 'complaint', 'manual')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 2. Redis keys

Redis is a cache and rate limiter only. Everything can be rebuilt from PostgreSQL.

| Key | Type | TTL | Purpose |
|---|---|---|---|
| `notif:unread:{userId}` | STRING (int) | 24 h | Cached unread count. Updated with `INCR`/`DECR`, deleted on mark-all-read, rebuilt from DB on miss |
| `notif:rl:{userId}:{channel}:{window}` | STRING (counter) | window length | Fixed-window rate limit counter |
| `notif:prefs:{userId}` | HASH | 10 min | Cached effective preferences. Deleted when the user changes preferences |

## 3. Retention

| Data | Kept for | Job |
|---|---|---|
| `notifications` | 90 days | Daily job deletes in batches of 5,000 |
| `notification_deliveries` | Deleted with the notification (cascade) | - |
| `push_receipts_pending` | Until checked, max 24 h | Receipt checker |
| Inactive `push_tokens` | 30 days after deactivation | Daily job |
| `email_suppressions` | Permanent (until manual removal) | - |

When a user account is deleted (future `auth.account-events`), all rows for that `user_id` are deleted.
