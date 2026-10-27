---
connie-title: Notification Service - In-App Channel
---

# In-App Channel

The in-app channel has two parts:

1. **Inbox** (durable): the `notifications` table, read through the gateway REST API.
2. **Real-time** (best effort): a push over the existing gateway WebSocket so the bell updates without a refresh.

The inbox is the **source of truth**. The real-time message is only a signal that something changed.

## 1. Inbox

Every notification is written to the inbox, even if the user turned in-app off for that category. In that case the item is stored already read (`read_at = created_at`), so history stays complete but the badge does not grow. Security notifications are always unread.

Inbox features:

| Feature | Behaviour |
|---|---|
| List | Newest first by `occurred_at`. Keyset (cursor) pagination, default 20, max 50 |
| Filter | `status=unread` or `all`. Optional `category` filter |
| Unread count | From Redis `notif:unread:{userId}`. On miss, `COUNT(*)` on the partial index and cache |
| Mark read | Sets `read_at`. Idempotent |
| Mark all read | `UPDATE ... WHERE user_id = $1 AND read_at IS NULL AND occurred_at <= $2` (the client sends the newest item it has seen, so new items that arrived meanwhile stay unread) |
| Archive | Sets `archived_at`, hides from the list |
| Deep link | `action_url` (web path) and `data` (ids), used by web and mobile to navigate |

Cursor format: base64url of `{ occurredAt, id }`. Opaque to clients.

## 2. Real-time delivery

This follows the [API Gateway WebSocket plan](../api_gateway/05-websockets.md): domain services publish client-safe events to a **client-facing Kafka topic**, and the gateway forwards them to the right user.

```text
in_app worker ──produce──> Kafka realtime.user-events.v1 (key = userId)
                                    │
                         API Gateway consumer
                                    │
                    SubscriptionManager.publish('user:<userId>', ...)
                                    │
                         WebSocket topic 'user.self'
```

The gateway already resolves `user.self` to the internal key `user:<userId>` (`api-gateway/src/websocket/authorization.ts`). The gateway needs a Kafka consumer for `realtime.user-events.v1`. That work belongs to the gateway backlog.

### Event envelope

```json
{
  "eventId": "6f1c...",
  "schemaVersion": 1,
  "type": "notification.created",
  "userId": "3b2a...",
  "occurredAt": "2026-10-27T09:12:00Z",
  "payload": {
    "notification": {
      "id": "a91e...",
      "type": "trade.sold",
      "category": "trading",
      "title": "Energy sold",
      "body": "You sold 5.00 kWh at 0.32 AED/kWh",
      "actionUrl": "/trades/88123",
      "occurredAt": "2026-10-27T09:12:00Z",
      "read": false
    },
    "unreadCount": 4
  }
}
```

Other real-time event types:

| Type | When |
|---|---|
| `notification.created` | New inbox item |
| `notification.read` | Read on another device (keeps web and mobile in sync) |
| `notification.all_read` | Mark-all-read on another device |

The message is defined in Protobuf (`gridx.notification.v1.RealtimeUserEvent`) and serialised to JSON by the gateway for the browser.

### Client rules (web and mobile)

1. On app start or WebSocket reconnect: fetch `GET /notifications?limit=20` and `GET /notifications/unread-count` (snapshot).
2. Subscribe to `user.self` and apply `notification.*` events on top.
3. Ignore events with an `eventId` already seen (duplicates are possible).
4. Show a toast for new items only when the app is in the foreground and the item is not `order.placed`.

## 3. UI guidance

- Bell icon with an unread badge (show "99+" above 99).
- A dropdown with the latest 5 items and a "See all" link to the full notifications page (the web plan already lists an "In app notification page").
- Icons and colours per category (trading, device alert, security).
- Relative time ("2 min ago") with the full date on hover.
- Clicking an item marks it as read and opens `actionUrl`.
- Empty state: "You're all caught up".
