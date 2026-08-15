---
connie-title: API Gateway - Testing & Delivery
---

# Testing and Delivery Plan

## Testing layers

### Unit tests

- Configuration parsing and production safeguards.
- REST/protobuf request and response mappers.
- Error mapping and public-message sanitization.
- Route authentication and authorization policies.
- Rate-limit key construction and policy selection.
- WebSocket protocol validation and topic authorization.
- Deadline and retry decisions.

### Integration tests

- Fastify lifecycle with test routes.
- JWKS retrieval, caching, rotation, unknown `kid`, and outage behavior.
- Real Redis behavior, including concurrent atomic limits and failure modes.
- Generated gRPC clients against test servers.
- WebSocket upgrade, authentication, messages, heartbeat, and disconnect behavior.
- Graceful shutdown with in-flight HTTP/gRPC work and active sockets.

### Contract tests

- Public OpenAPI examples validate against schemas.
- Gateway mappings remain compatible with the pinned protobuf SDK.
- Buf lint and breaking-change checks run in the protobuf workflow.
- Domain-service error details map to stable public codes.
- Consumer/provider compatibility is tested before independent deployment.

### Security tests

- Missing, malformed, expired, future-dated, wrong-issuer, wrong-audience, wrong-type, and disallowed-algorithm JWTs.
- Key rotation and forged/unknown `kid` behavior.
- Refresh token rejected as an access token.
- Spoofed forwarded IP and internal identity metadata.
- CORS/origin and CSRF behavior for the chosen browser credential model.
- Oversized and malformed HTTP/WebSocket/protobuf payloads.
- Cross-user resource and subscription attempts.
- Sensitive-data redaction in logs and errors.
- Rate-limit bypass attempts across replicas, IP versions, and identities.

### Performance and resilience tests

- Target REST throughput and latency by route class.
- Aggregation fan-out under partial dependency failure.
- Expected and peak concurrent WebSocket connections.
- Broadcast/fan-out event throughput and slow consumers.
- Redis latency, failover, and unavailability.
- gRPC timeouts, retry storms, circuit behavior, and downstream saturation.
- Rolling deployment and connection drain.
- Memory growth and event-loop delay during sustained load.

## Delivery milestones

### Milestone 1: Foundation

Deliver:

- TypeScript/Fastify service skeleton.
- Typed configuration and environment validation.
- Structured logging, request IDs, health endpoints, and graceful lifecycle.
- OpenAPI/error-envelope conventions.
- CI for lint, type check, unit tests, build, and dependency scanning.

Acceptance:

- Service starts with valid development configuration and fails clearly on invalid production configuration.
- Liveness/readiness and graceful SIGTERM behavior pass integration tests.
- No domain routes or placeholder security claims are presented as complete.

### Milestone 2: Authentication and user/profile proxy

Deliver:

- Auth Service proxy routes.
- RS256 access-token verification through cached JWKS.
- Issuer, audience, algorithm, expiry, and type validation.
- Declarative route authorization.
- User/profile endpoints delegated to Auth Service.
- Key-rotation procedure and tests.

Acceptance:

- The gateway contains no private JWT signing key and cannot mint Auth Service access tokens.
- Authentication test matrix passes.
- Auth/profile business rules and records remain in Auth Service.

### Milestone 3: Redis rate limiting

Deliver:

- Shared Redis limiter with atomic algorithm.
- Named route policies and standard response headers.
- Trusted-proxy/IP normalization.
- Route-specific Redis outage behavior and metrics.

Acceptance:

- Limits remain correct across at least two gateway instances under concurrency.
- Sensitive routes do not silently lose protection during Redis failure.
- Auth Service retains its own sensitive-operation limits.

### Milestone 4: gRPC domain integration

Deliver:

- Pinned generated TypeScript SDK.
- Reusable secure client channels.
- Identity/trace propagation, deadlines, cancellation, error mapping, and bounded retries.
- First end-to-end domain routes with route mapping records.

Acceptance:

- Plaintext production fallback is impossible.
- Local plaintext transport is isolated to explicit development configuration.
- Verified claims are propagated as canonical metadata, and spoofed client identity headers cannot override them.
- Unsafe mutations are not automatically replayed without idempotency.
- Contract and dependency-failure tests pass.

### Milestone 5: Aggregation and reliability

Deliver:

- Required client-oriented aggregate endpoints.
- Overall/per-call deadlines, fan-out bounds, concurrency controls, and documented partial-failure behavior.
- Overload protection and downstream resilience controls.

Acceptance:

- Load and failure tests meet the agreed service objectives.
- A failing optional dependency cannot indefinitely hold or crash gateway requests.

### Milestone 6: WebSockets

Deliver:

- Versioned WebSocket protocol.
- Single-use connection-ticket flow or approved alternative.
- Topic authorization, Redis limits, heartbeat, backpressure, and drain behavior.
- Shared event distribution through Kafka using dedicated client-facing topics.

Acceptance:

- Cross-user subscription, ticket replay, slow-consumer, reconnect, revocation, and rolling-deployment scenarios pass.
- Per-instance memory remains bounded at target concurrent connections.

### Milestone 7: Production readiness

Deliver:

- Production deployment manifests/configuration.
- Dashboards, alerts, service objectives, audit integration, and runbooks.
- Security review, load-test report, rollback procedure, and operational ownership.

Acceptance:

- No unresolved critical security findings.
- Capacity targets and failure behavior are evidenced by tests.
- On-call operators can detect, diagnose, and safely mitigate major dependency failures.

## Definition of done for each route

A route is complete only when:

- Its public schema and example are documented.
- Authentication, authorization, and rate-limit policies are declared.
- Its gRPC mapping and owner are explicit.
- Deadlines, errors, retries, and idempotency are defined.
- Unit, integration, contract, and applicable security tests pass.
- Metrics and redacted logs exist.
- No domain logic has migrated into the gateway.

## Open-decision register

Keep unresolved decisions as tracked architecture records rather than implicit TODOs. At minimum record the owner, deadline, options, decision, and consequences for:

- Service-mesh product and deployment configuration.
- Kafka topic schemas, retention, WebSocket delivery semantics, and multi-replica fan-out.
- Browser access/refresh token storage model.
- Initial capacity targets and service objectives.
