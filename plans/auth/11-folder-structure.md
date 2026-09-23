---
connie-title: Auth & Dewa Folder Structure
---

# Folder structure for Auth service and DEWA app

## Auth Service Folder structure

```text
auth-service/
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
│   │   ├── database.ts
│   │   ├── grpc.ts
│   │   ├── observability.ts
│   │   ├── redis.ts
│   │   └── security.ts
│   │
│   ├── transport/
│   │   ├── grpc/
│   │   │   ├── server.ts
│   │   │   ├── credentials.ts
│   │   │   ├── metadata.ts
│   │   │   ├── deadlines.ts
│   │   │   ├── errors.ts
│   │   │   └── services/
│   │   │       ├── auth.service.ts
│   │   │       └── authorization.service.ts
│   │   │
│   │   └── http/
│   │       ├── routes.ts
│   │       ├── health/
│   │       │   ├── routes.ts
│   │       │   ├── liveness.ts
│   │       │   └── readiness.ts
│   │       └── jwks.ts
│   │
│   ├── features/
│   │   ├── authentication/
│   │   │   ├── register.ts
│   │   │   ├── login.ts
│   │   │   ├── refresh.ts
│   │   │   ├── logout.ts
│   │   │   └── logout-all.ts
│   │   │
│   │   ├── users/
│   │   │   ├── service.ts
│   │   │   ├── repository.ts
│   │   │   └── mapper.ts
│   │   │
│   │   ├── sessions/
│   │   │   ├── service.ts
│   │   │   ├── repository.ts
│   │   │   └── mapper.ts
│   │   │
│   │   ├── authorization/
│   │   │   ├── service.ts
│   │   │   ├── permissions.ts
│   │   │   └── roles.ts
│   │   │
│   │   ├── password/
│   │   │   ├── forgot-password.ts
│   │   │   ├── reset-password.ts
│   │   │   └── change-password.ts
│   │   │
│   │   └── keys/
│   │       ├── service.ts
│   │       └── jwks.ts
│   │
│   ├── infrastructure/
│   │   ├── database/
│   │   │   ├── client.ts
│   │   │   ├── migrations/
│   │   │   └── repositories/
│   │   │       ├── user.repository.ts
│   │   │       └── session.repository.ts
│   │   │
│   │   ├── redis/
│   │   │   ├── client.ts
│   │   │   ├── keys.ts
│   │   │   ├── rate-limit.ts
│   │   │   └── session-cache.ts
│   │   │
│   │   ├── crypto/
│   │   │   ├── password-hasher.ts
│   │   │   ├── jwt-signer.ts
│   │   │   ├── token-hasher.ts
│   │   │   └── key-provider.ts
│   │   │
│   │   └── email/
│   │       └── provider.ts
│   │
│   ├── observability/
│   │   ├── logging.ts
│   │   ├── metrics.ts
│   │   ├── tracing.ts
│   │   └── redaction.ts
│   │
│   ├── errors/
│   │   ├── app-error.ts
│   │   ├── codes.ts
│   │   ├── error-handler.ts
│   │   └── grpc-errors.ts
│   │
│   ├── common/
│   │   ├── request-context.ts
│   │   ├── validation.ts
│   │   ├── constants.ts
│   │   └── types.ts
│   │
│   └── types/
│       └── fastify.d.ts
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
│   └── check-config.ts
│
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── eslint.config.js
├── package.json
├── tsconfig.json
└── README.md
```

## DEWA Mock App Folder structure

A simple implementation is enough for DEWA app. This folder structure is subject to changes

```text
dewa-mock/
├── src/
│   ├── app.ts
│   ├── config.ts
│   │
│   ├── routes/
│   │   ├── link-requests.ts
│   │   └── meters.ts
│   │
│   ├── services/
│   │   ├── link-request-service.ts
│   │   └── meter-service.ts
│   │
│   ├── models/
│   │   ├── LinkRequest.ts
│   │   └── Meter.ts
│   │
│   ├── store/
│   │   ├── link-request-store.ts
│   │   └── meter-store.ts
│   │
│   └── frontend/
│       ├── index.html
│       ├── app.ts
│       └── styles.css
│
├── tests/
│   ├── link-requests.test.ts
│   └── meters.test.ts
│
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```
