---
connie-title: API Gateway - User Stories
---

# API Gateway - User Stories

* **Epic:** API Gateway
* **Repository:** [p2p-energy-trading-platform/api-gateway](https://github.com/p2p-energy-trading-platform/api-gateway)

> This document breaks the API Gateway epic down into component-level user stories, grouped by functional area. Each story maps to a specific part of the `api-gateway` repository structure and includes acceptance criteria for Jira ticket creation. Stories in Section 6 are currently blocked and are listed separately with reasons instead of acceptance criteria.

---

## 1. Bootstrap & Configuration

### US-1.1 - Validate gateway configuration at startup

> **As** a developer, <br>
> **I want** the gateway to load and validate its configuration (ports, env vars, service URLs), <br>
> **so that** misconfiguration fails fast instead of causing runtime errors.

*Maps to: `src/config/env.ts`, `src/config/schema.ts`, `src/config/types.ts`, `scripts/check-config.ts`*

**Acceptance Criteria:**

- Invalid or missing required env vars cause the process to exit with a clear error at startup.
- Config is validated against the schema defined in `src/config/schema.ts`.
- Config type errors are caught at compile time via `src/config/types.ts`.

---

## 2. Security & Traffic Control

### US-2.1 - Enforce CORS and security headers

> **As** a platform operator, <br>
> **I want** CORS and standard security headers enforced at the gateway, <br>
> **so that** only approved origins can call the API and responses meet baseline security requirements.

*Maps to: `src/plugins/cors.ts`, `src/plugins/security.ts`, `src/observability/redaction.ts`*

**Acceptance Criteria:**

- CORS policy is configurable per environment (dev/staging/prod).
- Security headers (CSP, HSTS, etc.) are applied to all responses.
- Sensitive fields (tokens, secrets) are redacted from logs.

---

### US-2.2 - Per-client rate limiting

> **As** a platform operator, <br>
> **I want** per-client rate limiting at the gateway, <br>
> **so that** a single client can't overwhelm the system.

*Maps to: `src/plugins/rate-limit.ts`, `src/transport/redis/scripts/rate-limit.lua`, `src/transport/redis/client.ts`, `src/policies/rate-limits.ts`*

**Acceptance Criteria:**

- Requests-per-minute limit is enforced per client/route using a Redis-backed counter.
- Requests exceeding the limit return `429 Too Many Requests`.
- Limit thresholds are configurable per route/policy.

---

## 3. Observability & Health

### US-3.1 - Request logging, metrics, and tracing

> **As** an SRE/QA engineer, <br>
> **I want** gateway traffic logged and traced with correlation IDs, <br>
> **so that** requests can be followed end-to-end.

*Maps to: `src/plugins/observability.ts`, `src/observability/logging.ts`, `src/observability/metrics.ts`, `src/observability/tracing.ts`*

**Acceptance Criteria:**

- Each request is assigned a trace ID that is propagated through the request lifecycle.
- Structured logs include method, route, status, latency, and traceId.
- Metrics (latency, error rate, throughput) are exposed for scraping.

---

### US-3.2 - Liveness and readiness endpoints

> **As** an infrastructure operator, <br>
> **I want** liveness and readiness endpoints on the gateway, <br>
> **so that** orchestration (Docker/Kubernetes) knows when the service is healthy and ready to receive traffic.

*Maps to: `src/health/routes.ts`, `src/health/liveness.ts`, `src/health/readiness.ts`*

**Acceptance Criteria:**

- `/health/live` returns 200 if the process is running.
- `/health/ready` returns 200 only when Redis/Kafka connections are established.
- Unready state returns a non-200 status.

---

## 4. IoT Device Routing

### US-4.1 - Route device requests to IoT Ingestion & Dispatch

> **As** a client, <br>
> **I want** device/telemetry requests routed to the IoT Ingestion & Dispatch service, <br>
> **so that** I can view and manage smart meter devices.

*Maps to: `src/transport/grpc/clients/device.client.ts`, `src/features/devices/*`*

**Acceptance Criteria:**

- Requests to `/api/devices/*` are routed to `iot-ingestion-dispatch` via its device client.
- Responses are mapped back to the gateway's standard response schema.
- Errors from the service are mapped to standard HTTP errors.

---

## 5. Real-Time Delivery

### US-5.1 - Consume Kafka events and route to WebSocket subscribers

> **As** the platform, <br>
> **I want** relevant Kafka topics consumed and routed to subscribed WebSocket clients, <br>
> **so that** real-time updates reach users.

*Maps to: `src/transport/kafka/consumer.ts`, `src/transport/kafka/topics.ts`, `src/transport/kafka/schemas.ts`, `src/transport/kafka/event-router.ts`, `src/websocket/event-delivery.ts`*

**Acceptance Criteria:**

- Consumer subscribes to defined topics (device telemetry, initially).
- Consumed events are routed to matching active WebSocket subscriptions.
- Malformed or unknown events are logged and dropped, not crashing the consumer.

---

### US-5.2 - WebSocket connection lifecycle

> **As** a client, <br>
> **I want** to open a WebSocket connection, subscribe to channels, and receive heartbeats, <br>
> **so that** I get reliable real-time updates.

*Maps to: `src/plugins/websocket.ts`, `src/websocket/connection.ts`, `src/websocket/protocol.ts`, `src/websocket/subscriptions.ts`, `src/websocket/authorization.ts`, `src/websocket/heartbeat.ts`*

**Acceptance Criteria:**

- Client can open a WebSocket connection and subscribe to specific channels.
- Only authorized subscriptions are accepted.
- Server sends periodic heartbeats and detects/cleans up dead connections.

---

## 6. Error Handling & Validation

### US-6.1 - Consistent error schema and mapping layer

> **As** a developer, <br>
> **I want** a consistent error schema and mapping layer, <br>
> **so that** all error responses (regardless of source) look the same to clients.

*Maps to: `src/errors/app-error.ts`, `src/errors/codes.ts`, `src/errors/error-handler.ts`, `src/errors/grpc-to-http.ts`*

**Acceptance Criteria:**

- Errors follow a standard schema (code, message, timestamp/traceId).
- A central mapping layer handles gRPC-to-HTTP and Kafka-failure-to-HTTP cases.
- No feature handler duplicates error formatting logic.

---

### US-6.2 - Request payload validation

> **As** a client, <br>
> **I want** request payloads validated at the gateway, <br>
> **so that** malformed requests fail fast with a clear error.

*Maps to: `src/features/*/schemas.ts`, `src/common/validation.ts`, `src/common/pagination.ts`*

**Acceptance Criteria:**

- Each route defines a request/response schema.
- Invalid payloads return `400 Bad Request` with validation details.
- Common validation/pagination logic is shared, not duplicated per feature.

---

## 7. Blocked User Stories (Cannot Be Developed Yet)

> Each story below is written but cannot be implemented or integration-tested yet. Reasons are stated in place of acceptance criteria.

### US-7.1 - Authenticate requests at the gateway

> **As** a client, <br>
> **I want** to authenticate at the gateway, <br>
> **so that** only verified users reach backend services.

*Maps to: `src/plugins/authentication.ts`, `src/features/auth/*`, `src/types/authentication.ts`*

**Reason Blocked:** `auth-service` exists as a repository but has only 1 commit and a README stub — no authentication logic is implemented. The gateway has nothing real to validate credentials against yet.

---

### US-7.2 - Enforce role-based access control

> **As** a system admin, <br>
> **I want** role/permission-based access control enforced at the gateway, <br>
> **so that** unauthorized users can't hit restricted endpoints.

*Maps to: `src/plugins/authorization.ts`, `src/policies/route-auth.ts`, `src/policies/permissions.ts`*

**Reason Blocked:** Role and permission claims are issued by `auth-service`, which doesn't exist yet (see US-7.1). Without real claims to check, there is no data to enforce rules against.

---

### US-7.3 - Route order requests

> **As** a client, <br>
> **I want** to place and manage orders via the gateway, <br>
> **so that** I can participate in energy trading.

*Maps to: `src/transport/grpc/clients/order.client.ts`, `src/features/orders/*`*

**Reason Blocked:** No gRPC-based Order service repository exists. The only related backend is `matching-engine`, which communicates over Kafka, not gRPC (confirmed by the `cpp-sdk` repository description: "Kafka message encoding and decoding for the GridX Matching Engine"). This is a protocol mismatch, not just a missing repo, and needs a team decision on whether the gateway should produce/consume Kafka messages directly or wait for a gRPC-facing wrapper service to be built.

---

### US-7.4 - Route trade requests

> **As** a client, <br>
> **I want** to view trade results via the gateway, <br>
> **so that** I can track my completed trades.

*Maps to: `src/transport/grpc/clients/trade.client.ts`, `src/features/trades/*`*

**Reason Blocked:** Same as US-7.3 — depends on the same unresolved Kafka-vs-gRPC question for `matching-engine`.

---

### US-7.5 - Route wallet requests

> **As** a client, <br>
> **I want** to view wallet balance and transactions via the gateway, <br>
> **so that** I can manage my funds.

*Maps to: `src/transport/grpc/clients/wallet.client.ts`, `src/features/wallet/*`*

**Reason Blocked:** No Wallet service repository exists anywhere in the organization. There is no contract and nothing to route to.

---

### US-7.6 - Route market ticker requests

> **As** a client, <br>
> **I want** live market price/ticker data via the gateway, <br>
> **so that** I can see current trading prices.

*Maps to: `src/transport/grpc/clients/market.client.ts`, `src/features/market/*`*

**Reason Blocked:** No Market Ticker service repository exists. Nothing has been built yet to integrate against.

---

### US-7.7 - Route notification requests

> **As** a client, <br>
> **I want** to receive notifications through the gateway, <br>
> **so that** I'm informed of relevant platform events.

*Maps to: `src/transport/grpc/clients/notification.client.ts`, `src/features/notifications/*`*

**Reason Blocked:** No Notification service repository exists.

---

### US-7.8 - Route user/profile requests

> **As** a client, <br>
> **I want** to manage my profile via the gateway, <br>
> **so that** I can update my account details.

*Maps to: `src/transport/grpc/clients/user.client.ts`, `src/features/users/*`*

**Reason Blocked:** No User/Profile service repository exists.

---

## Summary Table

| ID | Story | Component | Status |
|------|--------|-----------|--------|
| US-1.1 | Validate gateway configuration at startup | `config/env.ts`, `config/schema.ts` | Ready |
| US-2.1 | Enforce CORS and security headers | `plugins/cors.ts`, `plugins/security.ts` | Ready |
| US-2.2 | Per-client rate limiting | `plugins/rate-limit.ts`, `transport/redis/` | Ready |
| US-3.1 | Request logging, metrics, and tracing | `plugins/observability.ts`, `observability/` | Ready |
| US-3.2 | Liveness and readiness endpoints | `health/routes.ts` | Ready |
| US-4.1 | Route device requests to IoT Ingestion & Dispatch | `transport/grpc/clients/device.client.ts` | Ready |
| US-5.1 | Consume Kafka events and route to WebSocket subscribers | `transport/kafka/`, `websocket/event-delivery.ts` | Ready |
| US-5.2 | WebSocket connection lifecycle | `plugins/websocket.ts`, `websocket/` | Ready |
| US-6.1 | Consistent error schema and mapping layer | `errors/` | Ready |
| US-6.2 | Request payload validation | `features/*/schemas.ts`, `common/validation.ts` | Ready |
| US-7.1 | Authenticate requests at the gateway | `plugins/authentication.ts`, `features/auth/*` | Blocked - auth-service not implemented |
| US-7.2 | Enforce role-based access control | `plugins/authorization.ts`, `policies/` | Blocked - depends on US-7.1 |
| US-7.3 | Route order requests | `transport/grpc/clients/order.client.ts` | Blocked - protocol mismatch (Kafka vs gRPC) |
| US-7.4 | Route trade requests | `transport/grpc/clients/trade.client.ts` | Blocked - protocol mismatch (Kafka vs gRPC) |
| US-7.5 | Route wallet requests | `transport/grpc/clients/wallet.client.ts` | Blocked - no service repo exists |
| US-7.6 | Route market ticker requests | `transport/grpc/clients/market.client.ts` | Blocked - no service repo exists |
| US-7.7 | Route notification requests | `transport/grpc/clients/notification.client.ts` | Blocked - no service repo exists |
| US-7.8 | Route user/profile requests | `transport/grpc/clients/user.client.ts` | Blocked - no service repo exists |

---
