---
connie-title: Auth Service Implementation Plan
---

# Auth Service Implementation Plan

Implementation should proceed incrementally rather than building every
feature at once.

## Phase 1 --- Service Foundation

Create:

- TypeScript project.
- Fastify application.
- Configuration module.
- Structured logging.
- Error handling.
- PostgreSQL connection.
- Redis connection.
- Health/readiness endpoints.
- Docker/development setup.

## Phase 2 --- Database

Implement migrations for:

- Users.
- Credentials.
- Sessions/refresh tokens.
- Roles.
- Permissions.
- User roles.
- Role permissions.

Add indexes and uniqueness constraints.

## Phase 3 --- Password Authentication

Implement:

- Registration.
- Email normalization.
- Argon2id hashing.
- Login.
- Account status checks.
- Logout.

Add unit and integration tests.

## Phase 4 --- Tokens and Sessions

Implement:

- JWT access-token creation.
- Ed25519 signing.
- JWKS endpoint.
- Refresh tokens.
- Refresh-token rotation.
- Session revocation.
- Key configuration and rotation support.

## Phase 5 --- Verification and Recovery

Implement:

- Email verification.
- Password reset.
- Redis-backed one-time tokens.
- Expiration and single-use enforcement.

## Phase 6 --- Authorization

Implement:

- Roles.
- Permissions.
- User-role assignments.
- Permission checks.
- Auth gRPC service.
- TypeScript SDK integration.

## Phase 7 --- Gateway Integration

Implement:

- JWT verification middleware/plugin in Fastify Gateway.
- JWKS retrieval/caching.
- Issuer/audience validation.
- User identity extraction.
- Rate limiting.
- Authenticated request context.

## Phase 8 --- SSO

Add OIDC/OAuth-based providers only after the local authentication flow
is stable.

## Phase 9 --- Onboarding/KYC

For KYC form:

- Define onboarding states.
- Define the KYC service boundary.
- Integrate the selected provider.
- Store only the data actually required by the platform.

## Phase 10 --- Hardening

Complete:

- Security tests.
- Rate-limit tuning.
- Key rotation testing.
- Session-revocation testing.
- Failure/recovery tests.
- Observability.
- Deployment secrets.
- Backup/recovery procedures.
