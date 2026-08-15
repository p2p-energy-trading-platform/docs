# Redis-Backed Rate Limiting

## Goal

Rate limits must remain effective when multiple gateway replicas receive traffic. Redis stores shared limiter state; gateway memory is not the authoritative store.

Using a Fastify plugin as the hook/integration layer is acceptable if its configured store is Redis and its behavior meets this design. “Do not use the default Fastify rate limit” means do not rely on the plugin's default in-memory counters or default one-policy-fits-all configuration.

## Algorithm

Use an atomic Redis implementation. A token-bucket or sliding-window algorithm is preferred for public APIs because it avoids sharp fixed-window boundary bursts. The operation should execute atomically through a reviewed Lua script or a proven Redis-backed library.

The response from Redis should provide enough data for the gateway to emit:

- Whether the request is allowed.
- Limit and remaining quota.
- Time until reset or token availability.
- `Retry-After` when rejected.

## Policy dimensions

Apply layered policies rather than a single global counter:

| Stage | Suggested identity | Purpose |
|---|---|---|
| Before authentication | Normalized client IP | Limit anonymous floods and token-verification work |
| After authentication | User ID | Prevent account-level abuse across devices and IPs |
| Sensitive auth route | IP plus normalized account identifier | Slow credential stuffing without exposing account existence |
| Expensive endpoint | User ID plus route class | Bound aggregation or costly reads |
| Mutation | User ID plus route class | Bound writes and trading commands |
| WebSocket upgrade | IP and user ID | Bound connection churn and concurrent sessions |
| WebSocket messages | User ID, connection, and message class | Bound subscription/message abuse |

Never include raw access tokens, email addresses, phone numbers, or other personal data in Redis keys. Hash normalized identifiers with an application-controlled keyed hash where necessary.

## Route classes

Define named policies in configuration, for example:

- `public-read`
- `authenticated-read`
- `expensive-read`
- `authenticated-write`
- `auth-login`
- `auth-refresh`
- `auth-password-reset`
- `websocket-connect`
- `websocket-message`

Numbers must be derived from expected traffic and load tests. Example values in legacy documents are not approved production settings.

## Redis keys and atomicity

Keys should include an environment/application namespace, policy version, policy name, and opaque identity:

```text
gridx:{environment}:gateway:rl:v1:{policy}:{opaque-identity}
```

Requirements:

- Every key has a bounded TTL.
- Check-and-update is atomic.
- Cluster key-slot behavior is understood if Redis Cluster is used.
- Cardinality and memory usage are observable.
- User-controlled route strings are not inserted without normalization.
- Policy changes can be versioned without deleting broad Redis key ranges.

## Client IP safety

Use forwarded headers only when the direct peer is a configured trusted proxy. Configure the exact ingress proxy ranges or hop count. Normalize IPv4 and IPv6 consistently and consider an IPv6 subnet policy so attackers cannot bypass limits by rotating addresses within an allocation.

## Response contract

Rejected HTTP requests return `429` with `Retry-After` and the project-standard error envelope:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Try again later.",
    "requestId": "..."
  }
}
```

Expose standardized rate-limit headers consistently, without revealing sensitive limiter-key information.

WebSocket upgrades can return HTTP `429`. For established connections, define a versioned protocol error and close code for repeated message-rate violations.

## Redis failure policy

Redis is a mandatory gateway dependency in the current architecture. The gateway does not implement a local emergency limiter or fail-open mode.

- If Redis is unavailable during startup, the gateway does not become ready.
- If Redis becomes unavailable while running, readiness fails and requests that require rate-limit enforcement return `503 Service Unavailable`.
- The gateway must not process sensitive authentication, financial, or trading operations without the Redis-backed control.
- Redis failures must be logged, measured, and surfaced to operators.

The Auth Service must independently rate-limit credential, MFA, refresh, and password-recovery operations. Gateway controls are defense in depth, not the Auth Service's only protection.

## Operational requirements

- Redis connections use TLS and authentication in production.
- Credentials are stored through the platform secret mechanism.
- Timeouts are short and do not consume the entire request budget.
- Connection-pool saturation, command latency, errors, allowed requests, denied requests, and readiness failures are measured.
- Advanced Redis failover and fallback designs are outside the initial local-development scope.

## Required tests

- Atomic behavior under concurrent requests from multiple gateway processes.
- Correct TTL and reset behavior.
- Layered IP and user limits.
- Trusted-proxy and spoofed-forwarded-header behavior.
- Redis timeout/disconnection causes unready status and the documented `503` response.
- IPv6 normalization.
- WebSocket connection and message limits.
- Bounded key cardinality and memory under adversarial inputs.
