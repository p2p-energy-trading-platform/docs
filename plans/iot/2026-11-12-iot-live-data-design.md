---
connie-title: IoT - Live Data Design (PETPG-347)
---

# IoT live data: design proposal

| | |
|---|---|
| Ticket | PETPG-347: Remaining live data integration between iot service and frontend |
| Author | Hanan Ahmed |
| Reviewer | Manimehalan Thiyagarajan |
| Status | **Approved** by Manimehalan Thiyagarajan on 12 November 2026, with the decisions in [section 12](#12-review-decisions). **Implemented** in November 2026; see [section 13](#13-implementation). |
| Date | 12 November 2026 |
| Repositories | `protobuf`, `iot-ingestion-dispatch`, `api-gateway`, `frontend-web` |

## 1. Summary

Today every IoT view loads its data once: when the page opens, when the period changes, or when the user presses Retry. This proposal adds live updates for the data that changes every few seconds, with no polling.

The ticket asks five questions. Short answers:

1. **Does api-gateway have a proper WebSocket system?** The foundation is good: ticket authentication, heartbeats, limits, slow-client protection, metrics, graceful shutdown and tests. It is not ready for IoT yet. It has one topic (`user.self`), topic checks cannot call other services, nothing publishes events, there is no hook to start or stop an upstream feed, the browser `Origin` is not checked, and sockets outlive the login that opened them. Details in [section 3.1](#31-api-gateway-websocket-system).
2. **How will the frontend handle WebSockets?** One shared connection per browser tab. It gets a ticket, connects, subscribes to the selected house, reconnects with backoff, and validates every message with zod. Live messages are written into the existing TanStack Query cache, so the current components update without changes. REST stays the source of truth: after every (re)connect the client re-reads the latest reading and house status. See [section 6.4](#64-frontend-web).
3. **What must change in the gateway?** Topic providers with async permission checks and first/last-subscriber hooks; an `iot.house.<houseId>` topic; one upstream stream per watched house per gateway instance; an `Origin` check; a 15-minute maximum socket age; HTTP/2 keep-alive on the IoT client; and the missing protocol document. See [section 6.3](#63-api-gateway).
4. **How does live data get from the IoT service to the gateway?** Through a new gRPC server-streaming RPC, `IotService.StreamHouseLive`. Inside the IoT service, readings and status changes are published on Redis pub/sub when they are stored, so every ingestion instance can serve any house. See [sections 6.1](#61-protobuf-contract) and [6.2](#62-iot-ingestion-dispatch).
5. **What live data remains to be mapped?** The latest reading (solar, home use, grid, battery power and SoC), the meter's online/offline status, and today's running totals. See [section 4](#4-live-data-still-to-map).

**Decision: Option C (approved)**, one shared gRPC server stream per watched house, fed by Redis pub/sub inside the IoT service. It follows the ticket's hint and meets the conditions the team's own plans set for live subscriptions: fan-out, replay and backpressure are stated explicitly, and there is never one gRPC stream per browser. The options are compared in [section 5](#5-options-considered).

## 2. Scope

**In scope:** live updates for the Dashboard, the Energy page (Generation & Usage, Assets), the shared header and the Profile page.

**Out of scope:** Trade and Notifications (their frontends are not ready), wallet and order events, DEWA registration status, dispatch/actuation, durable replay of missed events, and the mobile app. The protocol works for mobile, but no mobile work is planned.

**Sources reviewed:** the code in all four repositories plus the simulator and infrastructure (commits in [appendix A](#appendix-a-files-reviewed)), and the team plans `api_gateway/03-grpc.md`, `api_gateway/05-websockets.md`, `iot-ingestion-dispatch/02-redis-hot-storage.md`, `iot-ingestion-dispatch/08-grpc.md` and `api_contracts/api-contracts.md`.

## 3. Current state

### 3.1 api-gateway WebSocket system

Built by Keeththigan in October (`src/plugins/websocket.ts`, `src/websocket/*`, `src/features/websocket/routes.ts`, `src/transport/redis/ws-tickets.ts`), with unit and integration tests.

| Capability | State | Where |
|---|---|---|
| Ticket authentication: `POST /api/v1/ws/ticket` returns a single-use, 30-second ticket, stored hashed in Redis and consumed atomically with `GETDEL` | Done | `features/websocket/routes.ts`, `transport/redis/ws-tickets.ts` |
| Endpoint `GET /api/v1/ws?ticket=…`, rate limited to 20 connections per minute | Done | `plugins/websocket.ts`, `policies/rate-limits.ts` |
| Versioned message envelope (`subscribe`, `unsubscribe` → `subscribed`, `event`, `error`), schema-validated | Done | `websocket/protocol.ts`, `websocket/schemas.ts` |
| Heartbeat ping every 30 s; dead peers terminated | Done | `websocket/heartbeat.ts` |
| Limits: 5 connections per user per instance, 20 subscriptions per connection, 16 KB messages, 5 invalid messages | Done | `policies/websocket.ts` |
| Slow-client protection: closed with 1008 when more than 1 MB is waiting | Done | `websocket/connection.ts` |
| Graceful shutdown: 1001 sent to every client | Done | `plugins/websocket.ts` |
| Metrics: connections, subscriptions, closes by code | Done | `observability/metrics.ts` |
| Topics other than `user.self` | **Missing.** `resolveTopicKey` knows one topic and is synchronous, so it cannot ask the IoT service about ownership. | `websocket/authorization.ts` |
| Event producers | **Missing.** `app.realtime.publish()` exists but nothing calls it. | `types/fastify.d.ts` |
| First-subscriber / last-subscriber hooks to start and stop an upstream feed | **Missing** | `websocket/subscriptions.ts` |
| Browser `Origin` check on the upgrade (required by `05-websockets.md`) | **Missing** | `plugins/websocket.ts` |
| Session expiry: the ticket is checked once, so a socket outlives the 15-minute access token (`AUTH_ACCESS_TOKEN_TTL_SECONDS=900`) and a logout | **Missing** | `plugins/websocket.ts` |
| Cross-instance delivery: `publish()` reaches only that instance's sockets | By design. This is fine for IoT if each instance opens its own upstream feed. | `websocket/subscriptions.ts` |
| Protocol documentation: the README lists `docs/websocket-protocol.md`, but the file does not exist | **Missing** | `README.md` |

Two more facts shape the design:

- **Plugin order:** the WebSocket plugin is registered before the gRPC clients (`src/app.ts`), so an IoT permission check must be registered later, from the IoT feature.
- **Topic length:** topics are capped at 100 characters (`websocket/schemas.ts`), while house IDs may be up to 100 characters (`^[A-Za-z0-9._:-]{1,100}$`). The cap needs raising for `iot.house.<id>`.

### 3.2 api-gateway gRPC client

- **Client:** `@connectrpc/connect` 2.2.0 over HTTP/2 (`createGrpcTransport`). Server streams arrive as async iterables; no new library is needed.
- **Keep-alive:** none configured (`src/plugins/grpc.ts`). The installed version supports `pingIntervalMs`, `pingTimeoutMs`, `pingIdleConnection` and `idleConnectionTimeoutMs`.
- **Unary calls:** use deadlines from `transport/grpc/deadlines.ts` and pass `ownerUserId` from the access token, never from the client (`features/iot/handler.ts`).
- **Ownership:** `GetHouse` with an owner returns NOT_FOUND for another user's house, so it can serve as the subscription permission check.
- **Header propagation** reads the request context. A shared upstream stream has no request, so it carries no user headers. That is correct, because it is not scoped to one user.

### 3.3 iot-ingestion-dispatch

- **gRPC server:** grpc-go 1.85 (`internal/transport/grpc/server.go`) with **unary interceptors only** (recovery, logging), no keep-alive settings and no stream limit. `GracefulStop` waits for open RPCs, so long-lived streams would always hit the 5-second force-stop.
- **Layering:** handlers only convert types; validation and ownership live in `internal/query/service.go`. An empty `owner_user_id` means no ownership check (service-to-service), as documented in `iot.proto`.
- **Data path:** MQTT → Kafka → consumer → Postgres (history) → Redis. `SetLatestIfNewer` (Lua script `set_latest_if_newer.lua`) stores a reading only when it is newer and **reports whether it did**. That is a precise point to publish from (`internal/ingestion/meter_handler.go`). Kafka replays call it too, but only newer readings are applied.
- **Meter status:** the `update_heartbeat.lua` script writes `house:{id}:status` with a 10-minute TTL. Going offline means the key expires; **there is no offline event**. Redis runs the stock `redis:7-alpine` config, so keyspace notifications are off.
- **Redis failures** never block ingestion; they are absorbed by the configured cache policy (`absorbCacheError`). Live publishing must behave the same way.
- **Several instances** share the Kafka partitions, so the instance that consumed a house's reading is not necessarily the one serving that house's stream. A shared channel (Redis pub/sub) is needed between them.
- **Shutdown order:** mark not ready → stop Kafka → `grpc.Stop()` (`internal/app/shutdown.go`).

### 3.4 protobuf and the SDKs

- **No streaming RPC exists anywhere** in the platform's protos yet. This would be the first.
- **Lint and compatibility:** Buf `STANDARD` lint allows server streaming, provided the messages are named `<Rpc>Request` and `<Rpc>Response`. Breaking-change checks run at `FILE` level, and adding an RPC is not breaking.
- **Releases:** a `feat:` commit leads to a Release Please PR, then a tag; `generate-sdks.yml` publishes `go-sdk` and `typescript-sdk` with the same tag.
- **Versions:** protobuf is at **v1.23.0**; the gateway and ingestion pin SDK **v1.18.0**.

### 3.5 frontend-web

- **No WebSocket code.** This work starts from scratch.
- **Data:** TanStack Query with keys `['iot','houses']`, `['iot','house',id]`, `['iot','latest-reading',id]`, `['iot','energy-series',id,range]` and `['iot','energy-summary',id,range]` (`src/features/iot/hooks.ts`). The selected house is kept in zustand.
- **API client:** `apiRequest` sends cookies and refreshes an expired token once on a 401 (`src/lib/api-client/client.ts`), so requesting a socket ticket through it gets token refresh for free.
- **Global errors:** the query client shows a "Cannot reach the server" toast on network errors. Socket drops must not trigger it.
- **Mount point:** `src/routes/_authenticated.tsx` already resolves the selected house for every signed-in page; it is the natural place for one live subscription.
- **Testing:** Playwright 1.64.1 supports `page.routeWebSocket`, so e2e tests can mock the socket like `MockApi` mocks REST.

### 3.6 Load profile (simulator)

- **Cadence:** one reading every **5 s** and one heartbeat every **60 s** per house; **120 houses**.
- **Rates:** a watched house produces 0.2 messages per second; if every house were watched, 24 per second.
- **Size:** a reading is about 350 bytes of JSON.

## 4. Live data still to map

| # | Data | Where it shows | Today | Proposed | Rate |
|---|---|---|---|---|---|
| 1 | Latest reading: solar, home use, net/grid, battery power and SoC | Dashboard: Live energy flow, Solar PV and Home Battery cards, Battery SoC tile, current-slot export kW, "Meter sync" time. Energy → Assets: solar, battery and EV cards ("Updated …") | `GET …/latest-reading` on page load | `reading` event replaces the cached reading | Every 5 s per house |
| 2 | Meter online/offline and last heartbeat | Header badge, Profile → Smart meter, asset card status | `GET /iot/houses` on page load | `status` event when it changes | On change |
| 3 | Today's totals: energy position, KPIs, energy balance, peak demand, the current chart bucket, the forecast's "actual" line | Dashboard; Energy page when the period includes now | `GET …/energy-summary`, `…/energy-series` on load | Not pushed. Refetched at most once a minute while readings arrive, only for queries whose range includes now | At most once a minute |
| 4 | Asset definitions (capacity, V2G) | Device and asset cards | `GET /iot/houses/{id}` | Stays as it is; rarely changes | — |

**Not mapped:** cards still on sample data (forecast curve, usage by category, insights, savings, export earnings, charger and flexible-load cards), Trade, Notifications, wallet, and registration status. Registration status could later use the existing `user.self` topic.

## 5. Options considered

| | Option | For | Against | Verdict |
|---|---|---|---|---|
| A | Frontend polling | Simplest | Load grows with users rather than activity, data still lags, and the team ruled it out | Rejected |
| B | Kafka "client-facing" topic consumed by the gateway (the original plan in `05-websockets.md`) | Durable and replayable; one pattern for every domain | The gateway processes every reading of every house even if nobody watches; replicas need a per-instance consumer group or a router (open in that plan); needs a new projector service; ownership still needs the IoT service | Rejected: the gateway does not consume Kafka |
| **C** | **gRPC server stream from the IoT service, one shared stream per watched house per gateway instance** | Runs only while someone watches; reuses the gRPC client, SDKs and ownership logic; stated fan-out and backpressure; matches the ticket | No replay. Missed events are covered by a REST resync, which `05-websockets.md` requires anyway | **Recommended** |
| D | Gateway subscribes to the IoT service's Redis directly | Few moving parts | Couples the gateway to another service's internal storage, which breaks service ownership | Rejected |
| E | Server-Sent Events instead of WebSockets | Simple one-way push | The gateway already has WebSocket infrastructure; this would add a second mechanism | Rejected |

The reviewer decided that **api-gateway must not consume Kafka** ("avoid mixing Kafka with api-gateway"). This replaces the Kafka-first approach in `05-websockets.md`, which step 6 of the plan updates. Option C fits telemetry that is high-frequency, short-lived and per house, where only the latest value matters. It also meets the conditions in `iot-ingestion-dispatch/08-grpc.md` ("fan-out, replay, and backpressure requirements" must be known) and `api_gateway/03-grpc.md` ("Do not automatically map a gRPC stream one-to-one to each browser WebSocket").

## 6. Proposed design

### Architecture

```text
 Smart meter          iot-ingestion-dispatch                      api-gateway                         frontend-web
 (simulator)
   MQTT -> Kafka -> consumer -> Postgres (history)
                        |
                        +-> Redis SetLatestIfNewer ------+
                        |   (only if newer)              |  PUBLISH house:{id}:live
                        +-> Redis heartbeat -------------+  (only when stored / on status change)
                            (online transition)          |
                                                         v
                     LiveHub: 1 Redis subscriber per instance, fan-out, latest-wins,
                              offline timer per watched house
                                                         |
                     StreamHouseLive (gRPC server stream) ===> LiveHouseHub: 1 stream per
                                                               house per gateway instance
                                                                         |  realtime.publish
                                                               /api/v1/ws, topic iot.house.{id} ===> RealtimeClient
                                                               (ownership checked on subscribe)       -> TanStack Query cache
                                                                                                      -> Dashboard, Energy,
                                                                                                         Header, Profile
```

### Delivery guarantees

`05-websockets.md` asks every design to state these.

| Property | Decision |
|---|---|
| Publisher | iot-ingestion-dispatch publishes; the gateway forwards. |
| Client topic | `iot.house.<houseId>`, readable by users who own the house (an APPROVED meter registration). Checked with `IotService.GetHouse(owner_user_id)` on subscribe. |
| Delivery | At most once, best effort. Nothing is stored for replay. |
| Ordering | Per house, by `(measuredAt, seq)`. Guaranteed upstream by `SetLatestIfNewer`. The client also ignores anything older than what it holds. |
| Event identity | `meterId:seq` for readings. |
| Resync | After every `subscribed` acknowledgement, which covers the first connect and reconnects, the client refetches the latest reading and house status over REST. |
| Backpressure | Latest-wins conflation at every hop (ingestion hub, gateway upstream). The browser socket keeps the existing 1 MB slow-client limit. |
| Stream lifetime | The gateway gives each stream a 30-minute deadline and reopens it at once. The server also enforces a 60-minute maximum, so no call runs forever (`03-grpc.md`). |

### 6.1 protobuf contract

The change is additive in `proto/gridx/iot/v1/iot.proto`. Commit `feat(iot): add StreamHouseLive server-streaming RPC`, released as **v1.25.0** (v1.24.0 was taken by an unrelated release).

```protobuf
service IotService {
  // ... existing unary RPCs ...

  // Streams live updates for one house: first the current status and latest
  // reading (if any), then each newer reading and every meter status change.
  // Delivery is best effort with no replay; callers resync over the unary RPCs.
  // The server ends the stream after its maximum age; callers reopen it.
  rpc StreamHouseLive(StreamHouseLiveRequest) returns (stream StreamHouseLiveResponse);
}

message StreamHouseLiveRequest {
  string house_id = 1;
  // Optional. When set, the house must belong to this user (NOT_FOUND
  // otherwise). The gateway leaves it empty for its shared per-house stream
  // and checks ownership when each user subscribes.
  string owner_user_id = 2;
}

message StreamHouseLiveResponse {
  oneof event {
    MeterReading reading = 1;
    MeterStatusUpdate status = 2;
  }
}

message MeterStatusUpdate {
  MeterStatus meter_status = 1;
  // Unset when offline.
  google.protobuf.Timestamp last_heartbeat_at = 2;
}
```

Errors: `INVALID_ARGUMENT` (bad ID), `NOT_FOUND` (unknown house, or not owned when an owner is given), `UNAVAILABLE` (Redis down or the server shutting down), `DEADLINE_EXCEEDED` (normal end of a stream's life).

### 6.2 iot-ingestion-dispatch

**Publishing**, in a new package `internal/live`:

- **Readings:** after `SetLatestIfNewer` returns `applied == true` in `meter_handler.go`, publish `{"v":1,"type":"reading",…}` to channel `house:{house_id}:live`. The channel follows the existing key naming. Publishing happens in Go rather than inside the Lua script, so the `redis-rebuild` command, which reuses the script, does not flood subscribers.
- **Status:** `update_heartbeat.lua` returns whether the status key was absent or held a different status. When it was, `heartbeat_handler.go` publishes `{"v":1,"type":"status","status":"online","last_heartbeat_at":…}`.
- **Failures are best effort:** publish errors are counted and logged at debug level, and never fail ingestion or hold a Kafka offset. This matches `absorbCacheError`.
- **The payload is an internal format.** It is not the external wire format, as `02-redis-hot-storage.md` requires for Redis values.

**LiveHub**, one per process:

- **One Redis pub/sub connection per instance.** Channels are subscribed when a house gets its first local stream and unsubscribed after the last one ends.
- **Fan-out:** each stream has a latest-wins mailbox, so a slow stream skips readings rather than queueing them.
- **Offline detection without Redis changes:** for each watched house, a timer fires at `last_heartbeat_at + 10 min`. When it fires, the hub reads `house:{id}:status`: if the key is gone, it sends `offline` to its local streams; otherwise it reschedules. That costs about one Redis read per watched house every 10 minutes. The alternative, Redis keyspace notifications, needs a Redis config change and is fire-and-forget (open question 3).

**StreamHouseLive handler:**

1. Validate the ID and check ownership through `query.Service.GetHouse(houseID, ownerUserID)`. An empty owner skips the check.
2. Register with the hub, then send the snapshot: the status, then the latest reading if one exists.
3. Forward mailbox events until the client cancels, the 60-minute server maximum passes, or the hub closes.

**gRPC server changes** in `server.go`:

- Add `grpc.ChainStreamInterceptor(StreamServerRecovery, StreamServerLogger)`, mirroring the unary ones.
- Add `grpc.KeepaliveEnforcementPolicy{MinTime: 20s}`. grpc-go's default `MinTime` is 5 minutes, which would reject a client that pings every 30 s with `too_many_pings`.
- Add `grpc.KeepaliveParams{Time: 2m, Timeout: 20s}` and `grpc.MaxConcurrentStreams(1000)`.

**Shutdown:** call `liveHub.Close()` just before `grpc.Stop()`. Open streams then end with `UNAVAILABLE` and the gateway reconnects to a healthy instance immediately.

**Configuration:** `LIVE_ENABLED` (default `true`), `LIVE_STREAM_MAX_AGE` (`60m`), `GRPC_MAX_CONCURRENT_STREAMS` (`1000`), `GRPC_KEEPALIVE_MIN_TIME` (`20s`).

**Metrics:**

- `iot_live_streams` (gauge)
- `iot_live_events_published_total{type}`
- `iot_live_publish_errors_total`
- `iot_live_events_conflated_total`
- `iot_live_offline_detected_total`

### 6.3 api-gateway

**A. WebSocket module.** These are small, additive changes to Keeththigan's module, in their own PR.

- **Topic providers.** Features register providers without touching the plugin:

  ```ts
  export interface TopicProvider {
    /** True if this provider handles the client-facing topic. */
    matches(topic: string): boolean;
    /** Resolves to the internal key if the user may subscribe, otherwise null. */
    authorize(topic: string, user: WebsocketUser): Promise<string | null>;
    /** Called when a key gets its first local subscriber, and when its last one leaves. */
    onActive?(key: string): void;
    onIdle?(key: string): void;
  }
  // app.realtime.registerTopicProvider(provider)
  ```

  `user.self` keeps its current synchronous path.
- **Async subscribe.** `SubscriptionManager.subscribe` becomes async. Messages on one connection are handled in order (a per-connection promise chain), so replies keep their order. If the socket closed while a check was pending, the result is dropped.
- **New protocol errors:** `TOPIC_UNAVAILABLE` (the check could not run; try again later). `TOPIC_NOT_ALLOWED` is unchanged, and the same reply is used for an unknown house and someone else's house, so users cannot probe which IDs exist.
- **Origin check:** in the `/api/v1/ws` preHandler, an `Origin` header that is not in `CORS_ORIGINS` is refused with 403, before the ticket is used. Clients that send no `Origin`, such as mobile apps, are allowed; the ticket still applies.
- **Maximum socket age:** `maxConnectionAgeMs` defaults to 15 minutes (the access-token lifetime), with ±10% jitter. The existing heartbeat loop closes older sockets with a new close code, **4001 "Reauthenticate"**. The client reconnects with a fresh ticket, which re-checks the login and ownership.
- **Topic length:** raise the topic cap from 100 to 120 characters.
- **Documentation:** write `docs/websocket-protocol.md` (envelope, topics, errors, close codes, reconnect guidance).

**B. IoT live topic** (`src/features/iot/live.ts`, registered from `registerIotRoutes`, after the gRPC plugin):

- **Topic:** `iot.house.<houseId>`, using the same ID pattern as the REST routes. The internal key equals the topic, so several users watching one house share a feed.
- **authorize:** calls `grpcClients.iot.getHouse({ houseId, ownerUserId: user.userId })` with the existing 3-second deadline. NOT_FOUND gives `null` (`TOPIC_NOT_ALLOWED`); UNAVAILABLE gives `TOPIC_UNAVAILABLE`.
- **onActive:** opens `streamHouseLive({ houseId })` with an `AbortSignal` and a 30-minute timeout.
  - Each message is mapped with the existing mapper and sent as `realtime.publish(key, 'reading' | 'status', payload)`. Reuse means splitting `mapMeterReading` out of `mapLatestReadingResponse`.
  - A normal end (the deadline) reopens the stream at once. Errors retry with backoff from 1 s to 30 s with jitter, publishing `stream-state {state: 'interrupted'}`, and `stream-state {state: 'live'}` once a stream is open again.
- **onIdle:** closes the stream after a 10-second grace period, so brief unsubscribe/resubscribe cycles don't restart it.
- **Keep-alive** on the IoT transport: `pingIntervalMs: 30_000`, `pingTimeoutMs: 10_000`.
- **Metrics:**
  - `gateway_iot_live_upstreams` (gauge)
  - `gateway_iot_live_upstream_restarts_total{reason}`
  - `gateway_ws_events_total{topic_type,event}`
- **Configuration:** `WS_MAX_CONNECTION_AGE_MS`, `IOT_LIVE_STREAM_TIMEOUT_MS`, `IOT_LIVE_IDLE_GRACE_MS`.

**C. Message examples.** The `reading` payload has exactly the same shape as `GET /api/v1/iot/houses/{id}/latest-reading`.

```json
{ "type": "subscribe", "id": "c1", "topic": "iot.house.grid01-house0003" }

{ "type": "subscribed", "id": "c1", "topic": "iot.house.grid01-house0003",
  "version": 1, "timestamp": "2026-11-12T09:30:00.000Z" }

{ "type": "event", "topic": "iot.house.grid01-house0003", "event": "reading",
  "version": 1, "timestamp": "2026-11-12T09:30:05.120Z",
  "payload": {
    "meterId": "meter-grid01-house0003", "measuredAt": "2026-11-12T09:30:05.000Z",
    "seq": 4182, "solarKw": 1.42, "consumptionKw": 0.86, "netKw": 0.31,
    "storageAssets": [
      { "assetId": "bat-grid01-house0003", "assetType": "bess",
        "socPct": 63, "powerKw": 0.25, "capacityKwh": 5.16 }
    ]
  } }

{ "type": "event", "topic": "iot.house.grid01-house0003", "event": "status",
  "version": 1, "timestamp": "2026-11-12T09:41:00.000Z",
  "payload": { "meterStatus": "offline" } }

{ "type": "error", "id": "c2", "code": "TOPIC_NOT_ALLOWED",
  "message": "You cannot subscribe to this topic.", "timestamp": "…" }
```

| Close code | Meaning | Client action |
|---|---|---|
| 1000 | Normal close | Reconnect only if still needed |
| 1001 | Gateway shutting down | Reconnect with backoff |
| 1006 | Connection lost | Reconnect with backoff |
| 1008 | Policy (slow client, invalid messages) | Reconnect with a longer backoff |
| 1009 | Message too big | Do not resend; report |
| **4001** | **Reauthenticate (new)** | Reconnect at once with a new ticket |

### 6.4 frontend-web

| File | Purpose |
|---|---|
| `src/lib/realtime/client.ts` | `RealtimeClient`, framework-free. Gets a ticket via `apiRequest('/api/v1/ws/ticket', { method: 'POST' })` and connects to `ws(s)://<VITE_API_BASE_URL>/api/v1/ws?ticket=…`. Counts subscribers per topic and resubscribes after reconnecting. Backs off from 1 s to 30 s with full jitter; on HTTP 429 it waits for `Retry-After`. Stops on logout or when the ticket request returns 401 after refresh. |
| `src/lib/realtime/schemas.ts` | zod schemas for `subscribed`, `unsubscribed`, `event` and `error`. Invalid messages are ignored and logged. |
| `src/lib/realtime/store.ts` | zustand connection state (`idle`, `connecting`, `live`, `reconnecting`, `offline`) for UI labels. |
| `src/lib/realtime/use-topic.ts` | `useRealtimeTopic(topic, onEvent)`: subscribes while mounted, unsubscribes on unmount. |
| `src/features/iot/live.ts` | `useLiveHouse(houseId)` plus pure, unit-tested helpers `applyLiveReading` and `applyLiveStatus`. |
| `src/routes/_authenticated.tsx` | One call: `useLiveHouse(house?.houseId)`. This covers the Dashboard, Energy, header and Profile. |

What `useLiveHouse` does with each event:

| Event | Action |
|---|---|
| `reading` | Validate with zod; ignore it if not newer than the cached reading (same rule as `SetLatestIfNewer`); otherwise `setQueryData(['iot','latest-reading',id])`. Components re-render on their own, and "Updated just now" stays correct because `dataUpdatedAt` changes. |
| `status` | Update `meterStatus` and `lastHeartbeatAt` in `['iot','houses']` and `['iot','house',id]`. |
| `reading`, throttled | At most once a minute, invalidate `energy-summary` and `energy-series` for this house, only for queries whose range includes now and that are on screen. |
| `subscribed` | Invalidate `latest-reading` and `houses` for a REST resync. This covers the first connect and every reconnect. |
| `stream-state` | Shown by the "Live energy flow" badge: "Live", "Reconnecting" or "Paused" (today it shows a fixed "Now"). |

Other behaviour:

- **Hidden tab:** close the socket after 60 s in the background; reconnect and resync when the tab is visible again.
- **No toasts:** socket problems never use the global error toast; only the badge changes.
- **No polling** anywhere. If the socket can't connect, the app behaves exactly as it does today.
- **Rollout flag:** `VITE_REALTIME_ENABLED` (default `true`) for a staged rollout.

## 7. Security

- **Authentication:** the existing single-use ticket, plus the new `Origin` check. The topic carries a house ID, never a user ID.
- **Authorization:**
  - Ownership is checked by the IoT service on every subscribe, and again implicitly on every reconnect.
  - The maximum socket age limits how long a revoked login or ownership keeps receiving data: 15 minutes at most (open question 4).
  - The shared upstream stream carries no user identity; ownership is enforced at the gateway edge. That is the same trust model as `owner_user_id` today.
- **Data:** payloads are the same client-safe shapes as REST; internal Redis JSON is never forwarded.
- **Abuse limits:** existing limits on connections, subscriptions and message size, plus the slow-client limit. Subscribing to many houses is capped at 20 per connection.

## 8. Scalability and performance

| Item | Estimate |
|---|---|
| Messages per watched house | 0.2 per second (every 5 s), plus rare status changes |
| All 120 simulated houses watched | 24 messages per second from ingestion; trivial for Redis and the gateway |
| Redis | One `PUBLISH` per stored reading, cheap even with no subscriber (120 houses: 24/s; 10,000 houses: 2,000/s, well within Redis capacity) |
| Ingestion | One extra Redis connection per instance; one goroutine per open stream |
| Gateway → IoT | Upstream streams ≤ watched houses × gateway instances, multiplexed on one HTTP/2 connection per instance (limit 1,000 streams) |
| Gateway → browsers | Readings for a house × the sockets watching it; about 350 bytes each |
| Browser | One socket per tab; about 70 bytes per second per watched house |

## 9. Failure handling

| Failure | Effect | Recovery |
|---|---|---|
| Browser network drop | Socket closes (1006) | Reconnect with backoff, new ticket, resubscribe, REST resync |
| Gateway restart or deploy | 1001 to every client | Same as above |
| Ingestion restart or deploy | Upstream streams end (`UNAVAILABLE`); badge shows "Reconnecting" | Gateway reopens on another instance (first retry after about 1 s) |
| Redis pub/sub unavailable | No live events; publish errors counted | go-redis reconnects; REST still works; live resumes on its own |
| IoT service down | Upstream retries capped at 30 s | Existing error states and Retry buttons, as today |
| Slow browser | Closed with 1008 after 1 MB waits | Reconnect with a longer backoff |
| Access token expires | Socket closed at its maximum age (4001) | New ticket; `apiRequest` refreshes the token |
| User logs out | Frontend closes the socket | None needed |
| Kafka lag or replay | Only newer readings are published | None needed |

## 10. Testing

| Repo | Unit tests | Integration and e2e tests |
|---|---|---|
| protobuf | — | Existing `buf lint` and `buf breaking` in `validate.yml` |
| iot-ingestion-dispatch | Hub fan-out and conflation; offline timer with a fake clock; handler errors; stream interceptors | Real Redis: publish only when the reading is applied; status transition detection. `bufconn` stream test: snapshot, events, max age, shutdown ends streams. |
| api-gateway | Topic provider registry; async subscribe order; close during a pending check; active/idle hooks; Origin check; maximum age close | Existing WebSocket suite extended with a fake `IotService` (Connect `createRouterTransport`): subscribe allowed or refused, events forwarded, upstream restart, grace period |
| frontend-web | `RealtimeClient` with a fake WebSocket and fake timers (backoff, resubscribe, close codes, bad messages); `applyLiveReading` and `applyLiveStatus`; throttled invalidation | Playwright `page.routeWebSocket`: Live energy flow updates without reload; header flips to "Meter offline"; reconnect after a server close |
| End to end | — | The PETPG-278 real-stack check extended to live updates: values change within about 5 s with no reload; pausing the simulator triggers offline detection |

## 11. Implementation plan

Each step is its own PR, reviewed by Manimehalan Thiyagarajan. Estimates are rough.

| Step | Repo and branch | Work | Size | Depends on |
|---|---|---|---|---|
| 1 | `protobuf` `feat/iot-live-stream` | RPC and messages; lint and breaking checks pass; release v1.25.0 publishes the SDKs | S, about 0.5 day | Approval |
| 2 | `api-gateway` `feat/websocket-topic-providers` | Section 6.3A: topic providers, async subscribe, Origin check, maximum socket age, topic length, protocol doc, tests | M, about 1.5 days | Approval only |
| 3 | `iot-ingestion-dispatch` `feat/live-house-stream` | SDK bump to v1.25.0, publishing, heartbeat script change, LiveHub, stream handler, interceptors, keep-alive, shutdown order, metrics, tests | L, about 3 days | Step 1 |
| 4 | `api-gateway` `feat/iot-live-topic` | SDK bump to v1.25.0, IoT topic provider, upstream feed, keep-alive, metrics, tests | M, about 1.5 days | Steps 1 and 2 |
| 5 | `frontend-web` `feat/iot-live-updates` | Section 6.4, unit and e2e tests | M, about 2 days | Contract only (can start in parallel against mocks) |
| 6 | All | Real-stack verification, then update `05-websockets.md` and `08-grpc.md` to record the decision | S, about 1 day | Steps 3–5 |

In total, about 9–10 working days. Steps 2 and 5 can start as soon as this design is approved.

## 12. Review decisions

Answers from Manimehalan Thiyagarajan, 12 November 2026.

| # | Question | Decision | Effect on the design |
|---|---|---|---|
| 1 | gRPC server streaming (Option C) instead of Kafka? | **Yes.** Avoid mixing Kafka with api-gateway. | Option C is the design. The gateway does not consume Kafka; `05-websockets.md` is updated in step 6. |
| 2 | Topic name `iot.house.<houseId>`? | **Fine.** A user has only one smart meter, and every house is identified by its smart meter. | Topic unchanged. The frontend subscribes to the user's one house. See the finding in [section 12.1](#121-finding-one-smart-meter-per-user-is-not-enforced). |
| 3 | Offline detection: timer in the IoT stream, or Redis keyspace notifications? | **Timer.** No keyspace notifications. | As designed in section 6.2. |
| 4 | 15-minute maximum socket age with close code 4001? | **Yes.** | As designed in section 6.3. |
| 5 | Today's totals refreshed at most once a minute over REST? | **Yes.** | As designed in section 6.4. |
| 6 | Keep-alive: gateway ping 30 s / 10 s timeout, server `MinTime` 20 s? | **Yes.** | As designed in sections 6.2 and 6.3. |
| 7 | Who reviews changes to shared code? | **Manimehalan Thiyagarajan** reviews all of it. | Applies to every PR in section 11. |
| 8 | SDK bump from v1.18.0 to v1.24.0? | **Yes.** | Steps 3 and 4 bump the SDK (to v1.25.0, which carries the new RPC). |

### 12.1 Finding: one smart meter per user is not enforced

Checked in `iot-ingestion-dispatch` (`d762138`) and `api-gateway` (`6c96266`):

| Rule | Enforced? | Where |
|---|---|---|
| A house is identified by its smart meter (one meter per house) | Yes | Unique index `uq_houses_meter_id` (migration 00009) |
| A meter has at most one approved owner | Yes | Partial unique index `unique_approved_primary_owner` (migration 0012) |
| A user has at most one smart meter | **No** | Nothing checks it |

- **Claims never check the user.** `InitiateMeterClaim` → `registration.Service.RegisterHouse` saves a new registration with a new `registration_id` for any meter, without checking whether the user already has a pending or approved one.
- **Claims aren't limited to signup.** `POST /api/v1/registration/claim` can be called by a signed-in user at any time; only the frontend limits the smart-meter step to signup.
- **Two lookups disagree.** If a user gets a second meter approved, `ListHouses` (`house_reader.go`) returns both houses, while `GetRegistrationByUserID` (`ORDER BY created_at DESC LIMIT 1`) silently returns only the newest.

This does not block the live-data design: the topic carries the house ID, so it works either way. To make the rule real, the registration flow (owned by the DEWA work) would need:

1. a check in `RegisterHouse` that rejects a claim with `ALREADY_EXISTS` (HTTP 409 at the gateway) when the user already has a `DEWA_APPROVAL_PENDING` or `APPROVED` `PRIMARY_OWNER` registration
2. a partial unique index on `meter_registrations (user_id) WHERE role = 'PRIMARY_OWNER' AND approval_status IN ('DEWA_APPROVAL_PENDING', 'APPROVED')`, so the database guarantees it

> **Resolved in PETPG-348, with one change from the recommendation above.** Mani's review ruled that a pending claim is not ownership: anyone can type a meter number, and DEWA approval can fail or never happen. So only an **APPROVED** primary-owner registration blocks a new claim (`ALREADY_EXISTS`, HTTP 409), and the partial unique index (migration 00013) covers `approval_status = 'APPROVED'` only. Pending, rejected and expired claims never block anyone. Registration IDs are new for every request, so they are not used to recognise repeat requests.

## 13. Implementation

Implemented as designed in the six steps of [section 11](#11-implementation-plan):

| Step | Repository | What shipped |
|---|---|---|
| 1 | `protobuf` | `StreamHouseLive` and `MeterStatusUpdate`, released as **v1.25.0** (v1.24.0 was taken by an unrelated release) |
| 2 | `api-gateway` | Topic providers, async subscribe, `TOPIC_UNAVAILABLE`, Origin check, 4001 maximum socket age, 120-character topics, `docs/websocket-protocol.md` |
| 3 | `iot-ingestion-dispatch` | Publishing, the live hub, `StreamHouseLive`, stream interceptors, keepalive, stream limit, shutdown order |
| 4 | `api-gateway` | The `iot.house.<houseId>` topic with one shared upstream per watched house |
| 5 | `frontend-web` | `RealtimeClient`, `useLiveHouse`, and the Live / Connecting / Reconnecting / Paused badge |
| 6 | All | Real-stack verification, and this record in `05-websockets.md` and `08-grpc.md` |

**Differences from the design:**

- **Maximum socket age.** Each connection gets its own timer instead of a check in the 30-second heartbeat loop, so it closes on time rather than up to 30 s late.
- **Changed in code review (Mani, 21 November 2026), for iot-ingestion-dispatch:**
  - **No metrics.** Metrics wait for a proper metrics plan, so none were added. Failed publishes are logged as warnings instead of counted.
  - **No kill switch.** `LIVE_ENABLED` was removed; live updates are always on.
  - **No event version.** The Redis event is private to the service, so it carries no version field: `{"type": …}`.
- **Status events.** A status event is published only when a house goes from offline to online. Online and offline are defined by whether the status key exists, so no other change is visible to clients.
- **Paused state.** The frontend has a `paused` socket state for a hidden tab, so the badge reads "Paused" instead of looking like a failure.

**Real-stack verification (21 November 2026).** Simulator, ingestion, gateway and frontend were run against real Kafka, TimescaleDB and Redis, with a signed-in browser:

| Scenario | Result |
|---|---|
| Live readings | One every 5.0 s, no reload, no REST polling; today's totals refreshed once a minute |
| Two tabs | One shared upstream stream |
| Someone else's house, an unknown house, a bad ID | All `TOPIC_NOT_ALLOWED` |
| Foreign `Origin` | 403 |
| Ingestion restart | "Reconnecting", then live again about 2.5 s after it returned |
| Gateway restart | The browser reconnects by itself |
| Redis restart | Readings resume within 9 s |
| Hidden tab | Paused after 60 s, upstreams released, resumes when visible |
| Closed tab | Upstreams closed after the 10 s grace period |
| Simulator stopped | Offline event 10 min 3 s after the last heartbeat, no reload; back online 1 s after restart |
| Maximum socket age (shortened to 60 s) | Reconnects every 55–62 s with 4001 and a new ticket |

**Two flaws found during verification and fixed before review:**

- **Redis calls under the hub lock.** The hub called Redis while holding its lock, so a slow Redis could pause every house's events. Redis calls now run outside the lock, and a separate lock keeps subscribes and unsubscribes in order.
- **Misleading shutdown warnings.** Normal shutdowns logged `UNAVAILABLE` stream endings as warnings; they now log at INFO.

## Appendix A: files reviewed

| Repository | Commit | Files |
|---|---|---|
| api-gateway | `6c96266` (origin/main, 8 Nov) | `src/app.ts`, `src/plugins/{websocket,grpc,authentication,csrf,redis}.ts`, `src/websocket/{authorization,connection,heartbeat,protocol,schemas,subscriptions}.ts`, `src/features/websocket/routes.ts`, `src/transport/redis/{client,ws-tickets}.ts`, `src/transport/grpc/{clients/iot-client,deadlines,errors,metadata}.ts`, `src/features/iot/{routes,handler,mapper,schemas}.ts`, `src/policies/{websocket,rate-limits}.ts`, `src/observability/metrics.ts`, `src/types/fastify.d.ts`, `src/config/schema.ts`, `tests/{integration,unit/websocket}/websocket.test.ts`, `README.md`, installed `@connectrpc/connect-node` 2.2.0 types |
| iot-ingestion-dispatch | `d762138` (main, 10 Nov) | `internal/transport/grpc/{server,interceptors}.go`, `internal/transport/grpc/services/iot_handler.go`, `internal/query/service.go`, `internal/store/redis/{latest,heartbeat,keys,client}.go`, `internal/store/redis/scripts/*.lua`, `internal/ingestion/{meter_handler,heartbeat_handler}.go`, `internal/app/{app,loop,shutdown}.go`, `internal/config/validate.go`, `go.mod` |
| protobuf | `bd748d7` (origin/main, v1.23.0) | `proto/gridx/iot/v1/iot.proto`, `buf.yaml`, `buf.gen.yaml`, `.github/workflows/{generate-sdks,release-please}.yml`, `README.md` |
| frontend-web | `7cc3430` (origin/main, 8 Nov) | `src/lib/api-client/client.ts`, `src/lib/query-client.ts`, `src/env.ts`, `src/features/iot/{hooks,api,selected-house-store}.ts`, `src/routes/_authenticated.tsx`, `src/components/dashboard/LiveEnergyFlowCard.tsx`, `package.json`, `e2e/fixtures.ts` |
| auth-service | `8aba85d` (origin/main) | `.env.example`, `src/config/schema.ts` (access-token lifetime) |
| iot-simulation | `9fab603` (main) | `src/scheduler/tickLoop.ts`, `src/index.ts`, `config/grids.yaml` |
| gridx-infra | `de0d47f` (main) | `docker-compose.yml` (Redis image, no proxy), `mosquitto/*.json` |
| docs | `b14fccd` | `plans/api_gateway/{03-grpc,05-websockets}.md`, `plans/iot-ingestion-dispatch/{02-redis-hot-storage,07-dispatch-service,08-grpc}.md`, `plans/api_contracts/api-contracts.md` |
