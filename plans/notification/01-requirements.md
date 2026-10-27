---
connie-title: Notification Service - Requirements
---

# Requirements

## 1. Users and goals

| Who | What they need |
|---|---|
| Prosumer / consumer (web) | See trades, order updates and alerts in a notification bell / inbox, live without refreshing |
| Prosumer / consumer (mobile) | Get a push notification on the phone when something important happens, even when the app is closed |
| Any user | Get important account and trade summaries by email |
| Any user | Choose which notifications they get on which channel |
| Other services | Notify users by publishing an event, without knowing about channels, devices, or emails |
| Operators | See whether notifications are being delivered, and why they fail |

## 2. Functional requirements

### FR-1 Event intake

- Consume domain events from Kafka (see [03-event-catalog.md](03-event-catalog.md)).
- Decode Protobuf events using the shared `typescript-sdk`.
- Map each event to one or more **notification types** (e.g. `trade.executed` creates `trade.sold` for the seller and `trade.bought` for the buyer).
- Ignore event types the service does not handle, without failing.

### FR-2 Recipient resolution

- Resolve the recipient user from the event (`user_id`, `buyer_id`, `seller_id`, or a lookup).
- Fetch contact data (email, name, status, locale) from Auth Service `GetUser` **at send time**, so email changes are respected.
- Do not send to users who are disabled or deleted. Do not send non-account email to unverified email addresses.

### FR-3 Preferences

- Each notification type belongs to a **category** (security, trading, device alerts, market alerts, product news).
- Users can turn each category on or off **per channel** (in-app, email, push).
- Security / account notifications cannot be turned off (they are mandatory transactional messages).
- Defaults are defined per category (see [08-preferences-and-templates.md](08-preferences-and-templates.md)).
- Email must support one-click unsubscribe for non-mandatory categories.

### FR-4 In-app inbox

- Store every notification in the user's inbox.
- List notifications (newest first, cursor pagination, filter unread).
- Show unread count.
- Mark one as read, mark all as read, and archive (hide) a notification.
- Push new notifications and unread-count changes to connected web and mobile clients in real time.

### FR-5 Email

- Send HTML + plain-text email from templates.
- Track the delivery status of every email (queued, sent, failed, bounced, complained).
- Suppress future email to addresses that hard-bounced or complained.

### FR-6 Mobile push

- Register and unregister Expo push tokens per device installation.
- Send push notifications through the Expo Push Service.
- Check push receipts and deactivate invalid tokens (`DeviceNotRegistered`).
- Include a deep link so tapping a notification opens the right screen.

### FR-7 Templates and content

- One template per notification type and channel (in-app title/body, email subject/HTML/text, push title/body).
- Format money, energy and dates in the user's locale and time zone (default `en` and `Asia/Dubai`).
- Templates are versioned in code and reviewed through pull requests.

### FR-8 Internal send API

- Internal services may request a notification directly through gRPC `SendNotification` (for cases where publishing a domain event is not suitable, e.g. a future Auth email adapter).

### FR-9 Retention

- Inbox items are kept for 90 days, then deleted by a scheduled job.
- Delivery attempt records are kept for 30 days.

## 3. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | **No duplicates.** Re-delivered Kafka events must not create duplicate notifications | Enforced by a unique key in the database |
| NFR-2 | **No lost notifications.** A crash at any point must not lose an accepted event | At-least-once consumption + transactional DB write before offset commit |
| NFR-3 | **Latency.** Event to in-app real-time | p95 < 2 s |
| NFR-4 | **Latency.** Event to push/email handed to the provider | p95 < 10 s |
| NFR-5 | **Isolation.** A slow or down email/push provider must not stop event consumption or other channels | Channels are delivered by separate workers from a durable queue |
| NFR-6 | **Retries.** Temporary provider failures are retried with exponential backoff and jitter | Max 6 attempts over about 1 hour, then marked `failed` |
| NFR-7 | **Rate limiting.** Protect users from notification floods | Per user, per channel limits in Redis (see [10-reliability-security-observability.md](10-reliability-security-observability.md)) |
| NFR-8 | **Security.** Users can only read and change their own notifications | User identity comes from the verified gateway context, never the request body |
| NFR-9 | **Privacy.** No secrets or sensitive data in push payloads or logs | Push shows summaries only. Logs never contain email bodies or tokens |
| NFR-10 | **Observability.** Metrics, structured logs and traces for every stage | Prometheus + OpenTelemetry |
| NFR-11 | **Horizontal scaling.** Consumers and workers can run as several replicas | Kafka consumer group + `SKIP LOCKED` workers |
| NFR-12 | **Operability.** Health and readiness endpoints, graceful shutdown | Same pattern as Auth Service |
