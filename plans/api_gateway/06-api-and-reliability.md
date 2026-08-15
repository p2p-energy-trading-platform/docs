---
connie-title: API Gateway - Public API & Reliability
---

# Public API and Reliability

## API contract

The gateway publishes an OpenAPI contract for REST endpoints and a separate versioned schema for WebSocket messages. Public contracts must be generated or validated in CI and must not depend directly on internal protobuf JSON representation.

Every REST route definition must include:

- Method and canonical `/api/v1` path.
- Summary and owning domain service.
- Authentication policy and required permissions.
- Parameters and request-body schema.
- Success response schema and status code.
- Public error codes.
- Rate-limit class.
- Request deadline.
- Idempotency requirements.
- gRPC method and request/response mapper.
- Audit requirement.

## Validation

Fastify JSON schemas should validate all public inputs and serialize outputs.

- Reject unsupported content types.
- Define behavior for unknown object properties; prefer rejection on commands.
- Bound string, array, object, query, header, and body sizes.
- Use explicit formats and value ranges.
- Normalize only where semantics are unambiguous.
- Treat protobuf responses as untrusted internal input at the public boundary and map them into declared output schemas.

Validation performed by the gateway improves client feedback but does not replace validation in the owning service.

## Public error envelope

Use one stable shape across gateway-originated and translated downstream errors:

```json
{
  "error": {
    "code": "ORDER_NOT_FOUND",
    "message": "The requested order was not found.",
    "requestId": "01...",
    "details": []
  }
}
```

- `code` is stable and machine-readable.
- `message` is safe for clients and may change without being parsed.
- `requestId` supports investigation.
- `details` contains safe structured validation information when useful.
- Stack traces, SQL messages, internal addresses, raw gRPC metadata, and sensitive existence information are never exposed.

Authentication endpoints should avoid responses that reveal whether an account exists.

## Pagination and filtering

List routes must use one documented pagination style. Cursor pagination is preferred for changing order/trade/event datasets. Define maximum page size, stable ordering, cursor opacity, filter validation, and behavior when a cursor expires or becomes invalid.

## Idempotency

Commands that may cause financial, trading, or other non-repeatable effects must accept an idempotency key.

- Validate length and character set.
- Scope keys to authenticated caller and operation.
- Forward the key to the owning service.
- The owning service, not the gateway alone, stores the authoritative result/deduplication record.
- A repeated key with a different request payload is a conflict.
- Document retention time and replayed response behavior.

## Time budget

Each endpoint has an end-to-end deadline. The gateway reserves part of it for ingress, authentication, mapping, and returning the response. Downstream calls receive only the remaining budget.

Do not configure unlimited network operations. Apply bounded timeouts to:

- JWKS retrieval.
- Redis commands.
- gRPC calls.
- Broker operations used during WebSocket setup.
- Graceful drain/shutdown.

## Aggregation behavior

For endpoints calling multiple services:

- Run independent calls concurrently.
- Enforce an overall deadline.
- Limit fan-out and per-user concurrency.
- Retry only safe calls within the remaining budget.
- State whether the contract is all-or-nothing or allows partial data.
- Mark partial sections explicitly; never silently omit failed data.
- Cache only after defining freshness, invalidation, privacy, and authorization-keying rules.

## Overload protection

Rate limiting controls client quotas; it does not replace overload protection. Add:

- Maximum in-flight HTTP requests per instance.
- Maximum concurrent calls per downstream service.
- WebSocket connection and buffer caps.
- Load shedding with `503` before resource exhaustion.
- Event-loop delay and memory pressure monitoring.

## Retry, circuit, and fallback policy

- Retry only transient failures and safe/idempotent operations.
- Use small attempt limits, exponential backoff, and jitter.
- Respect client cancellation and deadlines.
- Avoid retrying at multiple layers in ways that multiply traffic.
- Use circuit breaking/outlier detection to limit repeated calls to failing dependencies.
- Do not return stale or fabricated financial data as a fallback unless a route contract explicitly permits and labels it.

## Graceful lifecycle

Startup:

1. Parse and validate configuration.
2. Initialize observability.
3. Initialize Redis, JWKS verifier, gRPC clients, and event subscriptions.
4. Register routes and WebSocket support.
5. Begin listening.
6. Report ready only after mandatory dependencies are usable.

Shutdown:

1. Mark the instance unready.
2. Stop accepting new HTTP and WebSocket connections.
3. Notify/drain WebSockets for a bounded period.
4. Await bounded in-flight requests.
5. Stop event consumers and close gRPC/Redis connections.
6. Flush telemetry within a bounded period and exit.

## API compatibility

- Backward-compatible changes remain in `/api/v1`.
- Breaking REST or WebSocket changes require a new public version and migration window.
- Removing or changing fields requires documented deprecation.
- Internal protobuf and public API versions evolve independently through explicit mappers.

