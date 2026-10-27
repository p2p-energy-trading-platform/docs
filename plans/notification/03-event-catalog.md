---
connie-title: Notification Service - Event Catalog
---

# Event Catalog

## 1. Input events

| Kafka topic | Producer | Protobuf message | Status |
|---|---|---|---|
| `trade.executed` | Matching Engine | `gridx.trade.v1.TradeExecuted` | Exists |
| `order.accepted` | Matching Engine | `gridx.order.v1.OrderAccepted` | Exists |
| `order.updated` | Matching Engine | `gridx.order.v1.OrderUpdated` | Exists, **missing `user_id`** |
| `order.cancelled` | Matching Engine | to confirm | Topic exists, check for `user_id` |
| `order.expired` | Matching Engine | to confirm | Topic exists, check for `user_id` |
| `iot.device-status-changed` | IoT Ingestion | new `gridx.iot.v1.DeviceStatusChanged` | **Needs to be added** |
| `grid.transfer-rule-changed` | Grid rules owner | `gridx.grid.v1.GridTransferRule` | **Topic to be confirmed** |
| `auth.account-events` | Auth Service | new `gridx.auth.v1.AccountEvent` | **Future** (KYC result, new login, password changed) |
| `billing.events` | Billing & Wallet | to be defined | **Future** (settlement, top-up, low balance) |

Every input event must have an `event_id` (used for de-duplication) and a timestamp.

## 2. Notification types

Notification types are named `<domain>.<what_happened>` and each belongs to one category.

| Type | Trigger | Recipient | Category | Example message |
|---|---|---|---|---|
| `trade.sold` | `TradeExecuted` | seller | trading | "You sold 5.00 kWh at 0.32 AED/kWh" |
| `trade.bought` | `TradeExecuted` | buyer | trading | "You bought 5.00 kWh at 0.32 AED/kWh" |
| `order.placed` | `OrderAccepted` | order owner | trading | "Your sell order for 10.00 kWh is live" |
| `order.partially_filled` | `OrderUpdated` (PARTIALLY_FILLED) | order owner | trading | "Your order is 40% filled" |
| `order.filled` | `OrderUpdated` (FILLED) | order owner | trading | "Your order is fully filled" |
| `order.cancelled` | `OrderUpdated` (CANCELLED) | order owner | trading | "Your order was cancelled" |
| `order.expired` | `OrderUpdated` (EXPIRED) | order owner | trading | "Your order expired with 2.00 kWh unfilled" |
| `device.offline` | `DeviceStatusChanged` (offline) | house owner | device_alerts | "Your smart meter has been offline for 10 minutes" |
| `device.online` | `DeviceStatusChanged` (online after offline) | house owner | device_alerts | "Your smart meter is back online" |
| `grid.fee_changed` | `GridTransferRule` | users in affected zones | market_alerts | "Grid fee for Zone 3 changed to 0.05 AED/kWh" |
| `account.kyc_approved` / `account.kyc_rejected` | `AccountEvent` (future) | user | security | "Your identity verification was approved" |
| `account.new_login` | `AccountEvent` (future) | user | security | "New sign-in from Chrome on macOS" |
| `account.password_changed` | `AccountEvent` (future) | user | security | "Your password was changed" |

`order.placed` is in-app only by default because the user has just placed the order themselves.

## 3. Gaps in current events (blocking)

### 3.1 User ID format mismatch

- Auth Service `users.id` is a `UUID`.
- `TradeExecuted.buyer_id/seller_id` and `OrderAccepted.user_id` are `uint64`.

The notification service stores `user_id` as `UUID` and calls `AuthService.GetUser(user_id)`. Matching Engine events must carry the same ID as Auth. **Recommendation:** add `string buyer_user_id` / `seller_user_id` / `user_id` (UUID) fields and deprecate the `uint64` fields, following Protobuf field evolution rules (never reuse field numbers).

### 3.2 `OrderUpdated` has no owner

```proto
message OrderUpdated {
  string event_id = 1;
  OrderUpdateType event_type = 2;
  uint64 order_id = 3;
  OrderStatus status = 4;
  int64 remaining_quantity = 5;
  google.protobuf.Timestamp updated_at = 6;
  string user_id = 7;
  int64 original_quantity = 8;
}
```

`original_quantity` lets templates show "40% filled" without a lookup.

**Fallback if the proto cannot change soon:** keep an `order_owners (order_id, user_id, original_quantity)` table filled from `order.accepted`. This works but couples the service to event arrival order, so it is temporary only.

### 3.3 No device status event

IoT Ingestion computes online/offline on read from `last_heartbeat_at`. Notifications need a **state change** event so we alert once, not on every heartbeat:

```proto
message DeviceStatusChanged {
  string event_id = 1;
  string house_id = 2;
  string user_id = 3;
  DeviceStatus status = 4;
  google.protobuf.Timestamp last_heartbeat_at = 5;
  google.protobuf.Timestamp changed_at = 6;
}
```

The producer should only emit `OFFLINE` after the configured threshold (e.g. 10 minutes) to avoid alerts on short network drops.

### 3.4 Units

The units of `execution_price`, `grid_fee_per_kwh` and `quantity` must be documented in the proto comments (for example "price in fils per kWh", "quantity in Wh"). Templates use one shared formatter.

## 4. Event handling rules

- **Idempotency key:** `dedupe_key = <type>:<event_id>:<user_id>`. One trade event creates two notifications (buyer and seller) with different keys.
- **Unknown event types:** count in a metric and skip.
- **Undecodable records:** send to `notification.dlq.v1` with the error and original headers.
- **Self-trade:** if buyer and seller are the same user, create both types (they are different facts).
- **Grid fee broadcast:** fan-out to many users is done in batches of 500 by a background job, not inside the consumer loop, so the partition is not blocked.
