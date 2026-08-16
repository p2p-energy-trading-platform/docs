---
connie-title: API Gateway - Folder structure 
---

# Proposed Repository and Folder Structure

## Assessment of the legacy structure

The previous structure is adequate for a small proof of concept, but it is not enough for the planned gateway. In particular, it does not clearly separate:

- Fastify infrastructure from public API features.
- Route definitions from orchestration logic.
- Public REST schemas from internal protobuf contracts.
- Authentication from authorization.
- gRPC client lifecycle from service-specific adapters.
- WebSocket protocol handling from Kafka consumption.
- Public errors from internal gRPC errors.
- Unit, integration, contract, and load tests.

The recommended structure below remains a single deployable Fastify application. The directories are code boundaries, not separate packages or repositories.

## Recommended structure

```text
api-gateway/
├── src/
│   ├── app.ts
│   ├── main.ts
│   │
│   ├── config/
│   │   ├── env.ts
│   │   ├── schema.ts
│   │   └── types.ts
│   │
│   ├── plugins/
│   │   ├── authentication.ts
│   │   ├── authorization.ts
│   │   ├── cors.ts
│   │   ├── grpc.ts
│   │   ├── kafka.ts
│   │   ├── observability.ts
│   │   ├── rate-limit.ts
│   │   ├── redis.ts
│   │   ├── security.ts
│   │   └── websocket.ts
│   │
│   ├── transport/
│   │   ├── grpc/
│   │   │   ├── credentials.ts
│   │   │   ├── deadlines.ts
│   │   │   ├── metadata.ts
│   │   │   ├── errors.ts
│   │   │   └── clients/
│   │   │       ├── auth.client.ts
│   │   │       ├── order.client.ts
│   │   │       ├── trade.client.ts
│   │   │       ├── wallet.client.ts
│   │   │       ├── market.client.ts
│   │   │       ├── device.client.ts
│   │   │       └── notification.client.ts
│   │   ├── kafka/
│   │   │   ├── consumer.ts
│   │   │   ├── topics.ts
│   │   │   ├── schemas.ts
│   │   │   └── event-router.ts
│   │   └── redis/
│   │       ├── client.ts
│   │       ├── keys.ts
│   │       └── scripts/
│   │           └── rate-limit.lua
│   │
│   ├── features/
│   │   ├── auth/
│   │   │   ├── routes.ts
│   │   │   ├── schemas.ts
│   │   │   ├── handler.ts
│   │   │   └── mapper.ts
│   │   ├── users/
│   │   │   ├── routes.ts
│   │   │   ├── schemas.ts
│   │   │   ├── handler.ts
│   │   │   └── mapper.ts
│   │   ├── orders/
│   │   │   ├── routes.ts
│   │   │   ├── schemas.ts
│   │   │   ├── handler.ts
│   │   │   └── mapper.ts
│   │   ├── trades/
│   │   ├── wallet/
│   │   ├── market/
│   │   ├── devices/
│   │   ├── notifications/
│   │   └── dashboard/
│   │
│   ├── websocket/
│   │   ├── connection.ts
│   │   ├── protocol.ts
│   │   ├── schemas.ts
│   │   ├── subscriptions.ts
│   │   ├── authorization.ts
│   │   ├── heartbeat.ts
│   │   └── event-delivery.ts
│   │
│   ├── policies/
│   │   ├── route-auth.ts
│   │   ├── permissions.ts
│   │   ├── rate-limits.ts
│   │   ├── idempotency.ts
│   │   └── timeouts.ts
│   │
│   ├── errors/
│   │   ├── app-error.ts
│   │   ├── codes.ts
│   │   ├── error-handler.ts
│   │   └── grpc-to-http.ts
│   │
│   ├── observability/
│   │   ├── logging.ts
│   │   ├── metrics.ts
│   │   ├── tracing.ts
│   │   └── redaction.ts
│   │
│   ├── health/
│   │   ├── routes.ts
│   │   ├── liveness.ts
│   │   └── readiness.ts
│   │
│   ├── common/
│   │   ├── request-context.ts
│   │   ├── pagination.ts
│   │   ├── validation.ts
│   │   └── types.ts
│   │
│   └── types/
│       ├── fastify.d.ts
│       ├── authentication.ts
│       └── websocket.ts
│
├── test/
│   ├── unit/
│   ├── integration/
│   ├── contract/
│   ├── security/
│   ├── load/
│   ├── fixtures/
│   ├── helpers/
│   └── setup.ts
│
├── scripts/
│   ├── check-config.ts
│   └── generate-openapi.ts
│
├── docs/  # Unsure if necessary
│   ├── openapi/
│   ├── websocket-protocol.md
│   └── runbooks/
│
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── eslint.config.js
├── package.json
├── tsconfig.json
└── README.md
```

Directories for services that have not yet been integrated should be added when their first route or event is implemented. Empty placeholder feature directories are unnecessary.

## Main entry points

### `src/app.ts`

Builds and returns the Fastify application. It registers plugins and routes but does not start a network listener. Keeping this separate makes integration tests straightforward.

```typescript
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify(options.fastify)

  await registerInfrastructure(app, options)
  await registerRoutes(app)

  return app
}
```

### `src/main.ts`

The process entry point. It loads configuration, creates the app, starts listening, and coordinates graceful shutdown. It should remain small.

## Feature organization

Features are grouped by public API capability rather than by generic technical type. A completed feature usually contains:

```text
features/orders/
├── routes.ts    # Fastify method/path, policy, and schema attachment
├── schemas.ts   # public request and response JSON schemas
├── handler.ts   # orchestration and call to the service adapter
└── mapper.ts    # REST model <-> protobuf model conversion
```

This keeps all code needed to understand an endpoint close together.

### `routes.ts`

Declares the external contract:

- HTTP method and path.
- Authentication and scope requirements.
- Rate-limit class.
- Request deadline.
- Request and response schemas.
- Handler.

It must not create raw gRPC clients, read environment variables, or implement domain rules.

### `handler.ts`

Coordinates the request:

- Reads already validated input and verified request identity.
- Calls one or more typed service clients.
- Applies the endpoint's timeout and partial-failure policy.
- Returns the public response model.

It must not verify passwords, calculate wallet balances, decide whether orders can be matched, or reproduce other service business logic.

### `mapper.ts`

Separates the public API from protobuf representation. This prevents protobuf field or SDK changes from leaking automatically into REST/WebSocket contracts.

## Plugins versus transport modules

The `plugins/` directory contains Fastify integration and lifecycle code. For example, `plugins/grpc.ts` creates clients during startup, decorates the Fastify instance with typed adapters, and closes them during shutdown.

The `transport/` directory contains the technology-specific implementation used by those plugins:

- gRPC channel credentials, metadata, deadlines, errors, and generated client wrappers.
- Kafka consumer setup, topic definitions, event decoding, and routing.
- Redis client setup, key construction, and atomic rate-limit scripts.

This division prevents Fastify-specific lifecycle code from spreading into transport adapters.

## gRPC clients

Each `*.client.ts` file wraps the generated SDK client for one service. The wrapper should:

- Reuse a process-level channel.
- Apply deadlines and cancellation.
- Attach gateway-generated identity and trace metadata.
- Convert transport errors into internal typed errors.
- Hide generated SDK setup from feature handlers.

It must not contain public HTTP response logic or domain business rules.

The `credentials.ts` module implements the phased security decision:

- Explicit plaintext credentials for local development.
- No silent plaintext fallback in production.
- A single future integration point for service-mesh-related transport configuration.

## Authentication and authorization

`plugins/authentication.ts` verifies RS256 access tokens through Auth Service JWKS and creates a typed authenticated principal on the request.

`plugins/authorization.ts` and `policies/permissions.ts` implement coarse route-level permission checks. Resource ownership and state-dependent authorization remain in downstream services.

`transport/grpc/metadata.ts` converts the verified principal into canonical internal metadata. It must overwrite reserved identity fields rather than forwarding client-provided values.

## Kafka and WebSockets

`transport/kafka/consumer.ts` manages Kafka connection and consumer lifecycle. `event-router.ts` validates client-facing Kafka events and forwards them to the WebSocket delivery layer.

The `websocket/` directory owns:

- Connection and authentication state.
- Versioned client message schemas.
- Topic/subscription authorization.
- Heartbeats and idle connections.
- Backpressure and slow-consumer handling.
- Delivery to locally connected clients.

Kafka consumers must consume dedicated client-facing topics, not expose raw domain or meter topics directly.

## Policies

Named policies prevent important behavior from becoming scattered route constants:

```typescript
export const routePolicies = {
  authLogin: {
    authentication: 'public',
    rateLimit: 'auth-login',
    timeoutMs: 3_000,
  },
  createOrder: {
    authentication: 'required',
    scopes: ['orders:write'],
    rateLimit: 'authenticated-write',
    timeoutMs: 5_000,
    idempotency: 'required',
  },
} as const
```

Values shown here are structural examples, not approved production limits.

## Shared code rule

Place something in `common/` only when at least two real features need it and it has no domain ownership. Avoid generic `utils.ts`, `helpers.ts`, or `services.ts` files because they become unstructured dumping grounds.

Generated protobuf code should remain in the installed TypeScript SDK package. Do not copy it into `src/types` or edit generated files inside the gateway.

## Testing layout

- `unit/`: policies, mappers, error mapping, and pure protocol logic.
- `integration/`: Fastify lifecycle, Redis, JWKS, Kafka, gRPC test servers, and WebSockets.
- `contract/`: public schemas and protobuf compatibility.
- `security/`: token, metadata spoofing, cross-user access, origin, and limit tests.
- `load/`: REST aggregation and concurrent WebSocket scenarios.
- `fixtures/`: test-only keys, protobuf responses, Kafka events, and public payloads with no production credentials.

Tests should generally mirror source paths so ownership is immediately visible.

## Dependency direction

Use this dependency direction:

```text
Fastify routes
      |
      v
Feature handlers and mappers
      |
      v
Typed transport clients
      |
      v
Generated SDKs / Redis / Kafka
```

Transport code must not import feature handlers. Common infrastructure must not import individual feature modules. These constraints prevent circular dependencies and keep the gateway replaceable at its internal boundaries.

## When to split further

Do not introduce a monorepo, internal package collection, or separate WebSocket repository initially. Consider splitting only when independently deployable scaling or ownership is demonstrated—for example, if WebSocket fan-out needs a very different replica count and lifecycle from REST traffic.
