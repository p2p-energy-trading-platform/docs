---
connie-title: Auth Service Overview
---

# Auth Service Overview

## Purpose

The Auth Service is the platform's central identity and authentication
service for the P2P energy trading platform.

It is responsible for:

- User account creation and lifecycle.
- Email/password authentication.
- SSO authentication where supported.
- Email verification and password recovery.
- Access-token and refresh-token management.
- Session management.
- Roles and permissions.
- Authentication-related account state.
- KYC/onboarding state when the platform requires it.
- Signing keys used to issue access tokens.

It is **not** responsible for smart-meter telemetry, MQTT, Kafka
ingestion, matching, or DEWA integration logic.

## Technology Stack

  Concern                 Technology
  ----------------------- -----------------------------------------------------
  Language                TypeScript
  HTTP framework          Fastify
  Internal RPC            gRPC
  Contract                Existing common Protobuf + generated TypeScript SDK
  Database                PostgreSQL
  Ephemeral state/cache   Redis
  Password hashing        Argon2id
  Access tokens           Short-lived JWT
  Refresh tokens          Opaque random tokens
  JWT signing             EdDSA/Ed25519
  Key publication         JWKS
  Observability           OpenTelemetry
  API exposure            Through the Fastify API Gateway

## Architectural Role

``` text
Client
  |
  | HTTPS
  v
API Gateway (Fastify)
  |
  | gRPC
  v
Auth Service (Fastify + TypeScript)
  |
  +--> PostgreSQL
  |
  +--> Redis
```

The API Gateway should verify access-token signatures locally. It should
not call Auth Service for every request.

Auth Service is the authority that issues and manages credentials; other
services consume the resulting identity.

## Core Principles

1. PostgreSQL is the source of truth for persistent identity data.
2. Redis is used for short-lived and high-frequency state, not as the
    identity database.
3. Password hashes never leave Auth Service.
4. Access tokens are short-lived and self-verifiable.
5. Refresh tokens are opaque and stored server-side as hashes.
6. Asymmetric JWT signing avoids distributing a shared JWT secret to
    every service.
7. Authentication and authorization are separate concerns.
8. Smart-meter registration is a separate domain from user
    authentication.
9. The DEWA Mock is outside the platform system boundary.
10. The IoT Simulator is outside the platform system boundary.

## Out of Scope

The initial Auth Service does not implement:

- Device telemetry.
- MQTT communication.
- Kafka ingestion.
- Smart-meter public-key verification.
- Matching-engine authorization logic.
- DEWA business logic.
- Real KYC provider integration.
