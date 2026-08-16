---
connie-title: API Gateway - Architecture
---

# Architecture and Service Boundaries

## Responsibilities

The gateway is responsible for:

- Terminating public HTTPS and WebSocket requests, unless TLS is terminated at a trusted ingress immediately in front of it.
- Validating request method, path, headers, query parameters, and body against schemas.
- Verifying access tokens issued by the Auth Service.
- Applying coarse route-level authorization, such as required roles or scopes.
- Applying distributed rate limits, request-size limits, and concurrency limits.
- Translating public REST requests into internal gRPC calls.
- Aggregating multiple service responses for purpose-built frontend endpoints.
- Translating internal errors into a stable public error contract.
- Propagating deadlines, cancellation, identity context, correlation IDs, and trace context.
- Serving real-time data through authenticated WebSocket subscriptions.
- Producing security events, structured logs, metrics, and traces.

The gateway is not responsible for:

- Password verification, account registration logic, MFA, token issuance, or refresh-session storage.
- Owning user or profile records. These belong to the Auth Service.
- Owning orders, trades, wallets, devices, notifications, or market data.
- Making domain decisions such as whether an order can be cancelled or whether a wallet has sufficient funds.
- Acting as a general-purpose data cache or event store.

## Auth and profile routing

The absence of a separate profile service is intentional. Public routes can still be organized for client usability without implying separate service ownership.

```text
POST  /api/v1/auth/login       -> AuthService.Login
POST  /api/v1/auth/refresh     -> AuthService.RefreshSession
POST  /api/v1/auth/logout      -> AuthService.RevokeSession
GET   /api/v1/users/me         -> AuthService.GetCurrentUser
PATCH /api/v1/users/me         -> AuthService.UpdateProfile
POST  /api/v1/users/me/password -> AuthService.ChangePassword
```

The exact RPC names remain contract decisions. Password routes should remain under Auth Service ownership even if the public URL is grouped with user settings.

## Request lifecycle

For a protected REST request:

1. The trusted ingress accepts TLS and forwards normalized connection information.
2. Fastify assigns or validates a correlation ID.
3. The gateway rejects malformed headers, unsupported content types, and oversized payloads.
4. The Redis limiter applies an IP-level pre-authentication policy.
5. The gateway verifies the access-token signature and required claims.
6. A user/route rate-limit policy and coarse permission policy are applied.
7. The handler creates a downstream deadline and invokes one or more gRPC methods.
8. The owning service applies resource-level authorization and domain rules.
9. The gateway maps the result or error to the public response contract.
10. Metrics, trace spans, and redacted structured logs are emitted.

## Data aggregation

An aggregation endpoint is allowed when it gives the frontend a stable, task-oriented response. Its handler must specify:

- Every downstream dependency.
- Which independent calls run concurrently.
- An overall deadline and a smaller deadline for each call.
- Whether partial results are allowed and how they are represented.
- A maximum fan-out count.
- Cache policy, if any.
- Behavior when one dependency is unavailable.

Aggregators must not reproduce domain rules. They compose already-authorized results.

## Inbound gRPC server

No inbound gRPC server is planned for the gateway. Internal services should publish events through the selected event infrastructure or expose their own APIs. An inbound gateway gRPC server may be added only after documenting a concrete caller, RPC contract, authentication method, authorization policy, and operational need.

## Public API version

The canonical prefix is `/api/v1`. Production and local deployments use the same path structure. Hostnames differ by environment; paths do not.

The health endpoints are outside the versioned API:

- `GET /health/live`: the process is running.
- `GET /health/ready`: the instance is ready to receive traffic.

Readiness must not require every downstream domain service to be healthy. It should represent whether the gateway can safely accept traffic and should report dependency detail only to trusted operators.
