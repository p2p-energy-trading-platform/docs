---
connie-title: API Gateway Plan 
---

# GridX API Gateway Plan

This directory contains the proposed implementation plan for the GridX API Gateway. It separates architecture decisions from repository setup instructions so that each subject can be reviewed and changed independently.

The existing [api-gateway.md](api-gateway.md) and [gRPC.md](gRPC.md) files are retained unchanged as legacy drafts. Where they conflict with this plan, the decisions in this README and the linked documents take precedence after team approval.

## Intended outcome

The API Gateway is the only public application endpoint for GridX web and mobile clients. It accepts REST and WebSocket traffic, verifies identities issued by the Auth Service, applies edge policies, and calls internal services over gRPC.

The gateway is an orchestration and protocol-translation layer. It is not a system of record and must not contain domain business logic.

```text
Web and mobile clients
        |
        | HTTPS REST / WSS
        v
API Gateway (Fastify)
        |
        | authenticated internal gRPC
        v
Auth, order, market, trade, wallet, device, and notification services
```

The Auth Service owns authentication and user/profile data. The gateway may expose `/auth/*`, `/users/me`, and profile-related public endpoints, but it delegates those operations to the Auth Service.

## Plan documents

| Document | Purpose |
|---|---|
| [01-architecture.md](01-architecture.md) | Responsibilities, boundaries, request flows, and repository shape |
| [02-authentication-and-authorization.md](02-authentication-and-authorization.md) | RS256/JWKS decision, token validation, permissions, revocation, and identity propagation |
| [03-grpc.md](03-grpc.md) | Internal contracts, secure channels, deadlines, retries, and error mapping |
| [04-rate-limiting.md](04-rate-limiting.md) | Redis-backed distributed rate-limit design |
| [05-websockets.md](05-websockets.md) | Authentication, subscriptions, scaling, and connection lifecycle |
| [06-api-and-reliability.md](06-api-and-reliability.md) | REST conventions, aggregation, resilience, and error contracts |
| [07-operations-and-security.md](07-operations-and-security.md) | Configuration, observability, deployment, and security controls |
| [08-testing-and-delivery.md](08-testing-and-delivery.md) | Test strategy, milestones, and acceptance criteria |
| [09-folder-structure.md](09-folder-structure.md) | Recommended repository layout and dependency boundaries |

## Confirmed decisions

- Fastify with TypeScript is used for the gateway and Auth Service.
- Frontend clients access backend capabilities only through HTTPS REST and WSS endpoints on the gateway.
- Internal synchronous communication uses gRPC.
- The Auth Service owns credentials, token issuance, refresh sessions, users, and profiles.
- The gateway verifies access tokens but does not issue them.
- Access tokens use asymmetric signatures. The initial algorithm is RS256, with verification keys distributed through JWKS.
- Distributed rate-limit state is stored in Redis; it is not kept only in gateway process memory.
- The gateway can aggregate data for client-facing endpoints but does not make domain decisions.
- The gateway does not expose public gRPC endpoints.
- During local development, internal gRPC uses plaintext channels on the private development network. A service mesh will provide authenticated, encrypted service-to-service traffic in a later production phase.
- The gateway propagates verified user claims to downstream services as canonical gRPC metadata. It does not forward the original access token or create an internal user token.
- Kafka is the durable event broker for real-time events consumed by the WebSocket gateway.

## Details still to be resolved

These details are intentionally deferred until the related services or deployment environment exist:

1. The specific service-mesh product and deployment configuration. This does not block local plaintext gRPC development.
2. The final public route catalogue and owning gRPC method for every route. The catalogue will grow incrementally as domain services and protobuf contracts are built.
3. Kafka topic names, schemas, retention, WebSocket delivery semantics, and the multi-replica fan-out design.
4. Production capacity targets. Until load tests exist, the legacy values of 100 ordinary requests per minute and 10 authentication requests per minute are provisional per-client rate-limit defaults, not total gateway capacity estimates.

Redis is a mandatory gateway dependency in the current design. No local emergency limiter or fail-open mode is planned: an unavailable Redis instance makes the gateway unready, and affected requests return `503`.

## Planning rules

Every public route must declare its owner, request schema, response schema, authentication policy, authorization policy, rate-limit class, timeout, idempotency behavior, and gRPC mapping. Every implementation milestone must meet the acceptance criteria in [08-testing-and-delivery.md](08-testing-and-delivery.md).
