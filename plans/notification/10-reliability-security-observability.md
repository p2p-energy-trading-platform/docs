---
connie-title: Notification Service - Reliability, Security and Observability
---

# Reliability, Security and Observability

## 1. Kafka consumption

- Consumer group: `notification-service` (stable per environment, never shared).
- `enable.auto.commit = false`. Offsets are committed **after** the PostgreSQL transaction commits.
- Process records of one partition in order. Different partitions run in parallel.
- Undecodable or schema-invalid records go to `notification.dlq.v1` with headers `x-error`, `x-source-topic`, `x-source-partition`, `x-source-offset`.
- Transient errors (DB down) → pause the partition, retry with backoff, do **not** skip the record.
- On shutdown: stop fetching, finish in-flight records, commit, then disconnect.

## 2. Retries

Backoff for delivery jobs: `delay = min(base * 2^(attempt-1), max) + random jitter (0-20%)`

| Attempt | Approximate delay |
|---|---|
| 1 | immediate |
| 2 | 30 s |
| 3 | 2 min |
| 4 | 8 min |
| 5 | 20 min |
| 6 | 30 min (last) |

After the last attempt, `status = 'failed'`. Failed jobs can be re-queued by an operator script (`npm run deliveries:retry -- --since=1h --channel=email`).

Errors are classified by each channel adapter as `temporary` or `permanent`. Permanent errors never retry.

## 3. Idempotency summary

| Point | Mechanism |
|---|---|
| Same Kafka event twice | `notifications.dedupe_key` unique |
| Same channel twice for one notification | `notification_deliveries (notification_id, channel)` unique |
| `SendNotification` retried by caller | `idempotency_key` stored as `dedupe_key` |
| Provider webhook delivered twice | Store processed provider event IDs (Redis set, 7 days) |
| Real-time event delivered twice | Client ignores known `eventId` |

## 4. Rate limiting and flood protection

Per user, per channel (Redis fixed window):

| Channel | Limit | When exceeded |
|---|---|---|
| Push | 10 / minute, 60 / hour | Skip push (`rate_limited`). Item is still in the inbox |
| Email | 5 / 10 minutes, 30 / day | Collapse into a summary email |
| In-app real-time | 30 / minute | Send only an unread-count update instead of each item |

Security notifications bypass rate limits.

Also:

- `group_key` collapses repeated updates for the same entity (e.g. many partial fills).
- Device offline alerts: at most one per house per 6 hours.

## 5. Security

- **Authorization:** every user-facing RPC filters by `user_id` from the gateway's verified token. A user asking for another user's notification gets `NOT_FOUND` (not `PERMISSION_DENIED`, to avoid confirming that it exists).
- **Service-to-service:** gRPC is only reachable inside the private network. `SendNotification` requires a service identity and an allow-list per caller.
- **Database:** the service connects as `NOTIFICATION_SERVICE_USER`, which only has access to `notification_data`.
- **Secrets:** Mailtrap API key, Expo access token, unsubscribe HMAC secret and webhook secret come from environment/secret files, never committed. Config is validated at startup (fail fast), as in Auth Service.
- **Template injection:** React Email escapes values by default. Never use `dangerouslySetInnerHTML` with event data. In-app text is plain text, rendered as text by clients.
- **Links:** `action_url` must be a relative path or the `gridx://` scheme. Absolute external URLs are rejected (prevents phishing links in notifications).
- **PII in logs:** log `user_id`, `notification_id` and `delivery_id` only. Never log email addresses, push tokens, or message bodies. Email addresses in suppressions are stored hashed.
- **Webhooks:** signature verification, timestamp tolerance of 5 minutes, idempotent processing.
- **Unsubscribe tokens:** HMAC-signed, expiring, scoped to one user and category.

## 6. Observability

### Metrics (Prometheus)

| Metric | Type | Labels |
|---|---|---|
| `notification_events_consumed_total` | counter | `topic`, `result` (`ok`, `skipped`, `dlq`) |
| `notification_consumer_lag` | gauge | `topic`, `partition` |
| `notifications_created_total` | counter | `type`, `category` |
| `notification_deliveries_total` | counter | `channel`, `status`, `error_code` |
| `notification_delivery_latency_seconds` | histogram | `channel` (event `occurred_at` → provider accepted) |
| `notification_delivery_queue_depth` | gauge | `channel`, `status` |
| `notification_provider_request_seconds` | histogram | `provider`, `outcome` |
| `notification_push_tokens_active` | gauge | `platform` |
| `notification_push_receipts_total` | counter | `status`, `error` |
| `notification_email_bounces_total` | counter | `kind` (`hard`, `soft`, `complaint`) |

### Alerts

| Alert | Condition |
|---|---|
| Consumer lag high | lag > 1,000 for 5 min |
| Delivery failure rate | failed / total > 5% for 10 min per channel |
| Queue backlog | pending older than 5 min > 100 |
| Push credentials broken | any `InvalidCredentials` / `MismatchSenderId` receipt |
| Email complaint rate | > 0.08% over 24 h |
| DLQ not empty | any new record in `notification.dlq.v1` |

### Tracing and logs

- OpenTelemetry trace context is read from Kafka headers and carried into delivery jobs (`trace_parent` column), so one trace shows event → notification → provider call.
- Structured JSON logs (Pino) with `event_id`, `notification_id`, `delivery_id`, `user_id`, `channel`.

### Health

- `GET /health/live`: process is running.
- `GET /health/ready`: PostgreSQL reachable, Kafka consumer joined (consumer role), migrations at the expected version.
- `GET /metrics`: Prometheus scrape endpoint.
