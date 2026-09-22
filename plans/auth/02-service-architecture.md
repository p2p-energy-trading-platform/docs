---
connie-title: Auth Service Architecture
---

# Auth Service Architecture

## Component Boundary

``` text
                         CLIENT
                            |
                          HTTPS
                            v
                  +-------------------+
                  |   API Gateway     |
                  |   Fastify / TS    |
                  +---------+---------+
                            |
                           gRPC
                            |
                            v
                  +-------------------+
                  |   Auth Service    |
                  |   Fastify / TS    |
                  +----+---------+----+
                       |         |
                       v         v
                 PostgreSQL    Redis
```

## Responsibilities by Component

### API Gateway

- Terminates external HTTP(S).
- Validates JWT signatures and standard claims.
- Performs gateway-level rate limiting.
- Routes requests.
- Propagates authenticated identity context to downstream services.
- Does not own users or passwords.

### Auth Service

- Owns authentication state.
- Issues credentials.
- Manages sessions and refresh tokens.
- Manages account verification.
- Manages password reset.
- Provides authentication-related gRPC APIs.
- Publishes authentication public keys through JWKS.

### PostgreSQL

Stores durable identity data:

- Users.
- Credentials.
- Sessions/refresh-token records.
- Roles.
- Permissions.
- Account state.
- Verification state where persistence is required.
- Audit records where required.

### Redis

Stores short-lived state:

- Login rate-limit counters.
- Password-reset tokens.
- Email-verification tokens.
- Short-lived session/revocation state.
- Temporary registration/onboarding state when appropriate.

## Internal Communication

Service-to-service communication uses gRPC and the common Protobuf
contract.

The TypeScript Auth Service consumes the generated TypeScript SDK.

Do not introduce a Python-specific SDK solely for Auth.

## Request Pattern

Normal authenticated request:

``` text
Client
  |
  | JWT
  v
Gateway
  |
  | local JWT verification
  v
Backend Service
```

Auth-specific operation:

``` text
Backend Service
  |
  | gRPC
  v
Auth Service
```

Auth should not be a synchronous dependency for every ordinary API
request.

## Service-to-Service Identity

User identity and service identity are separate.

- User requests use access tokens.
- Internal service calls should use service identity, preferably
    mTLS/workload identity in the deployment environment.
- A user JWT must not be treated as proof that one internal service is
    another service.

## System Boundary

DEWA Mock and IoT Simulator remain outside the platform boundary.

The platform communicates with the DEWA Mock through its small HTTP API.
The IoT Simulator communicates with the platform through the intended
simulation interfaces such as MQTT.
