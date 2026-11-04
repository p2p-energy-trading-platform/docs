---
connie-title: Notification Service - API and Protobuf
---

# API and Protobuf Contract

## 1. Protobuf

New package in the `protobuf` repository: `proto/gridx/notification/v1/`. After merging, new versions of `typescript-sdk`, `go-sdk` and `cpp-sdk` are released through the existing release flow.

```proto
syntax = "proto3";

package gridx.notification.v1;

import "google/protobuf/struct.proto";
import "google/protobuf/timestamp.proto";

service NotificationService {
  rpc ListNotifications(ListNotificationsRequest) returns (ListNotificationsResponse);
  rpc GetUnreadCount(GetUnreadCountRequest) returns (GetUnreadCountResponse);
  rpc MarkAsRead(MarkAsReadRequest) returns (MarkAsReadResponse);
  rpc MarkAllAsRead(MarkAllAsReadRequest) returns (MarkAllAsReadResponse);
  rpc ArchiveNotification(ArchiveNotificationRequest) returns (ArchiveNotificationResponse);

  rpc GetPreferences(GetPreferencesRequest) returns (GetPreferencesResponse);
  rpc UpdatePreferences(UpdatePreferencesRequest) returns (UpdatePreferencesResponse);
  rpc UnsubscribeByToken(UnsubscribeByTokenRequest) returns (UnsubscribeByTokenResponse);

  rpc RegisterPushToken(RegisterPushTokenRequest) returns (RegisterPushTokenResponse);
  rpc UnregisterPushToken(UnregisterPushTokenRequest) returns (UnregisterPushTokenResponse);

  rpc SendNotification(SendNotificationRequest) returns (SendNotificationResponse);
}

enum Channel {
  CHANNEL_UNSPECIFIED = 0;
  CHANNEL_IN_APP = 1;
  CHANNEL_EMAIL = 2;
  CHANNEL_PUSH = 3;
}

message Notification {
  string id = 1;
  string type = 2;
  string category = 3;
  string title = 4;
  string body = 5;
  string action_url = 6;
  google.protobuf.Struct data = 7;
  google.protobuf.Timestamp occurred_at = 8;
  google.protobuf.Timestamp read_at = 9;
}

message ListNotificationsRequest {
  string user_id = 1;
  uint32 limit = 2;
  string cursor = 3;
  bool unread_only = 4;
  string category = 5;
}

message ListNotificationsResponse {
  repeated Notification notifications = 1;
  string next_cursor = 2;
}

message GetUnreadCountRequest { string user_id = 1; }
message GetUnreadCountResponse { uint32 count = 1; }

message MarkAsReadRequest { string user_id = 1; repeated string notification_ids = 2; }
message MarkAsReadResponse { uint32 unread_count = 1; }

message MarkAllAsReadRequest { string user_id = 1; google.protobuf.Timestamp up_to = 2; }
message MarkAllAsReadResponse { uint32 unread_count = 1; }

message ArchiveNotificationRequest { string user_id = 1; string notification_id = 2; }
message ArchiveNotificationResponse {}

message CategoryPreference {
  string category = 1;
  Channel channel = 2;
  bool enabled = 3;
  bool locked = 4;
}

message GetPreferencesRequest { string user_id = 1; }
message GetPreferencesResponse {
  repeated CategoryPreference preferences = 1;
  string locale = 2;
  string time_zone = 3;
  string quiet_hours_from = 4;
  string quiet_hours_to = 5;
}

message UpdatePreferencesRequest {
  string user_id = 1;
  repeated CategoryPreference preferences = 2;
  optional string locale = 3;
  optional string time_zone = 4;
  optional string quiet_hours_from = 5;
  optional string quiet_hours_to = 6;
}
message UpdatePreferencesResponse { GetPreferencesResponse preferences = 1; }

message UnsubscribeByTokenRequest { string token = 1; }
message UnsubscribeByTokenResponse { string category = 1; }

enum Platform {
  PLATFORM_UNSPECIFIED = 0;
  PLATFORM_IOS = 1;
  PLATFORM_ANDROID = 2;
}

message RegisterPushTokenRequest {
  string user_id = 1;
  string installation_id = 2;
  string expo_token = 3;
  Platform platform = 4;
  string app_version = 5;
  string device_name = 6;
}
message RegisterPushTokenResponse {}

message UnregisterPushTokenRequest { string user_id = 1; string installation_id = 2; }
message UnregisterPushTokenResponse {}

message SendNotificationRequest {
  string idempotency_key = 1;
  string user_id = 2;
  string type = 3;
  google.protobuf.Struct data = 4;
  repeated Channel channels = 5;
}
message SendNotificationResponse { string notification_id = 1; bool duplicate = 2; }

message RealtimeUserEvent {
  string event_id = 1;
  uint32 schema_version = 2;
  string type = 3;
  string user_id = 4;
  google.protobuf.Timestamp occurred_at = 5;
  Notification notification = 6;
  uint32 unread_count = 7;
  repeated string notification_ids = 8;
}
```

`user_id` in user-facing RPCs is always set by the **gateway from the verified access token**, never copied from the client request.

## 2. Public REST routes (API Gateway)

| Method | Route | RPC | Notes |
|---|---|---|---|
| GET | `/api/v1/notifications?limit&cursor&unread&category` | `ListNotifications` | |
| GET | `/api/v1/notifications/unread-count` | `GetUnreadCount` | Cheap, can be polled as a fallback |
| POST | `/api/v1/notifications/read` | `MarkAsRead` | Body `{ "ids": ["..."] }`, max 100 IDs |
| POST | `/api/v1/notifications/read-all` | `MarkAllAsRead` | Body `{ "upTo": "<timestamp>" }` |
| DELETE | `/api/v1/notifications/{id}` | `ArchiveNotification` | Archive, not hard delete |
| GET | `/api/v1/notifications/preferences` | `GetPreferences` | |
| PUT | `/api/v1/notifications/preferences` | `UpdatePreferences` | Locked categories are ignored |
| POST | `/api/v1/devices/push-tokens` | `RegisterPushToken` | Idempotent upsert by `installationId` |
| DELETE | `/api/v1/devices/push-tokens/{installationId}` | `UnregisterPushToken` | |
| GET / POST | `/api/v1/notifications/unsubscribe?token=` | `UnsubscribeByToken` | **Public** (no login). Rate limited by IP |

Example list response:

```json
{
  "data": [
    {
      "id": "a91e...",
      "type": "trade.sold",
      "category": "trading",
      "title": "Energy sold",
      "body": "You sold 5.00 kWh at 0.32 AED/kWh",
      "actionUrl": "/trades/88123",
      "occurredAt": "2026-10-27T09:12:00Z",
      "read": false
    }
  ],
  "nextCursor": "eyJvIjoiMjAyNi0xMC0yN1QwOToxMjowMFoiLCJpIjoiYTkxZSJ9"
}
```

## 3. Internal callers of `SendNotification`

- Callers authenticate with the service-to-service mechanism used across the platform (mTLS or a service token, as decided for Auth Service gRPC).
- Only types listed in an allow-list per calling service are accepted (e.g. Auth Service may only send `account.*`).
- Prefer publishing a domain event over calling this RPC. Use the RPC only when the caller needs a synchronous answer, such as the future Auth email adapter.
