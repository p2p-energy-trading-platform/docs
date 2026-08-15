---
connie-title: API Gateway - Operations, observability & Security
---

# Operations, Observability, and Security

## Configuration principles

- Validate configuration at startup with a typed schema.
- Fail fast when mandatory production values are absent or invalid.
- Keep safe local defaults only for development.
- Do not silently downgrade TLS, authentication, or Redis-backed enforcement.
- Store secrets and private credentials in the platform secret manager.
- Never commit `.env`, private keys, certificates, or production endpoints.

Configuration groups should cover:

- HTTP host, port, trusted proxies, request limits, and CORS origins.
- Auth issuer, audience, JWKS URI, algorithms, caches, and timeouts.
- Redis endpoint, TLS, credentials, pool, timeouts, and fallback modes.
- gRPC targets, TLS trust, workload identity, deadlines, and message sizes.
- WebSocket limits, heartbeat, drain time, and Kafka broker/topic settings.
- Logging, tracing, metrics, sampling, and environment identity.

## HTTP edge security

- Production traffic uses HTTPS/WSS.
- Configure Helmet/security headers deliberately rather than relying only on defaults.
- Use an exact environment-specific CORS origin allowlist.
- Enable credentials only if the cookie-based design needs them.
- Apply CSRF protection to cookie-authenticated state changes.
- Trust forwarding headers only from known ingress proxies.
- Enforce request/body/header/query limits at both ingress and application layers.
- Reject ambiguous content types and malformed requests.
- Keep framework and parser dependencies patched.

## Logging

Emit structured JSON logs with consistent fields:

```text
timestamp, level, service, version, environment,
requestId, traceId, method, route, statusCode, durationMs,
authenticatedSubjectId (when appropriate), downstreamService, grpcStatus
```

Use route templates rather than raw URLs for metric/log dimensions. Redact authorization headers, cookies, access/refresh tokens, passwords, MFA values, private profile fields, wallet details, and sensitive message payloads. Do not log entire request/response bodies by default.

## Metrics and tracing

Required metrics include:

- HTTP requests, status, latency, in-flight count, and response size.
- Authentication outcomes and authorization denials by safe reason category.
- Redis rate-limit allows/denies, latency, failures, and fallback activation.
- gRPC call count, status, latency, retries, and deadline expiration per service/method.
- WebSocket connections, closes, subscriptions, messages, drops, queue depth, and event lag.
- Event-loop delay, CPU, memory, and process restarts.

Propagate W3C trace context through REST and approved gRPC metadata. Generate a request ID if the inbound value is missing or invalid; do not trust unlimited arbitrary values from clients.

Avoid high-cardinality metric labels such as user ID, token ID, raw URL, order ID, or error message.

## Audit events

Security-relevant and sensitive operations need tamper-resistant audit events, including:

- Login/session outcomes supplied by the Auth Service.
- Permission failures on privileged operations.
- Password/MFA/profile security changes.
- Order and wallet commands where required by domain policy.
- Administrative actions.
- Rate-limit fallback or security-control degradation.

Audit events must distinguish actor, action, target, outcome, time, request ID, and originating service without recording credentials.

## Health endpoints

- Liveness checks process health and event-loop viability; it should not fail merely because a downstream service is unavailable.
- Readiness determines whether this instance should receive new traffic.
- Detailed dependency health is restricted to operators.
- Health endpoints are lightweight and protected from abuse even if excluded from ordinary user quotas.

## Deployment

The deployable gateway should:

- Run as a non-root user in a minimal, pinned container image.
- Use immutable builds and a lockfile-based dependency installation.
- Expose only the public application port to ingress.
- Use rolling deployments with readiness gates and connection draining.
- Set CPU/memory requests and limits from load-test evidence.
- Autoscale using a combination of CPU, latency/in-flight work, and WebSocket connection pressure.
- Spread replicas across failure domains where the platform supports it.

Ingress configuration must support WebSocket upgrade, bounded idle timeouts, request-size enforcement, forwarded-header normalization, and graceful backend removal.

## Availability and service objectives

Before production, define measurable objectives for:

- REST availability and latency by route class.
- WebSocket connection success and event-delivery latency.
- Maximum error-rate and timeout budgets.
- Redis and Kafka dependency expectations.

Create alerts tied to user-impacting symptoms and control degradation. Each high-severity alert needs a short runbook covering diagnosis, safe mitigation, rollback, and escalation.

## Supply-chain controls

- Dependency vulnerability and license scanning.
- Secret scanning.
- Reproducible CI build and artifact provenance where available.
- Pinned base images and SDK versions.
- Protobuf breaking-change checks.
- Protected release workflow and documented rollback.

## Data and privacy

The gateway should minimize collected and retained personal data. Define log retention, audit retention, access control, encryption at rest, and deletion requirements with the platform's privacy policy. Gateway caches, if introduced, must be partitioned by authorization context and must not leak one user's response to another.
