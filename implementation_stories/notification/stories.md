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
> **MVP = Phases 0 to 5** (in-app, email and push for trade and order events). Phases 6 to 8 come after the MVP.

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

### US-0.1 - Use one user ID format in Matching Engine events

> **As** the Notification Service,  
> **I want** trade and order events to carry the same user ID as Auth Service (UUID),  
> **so that** I can find the right user and their contact details.

**Team:** Protobuf, Matching Engine  
**Depends on:** -  
**Maps to:** [03-event-catalog.md §3.1](../../plans/notification/03-event-catalog.md), `proto/gridx/trade/v1/trade_events.proto`, `proto/gridx/order/v1/*.proto`

**Acceptance Criteria:**

- `TradeExecuted` has `buyer_user_id` and `seller_user_id` (string, UUID). `OrderAccepted` has a UUID `user_id`.
- Old `uint64` fields are marked deprecated. Their field numbers are not reused.
- The matching engine fills the new fields in every published event.
- New SDK versions are released.

**Status:** Not started. **Release-blocking.**

---

### US-0.2 - Add order owner to order update events

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

### US-0.3 - Document units for price and quantity

> **As** a developer writing notification templates,  
> **I want** the units of price, grid fee and quantity written in the proto comments,  
> **so that** notifications show correct values to users.

**Team:** Protobuf, Matching Engine  
**Depends on:** -  
**Maps to:** [03-event-catalog.md §3.4](../../plans/notification/03-event-catalog.md)

**Acceptance Criteria:**

- `execution_price`, `grid_fee_per_kwh` and `quantity` have comments stating the unit (for example "fils per kWh", "Wh").
- The matching engine team confirms that the engine uses these units.

**Status:** Not started. **Release-blocking.**

---

### US-0.4 - Define the Notification Service Protobuf contract

> **As** the API Gateway and other services,  
> **I want** a `gridx.notification.v1` package with the service RPCs and the real-time event message,  
> **so that** we can call the Notification Service with generated, typed clients.

**Team:** Protobuf  
**Depends on:** -  
**Maps to:** [09-api-and-protobuf.md §1](../../plans/notification/09-api-and-protobuf.md), `proto/gridx/notification/v1/notification.proto`

**Acceptance Criteria:**

- The proto contains all RPCs in the plan: inbox, preferences, unsubscribe, push tokens and `SendNotification`.
- `RealtimeUserEvent` is defined.
- `buf lint` and `buf breaking` pass.
- New versions of `typescript-sdk`, `go-sdk` and `cpp-sdk` are released.

**Status:** Not started.

---

## Phase 1 - Service Foundation

### US-1.1 - Create the notification-service repository

> **As** a developer,  
> **I want** a new `notification-service` repository with the same layout and tooling as `auth-service`,  
> **so that** the team can work in a familiar structure.

**Team:** Notification  
**Depends on:** -  
**Maps to:** [11-folder-structure.md](../../plans/notification/11-folder-structure.md)

**Acceptance Criteria:**

- Repository created in the `p2p-energy-trading-platform` organisation with the folder layout from the plan.
- TypeScript, ESLint, Prettier and Vitest are set up like `auth-service`.
- CI runs lint, typecheck, test and build on every pull request.

**Status:** Not started.

---

### US-1.2 - Validate configuration at startup

> **As** a developer,  
> **I want** the service to load and validate its configuration with zod when it starts,  
> **so that** missing or wrong settings stop the service immediately with a clear error.

**Team:** Notification  
**Depends on:** US-1.1  
**Maps to:** `src/config/`, `scripts/check-config.ts`, `.env.example`

**Acceptance Criteria:**

- Missing or invalid required variables stop the process with a message naming the variable.
- `npm run check-config` validates config without starting the service.
- `SERVICE_ROLES` (`api`, `consumer`, `worker`) controls which parts of the service start. The default is all three.
- `.env.example` lists every variable.
- Secrets (Mailtrap key, Expo token, HMAC secrets) are never logged.

**Status:** Not started.

---

### US-1.3 - Logging, metrics setup and graceful shutdown

> **As** an operator,  
> **I want** structured logs, a metrics registry and clean shutdown,  
> **so that** the service is easy to debug and never loses work when it stops.

**Team:** Notification  
**Depends on:** US-1.1  
**Maps to:** `src/observability/`, [10-reliability-security-observability.md §6](../../plans/notification/10-reliability-security-observability.md)

**Acceptance Criteria:**

- Pino JSON logs with a configurable level.
- Email addresses, push tokens and message bodies are redacted from logs.
- A Prometheus registry and an OpenTelemetry tracer are set up.
- On `SIGTERM` the service stops taking new work, finishes in-flight work, then exits.

**Status:** Not started.

---

### US-1.4 - Database schema and connections

> **As** the service,  
> **I want** PostgreSQL and Redis clients and goose migrations for all tables,  
> **so that** features can store notifications, deliveries, preferences and tokens.

**Team:** Notification  
**Depends on:** US-1.2  
**Maps to:** [04-data-model.md](../../plans/notification/04-data-model.md), `src/infrastructure/database/`, `src/infrastructure/redis/`

**Acceptance Criteria:**

- The service connects to PostgreSQL as `NOTIFICATION_SERVICE_USER` and only uses the `notification_data` schema.
- Migrations create `notifications`, `notification_deliveries`, `notification_preferences`, `notification_settings`, `push_tokens`, `push_receipts_pending` and `email_suppressions`, with the indexes and unique constraints from the plan.
- Every migration has a rollback. `db:up`, `db:down` and `db:status` work locally.

**Status:** Not started.

---

### US-1.5 - Health, readiness and metrics endpoints

> **As** an infrastructure operator,  
> **I want** liveness, readiness and metrics endpoints,  
> **so that** Docker and Prometheus know whether the service is healthy.

**Team:** Notification  
**Depends on:** US-1.3, US-1.4  
**Maps to:** [10-reliability-security-observability.md §6](../../plans/notification/10-reliability-security-observability.md)

**Acceptance Criteria:**

- `GET /health/live` returns 200 while the process runs.
- `GET /health/ready` returns 200 only when PostgreSQL is reachable, migrations are at the expected version, and (for the consumer role) the Kafka consumer has joined its group.
- `GET /metrics` returns Prometheus metrics.

**Status:** Not started.

---

### US-1.6 - Docker and workspace integration

> **As** a developer,  
> **I want** the service to start with the rest of the platform using `task up`,  
> **so that** I can test it locally with Kafka, PostgreSQL and Redis.

**Team:** Notification, Infra  
**Depends on:** US-1.5  
**Maps to:** [11-folder-structure.md - Workspace changes](../../plans/notification/11-folder-structure.md)

**Acceptance Criteria:**

- `Dockerfile` and `docker-compose.yml` exist, with a container health check on `/health/live`.
- `notification-service` is added to `REPOS` in `gridx-workspace/Taskfile.yml` and included in `docker-compose.root.yml`.
- `notification-service=skeleton` is added to `.analysis-maturity`.
- `task up` starts the service and `/health/ready` is green.

**Status:** Not started.

---

## Phase 2 - Consume Events and Create Inbox Items

### US-2.1 - Reliable Kafka consumer

> **As** the service,  
> **I want** a Kafka consumer that commits offsets only after my database write succeeds,  
> **so that** no event is lost if the service crashes.

**Team:** Notification  
**Depends on:** US-1.4  
**Maps to:** [10-reliability-security-observability.md §1](../../plans/notification/10-reliability-security-observability.md), `src/consumer/kafka-consumer.ts`

**Acceptance Criteria:**

- Consumer group `notification-service` with auto-commit turned off.
- Records in one partition are processed in order. Partitions run in parallel.
- If PostgreSQL is down, the partition pauses and retries. The record is not skipped.
- Shutdown finishes in-flight records and commits before disconnecting.
- Integration test: a crash after the DB commit but before the offset commit creates no duplicate on restart.

**Status:** Not started.

---

### US-2.2 - Dead-letter topic for bad events

> **As** an operator,  
> **I want** events that cannot be decoded to go to a dead-letter topic,  
> **so that** one broken record does not block all notifications.

**Team:** Notification  
**Depends on:** US-2.1  
**Maps to:** [02-architecture.md §2](../../plans/notification/02-architecture.md), `src/consumer/dlq.ts`

**Acceptance Criteria:**

- Undecodable or invalid records are written to `notification.dlq.v1` with headers `x-error`, `x-source-topic`, `x-source-partition` and `x-source-offset`.
- The consumer continues with the next record.
- Unknown event types are counted in a metric and skipped (not sent to the DLQ).

**Status:** Not started.

---

### US-2.3 - Template registry and shared formatter

> **As** a developer,  
> **I want** one definition per notification type with its category, data schema and text for each channel,  
> **so that** all channels show the same, correctly formatted content.

**Team:** Notification  
**Depends on:** US-0.3, US-1.1  
**Maps to:** [08-preferences-and-templates.md §5](../../plans/notification/08-preferences-and-templates.md), `src/templates/registry.ts`, `src/templates/format.ts`

**Acceptance Criteria:**

- Types defined: `trade.sold`, `trade.bought`, `order.placed`, `order.partially_filled`, `order.filled`, `order.cancelled`, `order.expired`.
- Each type has a zod schema for its data, a category, a priority, in-app text and push text.
- The formatter uses `Intl` with the user's locale and time zone (default `en`, `Asia/Dubai`) for energy, price and dates.
- `action_url` only accepts relative paths or `gridx://` links.
- A unit test renders every type for every channel with sample data.

**Status:** Not started.

---

### US-2.4 - Default preferences and channel selection

> **As** a user,  
> **I want** sensible notification defaults without having to configure anything,  
> **so that** I get important updates on the right channels from day one.

**Team:** Notification  
**Depends on:** US-2.3  
**Maps to:** [08-preferences-and-templates.md §2-3](../../plans/notification/08-preferences-and-templates.md), `src/features/preferences/defaults.ts`

**Acceptance Criteria:**

- The default channel matrix from the plan is in code.
- The effective preference rule is applied: mandatory types always on, else user override, else default, and only channels allowed for the type.
- `order.placed` is in-app only. `order.partially_filled` never sends email.
- Unit tests cover every category and the exceptions.

**Status:** Not started.

---

### US-2.5 - Create notifications and delivery jobs in one transaction

> **As** the service,  
> **I want** to store the notification and one delivery job per enabled channel in a single database transaction,  
> **so that** a notification is never stored without its jobs, and repeated events never create duplicates.

**Team:** Notification  
**Depends on:** US-1.4, US-2.4  
**Maps to:** [02-architecture.md §2](../../plans/notification/02-architecture.md), `src/features/notifications/`

**Acceptance Criteria:**

- `notifications` is inserted with `ON CONFLICT (dedupe_key) DO NOTHING`, where `dedupe_key = <type>:<event_id>:<user_id>`.
- One `notification_deliveries` row with status `pending` is created per enabled channel.
- Disabled channels are recorded as `skipped` with `skip_reason = 'preference_off'`. The inbox item is still created (stored as read if in-app is off).
- After commit, `NOTIFY notification_deliveries` wakes the workers.

**Status:** Not started.

---

### US-2.6 - Notify buyer and seller when a trade executes

> **As** a buyer or seller,  
> **I want** to be told when my energy is bought or sold,  
> **so that** I know my trade went through.

**Team:** Notification  
**Depends on:** US-0.1, US-2.1, US-2.5  
**Maps to:** [03-event-catalog.md §2](../../plans/notification/03-event-catalog.md), `src/consumer/handlers/trade-executed.ts`

**Acceptance Criteria:**

- One `TradeExecuted` event creates `trade.sold` for the seller and `trade.bought` for the buyer.
- Publishing the same event twice still creates only two notifications.
- If buyer and seller are the same user, both notifications are created.

**Status:** Not started.

---

### US-2.7 - Notify order owner about order changes

> **As** a user with an open order,  
> **I want** to be told when my order is placed, filled, partially filled, cancelled or expired,  
> **so that** I can follow my order without checking the app.

**Team:** Notification  
**Depends on:** US-0.2, US-2.1, US-2.5  
**Maps to:** [03-event-catalog.md §2](../../plans/notification/03-event-catalog.md), [02-architecture.md §4](../../plans/notification/02-architecture.md), `src/consumer/handlers/order-events.ts`

**Acceptance Criteria:**

- `OrderAccepted` creates `order.placed`. `OrderUpdated` creates the type matching its status.
- `order.partially_filled` shows the filled percentage using `original_quantity`.
- `group_key = order:<order_id>`. A late update that arrives after a final state (filled, cancelled, expired) is stored in the inbox, but push and email are skipped.
- Unit tests cover every status.

**Status:** Not started.

---

### US-2.8 - Delivery queue and worker framework

> **As** the service,  
> **I want** channel workers that safely claim jobs from the delivery table and retry failures,  
> **so that** each channel is delivered independently and a slow provider never blocks the others.

**Team:** Notification  
**Depends on:** US-2.5  
**Maps to:** [02-architecture.md §2](../../plans/notification/02-architecture.md), [10-reliability-security-observability.md §2](../../plans/notification/10-reliability-security-observability.md), `src/delivery/`, `src/jobs/stuck-jobs-reaper.ts`

**Acceptance Criteria:**

- Workers claim jobs with `FOR UPDATE SKIP LOCKED`, per channel, ordered by priority.
- Workers wake on `LISTEN/NOTIFY` and also poll every 1 second.
- Temporary errors are retried with exponential backoff and jitter, up to 6 attempts. Then the job is marked `failed`.
- Permanent errors are marked `failed` immediately with the error code.
- A reaper re-queues jobs stuck in `processing` after `locked_until`.
- Integration test: two workers running at the same time never send the same job twice.

**Status:** Not started.

---

## Phase 3 - Inbox API and Real-Time

### US-3.1 - List my notifications

> **As** a user,  
> **I want** to see my notifications, newest first,  
> **so that** I can review what happened on my account.

**Team:** Notification  
**Depends on:** US-0.4, US-2.5  
**Maps to:** [06-in-app-channel.md §1](../../plans/notification/06-in-app-channel.md), `ListNotifications` RPC

**Acceptance Criteria:**

- Sorted by `occurred_at`, newest first, with cursor pagination (default 20, max 50).
- Filters: unread only, category.
- Archived items are not returned.
- Only the user's own notifications are returned. `user_id` comes from the gateway's verified token.

**Status:** Not started.

---

### US-3.2 - Unread count

> **As** a user,  
> **I want** to see how many unread notifications I have,  
> **so that** I know when something new needs my attention.

**Team:** Notification  
**Depends on:** US-3.1  
**Maps to:** [06-in-app-channel.md §1](../../plans/notification/06-in-app-channel.md), `GetUnreadCount` RPC

**Acceptance Criteria:**

- Count is read from Redis `notif:unread:{userId}`. If missing, it is counted in PostgreSQL and cached.
- The count stays correct after new items, mark-read and mark-all-read.
- If Redis is down, the count comes from PostgreSQL.

**Status:** Not started.

---

### US-3.3 - Mark as read, mark all as read, archive

> **As** a user,  
> **I want** to mark notifications as read and hide ones I don't need,  
> **so that** my inbox stays tidy.

**Team:** Notification  
**Depends on:** US-3.1  
**Maps to:** [06-in-app-channel.md §1](../../plans/notification/06-in-app-channel.md), `MarkAsRead`, `MarkAllAsRead`, `ArchiveNotification` RPCs

**Acceptance Criteria:**

- Mark as read accepts up to 100 IDs and is idempotent.
- Mark all as read only marks items up to the `upTo` time, so newer items stay unread.
- Archive hides the item. It is not hard-deleted.
- A user trying to change another user's notification gets `NOT_FOUND`.
- Each change returns the new unread count.

**Status:** Not started.

---

### US-3.4 - Send new notifications to the real-time topic

> **As** the service,  
> **I want** the in-app worker to publish new notifications to `realtime.user-events.v1`,  
> **so that** the gateway can show them to connected users immediately.

**Team:** Notification  
**Depends on:** US-0.4, US-2.8  
**Maps to:** [06-in-app-channel.md §2](../../plans/notification/06-in-app-channel.md), `src/delivery/channels/in-app.ts`

**Acceptance Criteria:**

- `notification.created` events are produced with key = `userId` and include the current unread count.
- `notification.read` and `notification.all_read` are published when items are read, so other devices stay in sync.
- Events follow the `RealtimeUserEvent` schema and have a unique `eventId`.

**Status:** Not started.

---

### US-3.5 - Gateway REST routes for the inbox

> **As** the web and mobile apps,  
> **I want** REST routes for the inbox,  
> **so that** I can show and update notifications.

**Team:** Gateway  
**Depends on:** US-0.4, US-3.1, US-3.2, US-3.3  
**Maps to:** [09-api-and-protobuf.md §2](../../plans/notification/09-api-and-protobuf.md)

**Acceptance Criteria:**

- Routes: `GET /api/v1/notifications`, `GET /api/v1/notifications/unread-count`, `POST /api/v1/notifications/read`, `POST /api/v1/notifications/read-all`, `DELETE /api/v1/notifications/{id}`.
- All routes require login. `user_id` is taken from the access token, never from the request.
- Request validation and rate limiting match other gateway routes.

**Status:** Not started.

---

### US-3.6 - Gateway forwards real-time notifications over WebSocket

> **As** a logged-in user,  
> **I want** new notifications to appear without refreshing the page,  
> **so that** I see trades as they happen.

**Team:** Gateway  
**Depends on:** US-3.4  
**Maps to:** [06-in-app-channel.md §2](../../plans/notification/06-in-app-channel.md), `api-gateway/src/websocket/`

**Acceptance Criteria:**

- The gateway consumes `realtime.user-events.v1` and publishes each event to `user:<userId>`, delivered on the `user.self` WebSocket topic.
- Events are sent to the browser as JSON.
- Users only receive their own events.

**Status:** Not started.

---

### US-3.7 - Web notification bell and page

> **As** a web user,  
> **I want** a bell with an unread badge, a dropdown and a full notifications page,  
> **so that** I can see and manage my notifications.

**Team:** Web  
**Depends on:** US-3.5, US-3.6  
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

### US-3.8 - Mobile in-app notifications screen

> **As** a mobile user,  
> **I want** a notifications screen and unread badge in the app,  
> **so that** I can see my history even if I missed a push.

**Team:** Mobile  
**Depends on:** US-3.5, US-3.6  
**Maps to:** [06-in-app-channel.md §2-3](../../plans/notification/06-in-app-channel.md)

**Acceptance Criteria:**

- Notifications list with pagination, unread badge, mark read, mark all read and archive.
- The app follows the same resync rules as web (fetch on start and reconnect, ignore duplicate events).
- Tapping an item opens the matching screen.

**Status:** Not started.

---

## Phase 4 - Email Channel

### US-4.1 - Email provider interface and Mailtrap adapter

> **As** a developer,  
> **I want** email sending behind an `EmailProvider` interface with a Mailtrap adapter,  
> **so that** we can change provider later without changing business logic.

**Team:** Notification  
**Depends on:** US-1.2  
**Maps to:** [05-email-channel.md §1](../../plans/notification/05-email-channel.md), `src/infrastructure/email/`

**Acceptance Criteria:**

- The interface matches the plan (`to`, `subject`, `text`, `html`, `headers`, `category`, `idempotencyKey`).
- Mailtrap Sandbox is used locally and in CI. Mailtrap Email Sending is used in production.
- Provider errors are classified as temporary (timeouts, 429, 5xx) or permanent (invalid address, validation errors).

**Status:** Not started.

---

### US-4.2 - Get user contact details from Auth Service

> **As** the email worker,  
> **I want** to get the user's current email, name, status and locale from Auth Service when sending,  
> **so that** emails go to the right, current address.

**Team:** Notification  
**Depends on:** US-1.2  
**Maps to:** [01-requirements.md FR-2](../../plans/notification/01-requirements.md), `src/infrastructure/auth-client/`

**Acceptance Criteria:**

- Uses the existing `AuthService.GetUser` RPC through the generated SDK.
- Disabled or deleted users are skipped.
- Unverified email addresses are skipped for non-security types.
- If Auth Service is down, the email job is retried later. In-app and push are not affected.

**Status:** Not started.

---

### US-4.3 - Email templates

> **As** a user,  
> **I want** clear, branded emails that look right in any mail app,  
> **so that** I can trust and understand what GridX sends me.

**Team:** Notification  
**Depends on:** US-2.3  
**Maps to:** [05-email-channel.md §3](../../plans/notification/05-email-channel.md), `src/templates/email/`

**Acceptance Criteria:**

- React Email layout with logo, footer, address and a "Manage notifications" link.
- An email template for every MVP type, each with an HTML and a plain-text part.
- `npm run email:preview` starts the preview server for design review.
- Snapshot tests render every template with sample data.
- No tracking pixels. Event data is never inserted as raw HTML.

**Status:** Not started.

---

### US-4.4 - Email delivery worker

> **As** a user who turned on email for a category,  
> **I want** to receive those notifications by email,  
> **so that** I have a record outside the app.

**Team:** Notification  
**Depends on:** US-2.8, US-4.1, US-4.2, US-4.3  
**Maps to:** [05-email-channel.md §2](../../plans/notification/05-email-channel.md), `src/delivery/channels/email.ts`

**Acceptance Criteria:**

- The worker gets contact details, checks suppressions, renders the template and sends.
- Adds `List-Unsubscribe` and `List-Unsubscribe-Post` headers for non-mandatory categories, and `X-GridX-Delivery-Id` on every email.
- On success, stores `provider_message_id` and sets status `sent`.
- If Mailtrap is down, in-app and push are still delivered and the email is retried until sent.
- An email arrives in the Mailtrap sandbox with HTML and text parts.

**Status:** Not started.

---

### US-4.5 - Handle bounces and spam complaints

> **As** the platform,  
> **I want** to stop emailing addresses that bounce or complain,  
> **so that** our sender reputation stays good and users are not annoyed.

**Team:** Notification  
**Depends on:** US-4.4  
**Maps to:** [05-email-channel.md §5](../../plans/notification/05-email-channel.md), `POST /webhooks/email/mailtrap`

**Acceptance Criteria:**

- The webhook verifies the provider signature or shared secret and rejects timestamps older than 5 minutes.
- Repeated webhook events are processed only once.
- Delivered: status `delivered`. Hard bounce: status `failed` and the address is added to `email_suppressions`.
- 3 soft bounces in 7 days are treated as a hard bounce.
- A spam complaint suppresses the address and turns off all non-mandatory email for the user.
- Suppressed emails are stored hashed.

**Status:** Not started.

---

### US-4.6 - One-click unsubscribe

> **As** a user,  
> **I want** to unsubscribe from a type of email with one click and no login,  
> **so that** I can easily stop emails I don't want.

**Team:** Notification, Gateway, Web  
**Depends on:** US-4.4  
**Maps to:** [05-email-channel.md §6](../../plans/notification/05-email-channel.md), `src/features/unsubscribe/`, `UnsubscribeByToken` RPC

**Acceptance Criteria:**

- The unsubscribe link has an HMAC-signed token for one user and one category, valid for 60 days, with a key ID for secret rotation.
- Notification: `UnsubscribeByToken` turns off email for that category.
- Gateway: public `GET` / `POST /api/v1/notifications/unsubscribe?token=` route, rate limited by IP.
- Web: confirmation page for the `GET` link. `POST` (one-click from the mail app) works without the page.
- Security emails cannot be unsubscribed.
- Invalid or expired tokens show a clear error.

**Status:** Not started.

---

### US-4.7 - Production email domain setup

> **As** the platform,  
> **I want** a dedicated sending domain with SPF, DKIM and DMARC,  
> **so that** our emails reach inboxes instead of spam.

**Team:** Infra  
**Depends on:** -  
**Maps to:** [05-email-channel.md §4](../../plans/notification/05-email-channel.md)

**Acceptance Criteria:**

- A sending sub-domain (for example `notify.<domain>`) is decided and set up with Mailtrap.
- SPF, DKIM and DMARC (`p=none` to start) records are published and verified.
- `From` and a monitored `Reply-To` address are configured.

**Status:** Not started. **Required before production email.**

---

## Phase 5 - Mobile Push Channel

### US-5.1 - Register and unregister push tokens

> **As** a mobile user,  
> **I want** my phone registered for push notifications when I log in, and removed when I log out,  
> **so that** notifications reach my phone and no one else's.

**Team:** Notification, Gateway  
**Depends on:** US-0.4, US-1.4  
**Maps to:** [07-mobile-push-channel.md §2](../../plans/notification/07-mobile-push-channel.md), [04-data-model.md §1.4](../../plans/notification/04-data-model.md), `src/features/devices/`

**Acceptance Criteria:**

- Notification: `RegisterPushToken` upserts by `installation_id` and updates `last_seen_at`. `UnregisterPushToken` deactivates it.
- If another user logs in on the same phone, the token moves to the new user. The old user no longer gets pushes on that phone.
- Gateway: `POST /api/v1/devices/push-tokens` and `DELETE /api/v1/devices/push-tokens/{installationId}`, both requiring login.

**Status:** Not started.

---

### US-5.2 - Expo credentials setup

> **As** the team,  
> **I want** FCM and APNs credentials set up in EAS and an Expo access token for the server,  
> **so that** we can send pushes to Android and iOS.

**Team:** Mobile, Infra  
**Depends on:** -  
**Maps to:** [07-mobile-push-channel.md §1](../../plans/notification/07-mobile-push-channel.md)

**Acceptance Criteria:**

- FCM v1 service account and APNs key are uploaded with `eas credentials`.
- An Expo access token is created with enhanced push security on, and stored as a secret for the service.
- A test push reaches a physical Android and iOS device.

**Status:** Not started.

---

### US-5.3 - Push delivery worker

> **As** a mobile user,  
> **I want** a push notification when something important happens, even when the app is closed,  
> **so that** I don't miss trades or alerts.

**Team:** Notification  
**Depends on:** US-2.8, US-5.1, US-5.2  
**Maps to:** [07-mobile-push-channel.md §3, §5-6](../../plans/notification/07-mobile-push-channel.md), `src/delivery/channels/push.ts`, `src/infrastructure/push/`

**Acceptance Criteria:**

- Uses `expo-server-sdk`. Sends in chunks of max 100 messages.
- One message per active token, with title, body, `data.url` deep link, `channelId`, `ttl`, `priority` and `collapseId` as in the plan.
- No token: status `skipped` with `skip_reason = 'no_push_token'`.
- `ok` tickets are saved for receipt checking. A delivery is `sent` if at least one device ticket is `ok`.
- A shared Redis rate limiter keeps sending below Expo's 600 messages per second. 429 and 5xx are retried.
- Push text has no sensitive data (no balances, names, addresses or codes).

**Status:** Not started.

---

### US-5.4 - Check push receipts and clean up tokens

> **As** the platform,  
> **I want** to check push receipts and remove invalid tokens,  
> **so that** we stop sending to uninstalled apps and spot credential problems early.

**Team:** Notification  
**Depends on:** US-5.3  
**Maps to:** [07-mobile-push-channel.md §4](../../plans/notification/07-mobile-push-channel.md), `src/jobs/push-receipts.ts`

**Acceptance Criteria:**

- The job runs every 5 minutes for tickets older than 15 minutes, in batches of 1,000.
- `DeviceNotRegistered`: the token is deactivated immediately with no retry.
- `MessageRateExceeded`: retry with backoff. `MessageTooBig`: mark failed and log an error.
- `InvalidCredentials` / `MismatchSenderId`: mark failed and raise an alert.
- Tickets older than 24 hours are deleted without checking.

**Status:** Not started.

---

### US-5.5 - Mobile push permission and token registration

> **As** a mobile user,  
> **I want** the app to ask for notification permission at a sensible moment,  
> **so that** I understand why it needs it.

**Team:** Mobile  
**Depends on:** US-5.1, US-5.2  
**Maps to:** [07-mobile-push-channel.md §2](../../plans/notification/07-mobile-push-channel.md)

**Acceptance Criteria:**

- `expo-notifications` and `expo-device` are installed and configured in `app.json`.
- Permission is asked in context (for example after the first order), not on first launch.
- A random `installationId` is created on first launch and kept in secure storage.
- The token is registered on every app start and whenever it changes.
- On logout, the token is unregistered before the session is cleared.

**Status:** Not started.

---

### US-5.6 - Mobile push channels and deep links

> **As** a mobile user,  
> **I want** tapping a notification to open the right screen, and to control alert types in phone settings,  
> **so that** notifications are useful and not annoying.

**Team:** Mobile  
**Depends on:** US-5.5  
**Maps to:** [07-mobile-push-channel.md §2](../../plans/notification/07-mobile-push-channel.md)

**Acceptance Criteria:**

- Android channels `trading`, `device_alerts`, `security` and `market_alerts` are created with the importance levels from the plan.
- Tapping a notification opens `data.url` (for example `gridx://trades/88123`) through Expo Router.
- While the app is open, an in-app toast is shown instead of a system banner.
- iOS badge shows the unread count.
- A trade push on a physical Android and iOS device opens the trade screen when tapped.

**Status:** Not started.

---

## Phase 6 - Preferences and Protection (after MVP)

### US-6.1 - Preferences API

> **As** a user,  
> **I want** to choose which categories I get on in-app, push and email,  
> **so that** I only get the notifications I care about.

**Team:** Notification, Gateway  
**Depends on:** US-0.4, US-2.4  
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

### US-6.4 - Rate limits and flood protection

> **As** a user,  
> **I want** to be protected from a flood of notifications,  
> **so that** busy trading does not spam my phone or inbox.

**Team:** Notification  
**Depends on:** US-4.4, US-5.3  
**Maps to:** [10-reliability-security-observability.md §4](../../plans/notification/10-reliability-security-observability.md), [05-email-channel.md §7](../../plans/notification/05-email-channel.md), `src/delivery/rate-limit.ts`

**Acceptance Criteria:**

- Per user, per channel limits in Redis: push 10/min and 60/hour, email 5 per 10 min and 30/day, real-time 30/min.
- Over the push limit: push skipped with `rate_limited`, inbox item still created.
- Over the email limit: emails are combined into one summary email.
- Over the real-time limit: only an unread-count update is sent.
- Security notifications are never rate limited.
- If Redis is down, sending is allowed and a warning is logged.

**Status:** Not started.

---

### US-6.5 - Quiet hours

> **As** a user,  
> **I want** to set quiet hours for push notifications,  
> **so that** my phone does not buzz at night.

**Team:** Notification  
**Depends on:** US-6.1, US-5.3  
**Maps to:** [07-mobile-push-channel.md §3](../../plans/notification/07-mobile-push-channel.md)

**Acceptance Criteria:**

- Non-security pushes during quiet hours are delayed until the end of quiet hours, in the user's time zone.
- If the push TTL would expire first, the push is skipped (the inbox item remains).
- Security pushes are always sent.

**Status:** Not started.

---

### US-6.6 - Metrics, alerts and dashboard

> **As** an operator,  
> **I want** metrics, alerts and a Grafana dashboard for the service,  
> **so that** I know when notifications are failing and why.

**Team:** Notification, Infra  
**Depends on:** US-1.5  
**Maps to:** [10-reliability-security-observability.md §6](../../plans/notification/10-reliability-security-observability.md), [Prometheus plan](../../plans/metrics/prometheus.md)

**Acceptance Criteria:**

- All metrics in the plan are exported.
- Alerts: consumer lag, delivery failure rate, queue backlog, push credential errors, email complaint rate, new DLQ records.
- Grafana dashboard shows events, deliveries per channel, latency and queue depth.
- Trace context is carried from the Kafka event to the provider call.

**Status:** Not started.

---

### US-6.7 - Data retention and operator tools

> **As** an operator,  
> **I want** old data cleaned up automatically and a way to retry failed deliveries,  
> **so that** the database stays small and incidents can be fixed.

**Team:** Notification  
**Depends on:** US-2.8  
**Maps to:** [04-data-model.md §3](../../plans/notification/04-data-model.md), `src/jobs/retention.ts`, `scripts/retry-deliveries.ts`

**Acceptance Criteria:**

- A daily job deletes notifications older than 90 days in batches of 5,000.
- Inactive push tokens are deleted 30 days after deactivation.
- `npm run deliveries:retry -- --since=1h --channel=email` re-queues failed deliveries.
- The README has a runbook: replaying the DLQ, retrying deliveries, common alerts.

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
**Depends on:** US-7.1, US-2.5  
**Maps to:** `src/consumer/handlers/device-status.ts`

**Acceptance Criteria:**

- `device.offline` and `device.online` types are added in the `device_alerts` category.
- At most one offline alert per house every 6 hours.
- In-app, push and email are on by default.

**Status:** Not started.

---

### US-7.3 - Grid fee change broadcast

> **As** a user in a grid zone,  
> **I want** to be told when the grid fee for my zone changes,  
> **so that** I can adjust my prices.

**Team:** Notification  
**Depends on:** US-2.5. The topic and producer must be confirmed.  
**Maps to:** [03-event-catalog.md §4](../../plans/notification/03-event-catalog.md), `src/consumer/handlers/grid-rule-changed.ts`

**Acceptance Criteria:**

- The source topic and owner for `GridTransferRule` changes are confirmed.
- `grid.fee_changed` is created for every user in the affected zones.
- Fan-out runs as a background job in batches of 500, not inside the consumer loop.
- In-app only by default.

**Status:** Not started. **Blocked:** topic and owner not confirmed.

---

### US-7.4 - Publish account events

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

### US-7.5 - Account and security notifications

> **As** a user,  
> **I want** to always be told about security events on my account,  
> **so that** I can react quickly if someone else is using it.

**Team:** Notification  
**Depends on:** US-7.4, US-4.4, US-5.3  
**Maps to:** [03-event-catalog.md §2](../../plans/notification/03-event-catalog.md), [08-preferences-and-templates.md §1](../../plans/notification/08-preferences-and-templates.md)

**Acceptance Criteria:**

- `account.kyc_approved`, `account.kyc_rejected`, `account.new_login` and `account.password_changed` are added in the `security` category.
- Security notifications are sent on all channels and cannot be turned off or rate limited.
- When an account is deleted, all of that user's notification data is deleted.

**Status:** Not started.

---

### US-7.6 - Internal send API for other services

> **As** another internal service,  
> **I want** to ask the Notification Service to send a notification directly,  
> **so that** I can notify a user when publishing an event does not fit.

**Team:** Notification  
**Depends on:** US-0.4, US-2.5  
**Maps to:** [09-api-and-protobuf.md §3](../../plans/notification/09-api-and-protobuf.md), `SendNotification` RPC

**Acceptance Criteria:**

- Callers must authenticate with the platform's service-to-service method.
- Each caller has an allow-list of types (for example Auth may only send `account.*`).
- `idempotency_key` prevents duplicates. A repeated call returns `duplicate = true`.

**Status:** Not started.

---

### US-7.7 - Auth Service email adapter (optional)

> **As** Auth Service,  
> **I want** to send account emails through the Notification Service,  
> **so that** all user email uses one template system and one delivery pipeline.

**Team:** Auth  
**Depends on:** US-7.6  
**Maps to:** [Auth - Account management and recovery](../../plans/auth/12-account-management-and-recovery.md)

**Acceptance Criteria:**

- An Auth email adapter calls `SendNotification`.
- OTP and password-reset emails keep the highest priority and still arrive within their time limits.
- Auth can switch back to its own Mailtrap adapter with configuration.

**Status:** Not started. Optional.

---

## Phase 8 - Later Improvements (backlog)

These are ideas for later. Create them as backlog items, not sprint stories.

| ID | Item | Notes |
|---|---|---|
| US-8.1 | Daily trading summary email | One email per day instead of one per trade |
| US-8.2 | Price spike / low price alerts | From [functionalities](../../knowledge_pot/functionalities.md) |
| US-8.3 | Arabic translations | Templates already keep strings separate |
| US-8.4 | Admin broadcast tool | Send announcements to all or some users |

---

## Testing and Release

### US-9.1 - Pipeline integration tests

> **As** the team,  
> **I want** integration tests with real PostgreSQL, Redis and Kafka,  
> **so that** we know the pipeline is reliable before release.

**Team:** Notification  
**Depends on:** US-2.8  
**Maps to:** [12-implementation-plan.md - Testing strategy](../../plans/notification/12-implementation-plan.md)

**Acceptance Criteria:**

- Testcontainers runs PostgreSQL, Redis and Kafka in CI.
- Covered: same event twice gives one notification. Crash before offset commit gives no duplicate. Two workers never double-send. Retry and reaper flows work.
- Covered: provider down still delivers other channels. Preference off skips the channel but keeps the inbox item. A user cannot read another user's notification.

**Status:** Not started.

---

### US-9.2 - End-to-end and load test for MVP

> **As** the team,  
> **I want** an end-to-end check and a load test,  
> **so that** we can sign off the MVP.

**Team:** Notification, Web, Mobile  
**Depends on:** All MVP stories (Phases 0 to 5)  
**Maps to:** [12-implementation-plan.md - Definition of done](../../plans/notification/12-implementation-plan.md)

**Acceptance Criteria:**

- A matching engine trade reaches the web bell, the email sandbox and a physical phone.
- Load test at 1,000 trades per minute: p95 event to in-app real-time under 2 s, p95 event to provider under 10 s.
- README has setup, configuration and runbook.

**Status:** Not started.

---

## Summary Table

| ID | Story | Team | Phase | MVP | Depends on |
|---|---|---|---|---|---|
| US-0.1 | Use one user ID format in Matching Engine events | Protobuf, Matching Engine | 0 | Yes | - |
| US-0.2 | Add order owner to order update events | Protobuf, Matching Engine | 0 | Yes | US-0.1 |
| US-0.3 | Document units for price and quantity | Protobuf, Matching Engine | 0 | Yes | - |
| US-0.4 | Define the Notification Service Protobuf contract | Protobuf | 0 | Yes | - |
| US-1.1 | Create the notification-service repository | Notification | 1 | Yes | - |
| US-1.2 | Validate configuration at startup | Notification | 1 | Yes | US-1.1 |
| US-1.3 | Logging, metrics setup and graceful shutdown | Notification | 1 | Yes | US-1.1 |
| US-1.4 | Database schema and connections | Notification | 1 | Yes | US-1.2 |
| US-1.5 | Health, readiness and metrics endpoints | Notification | 1 | Yes | US-1.3, US-1.4 |
| US-1.6 | Docker and workspace integration | Notification, Infra | 1 | Yes | US-1.5 |
| US-2.1 | Reliable Kafka consumer | Notification | 2 | Yes | US-1.4 |
| US-2.2 | Dead-letter topic for bad events | Notification | 2 | Yes | US-2.1 |
| US-2.3 | Template registry and shared formatter | Notification | 2 | Yes | US-0.3, US-1.1 |
| US-2.4 | Default preferences and channel selection | Notification | 2 | Yes | US-2.3 |
| US-2.5 | Create notifications and delivery jobs in one transaction | Notification | 2 | Yes | US-1.4, US-2.4 |
| US-2.6 | Notify buyer and seller when a trade executes | Notification | 2 | Yes | US-0.1, US-2.1, US-2.5 |
| US-2.7 | Notify order owner about order changes | Notification | 2 | Yes | US-0.2, US-2.1, US-2.5 |
| US-2.8 | Delivery queue and worker framework | Notification | 2 | Yes | US-2.5 |
| US-3.1 | List my notifications | Notification | 3 | Yes | US-0.4, US-2.5 |
| US-3.2 | Unread count | Notification | 3 | Yes | US-3.1 |
| US-3.3 | Mark as read, mark all as read, archive | Notification | 3 | Yes | US-3.1 |
| US-3.4 | Send new notifications to the real-time topic | Notification | 3 | Yes | US-0.4, US-2.8 |
| US-3.5 | Gateway REST routes for the inbox | Gateway | 3 | Yes | US-3.1, US-3.2, US-3.3 |
| US-3.6 | Gateway forwards real-time notifications over WebSocket | Gateway | 3 | Yes | US-3.4 |
| US-3.7 | Web notification bell and page | Web | 3 | Yes | US-3.5, US-3.6 |
| US-3.8 | Mobile in-app notifications screen | Mobile | 3 | Yes | US-3.5, US-3.6 |
| US-4.1 | Email provider interface and Mailtrap adapter | Notification | 4 | Yes | US-1.2 |
| US-4.2 | Get user contact details from Auth Service | Notification | 4 | Yes | US-1.2 |
| US-4.3 | Email templates | Notification | 4 | Yes | US-2.3 |
| US-4.4 | Email delivery worker | Notification | 4 | Yes | US-2.8, US-4.1, US-4.2, US-4.3 |
| US-4.5 | Handle bounces and spam complaints | Notification | 4 | Yes | US-4.4 |
| US-4.6 | One-click unsubscribe | Notification, Gateway, Web | 4 | Yes | US-4.4 |
| US-4.7 | Production email domain setup | Infra | 4 | Before prod | - |
| US-5.1 | Register and unregister push tokens | Notification, Gateway | 5 | Yes | US-0.4, US-1.4 |
| US-5.2 | Expo credentials setup | Mobile, Infra | 5 | Yes | - |
| US-5.3 | Push delivery worker | Notification | 5 | Yes | US-2.8, US-5.1, US-5.2 |
| US-5.4 | Check push receipts and clean up tokens | Notification | 5 | Yes | US-5.3 |
| US-5.5 | Mobile push permission and token registration | Mobile | 5 | Yes | US-5.1, US-5.2 |
| US-5.6 | Mobile push channels and deep links | Mobile | 5 | Yes | US-5.5 |
| US-6.1 | Preferences API | Notification, Gateway | 6 | No | US-0.4, US-2.4 |
| US-6.2 | Web notification settings screen | Web | 6 | No | US-6.1 |
| US-6.3 | Mobile notification settings screen | Mobile | 6 | No | US-6.1 |
| US-6.4 | Rate limits and flood protection | Notification | 6 | No | US-4.4, US-5.3 |
| US-6.5 | Quiet hours | Notification | 6 | No | US-6.1, US-5.3 |
| US-6.6 | Metrics, alerts and dashboard | Notification, Infra | 6 | No | US-1.5 |
| US-6.7 | Data retention and operator tools | Notification | 6 | No | US-2.8 |
| US-7.1 | Publish device status change events | Protobuf, IoT | 7 | No | US-0.1 |
| US-7.2 | Smart meter offline and online alerts | Notification | 7 | No | US-7.1, US-2.5 |
| US-7.3 | Grid fee change broadcast | Notification | 7 | No | US-2.5 (topic to confirm) |
| US-7.4 | Publish account events | Protobuf, Auth | 7 | No | - |
| US-7.5 | Account and security notifications | Notification | 7 | No | US-7.4, US-4.4, US-5.3 |
| US-7.6 | Internal send API for other services | Notification | 7 | No | US-0.4, US-2.5 |
| US-7.7 | Auth Service email adapter (optional) | Auth | 7 | No | US-7.6 |
| US-8.1 - US-8.4 | Later improvements | Various | 8 | No | - |
| US-9.1 | Pipeline integration tests | Notification | Testing | Yes | US-2.8 |
| US-9.2 | End-to-end and load test for MVP | Notification, Web, Mobile | Testing | Yes | Phases 0 to 5 |
