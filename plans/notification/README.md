---
connie-title: Notification Service Plan
---

# Notification Service - Plan

- **Author:** K. Keeththigan
- **Implementation language:** TypeScript (Node.js 24)
- **Status:** Draft for team review. Release-blocking decisions are listed below.
- **Scope:** Event-driven notifications to users through three channels: **in-app inbox**, **email**, and **mobile push** (Expo). Includes user preferences, templates, delivery tracking, and the public inbox API.
- **Out of scope (for now):** SMS, WhatsApp, marketing campaigns, admin broadcast UI, and auth OTP/password-reset emails (these stay in Auth Service until phase 7, see [12-implementation-plan.md](12-implementation-plan.md)).

## Purpose

Other services (Matching Engine, IoT Ingestion, Auth, and later Billing/Wallet) publish **domain events** to Kafka. They do not know about users' devices, email addresses, or preferences.

The Notification Service turns those events into user-facing messages:

1. **Listen** to domain events on Kafka.
2. **Decide** who should be told, what they should be told, and on which channel (based on the notification type and the user's preferences).
3. **Store** the notification in the user's inbox (PostgreSQL).
4. **Deliver** it through in-app real-time, email, and mobile push, with retries and delivery tracking.
5. **Serve** the inbox, unread count, preferences, and push-token APIs to the web and mobile apps through the API Gateway.

## System boundary

```text
Matching Engine ─┐                                   ┌──> Email provider (Mailtrap) ──> user inbox
IoT Ingestion  ──┼── Kafka (domain topics) ──>       │
Auth Service   ──┘                         Notification Service ──> Expo Push Service ──> FCM / APNs ──> phone
                                                     │
                                                     ├──> Kafka realtime.user-events.v1 ──> API Gateway WS ──> web/mobile
                                                     │
API Gateway ──── gRPC (inbox, preferences, tokens) ──┤
                                                     ├──> PostgreSQL (notification_data schema)
                                                     └──> Redis (rate limits, unread-count cache)
```

## Plan documents

| Document | Purpose |
|---|---|
| [01-requirements.md](01-requirements.md) | Functional and non-functional requirements |
| [02-architecture.md](02-architecture.md) | Components, processing pipeline, delivery semantics |
| [03-event-catalog.md](03-event-catalog.md) | Input events, notification types, and gaps in current events |
| [04-data-model.md](04-data-model.md) | PostgreSQL schema and Redis keys |
| [05-email-channel.md](05-email-channel.md) | Email delivery, templates, deliverability, bounces, unsubscribe |
| [06-in-app-channel.md](06-in-app-channel.md) | Inbox, unread count, real-time delivery over the gateway WebSocket |
| [07-mobile-push-channel.md](07-mobile-push-channel.md) | Expo push tokens, tickets, receipts, and mobile client setup |
| [08-preferences-and-templates.md](08-preferences-and-templates.md) | Preference center, default channel matrix, template system |
| [09-api-and-protobuf.md](09-api-and-protobuf.md) | gRPC contract and public REST routes |
| [10-reliability-security-observability.md](10-reliability-security-observability.md) | Retries, idempotency, rate limits, security, metrics, alerts |
| [11-folder-structure.md](11-folder-structure.md) | Repository layout |
| [12-implementation-plan.md](12-implementation-plan.md) | Phased delivery plan, testing, and acceptance criteria |

## Technology decisions

| Concern | Choice | Why |
|---|---|---|
| Runtime / language | Node.js 24 + TypeScript | Same as Auth Service and API Gateway, so the team can share code style, tooling and the SDK |
| HTTP framework | Fastify 5 | Health, readiness, metrics and provider webhooks. Same as other Node services |
| Internal RPC | gRPC via ConnectRPC (`@connectrpc/connect-node`) + generated `typescript-sdk` | Same contract approach as Auth Service |
| Event broker | Kafka via `@confluentinc/kafka-javascript` | Already used by the API Gateway. KafkaJS is no longer actively maintained |
| Database | PostgreSQL 16 (`notification_data` schema, `postgres` driver) | Schema and DB user already exist in `gridx-infra`. Durable inbox and delivery queue |
| Migrations | `goose` | Same as Auth Service |
| Cache / rate limiting | Redis 7 (`redis` client) | Already in infra. Used for per-user rate limits and unread counts. Never the source of truth |
| Delivery queue | PostgreSQL table + `FOR UPDATE SKIP LOCKED` workers | Creating a notification and its delivery jobs happens in one transaction, so there is no dual-write problem. See [02-architecture.md](02-architecture.md) |
| Email provider | Mailtrap (Sandbox in dev, Email Sending in prod) behind an `EmailProvider` interface | Already used by Auth Service. The interface lets us switch to Amazon SES / Postmark later without code changes in business logic |
| Email templates | React Email (`@react-email/components`, `@react-email/render`) | Type-safe TSX templates that render both HTML and plain text and handle email-client quirks |
| Mobile push | Expo Push Service via `expo-server-sdk` | Mobile app is Expo / React Native. One API for both FCM (Android) and APNs (iOS) |
| Real-time in-app | Kafka topic `realtime.user-events.v1` consumed by the API Gateway WebSocket (`user.self` topic) | Follows the existing gateway WebSocket plan. The notification service never holds client sockets |
| Validation | `zod` | Same as other services |
| Logging / metrics / tracing | Pino (Fastify logger), Prometheus (`@prometheus-io/client`), OpenTelemetry | Same as other services and the [Prometheus plan](../metrics/prometheus.md) |
| Testing | Vitest + Testcontainers (PostgreSQL, Redis, Kafka) | Same as Auth Service plus real integration tests for the pipeline |

## Release-blocking decisions

These must be settled with the owners of other services before implementation of the affected parts:

1. **User ID format.** Auth Service uses `UUID` user IDs. `TradeExecuted.buyer_id/seller_id` and `OrderAccepted.user_id` are `uint64`. The platform needs one user ID format in all events (recommended: UUID string). Owner: Matching Engine + Auth.
2. **`OrderUpdated` has no `user_id`.** Without it we cannot tell who owns the order. Recommended: add `user_id` to `OrderUpdated` (and `OrderCancelled` / `OrderExpired` if missing). Fallback: keep an `order_id -> user_id` projection from `order.accepted`. Owner: Matching Engine.
3. **No "meter offline" event.** IoT Ingestion computes online/offline on read. A `iot.device-status-changed` event (with `house_id` and owning `user_id`) is needed for meter alerts. Owner: IoT Ingestion.
4. **Money and energy units.** `execution_price`, `grid_fee_per_kwh` and `quantity` are `int64`. The unit (fils? Wh?) must be documented so templates display correct values.
5. **Production email domain.** A sending domain (e.g. `notify.<domain>`) with SPF, DKIM and DMARC must be set up before production email.

## Related documents

- [API Gateway - Websockets](../api_gateway/05-websockets.md)
- [Auth - Account management and recovery](../auth/12-account-management-and-recovery.md) (future Notification Service email adapter)
- [Services Overview](../../architecture/services-overview.md)
