---
connie-title: Notification Service - User Stories
---

# Notification Service - User Stories

- **Epic:** Notification Service
- **Repository:** `p2p-energy-trading-platform/notification-service` (to be created)
- **Language:** TypeScript (Node.js 24)
- **Plan:** [docs/plans/notification/README.md](../../plans/notification/README.md)
- **Status:** Draft. Nothing is implemented yet.

> This document breaks the Notification Service plan into user stories for Jira. Stories follow the phases in [12-implementation-plan.md](../../plans/notification/12-implementation-plan.md). Each story has a **Team** (which repository or team does the work), **Depends on** (stories that must be done first), **Maps to** (plan section and expected files), and acceptance criteria.
>
> The Notification Service is built by 1 or 2 people, so its stories are sized as **one demoable piece of work each (about 2 to 5 days)**. Work owned by other teams is kept in separate stories so each team has its own ticket.
>
> **MVP = Phases 0 to 5** (in-app, email and push for trade and order events). Phases 6 and 7 come after the MVP. Phase 8 is the backlog.

**Teams used in this document:**

| Team | Repository |
|---|---|
| Notification | `notification-service` (new) |
| Protobuf | `protobuf`, `typescript-sdk`, `go-sdk`, `cpp-sdk` |
| Matching Engine | `matching-engine` |
| Gateway | `api-gateway` |
| Web | `frontend-web` |
| Mobile | `frontend-mobile` |
| IoT | `iot-ingestion-dispatch` |
| Auth | `auth-service` |
| Infra | `gridx-infra`, `gridx-workspace` |

---

## Phase 0 - Contract Fixes (other teams)

These stories unblock the Notification Service. They can start now.

### US-0.1 - Fix user IDs and units in trade and order events

> **As** the Notification Service,  
> **I want** trade and order events to use the same user ID as Auth Service (UUID) and to document their units,  
> **so that** I can find the right user and show correct values in notifications.

**Team:** Protobuf, Matching Engine  
**Depends on:** -  
**Maps to:** [03-event-catalog.md §3.1, §3.4](../../plans/notification/03-event-catalog.md), `proto/gridx/trade/v1/trade_events.proto`, `proto/gridx/order/v1/*.proto`

**Acceptance Criteria:**

- `TradeExecuted` has `buyer_user_id` and `seller_user_id` (string, UUID). `OrderAccepted` has a UUID `user_id`.
- Old `uint64` fields are marked deprecated. Their field numbers are not reused.
- `execution_price`, `grid_fee_per_kwh` and `quantity` have comments stating the unit (for example "fils per kWh", "Wh").
- The matching engine fills the new fields in every published event.
- New SDK versions are released.

**Status:** Not started. **Release-blocking.**

---

### US-0.2 - Add order owner and expiry to order update events

> **As** the Notification Service,  
> **I want** every order update, cancel and expiry event to include the owner's user ID and the original quantity,  
> **so that** I know who to notify and can show "40% filled" without a lookup.

**Team:** Protobuf, Matching Engine  
**Depends on:** US-0.1  
**Maps to:** [03-event-catalog.md §3.2](../../plans/notification/03-event-catalog.md), `proto/gridx/order/v1/order_update_events.proto`

**Acceptance Criteria:**

- `OrderUpdated` has `string user_id = 7` and `int64 original_quantity = 8`.
- Cancelled and expired order events also carry `user_id`.
- The team agrees on one topic name for order state (`order.updated` or `order.state`) and documents it.
- The matching engine publishes `EXPIRED` order updates when orders expire (today `ExpiryManager` is not called).

**Status:** Not started. **Release-blocking.**

---

### US-0.3 - Define the Notification Service Protobuf contract

> **As** the API Gateway and other services,  
> **I want** a `gridx.notification.v1` package with the service RPCs and the real-time event message,  
> **so that** we can call the Notification Service with generated, typed clients.

**Team:** Protobuf  
**Depends on:** -  
**Maps to:** [09-api-and-protobuf.md §1](../../plans/notification/09-api-and-protobuf.md), `proto/gridx/notification/v1/notification.proto`

**Acceptance Criteria:**

- The proto contains the RPCs in the plan: inbox, preferences, unsubscribe and push tokens. `SendNotification` can be added later (see backlog).
- `RealtimeUserEvent` is defined.
- `buf lint` and `buf breaking` pass.
- New versions of `typescript-sdk`, `go-sdk` and `cpp-sdk` are released.

**Status:** Not started.

---

## Phase 1 - Service Foundation

### US-1.1 - Service skeleton

> **As** a developer,  
> **I want** a `notification-service` repository with the same layout, tooling, config, logging and shutdown handling as `auth-service`,  
> **so that** I can start building features on a working base.

**Team:** Notification  
**Depends on:** -  
**Maps to:** [11-folder-structure.md](../../plans/notification/11-folder-structure.md), [10-reliability-security-observability.md §6](../../plans/notification/10-reliability-security-observability.md), `src/config/`, `src/observability/`

**Acceptance Criteria:**

- Repository created in the `p2p-energy-trading-platform` organisation with the folder layout from the plan.
- TypeScript, ESLint, Prettier and Vitest are set up like `auth-service`. CI runs lint, typecheck, test and build on every pull request.
- Config is validated with zod at startup. Missing or invalid variables stop the process with a message naming the variable. `npm run check-config` works.
- `SERVICE_ROLES` (`api`, `consumer`, `worker`) controls which parts start. The default is all three.
- `.env.example` lists every variable.
- Pino JSON logs with a configurable level. Email addresses, push tokens, message bodies and secrets are never logged.
- Prometheus registry and OpenTelemetry tracer are set up.
- On `SIGTERM` the service stops taking new work, finishes in-flight work, then exits.

**Status:** Not started.

---

### US-1.2 - Database schema and connections

> **As** the service,  
> **I want** PostgreSQL and Redis clients and goose migrations for all tables,  
> **so that** features can store notifications, deliveries, preferences and tokens.

**Team:** Notification  
**Depends on:** US-1.1  
**Maps to:** [04-data-model.md](../../plans/notification/04-data-model.md), `src/infrastructure/database/`, `src/infrastructure/redis/`

**Acceptance Criteria:**

- The service connects to PostgreSQL as `NOTIFICATION_SERVICE_USER` and only uses the `notification_data` schema.
- Migrations create `notifications`, `notification_deliveries`, `notification_preferences`, `notification_settings`, `push_tokens`, `push_receipts_pending` and `email_suppressions`, with the indexes and unique constraints from the plan.
- Every migration has a rollback. `db:up`, `db:down` and `db:status` work locally.

**Status:** Not started.

---

### US-1.3 - Health endpoints and workspace integration

> **As** a developer and operator,  
> **I want** health and metrics endpoints and the service started with the rest of the platform by `task up`,  
> **so that** I can run and check it locally with Kafka, PostgreSQL and Redis.

**Team:** Notification, Infra  
**Depends on:** US-1.2  
**Maps to:** [10-reliability-security-observability.md §6](../../plans/notification/10-reliability-security-observability.md), [11-folder-structure.md - Workspace changes](../../plans/notification/11-folder-structure.md)

**Acceptance Criteria:**

- `GET /health/live` returns 200 while the process runs.
- `GET /health/ready` returns 200 only when PostgreSQL is reachable, migrations are at the expected version, and (for the consumer role) the Kafka consumer has joined its group.
- `GET /metrics` returns Prometheus metrics.
- `Dockerfile` and `docker-compose.yml` exist, with a container health check on `/health/live`.
- `notification-service` is added to `REPOS` in `gridx-workspace/Taskfile.yml`, included in `docker-compose.root.yml`, and added to `.analysis-maturity` as `skeleton`.
- `task up` starts the service and `/health/ready` is green.

**Status:** Not started.

---

## Phase 2 - Consume Events and Create Inbox Items

### US-2.1 - Reliable Kafka consumer with dead-letter topic

> **As** the service,  
> **I want** a Kafka consumer that commits offsets only after my database write succeeds, and sends broken records to a dead-letter topic,  
> **so that** no event is lost and one bad record does not block all notifications.

**Team:** Notification  
**Depends on:** US-1.2  
**Maps to:** [10-reliability-security-observability.md §1](../../plans/notification/10-reliability-security-observability.md), `src/consumer/kafka-consumer.ts`, `src/consumer/dlq.ts`

**Acceptance Criteria:**

- Consumer group `notification-service` with auto-commit turned off.
- Records in one partition are processed in order. Partitions run in parallel.
- If PostgreSQL is down, the partition pauses and retries. The record is not skipped.
- Undecodable or invalid records go to `notification.dlq.v1` with headers `x-error`, `x-source-topic`, `x-source-partition` and `x-source-offset`, and the consumer continues.
- Unknown event types are counted in a metric and skipped.
- Shutdown finishes in-flight records and commits before disconnecting.
- Integration test: a crash after the DB commit but before the offset commit creates no duplicate on restart.

**Status:** Not started.

---

### US-2.2 - Notification templates and default preferences

> **As** a developer,  
> **I want** one definition per notification type with its category, data schema, text for each channel, and default channels,  
> **so that** every channel shows the same, correctly formatted content and users get sensible defaults.

**Team:** Notification  
**Depends on:** US-0.1, US-1.1  
**Maps to:** [08-preferences-and-templates.md](../../plans/notification/08-preferences-and-templates.md), `src/templates/registry.ts`, `src/templates/format.ts`, `src/features/preferences/defaults.ts`

**Acceptance Criteria:**

- Types defined: `trade.sold`, `trade.bought`, `order.placed`, `order.partially_filled`, `order.filled`, `order.cancelled`, `order.expired`.
- Each type has a zod schema, a category, a priority, in-app text and push text.
- The formatter uses `Intl` with the user's locale and time zone (default `en`, `Asia/Dubai`) for energy, price and dates.
- `action_url` only accepts relative paths or `gridx://` links.
- The default channel matrix and the effective preference rule from the plan are in code. `order.placed` is in-app only. `order.partially_filled` never sends email.
- Unit tests render every type for every channel and cover every preference default and exception.

**Status:** Not started.

---

### US-2.3 - Trade and order notifications in the inbox

> **As** a buyer, seller or order owner,  
> **I want** a notification when my trade executes or my order changes,  
> **so that** I can follow my trading without checking the app.

**Team:** Notification  
**Depends on:** US-0.2, US-2.1, US-2.2  
**Maps to:** [02-architecture.md §2, §4](../../plans/notification/02-architecture.md), [03-event-catalog.md §2, §4](../../plans/notification/03-event-catalog.md), `src/consumer/handlers/`, `src/features/notifications/`

**Acceptance Criteria:**

- One `TradeExecuted` creates `trade.sold` for the seller and `trade.bought` for the buyer. If they are the same user, both are created.
- `OrderAccepted` creates `order.placed`. `OrderUpdated` creates the type matching its status. Partial fills show the filled percentage.
- The notification and one `pending` delivery row per enabled channel are written in one transaction. `dedupe_key = <type>:<event_id>:<user_id>` with `ON CONFLICT DO NOTHING`.
- Disabled channels are recorded as `skipped` with `skip_reason = 'preference_off'`. The inbox item is still created (stored as read if in-app is off).
- `group_key = order:<order_id>`. A late update after a final state is stored, but its push and email are skipped.
- After commit, `NOTIFY notification_deliveries` wakes the workers.
- Publishing a `TradeExecuted` twice still creates exactly two inbox rows.

**Status:** Not started.

---

### US-2.4 - Delivery queue and worker framework

> **As** the service,  
> **I want** channel workers that safely claim jobs from the delivery table and retry failures,  
> **so that** each channel is delivered independently and a slow provider never blocks the others.

**Team:** Notification  
**Depends on:** US-2.3  
**Maps to:** [02-architecture.md §2](../../plans/notification/02-architecture.md), [10-reliability-security-observability.md §2](../../plans/notification/10-reliability-security-observability.md), `src/delivery/`, `src/jobs/stuck-jobs-reaper.ts`

**Acceptance Criteria:**

- Workers claim jobs with `FOR UPDATE SKIP LOCKED`, per channel, ordered by priority.
- Workers wake on `LISTEN/NOTIFY` and also poll every 1 second.
- Temporary errors are retried with exponential backoff and jitter, up to 6 attempts, then marked `failed`. Permanent errors are marked `failed` immediately.
- A reaper re-queues jobs stuck in `processing` after `locked_until`.
- Integration test: two workers running at the same time never send the same job twice.

**Status:** Not started.

---

## Phase 3 - Inbox API and Real-Time

### US-3.1 - Inbox gRPC API

> **As** a user,  
> **I want** to list my notifications, see my unread count, mark them read and archive them,  
> **so that** I can review and manage what happened on my account.

**Team:** Notification  
**Depends on:** US-0.3, US-2.3  
**Maps to:** [06-in-app-channel.md §1](../../plans/notification/06-in-app-channel.md), `ListNotifications`, `GetUnreadCount`, `MarkAsRead`, `MarkAllAsRead`, `ArchiveNotification` RPCs

**Acceptance Criteria:**

- List: newest first by `occurred_at`, cursor pagination (default 20, max 50), filters for unread and category. Archived items are hidden.
- Unread count is read from Redis and rebuilt from PostgreSQL on a miss or if Redis is down.
- Mark as read accepts up to 100 IDs and is idempotent. Mark all as read only marks items up to `upTo`. Each change returns the new unread count.
- Archive hides the item. It is not hard-deleted.
- `user_id` always comes from the gateway's verified token. Asking for another user's notification returns `NOT_FOUND`.

**Status:** Not started.

---

### US-3.2 - Real-time in-app delivery

> **As** the service,  
> **I want** the in-app worker to publish notification changes to `realtime.user-events.v1`,  
> **so that** the gateway can show them to connected users immediately.

**Team:** Notification  
**Depends on:** US-0.3, US-2.4  
**Maps to:** [06-in-app-channel.md §2](../../plans/notification/06-in-app-channel.md), `src/delivery/channels/in-app.ts`

**Acceptance Criteria:**

- `notification.created` events are produced with key = `userId` and include the current unread count.
- `notification.read` and `notification.all_read` are published when items are read, so other devices stay in sync.
- Events follow the `RealtimeUserEvent` schema and have a unique `eventId`.

**Status:** Not started.

---

### US-3.3 - Gateway inbox routes and real-time forwarding

> **As** the web and mobile apps,  
> **I want** REST routes for the inbox and live notification events on the `user.self` WebSocket topic,  
> **so that** I can show notifications and update them without a refresh.

**Team:** Gateway  
**Depends on:** US-3.1, US-3.2  
**Maps to:** [09-api-and-protobuf.md §2](../../plans/notification/09-api-and-protobuf.md), [06-in-app-channel.md §2](../../plans/notification/06-in-app-channel.md), `api-gateway/src/websocket/`

**Acceptance Criteria:**

- Routes: `GET /api/v1/notifications`, `GET /api/v1/notifications/unread-count`, `POST /api/v1/notifications/read`, `POST /api/v1/notifications/read-all`, `DELETE /api/v1/notifications/{id}`.
- All routes require login. `user_id` is taken from the access token, never from the request.
- The gateway consumes `realtime.user-events.v1` and publishes each event to `user:<userId>`, delivered on `user.self` as JSON.
- Users only receive their own events.

**Status:** Not started.

---

### US-3.4 - Web notification bell and page

> **As** a web user,  
> **I want** a bell with an unread badge, a dropdown and a full notifications page,  
> **so that** I can see and manage my notifications.

**Team:** Web  
**Depends on:** US-3.3  
**Maps to:** [06-in-app-channel.md §2-3](../../plans/notification/06-in-app-channel.md)

**Acceptance Criteria:**

- The bell shows the unread count ("99+" above 99). The dropdown shows the latest 5 with a "See all" link.
- The full page has pagination, unread filter, mark all read and archive.
- Clicking an item marks it read and opens `actionUrl`.
- On load and on WebSocket reconnect, the app re-fetches the list and unread count, then applies live events. Duplicate `eventId`s are ignored.
- A toast shows for new items while the app is open (not for `order.placed`).
- A new trade appears in the bell within 2 seconds without refresh and is still there after reload.

**Status:** Not started.

---

### US-3.5 - Mobile in-app notifications screen

> **As** a mobile user,  
> **I want** a notifications screen and unread badge in the app,  
> **so that** I can see my history even if I missed a push.

**Team:** Mobile  
**Depends on:** US-3.3  
**Maps to:** [06-in-app-channel.md §2-3](../../plans/notification/06-in-app-channel.md)

**Acceptance Criteria:**

- Notifications list with pagination, unread badge, mark read, mark all read and archive.
- The app follows the same resync rules as web (fetch on start and reconnect, ignore duplicate events).
- Tapping an item opens the matching screen.

**Status:** Not started.

---

## Phase 4 - Email Channel

### US-4.1 - Email templates

> **As** a user,  
> **I want** clear, branded emails that look right in any mail app,  
> **so that** I can trust and understand what GridX sends me.

**Team:** Notification  
**Depends on:** US-2.2  
**Maps to:** [05-email-channel.md §3](../../plans/notification/05-email-channel.md), `src/templates/email/`

**Acceptance Criteria:**

- React Email layout with logo, footer, address and a "Manage notifications" link.
- An email template for every MVP type, each with an HTML and a plain-text part.
- `npm run email:preview` starts the preview server for design review.
- Snapshot tests render every template with sample data.
- No tracking pixels. Event data is never inserted as raw HTML.

**Status:** Not started.

---

### US-4.2 - Email delivery

> **As** a user who turned on email for a category,  
> **I want** to receive those notifications by email at my current address,  
> **so that** I have a record outside the app.

**Team:** Notification  
**Depends on:** US-2.4, US-4.1  
**Maps to:** [05-email-channel.md §1-2](../../plans/notification/05-email-channel.md), `src/infrastructure/email/`, `src/infrastructure/auth-client/`, `src/delivery/channels/email.ts`

**Acceptance Criteria:**

- Email is sent through an `EmailProvider` interface with a Mailtrap adapter (Sandbox locally and in CI).
- Provider errors are classified as temporary (timeouts, 429, 5xx) or permanent (invalid address, validation errors).
- The worker gets the user's current email, name, status and locale from the existing `AuthService.GetUser` RPC. Disabled users and (for non-security types) unverified addresses are skipped.
- Addresses in `email_suppressions` are skipped.
- Adds `List-Unsubscribe` and `List-Unsubscribe-Post` headers for non-mandatory categories, and `X-GridX-Delivery-Id` on every email.
- On success, stores `provider_message_id` and sets status `sent`.
- If Mailtrap or Auth Service is down, in-app and push are still delivered and the email is retried until sent.
- An email arrives in the Mailtrap sandbox with HTML and text parts.

**Status:** Not started.

---

### US-4.3 - One-click unsubscribe

> **As** a user,  
> **I want** to unsubscribe from a type of email with one click and no login,  
> **so that** I can easily stop emails I don't want.

**Team:** Notification, Gateway, Web  
**Depends on:** US-4.2  
**Maps to:** [05-email-channel.md §6](../../plans/notification/05-email-channel.md), `src/features/unsubscribe/`, `UnsubscribeByToken` RPC

**Acceptance Criteria:**

- The unsubscribe link has an HMAC-signed token for one user and one category, valid for 60 days, with a key ID for secret rotation.
- Notification: `UnsubscribeByToken` turns off email for that category.
- Gateway: public `GET` / `POST /api/v1/notifications/unsubscribe?token=` route, rate limited by IP.
- Web: confirmation page for the `GET` link. `POST` (one-click from the mail app) works without the page.
- Security emails cannot be unsubscribed. Invalid or expired tokens show a clear error.

**Status:** Not started.

---

## Phase 5 - Mobile Push Channel

### US-5.1 - Register and unregister push tokens

> **As** a mobile user,  
> **I want** my phone registered for push notifications when I log in, and removed when I log out,  
> **so that** notifications reach my phone and no one else's.

**Team:** Notification, Gateway  
**Depends on:** US-0.3, US-1.2  
**Maps to:** [07-mobile-push-channel.md §2](../../plans/notification/07-mobile-push-channel.md), [04-data-model.md §1.4](../../plans/notification/04-data-model.md), `src/features/devices/`

**Acceptance Criteria:**

- Notification: `RegisterPushToken` upserts by `installation_id` and updates `last_seen_at`. `UnregisterPushToken` deactivates it.
- If another user logs in on the same phone, the token moves to the new user. The old user no longer gets pushes on that phone.
- Gateway: `POST /api/v1/devices/push-tokens` and `DELETE /api/v1/devices/push-tokens/{installationId}`, both requiring login.

**Status:** Not started.

---

### US-5.2 - Push delivery and receipt checking

> **As** a mobile user,  
> **I want** a push notification when something important happens, even when the app is closed,  
> **so that** I don't miss trades or alerts.

**Team:** Notification  
**Depends on:** US-2.4, US-5.1  
**Maps to:** [07-mobile-push-channel.md §3-6](../../plans/notification/07-mobile-push-channel.md), `src/delivery/channels/push.ts`, `src/infrastructure/push/`, `src/jobs/push-receipts.ts`

**Acceptance Criteria:**

- Uses `expo-server-sdk` with an Expo access token. Sends in chunks of max 100 messages.
- One message per active token, with title, body, `data.url` deep link, `channelId`, `ttl`, `priority` and `collapseId` as in the plan.
- No token: status `skipped` with `skip_reason = 'no_push_token'`.
- A delivery is `sent` if at least one device ticket is `ok`. 429 and 5xx are retried. A shared Redis limiter keeps sending below 600 messages per second.
- A receipt job runs every 5 minutes for tickets older than 15 minutes. `DeviceNotRegistered` deactivates the token. `InvalidCredentials` / `MismatchSenderId` mark the delivery failed and log an error.
- Push text has no sensitive data (no balances, names, addresses or codes).

**Status:** Not started.

---

### US-5.3 - Mobile push integration

> **As** a mobile user,  
> **I want** the app to ask for notification permission at a sensible moment, and tapping a push to open the right screen,  
> **so that** push notifications are useful and not annoying.

**Team:** Mobile  
**Depends on:** US-5.1  
**Maps to:** [07-mobile-push-channel.md §1-2](../../plans/notification/07-mobile-push-channel.md)

**Acceptance Criteria:**

- FCM v1 and APNs credentials are uploaded with `eas credentials`. An Expo access token with enhanced push security is created and given to the Notification Service.
- `expo-notifications` and `expo-device` are installed and configured in `app.json`.
- Permission is asked in context (for example after the first order), not on first launch.
- A random `installationId` is kept in secure storage. The token is registered on every app start and when it changes, and unregistered on logout before the session is cleared.
- Android channels `trading`, `device_alerts`, `security` and `market_alerts` are created with the importance levels from the plan.
- Tapping a notification opens `data.url` (for example `gridx://trades/88123`) through Expo Router. In the foreground, an in-app toast is shown instead.
- A trade push on a physical Android and iOS device opens the trade screen when tapped.

**Status:** Not started.

---

## Testing and Release

### US-9.1 - MVP end-to-end and load test

> **As** the team,  
> **I want** an end-to-end check and a load test of the whole pipeline,  
> **so that** we can sign off the MVP.

**Team:** Notification  
**Depends on:** All MVP stories (Phases 0 to 5)  
**Maps to:** [12-implementation-plan.md - Testing strategy, Definition of done](../../plans/notification/12-implementation-plan.md)

**Acceptance Criteria:**

- Testcontainers runs PostgreSQL, Redis and Kafka in CI for the integration tests written in earlier stories.
- Covered: provider down still delivers other channels. Preference off skips the channel but keeps the inbox item. A user cannot read another user's notification.
- A matching engine trade reaches the web bell, the email sandbox and a physical phone.
- Load test at 1,000 trades per minute: p95 event to in-app real-time under 2 s, p95 event to provider under 10 s.
- README has setup, configuration and a runbook (replaying the DLQ, retrying failed deliveries).

**Status:** Not started.

---

## Phase 6 - Preferences and Protection (after MVP)

### US-6.1 - Preferences API

> **As** a user,  
> **I want** to choose which categories I get on in-app, push and email,  
> **so that** I only get the notifications I care about.

**Team:** Notification, Gateway  
**Depends on:** US-0.3, US-2.2  
**Maps to:** [08-preferences-and-templates.md](../../plans/notification/08-preferences-and-templates.md), `GetPreferences` / `UpdatePreferences` RPCs

**Acceptance Criteria:**

- `GetPreferences` returns every category and channel with `enabled` and `locked`, plus locale, time zone and quiet hours.
- `UpdatePreferences` stores only values that differ from defaults. Changes to locked (security) categories are ignored.
- The Redis preference cache is cleared on update.
- Gateway: `GET` and `PUT /api/v1/notifications/preferences`.

**Status:** Not started.

---

### US-6.2 - Web notification settings screen

> **As** a web user,  
> **I want** a settings screen with a grid of categories and channels,  
> **so that** I can change my preferences easily.

**Team:** Web  
**Depends on:** US-6.1  
**Maps to:** [08-preferences-and-templates.md §4](../../plans/notification/08-preferences-and-templates.md)

**Acceptance Criteria:**

- Shows the category × channel grid. Security is shown as always on and cannot be changed.
- Quiet hours and time zone can be edited.
- Changes save and show a success or error message.

**Status:** Not started.

---

### US-6.3 - Mobile notification settings screen

> **As** a mobile user,  
> **I want** the same settings in the app, and to know if phone notifications are blocked,  
> **so that** I can fix it.

**Team:** Mobile  
**Depends on:** US-6.1  
**Maps to:** [08-preferences-and-templates.md §4](../../plans/notification/08-preferences-and-templates.md)

**Acceptance Criteria:**

- Same grid and options as web.
- If OS permission is denied, the Push column says so and links to phone settings.

**Status:** Not started.

---

### US-6.4 - Rate limits and quiet hours

> **As** a user,  
> **I want** to be protected from a flood of notifications and to set quiet hours for push,  
> **so that** busy trading does not spam me and my phone does not buzz at night.

**Team:** Notification  
**Depends on:** US-4.2, US-5.2, US-6.1  
**Maps to:** [10-reliability-security-observability.md §4](../../plans/notification/10-reliability-security-observability.md), [05-email-channel.md §7](../../plans/notification/05-email-channel.md), [07-mobile-push-channel.md §3](../../plans/notification/07-mobile-push-channel.md), `src/delivery/rate-limit.ts`

**Acceptance Criteria:**

- Per user, per channel limits in Redis: push 10/min and 60/hour, email 5 per 10 min and 30/day, real-time 30/min.
- Over the push limit: push skipped with `rate_limited`, inbox item still created. Over the email limit: emails are combined into one summary email. Over the real-time limit: only an unread-count update is sent.
- Non-security pushes during quiet hours are delayed until they end (user's time zone), or skipped if the TTL would expire first.
- Security notifications are never rate limited or delayed.
- If Redis is down, sending is allowed and a warning is logged.

**Status:** Not started.

---

### US-6.5 - Metrics, alerts and dashboard

> **As** an operator,  
> **I want** metrics, alerts and a Grafana dashboard for the service,  
> **so that** I know when notifications are failing and why.

**Team:** Notification, Infra  
**Depends on:** US-1.3  
**Maps to:** [10-reliability-security-observability.md §6](../../plans/notification/10-reliability-security-observability.md), [Prometheus plan](../../plans/metrics/prometheus.md)

**Acceptance Criteria:**

- All metrics in the plan are exported.
- Alerts: consumer lag, delivery failure rate, queue backlog, push credential errors, new DLQ records.
- Grafana dashboard shows events, deliveries per channel, latency and queue depth.
- Trace context is carried from the Kafka event to the provider call.

**Status:** Not started.

---

## Phase 7 - More Events (after MVP)

### US-7.1 - Publish device status change events

> **As** the Notification Service,  
> **I want** IoT Ingestion to publish an event when a smart meter goes offline or comes back online,  
> **so that** I can alert the owner once, not on every heartbeat.

**Team:** Protobuf, IoT  
**Depends on:** US-0.1  
**Maps to:** [03-event-catalog.md §3.3](../../plans/notification/03-event-catalog.md)

**Acceptance Criteria:**

- `gridx.iot.v1.DeviceStatusChanged` is added with `event_id`, `house_id`, `user_id`, `status`, `last_heartbeat_at` and `changed_at`.
- Published to `iot.device-status-changed` only when status changes.
- `OFFLINE` is only sent after a configurable threshold (for example 10 minutes).

**Status:** Not started.

---

### US-7.2 - Smart meter offline and online alerts

> **As** a house owner,  
> **I want** to be told when my smart meter goes offline and when it is back,  
> **so that** I can fix it before it affects my trading.

**Team:** Notification  
**Depends on:** US-7.1, US-2.3  
**Maps to:** `src/consumer/handlers/device-status.ts`

**Acceptance Criteria:**

- `device.offline` and `device.online` types are added in the `device_alerts` category.
- At most one offline alert per house every 6 hours.
- In-app, push and email are on by default.

**Status:** Not started.

---

### US-7.3 - Publish account events

> **As** the Notification Service,  
> **I want** Auth Service to publish account events (KYC result, new login, password changed, account deleted),  
> **so that** users are told about important changes to their account.

**Team:** Protobuf, Auth  
**Depends on:** -  
**Maps to:** [03-event-catalog.md §1](../../plans/notification/03-event-catalog.md)

**Acceptance Criteria:**

- `gridx.auth.v1.AccountEvent` is defined and published to `auth.account-events`.
- Covers KYC approved/rejected, new login, password changed and account deleted.

**Status:** Not started.

---

### US-7.4 - Account and security notifications

> **As** a user,  
> **I want** to always be told about security events on my account,  
> **so that** I can react quickly if someone else is using it.

**Team:** Notification  
**Depends on:** US-7.3, US-4.2, US-5.2  
**Maps to:** [03-event-catalog.md §2](../../plans/notification/03-event-catalog.md), [08-preferences-and-templates.md §1](../../plans/notification/08-preferences-and-templates.md)

**Acceptance Criteria:**

- `account.kyc_approved`, `account.kyc_rejected`, `account.new_login` and `account.password_changed` are added in the `security` category.
- Security notifications are sent on all channels and cannot be turned off.
- When an account is deleted, all of that user's notification data is deleted.

**Status:** Not started.

---

## Phase 8 - Later Improvements (backlog)

These are not needed for the project demo. Create them as backlog items, not sprint stories.

| ID | Item | Notes |
|---|---|---|
| US-8.1 | Email bounces and spam complaints | Mailtrap webhook, `email_suppressions`. See [05-email-channel.md §5](../../plans/notification/05-email-channel.md) |
| US-8.2 | Production email domain (SPF, DKIM, DMARC) | Infra. Only needed to email real users outside the Mailtrap sandbox |
| US-8.3 | Data retention jobs and delivery retry script | 90-day inbox cleanup, `deliveries:retry`. See [04-data-model.md §3](../../plans/notification/04-data-model.md) |
| US-8.4 | Grid fee change broadcast | Topic and owner for `GridTransferRule` changes not confirmed yet |
| US-8.5 | Internal `SendNotification` API and Auth email adapter | See [09-api-and-protobuf.md §3](../../plans/notification/09-api-and-protobuf.md) |
| US-8.6 | Daily trading summary email | One email per day instead of one per trade |
| US-8.7 | Price spike / low price alerts | From [functionalities](../../knowledge_pot/functionalities.md) |
| US-8.8 | Arabic translations | Templates already keep strings separate |
| US-8.9 | Admin broadcast tool | Send announcements to all or some users |

---

## Summary Table

| ID | Story | Team | Phase | MVP | Depends on |
|---|---|---|---|---|---|
| US-0.1 | Fix user IDs and units in trade and order events | Protobuf, Matching Engine | 0 | Yes | - |
| US-0.2 | Add order owner and expiry to order update events | Protobuf, Matching Engine | 0 | Yes | US-0.1 |
| US-0.3 | Define the Notification Service Protobuf contract | Protobuf | 0 | Yes | - |
| US-1.1 | Service skeleton | Notification | 1 | Yes | - |
| US-1.2 | Database schema and connections | Notification | 1 | Yes | US-1.1 |
| US-1.3 | Health endpoints and workspace integration | Notification, Infra | 1 | Yes | US-1.2 |
| US-2.1 | Reliable Kafka consumer with dead-letter topic | Notification | 2 | Yes | US-1.2 |
| US-2.2 | Notification templates and default preferences | Notification | 2 | Yes | US-0.1, US-1.1 |
| US-2.3 | Trade and order notifications in the inbox | Notification | 2 | Yes | US-0.2, US-2.1, US-2.2 |
| US-2.4 | Delivery queue and worker framework | Notification | 2 | Yes | US-2.3 |
| US-3.1 | Inbox gRPC API | Notification | 3 | Yes | US-0.3, US-2.3 |
| US-3.2 | Real-time in-app delivery | Notification | 3 | Yes | US-0.3, US-2.4 |
| US-3.3 | Gateway inbox routes and real-time forwarding | Gateway | 3 | Yes | US-3.1, US-3.2 |
| US-3.4 | Web notification bell and page | Web | 3 | Yes | US-3.3 |
| US-3.5 | Mobile in-app notifications screen | Mobile | 3 | Yes | US-3.3 |
| US-4.1 | Email templates | Notification | 4 | Yes | US-2.2 |
| US-4.2 | Email delivery | Notification | 4 | Yes | US-2.4, US-4.1 |
| US-4.3 | One-click unsubscribe | Notification, Gateway, Web | 4 | Yes | US-4.2 |
| US-5.1 | Register and unregister push tokens | Notification, Gateway | 5 | Yes | US-0.3, US-1.2 |
| US-5.2 | Push delivery and receipt checking | Notification | 5 | Yes | US-2.4, US-5.1 |
| US-5.3 | Mobile push integration | Mobile | 5 | Yes | US-5.1 |
| US-9.1 | MVP end-to-end and load test | Notification | Testing | Yes | Phases 0 to 5 |
| US-6.1 | Preferences API | Notification, Gateway | 6 | No | US-0.3, US-2.2 |
| US-6.2 | Web notification settings screen | Web | 6 | No | US-6.1 |
| US-6.3 | Mobile notification settings screen | Mobile | 6 | No | US-6.1 |
| US-6.4 | Rate limits and quiet hours | Notification | 6 | No | US-4.2, US-5.2, US-6.1 |
| US-6.5 | Metrics, alerts and dashboard | Notification, Infra | 6 | No | US-1.3 |
| US-7.1 | Publish device status change events | Protobuf, IoT | 7 | No | US-0.1 |
| US-7.2 | Smart meter offline and online alerts | Notification | 7 | No | US-7.1, US-2.3 |
| US-7.3 | Publish account events | Protobuf, Auth | 7 | No | - |
| US-7.4 | Account and security notifications | Notification | 7 | No | US-7.3, US-4.2, US-5.2 |
| US-8.1 - US-8.9 | Later improvements | Various | 8 | No | - |
