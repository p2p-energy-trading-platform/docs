---
connie-title: Notification Service Implementation Plan
---

# Implementation Plan

Build in small phases. Each phase ends with something that runs end to end and is merged.

**MVP = phases 1 to 5** (in-app + email + push for trade and order events).

## Phase 0 - Contract fixes (other teams, can start now)

- [ ] Agree on one user ID format across events (UUID). Update Matching Engine events.
- [ ] Add `user_id` (and `original_quantity`) to `OrderUpdated`.
- [ ] Document units for price and quantity fields in proto comments.
- [ ] Add `gridx/notification/v1/notification.proto` and release the SDKs.

## Phase 1 - Service foundation

- [ ] Create `notification-service` repo from the `auth-service` layout.
- [ ] Config (zod), logger, metrics, health/readiness, graceful shutdown.
- [ ] PostgreSQL and Redis clients. Goose migrations for all tables in [04-data-model.md](04-data-model.md).
- [ ] Dockerfile, docker-compose, CI (lint, typecheck, test, build).
- [ ] Add to workspace `Taskfile.yml` and `docker-compose.root.yml`.

**Done when:** `task up` starts the service and `/health/ready` is green.

## Phase 2 - Consume events and create inbox items

- [ ] Kafka consumer with manual commits, DLQ, pause/resume.
- [ ] Handlers for `trade.executed` and `order.*`.
- [ ] Template registry with `trade.sold`, `trade.bought`, `order.placed`, `order.filled`, `order.partially_filled`, `order.cancelled`, `order.expired`.
- [ ] Default preferences. Create `notifications` + `notification_deliveries` in one transaction.

**Done when:** publishing a `TradeExecuted` creates exactly two inbox rows, and publishing it twice still creates two.

## Phase 3 - Inbox API and real-time

- [ ] gRPC: list, unread count, mark read, mark all read, archive.
- [ ] Gateway REST routes (gateway team).
- [ ] In-app delivery worker producing to `realtime.user-events.v1`.
- [ ] Gateway Kafka consumer → `user.self` WebSocket (gateway team).
- [ ] Web: bell, dropdown, notifications page.

**Done when:** a trade appears in the web bell within 2 seconds without a refresh, and survives a page reload.

## Phase 4 - Email channel

- [ ] `EmailProvider` + Mailtrap adapter. Auth `GetUser` client.
- [ ] React Email layout and templates. Plain-text versions.
- [ ] Email worker with retries, suppression check.
- [ ] Mailtrap webhook endpoint (bounces, complaints).
- [ ] Signed unsubscribe tokens and endpoint.

**Done when:** a device offline or trading email (with email enabled) arrives in the Mailtrap sandbox with HTML and text parts and a working unsubscribe link.

## Phase 5 - Mobile push channel

- [ ] Push token register/unregister RPCs and gateway routes.
- [ ] Expo provider (`expo-server-sdk`), chunking, ticket handling.
- [ ] Receipt checker job and token deactivation.
- [ ] Mobile: permission prompt, token registration, Android channels, deep-link handling, logout unregister.
- [ ] EAS credentials for FCM v1 and APNs.

**Done when:** a trade sends a push to a physical Android and iOS device, tapping it opens the trade screen, and uninstalling the app deactivates the token after the receipt check.

## Phase 6 - Preferences and protection

- [ ] Get/update preferences RPCs and settings screens (web and mobile).
- [ ] Redis rate limits, `group_key` collapsing, quiet hours.
- [ ] Alerts and Grafana dashboard.

## Phase 7 - More events

- [ ] `device.offline` / `device.online` (after IoT adds `DeviceStatusChanged`).
- [ ] `grid.fee_changed` broadcast with batched fan-out.
- [ ] `account.*` events (after Auth publishes account events).
- [ ] Optional: Auth Service email adapter that calls `SendNotification`, as planned in [Auth account management](../auth/12-account-management-and-recovery.md). OTP and password-reset emails keep the highest priority.

## Phase 8 - Later improvements

- Daily trading summary email.
- Price spike / low price alerts (from [functionalities](../../knowledge_pot/functionalities.md)).
- Arabic translations.
- Admin broadcast tool.

## Testing strategy

| Level | What | Tools |
|---|---|---|
| Unit | Handlers (event → intents), preference resolution, backoff, template rendering, formatters, unsubscribe tokens | Vitest |
| Integration | Consumer → DB transaction → offset commit. `SKIP LOCKED` with two workers never double-sends. Retry and reaper flows | Vitest + Testcontainers (Postgres, Redis, Kafka) |
| Contract | gRPC handlers match the SDK types. Realtime event matches gateway expectations | Generated SDK types |
| Provider | Mailtrap sandbox inbox. Expo provider with a mocked HTTP server for tickets/receipts and error codes | Mailtrap sandbox, `msw` / nock |
| End to end | Matching engine trade → web bell + email + device push | Docker compose + manual device check |

Key test cases:

- Same event twice → one notification.
- Crash after DB commit but before offset commit → no duplicate on restart.
- Email provider down → in-app and push still delivered, email retried and eventually sent.
- `DeviceNotRegistered` receipt → token deactivated, no further sends.
- User B logs in on user A's phone → user A's notifications no longer reach the phone.
- User cannot read or mark another user's notification.
- Preference off → channel skipped with `skip_reason = 'preference_off'`, inbox item still created.

## Definition of done (MVP)

- [ ] All MVP phases merged with tests passing in CI.
- [ ] p95 event → in-app real-time < 2 s and event → provider < 10 s in local load test (1,000 trades/minute).
- [ ] Metrics and alerts configured.
- [ ] README with setup, configuration and runbook (how to replay DLQ, how to retry failed deliveries).
