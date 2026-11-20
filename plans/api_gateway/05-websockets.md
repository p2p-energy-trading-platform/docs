---
connie-title: API Gateway - Websockets
---

# WebSocket Plan

## Purpose

WebSockets provide authenticated, server-pushed updates needed by the web and mobile clients. They are not an unrestricted tunnel to internal services.

Potential streams include market updates, order/trade status, device state, wallet events, and notifications. The owning domain service remains the source of truth.

## Endpoint and protocol

Use a versioned endpoint such as:

```text
WSS /api/v1/ws
```

Define a small versioned application protocol with message envelopes:

```json
{
  "type": "subscribe",
  "id": "client-message-id",
  "topic": "orders.self",
  "payload": {}
}
```

Server messages should contain `type`, a correlation/subscription identifier, event version, timestamp, and payload. Validate every inbound message against a schema and reject unknown or oversized message types.

## Authentication

Authenticate before accepting subscriptions. Browser WebSocket APIs cannot freely set an `Authorization` header, so choose and document one of these mechanisms:

1. A very short-lived, single-use WebSocket ticket obtained from an authenticated REST endpoint. This is the preferred default.
2. A secure cookie when the overall browser authentication design uses cookies, with strict origin and CSRF-related controls.
3. A carefully defined subprotocol token mechanism if clients and infrastructure support it safely.

Do not place long-lived bearer tokens in query strings; URLs are commonly captured in logs and telemetry.

For a connection ticket:

- Auth Service or gateway issues it only after access-token verification.
- It expires within roughly 30–60 seconds.
- It is single-use and audience-restricted to the WebSocket endpoint.
- It contains or references the subject and authorized connection context.
- Reuse is rejected through an atomic Redis consume operation.

## Authorization

Authorization occurs both when subscribing and while delivering events:

- Map each topic to required scopes/roles.
- Derive user-specific subjects from verified identity; do not accept arbitrary user IDs from the client.
- Check resource ownership in the owning service when it cannot be safely derived from trusted event metadata.
- Prevent one tenant/user from guessing another user's topic.
- Re-evaluate permission for sensitive long-lived subscriptions when account or role state changes.

## Token expiry and revocation

Choose a clear lifecycle:

- Record the access/session expiry associated with the connection.
- Notify the client shortly before reauthentication is required.
- Prefer obtaining a new short-lived ticket and reconnecting rather than sending refresh tokens over the socket.
- Close the connection when authentication expires and is not renewed.
- Consume account/session revocation events to terminate affected connections when immediate revocation is required.

## Connection management

Define and test:

- Maximum connections per IP, user, and gateway instance.
- Maximum subscriptions per connection and user.
- Maximum inbound/outbound message and frame sizes.
- Inbound message rates and subscription churn limits through Redis.
- Ping/pong interval, idle timeout, and dead-peer detection.
- Maximum outbound queue per connection.
- Slow-consumer policy and close code.
- Graceful shutdown notification and drain period.
- Client reconnection with exponential backoff and jitter.

## Event delivery and scaling

Kafka is the durable event broker for real-time events. The gateway consumes dedicated, versioned client-facing topics rather than publishing raw internal order, trade, wallet, or IoT records directly to WebSocket clients.

> **IoT live data does not use this Kafka path.** PETPG-347 decided that the gateway never consumes Kafka for IoT; live meter data reaches it through a gRPC server stream from iot-ingestion-dispatch. See *IoT live data (PETPG-347)* below.

Example topic separation:

```text
Internal domain topics               Client-facing topics
orders.events.v1          ->         realtime.user-events.v1
trades.events.v1          ->         realtime.market-summary.v1
meter.readings.v1         ->         realtime.device-status.v1
```

The owning service or an event-projection component creates a safe client-facing event. That event should include an event ID, schema version, timestamp, routing key such as user/device ID, event type, and client-safe payload. This prevents the public WebSocket contract from becoming coupled to high-volume or sensitive internal schemas.

Initial local development assumes one gateway instance consuming Kafka. When the gateway is horizontally scaled, the design must account for Kafka delivering a record to only one consumer within a consumer group even though the relevant WebSocket may be connected to another replica. Acceptable later designs include a unique consumer group per gateway instance for modest curated traffic, or a dedicated real-time router that consumes Kafka and fans events out to the correct gateway instances. Redis Streams will not be introduced as a second durable event broker without a separate demonstrated requirement.

The design must state:

- Which service publishes each event.
- Topic naming and access classification.
- At-most-once, at-least-once, or replayable delivery semantics.
- Ordering scope, such as per order or per user.
- Event IDs and deduplication expectations.
- Resume cursor or snapshot/resync procedure after reconnect.
- Backpressure from gateway instances to the broker.

Do not promise reliable delivery unless events are durably stored and replayable. Clients should obtain an authoritative snapshot through REST after connecting/reconnecting, then apply subsequent events.

## IoT live data (PETPG-347)

Decided in the [IoT live data design](../iot/2026-11-12-iot-live-data-design.md), approved by Manimehalan Thiyagarajan on 12 November 2026, and implemented in November 2026. The client-facing protocol is documented in the api-gateway repository at `docs/websocket-protocol.md`.

**Path.** Smart meter → MQTT → Kafka → iot-ingestion-dispatch, which stores the reading and publishes it on Redis pub/sub (`house:{houseId}:live`) only when it becomes the house's latest reading. Each ingestion instance serves `IotService.StreamHouseLive` (gRPC server streaming). Each gateway instance opens **one** upstream stream per house that its clients watch, shared by every socket watching that house, and publishes its events to the `iot.house.<houseId>` WebSocket topic. There is never one gRPC stream per browser.

| Property | Decision |
|---|---|
| Publisher | iot-ingestion-dispatch publishes; the gateway forwards. |
| Client topic | `iot.house.<houseId>`, for the house's owner (an APPROVED meter registration). Ownership is checked with `IotService.GetHouse(owner_user_id)` on every subscribe; an unknown house and someone else's house get the same `TOPIC_NOT_ALLOWED`. |
| Events | `reading` (exactly the `GET …/latest-reading` response), `status` (`online`/`offline` with `lastHeartbeatAt`), `stream-state` (`interrupted`/`live` when the gateway's upstream drops and recovers). |
| Delivery | At most once, best effort. Nothing is stored for replay. |
| Ordering | Per house, by `(measuredAt, seq)`: only a reading newer than the stored latest one is published, and clients ignore anything older than what they hold. |
| Event identity | `meterId:seq` for readings. |
| Resync | After every `subscribed` reply (first connect and every reconnect) and after `stream-state` `live`, the client refetches the latest reading and the house over REST. |
| Backpressure | Latest-wins at each hop (ingestion stream mailbox, gateway upstream); the existing 1 MB slow-client limit protects each socket. |
| Offline detection | The ingestion hub sets a timer for the end of each watched house's 10-minute liveness window and publishes `offline` when the status key is gone. No Redis keyspace notifications. |
| Stream lifetime | The gateway gives each upstream stream a 30-minute deadline and reopens it at once; the server ends streams after 60 minutes. Errors retry with backoff from 1 s to 30 s. An unwatched house's stream closes after a 10-second grace period. |

**Connection lifecycle.** Implemented as this plan recommends:

- Tickets are single use and expire after 30 seconds.
- The browser `Origin` is checked against `CORS_ORIGINS` before the ticket is used.
- Each socket is closed with application code **4001 "Reauthenticate"** after `WS_MAX_CONNECTION_AGE_MS`, which defaults to 15 minutes (the access-token lifetime) with ±10% jitter. The client reconnects at once with a new ticket, which re-checks the login and ownership. A logout or lost ownership therefore stops live data within one token lifetime.

**Extension point.** Features add topics by registering a topic provider (`app.realtime.registerTopicProvider`) with an asynchronous permission check and hooks for a key's first and last local subscriber. The IoT topic is the first provider. Other domains can still choose the Kafka path above.

**Verification.** Unit and integration tests in all three services, plus a real-stack run covering:

- live readings every 5 s with no polling
- one shared upstream for two tabs
- refused foreign houses and foreign origins
- recovery from ingestion, gateway and Redis restarts
- pausing a hidden tab
- grace-period clean-up
- offline detection with the real 10-minute window
- the 4001 reconnect

## Origin and transport security

- Production uses WSS only.
- Validate the browser `Origin` against an environment-specific allowlist.
- Ensure the ingress supports upgrade headers, idle timeouts, and connection draining.
- Sanitize query parameters and headers in access logs.
- Do not enable compression without reviewing resource-exhaustion and data-exposure implications.

## Observability

Measure active connections, connection attempts, authentication failures, close reasons, subscription counts, inbound/outbound message rates, dropped messages, outbound queue depth, event lag, and per-instance saturation. Logs must use user/request identifiers without tokens or sensitive payloads.

## Acceptance scenarios

- Valid user connects, subscribes to an allowed topic, and receives events.
- Invalid, expired, replayed, or wrong-audience ticket is rejected.
- User cannot subscribe to another user's resource.
- Rate-limited connection/message receives the documented response.
- Slow consumer is disconnected without unbounded memory growth.
- Revoked session is disconnected according to policy.
- Instance shutdown drains or closes connections predictably and clients reconnect safely.
