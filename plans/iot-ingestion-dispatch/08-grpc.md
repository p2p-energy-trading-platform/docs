---
connie-title: IoT Ingestion - gRPC API
---

# Production gRPC query API

## Scope and ownership

gRPC gives the API Gateway and authorized internal services read-only access to current and historical telemetry. It does not ingest telemetry, expose database-shaped CRUD.

The versioned contract is owned in the organization `protobuf` repository under `gridx.iot.v1`; generated Go and TypeScript clients are released through the SDK repositories. This service pins a generated SDK version.

## Version 1 service

Start with bounded unary reads. A live subscription is deliberately excluded until fan-out, replay, and backpressure requirements are known; one gRPC stream per browser is not an acceptable default architecture.

```protobuf
syntax = "proto3";

package gridx.iot.v1;

import "google/protobuf/timestamp.proto";

option go_package = "github.com/p2p-energy-trading-platform/go-sdk/gen/gridx/iot/v1;iotv1";

service TelemetryQueryService {
  rpc GetLatestReading(GetLatestReadingRequest) returns (GetLatestReadingResponse);
  rpc ListHistoricalReadings(ListHistoricalReadingsRequest) returns (ListHistoricalReadingsResponse);
  rpc GetHouseStatus(GetHouseStatusRequest) returns (GetHouseStatusResponse);
}

message GetLatestReadingRequest {
  string grid_id = 1;
  string house_id = 2;
}

message GetLatestReadingResponse {
  MeterReading reading = 1;
  google.protobuf.Timestamp observed_at = 2;
}

message ListHistoricalReadingsRequest {
  string grid_id = 1;
  string house_id = 2;
  google.protobuf.Timestamp start_time = 3; // inclusive
  google.protobuf.Timestamp end_time = 4;   // exclusive
  int32 page_size = 5;
  string page_token = 6;
}

message ListHistoricalReadingsResponse {
  repeated MeterReading readings = 1;
  string next_page_token = 2;
}

message GetHouseStatusRequest {
  string grid_id = 1;
  string house_id = 2;
}

message GetHouseStatusResponse {
  enum Status {
    STATUS_UNSPECIFIED = 0;
    STATUS_ONLINE = 1;
    STATUS_OFFLINE = 2;
  }
  Status status = 1;
  google.protobuf.Timestamp last_heartbeat_at = 2;
}
```

`MeterReading` and its nested asset types are shared messages in the same package, as drafted in [01-kafka-consumption.md](01-kafka-consumption.md). The contract must preserve presence for optional measurements where absence differs from zero. Generated protobuf messages are mapped at the transport boundary; storage rows and Redis JSON are not returned directly.

`GetGridSummary` is removed from v1 until its exact measures, time window, freshness, and cost are specified. A vague grid-wide aggregate invites unbounded database work. Add it later using a continuous aggregate or a purpose-built projection after query requirements and an SLO exist.

## Query semantics and limits

- Both IDs are required and must match the platform identifier grammar. The caller must be authorized for the requested grid/house before storage is queried.
- Historical ranges are `[start_time, end_time)`, use UTC, require `start < end`, and have a configured maximum span.
- `page_size` has a small default and hard maximum. Pagination is keyset-based on the stable ordering `(time DESC, seq DESC, house_id)`; never use offset pagination for a growing hypertable.
- Page tokens are opaque, versioned, integrity-protected, and bind the filters/order to the token. Invalid or expired tokens return `INVALID_ARGUMENT`.
- `GetLatestReading` reads Redis. A missing cache key may perform one bounded TimescaleDB fallback and optionally repair the cache; distinguish a genuinely unknown house from a temporarily unavailable store.
- `GetHouseStatus` derives liveness from `last_heartbeat_at` and the configured threshold. An expired Redis key means offline only for a known house; it does not mean the house does not exist.
- Every database statement has a context deadline and uses prepared/parameterized SQL. Results have hard row and serialized-response-size limits.

## Errors

Use stable gRPC status codes and safe messages:

| Condition | Status |
|---|---|
| Invalid ID, time range, page size, or token | `INVALID_ARGUMENT` |
| Missing/invalid workload or user identity | `UNAUTHENTICATED` |
| Caller cannot access the grid/house | `PERMISSION_DENIED` |
| Known-scope resource does not exist | `NOT_FOUND` |
| Deadline expires | `DEADLINE_EXCEEDED` |
| Concurrency/rate limit reached | `RESOURCE_EXHAUSTED` |
| Redis/TimescaleDB temporarily unavailable | `UNAVAILABLE` |
| Unexpected internal failure | `INTERNAL` |

Do not return SQL, Redis keys, topology, stack traces, or raw dependency errors. Attach a stable application error reason with `google.rpc.ErrorInfo` only when clients can act on it.

## Server lifecycle and middleware

The process runs the Kafka consumer, gRPC server, and lightweight HTTP health endpoints under one application lifecycle. The gRPC server has ordered unary interceptors for panic recovery, request/trace context, authentication, authorization, validation, concurrency/rate limits, metrics, and safe logging. Recovery is a last-resort containment boundary; handlers still return errors rather than panic.

Require client deadlines and enforce a server maximum even if the caller omits one. Propagate cancellation to Redis and Postgres. Set conservative maximum receive/send message sizes, maximum concurrent streams, keepalive enforcement compatible with the platform load balancer, and bounded handler concurrency. Do not add transparent application retries around database reads unless the remaining deadline and operation safety make it useful.

On startup, bind the listener only after configuration and required dependencies have been checked. Register the standard [`grpc.health.v1.Health`](https://grpc.io/docs/guides/health-checking/) service. It reports `SERVING` only when the query API can meet its dependency policy. Keep `/healthz` for process liveness and `/readyz` for orchestration. [Reflection](https://grpc.io/docs/guides/reflection/) is enabled only in local/development environments unless production access is explicitly restricted.

On `SIGTERM`, mark readiness and gRPC health `NOT_SERVING`, stop accepting Kafka work, drain bounded in-flight ingestion/RPCs, call [graceful gRPC stop](https://grpc.io/docs/guides/server-graceful-stop/) with a deadline, then force stop and close stores if the deadline expires.

## Authentication, authorization, and transport

Local Compose may use plaintext only on its private development network. Production requires TLS, preferably service-mesh mTLS/workload identity, and must fail closed if secure credentials are unavailable. The API Gateway is an allowed caller; other callers are allowlisted by workload identity.

Transport identity identifies the calling service. User/resource authorization still requires allowlisted metadata produced by the authenticated gateway (for example request ID, trace context, user ID, scopes, and grid claims). Never forward arbitrary client metadata or an original bearer token. Until the platform has a verified identity-propagation standard, the API must not expose cross-house telemetry to user-facing routes.

## Observability and SLOs

Emit RPC count, status, latency histograms, in-flight requests, rejected requests, response rows/bytes, Redis fallback count, and dependency latency. Trace gRPC to Redis/Postgres calls and correlate with request ID and W3C trace context. Labels must use method/status, never raw grid or house IDs. Logs redact identities according to the platform policy.

Before release, define measurable targets for availability and p95/p99 latency separately for latest and historical reads. Load tests must cover cache hits, cache misses, maximum historical pages, concurrent callers, dependency slowdown, cancellation, and graceful shutdown.

## Contract and interoperability tests

- Protobuf lint/breaking-change checks in the contract repository.
- Go handler tests for validation, authorization, status mapping, deadlines, and pagination tokens.
- Integration tests against real Redis and TimescaleDB.
- Generated TypeScript client smoke test from the API Gateway to this Go server.
- TLS/workload-identity and metadata allowlist tests in a production-like environment.
- `grpcurl` development smoke test through reflection; production smoke tests use compiled health/query clients.

No gRPC method is production-ready until its caller, authorization rule, deadline, maximum request/response size, storage query, error mapping, metrics, and load-test threshold are recorded.
