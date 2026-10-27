---
connie-title: Notification Service - Mobile Push Channel
---

# Mobile Push Channel

## 1. Why Expo Push Service

The mobile app is built with Expo / React Native. The Expo Push Service gives one API for both platforms:

```text
Notification Service ──(expo-server-sdk)──> Expo Push Service ──> FCM (Android)
                                                              └──> APNs (iOS)
```

- No need to call FCM and APNs directly or manage two token formats.
- FCM v1 service-account credentials and the APNs key are uploaded once to EAS (`eas credentials`). The backend only needs an **Expo access token** (with "enhanced push security" turned on so only our server can send).
- If we later need features Expo does not support, we can switch to direct FCM/APNs because tokens can also be read as native device tokens.

## 2. Mobile client setup (`frontend-mobile`)

1. Install `expo-notifications` and `expo-device`. Add the `expo-notifications` plugin to `app.json` with the notification icon and colour.
2. Ask for permission **in context**, not on first launch. For example, after the user's first order: "Get notified when your energy is sold?". iOS only allows one system prompt.
3. Get the token with `Notifications.getExpoPushTokenAsync({ projectId })`. The `projectId` comes from EAS config.
4. Register it with `POST /api/v1/devices/push-tokens` with `{ installationId, expoToken, platform, appVersion, deviceName }`.
   - `installationId` is a random UUID stored in secure storage on first launch.
5. Register again on every app start and on token change (`addPushTokenListener`). This keeps `last_seen_at` fresh.
6. On logout: `DELETE /api/v1/devices/push-tokens/{installationId}` **before** clearing the session.
7. Create Android notification channels:

   | Channel ID | Name | Importance |
   |---|---|---|
   | `trading` | Trades and orders | HIGH |
   | `device_alerts` | Smart meter alerts | HIGH |
   | `security` | Account and security | MAX |
   | `market_alerts` | Market and grid updates | DEFAULT |

8. Handle taps with `addNotificationResponseReceivedListener` and navigate using `data.url` (e.g. `gridx://trades/88123`) through Expo Router.
9. When the app is in the foreground, show an in-app toast instead of a system banner (`setNotificationHandler`).
10. Push notifications only work on a physical device with a development build, not in Expo Go for SDK 53+.

## 3. Send flow (server)

1. Worker claims a batch of `push` delivery jobs.
2. Loads active `push_tokens` for each user. If none, `status = 'skipped'`, `skip_reason = 'no_push_token'`.
3. Checks quiet hours (push only, non-security): if inside quiet hours, `next_attempt_at` = end of quiet hours, unless the TTL would expire first.
4. Builds one Expo message per token:

   ```json
   {
     "to": "ExponentPushToken[xxxxxxxx]",
     "title": "Energy sold",
     "body": "You sold 5.00 kWh at 0.32 AED/kWh",
     "data": { "url": "gridx://trades/88123", "notificationId": "a91e..." },
     "channelId": "trading",
     "priority": "high",
     "sound": "default",
     "ttl": 3600,
     "collapseId": "order:123"
   }
   ```

5. Sends in chunks of **max 100 messages** per request (`expo.chunkPushNotifications`) with gzip.
6. Stores each returned **ticket**:
   - `ok` → save `ticket_id` in `push_receipts_pending` with `check_after = now() + 15 min`,
   - `error` → handle by error code (table below).
7. A delivery is `sent` if at least one device ticket is `ok`.

## 4. Receipts and token cleanup

A ticket only means Expo accepted the message. The **receipt** says whether FCM/APNs accepted it.

The receipt checker runs every 5 minutes:

1. Loads tickets where `check_after <= now()` (batches of 1,000).
2. Calls `getPushNotificationReceiptsAsync`.
3. Acts on each receipt:

| Error | Meaning | Action |
|---|---|---|
| `DeviceNotRegistered` | App uninstalled or token invalid | Deactivate the token immediately. Do not retry |
| `MessageTooBig` | Payload > 4 KB | Mark failed, log as a bug (templates must keep payloads small) |
| `MessageRateExceeded` | Too many messages to one device | Retry later with backoff |
| `MismatchSenderId` / `InvalidCredentials` | Our FCM/APNs credentials are wrong | Mark failed, **alert** operators (affects every user) |

Receipts are kept by Expo for 24 hours. Tickets older than 24 h are deleted without checking.

## 5. Payload rules

- Keep title under 50 characters and body under 150 characters so they are not cut off.
- **No sensitive data:** no balances, full names, addresses, tokens or OTP codes. Push content can appear on the lock screen. Example: "You sold 5.00 kWh" is fine, "Your wallet balance is 1,203 AED" is not.
- `data` contains only IDs and a deep link. The app fetches details through the authenticated API.
- Set `ttl` per type: trade and order updates 1 h, device alerts 6 h, security 24 h. Stale pushes are worse than no push.
- Use `collapseId` / `group_key` so many partial fills for one order replace each other on the device instead of stacking.
- `priority: 'high'` only for trading, device alerts and security. Others use `default` to respect battery optimisation.

## 6. Limits and retries

- Expo allows about **600 notifications per second per project**. Workers use a token-bucket limiter (in Redis, shared across replicas) set below this.
- HTTP 429 and 5xx from Expo → retry with exponential backoff and jitter.
- Badge count on iOS is set to the unread count (`badge` field) for the trading and security categories.
