# Internal gRPC Plan

## Scope

The gateway is a gRPC client of internal domain services. It does not expose gRPC to frontend clients and has no planned inbound gRPC server.

Generated TypeScript clients from the protobuf/SDK release are the integration boundary. Handwritten copies of protobuf message types must not be maintained in the gateway.

## Contract ownership

The protobuf repository is the source of truth. Each contract must define:

- A versioned package name, for example `gridx.orders.v1`.
- Request, response, and error-detail messages.
- Field validation expectations.
- Idempotency behavior for commands.
- Authentication and authorization expectations.
- Pagination semantics for list methods.
- Whether a method is unary, server-streaming, client-streaming, or bidirectional.

CI must run protobuf linting and breaking-change detection. Removed field numbers and names must be reserved. Generated SDK releases must be versioned, and the gateway must pin an explicit compatible version.

## Client lifecycle

- Create one reusable client/channel per service target per gateway process.
- Do not create a new channel for every HTTP request.
- Initialize clients through an encapsulated Fastify plugin.
- Validate all required service targets at startup.
- Close channels during graceful shutdown after new requests stop being accepted.
- Use service discovery or stable platform DNS in deployed environments, not fixed pod addresses.

Keepalive values must be agreed with infrastructure and server owners. Aggressive keepalive can create unnecessary load and should not be copied from an example without testing.

## Transport and service authentication

The implementation is phased:

- Local development initially uses plaintext gRPC channels on the private development/container network.
- The client-creation code must centralize channel credentials so transport security can change without altering routes, mappers, or domain clients.
- A later production phase introduces a service mesh for mTLS/workload identity and service authorization.
- Plaintext must not remain enabled in an untrusted or production network.

With the service mesh in place:

- The gateway verifies the downstream service identity.
- The downstream service verifies the gateway workload identity.
- Traffic is encrypted in transit.
- Authorization can restrict RPC callers by service identity.

The mesh should own certificate issuance, storage, renewal, rotation, expiry monitoring, and trust distribution. Application repositories should not implement their own production certificate-rotation system. Production must fail fast rather than silently fall back to plaintext.

The official [gRPC authentication guide](https://grpc.io/docs/guides/auth/) describes TLS channel credentials, optional mutual authentication, and metadata-based call credentials.

## User identity metadata

Transport authentication proves which workload made the call; it does not by itself identify the frontend user. Follow the identity-propagation policy in [02-authentication-and-authorization.md](02-authentication-and-authorization.md).

Standard internal metadata should include:

```text
x-request-id
traceparent
x-gridx-user-id
x-gridx-user-scopes
x-gridx-user-roles       # when required
x-gridx-tenant-id        # if tenancy is introduced
```

The gateway creates this metadata from verified access-token claims. It does not forward the original access token or mint an internal assertion. Do not forward arbitrary inbound metadata: use an allowlist and overwrite reserved identity fields. Downstream services may trust this metadata in production only when mesh identity and authorization policy prove that the RPC caller is the gateway.

## Deadlines and cancellation

Every RPC must have a deadline. Infinite calls are prohibited.

- Start with a route-level HTTP deadline.
- Reserve time for response mapping and network overhead.
- Give each downstream call a deadline within the remaining budget.
- Propagate cancellation when the HTTP client disconnects or the WebSocket subscription closes.
- For aggregation, assign per-call budgets without exceeding the overall request deadline.

Timeout values belong to route configuration and must be verified by load tests; one global number is insufficient.

## Retries

Retries are allowed only when all of these are true:

- The status is considered transient.
- The remaining deadline permits another attempt.
- The method is read-only or protected by an idempotency key.
- The retry limit is small and uses exponential backoff with jitter.

Do not retry validation, authentication, permission, or business-rule failures. Do not automatically retry an unsafe financial or trading mutation without service-side idempotency.

## Error mapping

Use a central mapper rather than route-specific ad hoc behavior.

| gRPC status | Default HTTP status | Public meaning |
|---|---:|---|
| `INVALID_ARGUMENT` | 400 | Invalid request |
| `UNAUTHENTICATED` | 401 | Authentication required or invalid |
| `PERMISSION_DENIED` | 403 | Authenticated but not permitted |
| `NOT_FOUND` | 404 | Resource not found |
| `ALREADY_EXISTS` | 409 | Resource conflict |
| `FAILED_PRECONDITION` | 409 or 422 | Current state prevents operation |
| `RESOURCE_EXHAUSTED` | 429 | Service limit exceeded |
| `DEADLINE_EXCEEDED` | 504 | Downstream deadline exceeded |
| `UNAVAILABLE` | 503 | Dependency temporarily unavailable |
| `INTERNAL`/unknown | 502 | Downstream failure |

The exact mapping may be specialized by a documented domain error code. Internal messages, stack traces, database details, and service addresses must not reach clients.

## Resilience controls

- Concurrency bounds per downstream service.
- Circuit breaking or outlier handling where supported by the runtime/platform.
- Maximum outbound and inbound protobuf message sizes.
- Load shedding before the process becomes unhealthy.
- Per-service latency, status, retry, and saturation metrics.
- Readiness behavior that does not flap because one optional downstream service is unavailable.

## Streaming

Do not automatically map a gRPC stream one-to-one to each browser WebSocket. The design must first establish fan-out requirements, event ordering, replay needs, and expected connection counts. A broker-backed subscription layer is generally more suitable when many clients consume the same event stream.

## Required route mapping record

For every REST handler, record:

```text
Public method/path:
Owning service and RPC:
Request mapper:
Response mapper:
Authentication/scopes:
Resource authorization owner:
Deadline:
Retry policy:
Idempotency policy:
Error mapping exceptions:
```
