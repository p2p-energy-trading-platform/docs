---
connie-title: Auth Service - User Stories
---

# Auth Service - User Stories

- **Epic:** Auth Service
- **Repository:** [p2p-energy-trading-platform/auth-service](https://github.com/p2p-energy-trading-platform/auth-service)
- **Plan:** [docs/plans/auth/09-implementation-plan.md](https://github.com/p2p-energy-trading-platform/docs/blob/main/plans/auth/09-implementation-plan.md)

> This document breaks the Auth Service's 10-phase implementation plan down into component-level user stories, grouped by phase. Each story is checked against the actual `auth-service` repository, with related files cited under `Maps to`. Implementation status is distinguished from test verification and cross-service integration. Stories that remain dependent on external decisions or other repositories are listed separately.

**Current repo state at a glance:** The foundational service components, PostgreSQL and Redis connectivity, health checks, structured logging, and cryptographic utilities are implemented. Database migrations now exist for users, credentials, sessions, roles, permissions, and KYC-related tables. Registration, login, logout, and logout-all flows have been implemented and connected to the gRPC authentication service. Session persistence uses PostgreSQL with Redis caching. JWT signing and JWKS functionality are present. However, dedicated end-to-end verification, refresh-token rotation, complete authorization checks, and API Gateway authentication integration remain outstanding or require further verification.

---

## 1. Phase 1 — Service Foundation

### US-1.1 - Validate service configuration at startup

> **As** a developer,  
> **I want** the auth service to load and validate its configuration at startup,  
> **so that** misconfiguration fails fast instead of causing runtime errors.

**Maps to:** `src/config/env.ts`, `src/config/schema.ts`, `src/config/types.ts`, `scripts/check-config.ts`

**Acceptance Criteria:**

- Invalid or missing required environment variables cause the process to exit with a clear error at startup.
- `npm run check-config` validates configuration without starting the full service.
- Config type errors are caught at compile time via `src/config/types.ts`.

**Status:** Implemented. Configuration loading, validation, and typed configuration are present. Automated verification should be included in the final service check.

---

### US-1.2 - Structured logging

> **As** an SRE/QA engineer,  
> **I want** structured, leveled logging across the service,  
> **so that** operational issues can be diagnosed from log output.

**Maps to:** `src/plugins/observability.ts`

**Acceptance Criteria:**

- Log level is configurable via environment variable.
- Logs are structured (JSON), not plain text.
- Sensitive fields (passwords, tokens, secrets) are never logged in plaintext.

**Status:** Implemented. Structured logging and sensitive-field redaction are configured through the observability plugin. Redaction covers sensitive authentication-related fields, including passwords, authorization data, and tokens.

---

### US-1.3 - Database and Redis connectivity

> **As** the service,  
> **I want** managed PostgreSQL and Redis connections wired into Fastify,  
> **so that** downstream features can persist and cache data reliably.

**Maps to:** `src/plugins/database.ts`, `src/plugins/database.test.ts`, `src/plugins/redis.ts`, `src/plugins/redis.test.ts`

**Acceptance Criteria:**

- Database plugin establishes a Postgres connection pool and exposes it via Fastify decoration.
- Redis plugin establishes a connection and exposes it similarly.
- Both connections are covered by tests and reported in the readiness check (see US-1.4).

**Status:** Implemented. PostgreSQL and Redis plugins and their corresponding tests are present.

---

### US-1.4 - Health and readiness endpoints

> **As** an infrastructure operator,  
> **I want** liveness and readiness endpoints on the auth service,  
> **so that** orchestration knows when the service is healthy and ready to receive traffic.

**Maps to:** `src/transport/http/health/routes.ts`, `src/transport/http/health/liveness.ts`, `src/transport/http/health/readiness.ts`

**Acceptance Criteria:**

- Liveness endpoint returns 200 if the process is running.
- Readiness endpoint returns 200 only when Postgres and Redis connections are established.
- Unready state returns a non-200 status.

**Status:** Implemented. Liveness and readiness endpoints are present, including database and Redis dependency checks.

---

## 2. Phase 2 — Database

### US-2.1 - Core schema migrations

> **As** a developer,  
> **I want** Goose migrations for users, credentials, sessions/refresh tokens, roles, permissions, user-roles, and role-permissions,  
> **so that** the service has a working relational schema to build features against.

**Maps to:** `migrations/20260928103514_update_timestamp_function.sql`, `migrations/20260928103919_create_users_table.sql`, `migrations/20260928104328_create_credentials_table.sql`, `migrations/20260928105718_create_sessions_table.sql`, `migrations/20260928105929_create_roles_permissions_tables.sql`, `migrations/20260928110810_create_kyc_tables.sql`

**Acceptance Criteria:**

- Each required table has a forward migration and a corresponding rollback migration.
- Appropriate indexes and uniqueness constraints are added (e.g. unique email, unique role name).
- `npm run db:up` / `npm run db:status` / `npm run db:down` work against a local Postgres instance via `gridx-infra` / `gridx-workspace`.

**Status:** Implemented. Migration files now exist for the core user, credential, session, role/permission, and KYC schemas. Migration execution, rollback behavior, and database constraints should be verified against the local PostgreSQL environment before marking the story fully verified.

---

## 3. Phase 3 — Password Authentication

### US-3.1 - Password hashing primitive

> **As** the service,  
> **I want** a reusable Argon2id password hashing/verification utility,  
> **so that** credentials are never stored or compared in plaintext.

**Maps to:** `src/infrastructure/crypto/password-hasher.ts`, `src/infrastructure/crypto/password-hasher.test.ts`

**Acceptance Criteria:**

- Hash function uses Argon2id with reasonable cost parameters.
- Verify function correctly accepts matching passwords and rejects non-matching ones.
- Unit tests cover both paths.

**Status:** Implemented and unit-tested.

---

### US-3.2 - User registration

> **As** a new user,  
> **I want** to register an account with email and password,  
> **so that** I can access the platform.

**Maps to:** `src/features/authentication/register.ts`, `src/features/users/repository.ts`, `src/transport/grpc/services/auth-service.ts`, `migrations/20260928103919_create_users_table.sql`, `migrations/20260928104328_create_credentials_table.sql`

**Acceptance Criteria:**

- Email is normalized (lowercase, trimmed) before storage.
- Password is hashed via US-3.1's utility before persistence.
- Duplicate email registration is rejected with a clear error.
- gRPC `Register` method is implemented and wired to this logic.

**Status:** Implemented. Registration includes email normalization, password hashing, user and credential persistence, default role assignment, and duplicate-email handling. Database-backed integration tests should be verified before considering the complete flow fully tested.

---

### US-3.3 - Login and logout

> **As** a registered user,  
> **I want** to log in with email/password and log out,  
> **so that** I can securely access and end my session.

**Maps to:** `src/features/authentication/login.ts`, `src/features/authentication/logout.ts`, `src/features/sessions/repository.ts`, `src/features/users/repository.ts`, `src/transport/grpc/services/auth-service.ts`

**Acceptance Criteria:**

- Login verifies credentials via US-3.1 and checks account status before issuing tokens.
- Logout invalidates the current session/refresh token.
- gRPC `Login` and `Logout` methods are implemented.

**Status:** Implemented. Login verifies credentials, checks account status, issues an access token and refresh token, and persists the session. Logout revokes the corresponding session using the refresh-token hash. Full authentication-flow integration testing remains to be verified.

---

## 4. Phase 4 — Tokens and Sessions

### US-4.1 - JWT signing and key management

> **As** the service,  
> **I want** Ed25519-based JWT access-token signing with a key provider abstraction,  
> **so that** tokens are cryptographically verifiable and keys can be rotated.

**Maps to:** `src/infrastructure/crypto/jwt-signer.ts`, `src/infrastructure/crypto/jwt-signer.test.ts`, `src/infrastructure/crypto/key-provider.ts`, `src/infrastructure/crypto/key-provider.test.ts`, `scripts/generate-dev-keys.mjs`

**Acceptance Criteria:**

- Signer produces valid Ed25519-signed JWTs.
- Key provider supports loading the current signing key and exposes key metadata for JWKS.
- Unit tests cover signing and key retrieval.

**Status:** Implemented and unit-tested. JWT signing and key-provider functionality are present.

---

### US-4.2 - JWKS endpoint

> **As** a relying party (e.g. the API Gateway),  
> **I want** a JWKS endpoint publishing the service's public keys,  
> **so that** access tokens can be verified without calling the auth service on every request.

**Maps to:** `src/features/keys/service.ts`, `src/features/keys/jwks.ts`, `src/transport/http/jwks.ts`

**Acceptance Criteria:**

- `GET /.well-known/jwks.json` (or equivalent) returns the current public key(s) in JWK format.
- Response is cacheable with appropriate cache headers.

**Status:** Implemented in the Auth Service. JWKS-related key functionality and the HTTP endpoint are present. End-to-end verification from the API Gateway remains part of US-8.1.

---

### US-4.3 - Refresh tokens and rotation

> **As** a logged-in user,  
> **I want** my session to be extendable via a refresh token that rotates on use,  
> **so that** I stay logged in securely without re-entering credentials constantly.

**Maps to:** `src/infrastructure/crypto/token-hasher.ts`, `src/features/sessions/repository.ts`, `src/features/authentication/login.ts`

**Acceptance Criteria:**

- Refresh token is single-use; using it issues a new access token and a new refresh token, invalidating the old one.
- Refresh tokens are stored hashed, never in plaintext.
- gRPC `Refresh` method is implemented.

**Status:** Partially implemented. Refresh-token hashing and session persistence are present, and login issues a refresh token stored as a hash. However, a complete refresh endpoint with single-use token rotation has not been verified and remains outstanding.

---

### US-4.4 - Session revocation ("logout all")

> **As** a user,  
> **I want** to revoke all active sessions,  
> **so that** I can secure my account from any device.

**Maps to:** `src/features/authentication/logout-all.ts`, `src/features/sessions/repository.ts`, `src/transport/grpc/services/auth-service.ts`

**Acceptance Criteria:**

- All refresh tokens/sessions for the user are invalidated in one operation.
- gRPC `LogoutAll` method is implemented.

**Status:** Implemented. The logout-all flow and gRPC method are present. Session revocation is persisted in PostgreSQL, with Redis cache invalidation handled on a best-effort basis. The caller identity is obtained from the `x-gridx-user-id` request header; secure identity propagation must be enforced by the trusted gateway so clients cannot supply or spoof this identity directly. Dedicated integration tests should be verified.

---

## 5. Phase 6 — Authorization

### US-5.1 - Roles and permissions data model + checks

> **As** the platform,  
> **I want** roles, permissions, and user-role assignments enforced via an authorization service,  
> **so that** access control decisions are centralized and consistent.

**Maps to:** `migrations/20260928105929_create_roles_permissions_tables.sql`, `src/features/users/repository.ts`, `src/transport/grpc/services/authorization-service.ts`

**Acceptance Criteria:**

- `GetUser` and `CheckPermission` gRPC methods are implemented.
- Permission checks correctly reflect a user's assigned roles.
- Covered by unit tests.

**Status:** Partially implemented. Role and permission database structures and default role assignment are present. However, the `GetUser` and `CheckPermission` authorization gRPC methods remain unimplemented, so centralized permission enforcement is outstanding.

---

## 6. Phase 9 — Onboarding / KYC

### US-6.1 - Onboarding state machine

> **As** a new user,  
> **I want** my onboarding/KYC progress tracked through defined states,  
> **so that** the platform knows what verification steps remain before I can trade.

**Maps to:** `migrations/20260928110810_create_kyc_tables.sql`

**Acceptance Criteria:**

- Defined onboarding states (e.g. `registered`, `pending_verification`, `verified`, `rejected`).
- State transitions are validated (no skipping required steps).

**Status:** Partially implemented. KYC-related database schema has been created. However, onboarding state-transition logic, validation, and application-level workflows have not been verified or completed.

---

## 7. Phase 10 — Hardening

### US-7.1 - Security and failure-recovery test suite

> **As** an SRE/QA engineer,  
> **I want** dedicated security, load, and failure-recovery tests,  
> **so that** the auth service is verified against abuse and partial-outage scenarios before production use.

**Maps to:** `src/infrastructure/crypto/`, `src/plugins/database.test.ts`, `src/plugins/redis.test.ts`, `tests/`

**Acceptance Criteria:**

- Security tests cover things like brute-force login attempts, token replay, and expired-key handling.
- Load tests establish baseline throughput/latency for login and token verification.
- Rate-limit tuning and key-rotation are explicitly tested.

**Status:** Partially implemented. Unit tests exist for cryptographic utilities and infrastructure plugins. A dedicated comprehensive security, load, and failure-recovery test suite has not been verified. Authentication-flow integration tests, token replay tests, brute-force protection tests, and load benchmarks remain to be completed or confirmed.

---

## 8. Blocked / Cross-Service User Stories

### US-8.1 - Gateway JWT verification integration

> **As** the API Gateway,  
> **I want** to verify access tokens locally using the auth service's JWKS,  
> **so that** most requests don't require a round-trip to the auth service.

**Maps to:** `api-gateway` repository, including `src/config/env.ts`, `src/plugins/security.ts`, and `src/app.ts`; Auth Service JWKS implementation under `src/transport/http/jwks.ts`.

**Reason / Status:** Not implemented in the current API Gateway runtime. Gateway configuration contains authentication-related settings, but the reviewed application bootstrap currently registers security, CORS, Redis, and health functionality without a complete JWT verification plugin, gRPC authentication integration, or protected authentication routes. The TypeScript SDK contains generated authentication contracts, but these alone do not provide runtime verification. This story remains outstanding and depends on stable Auth Service token/JWKS behavior.

---

### US-8.2 - SSO / OIDC providers

> **As** a user,  
> **I want** to sign in via an external identity provider (SSO),  
> **so that** I don't need a separate password for this platform.

**Maps to:** Not yet implemented.

**Reason Blocked:** The implementation plan states that Phase 8 (SSO) should begin after the local authentication flow is stable. Registration, login, and session functionality are now implemented, but refresh-token rotation and complete authorization integration still require further work before the local authentication foundation can be considered fully stable.

---

### US-8.3 - KYC provider integration

> **As** the platform,  
> **I want** to integrate a third-party KYC/identity-verification provider,  
> **so that** users can be verified before trading real energy/funds.

**Maps to:** KYC schema migration: `migrations/20260928110810_create_kyc_tables.sql`

**Reason Blocked:** The KYC database foundation exists, but the external provider has not been selected or integrated. Provider selection and the required service boundary must be agreed upon by the team before provider-specific integration begins.

---

## Summary Table

| ID | Story | Phase | Status |
|------|--------|-------|--------|
| US-1.1 | Validate service configuration at startup | 1 | Implemented |
| US-1.2 | Structured logging | 1 | Implemented |
| US-1.3 | Database and Redis connectivity | 1 | Implemented |
| US-1.4 | Health and readiness endpoints | 1 | Implemented |
| US-2.1 | Core schema migrations | 2 | Implemented — verify migration execution and rollback |
| US-3.1 | Password hashing primitive | 3 | Done — implemented and unit-tested |
| US-3.2 | User registration | 3 | Implemented — verify database-backed integration tests |
| US-3.3 | Login and logout | 3 | Implemented — verify end-to-end authentication tests |
| US-4.1 | JWT signing and key management | 4 | Done — implemented and unit-tested |
| US-4.2 | JWKS endpoint | 4 | Implemented — gateway integration pending |
| US-4.3 | Refresh tokens and rotation | 4 | Partial — refresh-token issuance/storage exists; rotation outstanding |
| US-4.4 | Session revocation ("logout all") | 4 | Implemented — verify identity propagation and integration tests |
| US-5.1 | Roles/permissions authorization checks | 6 | Partial — schema/default role assignment exists; permission checks outstanding |
| US-6.1 | Onboarding state machine | 9 | Partial — KYC schema exists; state-transition logic outstanding |
| US-7.1 | Security/failure-recovery test suite | 10 | Partial — unit tests exist; comprehensive security/load tests outstanding |
| US-8.1 | Gateway JWT verification integration | 7 | Not implemented — gateway runtime integration outstanding |
| US-8.2 | SSO / OIDC providers | 8 | Blocked — local authentication flow must be stabilized |
| US-8.3 | KYC provider integration | 9 | Blocked — provider selection required |

---