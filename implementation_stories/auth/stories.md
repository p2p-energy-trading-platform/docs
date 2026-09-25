---
connie-title: Auth Service - User Stories
---

# Auth Service - User Stories

* **Epic:** Auth Service
* **Repository:** [p2p-energy-trading-platform/auth-service](https://github.com/p2p-energy-trading-platform/auth-service)
* **Plan:** [docs/plans/auth/09-implementation-plan.md](https://github.com/p2p-energy-trading-platform/docs/blob/main/plans/auth/09-implementation-plan.md)

> This document breaks the Auth Service's 10-phase implementation plan down into component-level user stories, grouped by phase. Each story is checked against the actual `auth-service` repository — real files are cited under `Maps to`; anything not yet started is noted as such. Stories that are genuinely blocked (not just unstarted) are listed separately in Section 8 with reasons.

**Current repo state at a glance:** foundational scaffolding (config, error handling, Redis/Postgres plugins, observability, gRPC server) is in place. Cryptographic primitives (Argon2id password hashing, Ed25519 JWT signing, JWKS) are implemented and unit-tested. No database migrations exist yet (`migrations/` is empty), and the actual auth flows (register/login/refresh/logout) and authorization checks are empty gRPC stubs with no logic (`// Register: unimplemented` etc.).

---

## 1. Phase 1 — Service Foundation

### US-1.1 - Validate service configuration at startup

> **As** a developer, <br>
> **I want** the auth service to load and validate its configuration at startup, <br>
> **so that** misconfiguration fails fast instead of causing runtime errors.

*Maps to: `src/config/env.ts`, `src/config/schema.ts`, `src/config/types.ts`, `scripts/check-config.ts`*

**Acceptance Criteria:**

- Invalid or missing required env vars cause the process to exit with a clear error at startup.
- `npm run check-config` validates configuration without starting the full service.
- Config type errors are caught at compile time via `src/config/types.ts`.

**Status:** Already implemented — mirrors the pattern built for `api-gateway`'s US-1.1.

---

### US-1.2 - Structured logging

> **As** an SRE/QA engineer, <br>
> **I want** structured, leveled logging across the service, <br>
> **so that** operational issues can be diagnosed from log output.

*Maps to: `src/plugins/observability.ts`*

**Acceptance Criteria:**

- Log level is configurable via env var.
- Logs are structured (JSON), not plain text.
- Sensitive fields (passwords, tokens, secrets) are never logged in plaintext.

**Status:** `src/plugins/observability.ts` exists (48 lines) but there is no dedicated `observability/logging.ts` or `observability/redaction.ts` as the README's aspirational structure describes — confirm with the team whether logging/redaction lives inside the plugin file or still needs to be split out and whether redaction is actually implemented yet.

---

### US-1.3 - Database and Redis connectivity

> **As** the service, <br>
> **I want** managed PostgreSQL and Redis connections wired into Fastify, <br>
> **so that** downstream features can persist and cache data reliably.

*Maps to: `src/plugins/database.ts`, `src/plugins/database.test.ts`, `src/plugins/redis.ts`, `src/plugins/redis.test.ts`*

**Acceptance Criteria:**

- Database plugin establishes a Postgres connection pool and exposes it via Fastify decoration.
- Redis plugin establishes a connection and exposes it similarly.
- Both connections are covered by tests (already present) and reported in the readiness check (see US-1.4).

**Status:** Already implemented and tested.

---

### US-1.4 - Health and readiness endpoints

> **As** an infrastructure operator, <br>
> **I want** liveness and readiness endpoints on the auth service, <br>
> **so that** orchestration knows when the service is healthy and ready to receive traffic.

*Maps to: `src/transport/http/health/routes.ts`, `src/transport/http/health/liveness.ts`, `src/transport/http/health/readiness.ts`*

**Acceptance Criteria:**

- Liveness endpoint returns 200 if the process is running.
- Readiness endpoint returns 200 only when Postgres and Redis connections are established.
- Unready state returns a non-200 status.

**Status:** Already implemented.

---

## 2. Phase 2 — Database

### US-2.1 - Core schema migrations

> **As** a developer, <br>
> **I want** Goose migrations for users, credentials, sessions/refresh tokens, roles, permissions, user-roles, and role-permissions, <br>
> **so that** the service has a working relational schema to build features against.

*Maps to: `migrations/` (currently empty except `.gitkeep`)*

**Acceptance Criteria:**

- Each table listed above has a forward migration and a corresponding rollback migration.
- Appropriate indexes and uniqueness constraints are added (e.g. unique email, unique role name).
- `npm run db:up` / `npm run db:status` / `npm run db:down` work against a local Postgres instance via `gridx-infra`/`gridx-workspace`.

**Status:** Not started — `migrations/` only contains `.gitkeep`. This is a hard prerequisite for nearly every feature in Phases 3–6, so it should be prioritized first.

---

## 3. Phase 3 — Password Authentication

### US-3.1 - Password hashing primitive

> **As** the service, <br>
> **I want** a reusable Argon2id password hashing/verification utility, <br>
> **so that** credentials are never stored or compared in plaintext.

*Maps to: `src/infrastructure/crypto/password-hasher.ts`, `src/infrastructure/crypto/password-hasher.test.ts`*

**Acceptance Criteria:**

- Hash function uses Argon2id with reasonable cost parameters.
- Verify function correctly accepts matching passwords and rejects non-matching ones.
- Unit tests cover both paths.

**Status:** Already implemented and tested.

---

### US-3.2 - User registration

> **As** a new user, <br>
> **I want** to register an account with email and password, <br>
> **so that** I can access the platform.

*Maps to: `src/features/authentication/register.ts` (not yet created), `src/transport/grpc/services/auth-service.ts`*

**Acceptance Criteria:**

- Email is normalized (lowercase, trimmed) before storage.
- Password is hashed via US-3.1's utility before persistence.
- Duplicate email registration is rejected with a clear error.
- gRPC `Register` method (currently `// Register: unimplemented` in `auth-service.ts`) is implemented and wired to this logic.

**Status:** Not started. The gRPC method slot exists but is an empty stub. **Depends on US-2.1** (users/credentials tables must exist first).

---

### US-3.3 - Login and logout

> **As** a registered user, <br>
> **I want** to log in with email/password and log out, <br>
> **so that** I can securely access and end my session.

*Maps to: `src/features/authentication/login.ts`, `src/features/authentication/logout.ts` (not yet created), `src/transport/grpc/services/auth-service.ts`*

**Acceptance Criteria:**

- Login verifies credentials via US-3.1 and checks account status (active/locked/disabled) before issuing tokens.
- Logout invalidates the current session/refresh token.
- gRPC `Login` and `Logout` methods (currently stubbed) are implemented.

**Status:** Not started. **Depends on US-2.1 and US-3.2.**

---

## 4. Phase 4 — Tokens and Sessions

### US-4.1 - JWT signing and key management

> **As** the service, <br>
> **I want** Ed25519-based JWT access-token signing with a key provider abstraction, <br>
> **so that** tokens are cryptographically verifiable and keys can be rotated.

*Maps to: `src/infrastructure/crypto/jwt-signer.ts` (+test), `src/infrastructure/crypto/key-provider.ts` (+test), `scripts/generate-dev-keys.mjs`*

**Acceptance Criteria:**

- Signer produces valid Ed25519-signed JWTs.
- Key provider supports loading the current signing key and exposes key metadata for JWKS.
- Unit tests cover signing and key retrieval.

**Status:** Already implemented and tested.

---

### US-4.2 - JWKS endpoint

> **As** a relying party (e.g. the API Gateway), <br>
> **I want** a JWKS endpoint publishing the service's public keys, <br>
> **so that** access tokens can be verified without calling the auth service on every request.

*Maps to: `src/features/keys/service.ts`, `src/features/keys/jwks.ts`, `src/transport/http/jwks.ts`*

**Acceptance Criteria:**

- `GET /.well-known/jwks.json` (or equivalent) returns the current public key(s) in JWK format.
- Response is cacheable (appropriate cache headers).

**Status:** Already implemented — `src/transport/http/jwks.ts` exists and wires to `features/keys`.

---

### US-4.3 - Refresh tokens and rotation

> **As** a logged-in user, <br>
> **I want** my session to be extendable via a refresh token that rotates on use, <br>
> **so that** I stay logged in securely without re-entering credentials constantly.

*Maps to: `src/features/authentication/refresh.ts`, `src/features/sessions/*` (not yet created), `src/infrastructure/crypto/token-hasher.ts`*

**Acceptance Criteria:**

- Refresh token is single-use; using it issues a new access token and a new refresh token, invalidating the old one.
- Refresh tokens are stored hashed (via `token-hasher.ts`), never in plaintext.
- gRPC `Refresh` method (currently stubbed) is implemented.

**Status:** Not started — `token-hasher.ts` primitive exists, but no session/refresh feature logic. **Depends on US-2.1 and US-3.3.**

---

### US-4.4 - Session revocation ("logout all")

> **As** a user, <br>
> **I want** to revoke all active sessions (e.g. after a suspected compromise), <br>
> **so that** I can secure my account from any device.

*Maps to: `src/features/authentication/logout-all.ts` (not yet created)*

**Acceptance Criteria:**

- All refresh tokens/sessions for the user are invalidated in one operation.
- gRPC `LogoutAll` method (currently stubbed) is implemented.

**Status:** Not started. **Depends on US-4.3.**

---

## 5. Phase 6 — Authorization

### US-5.1 - Roles and permissions data model + checks

> **As** the platform, <br>
> **I want** roles, permissions, and user-role assignments enforced via an authorization service, <br>
> **so that** access control decisions are centralized and consistent.

*Maps to: `src/features/authorization/*` (not yet created), `src/transport/grpc/services/authorization-service.ts`*

**Acceptance Criteria:**

- `GetUser` and `CheckPermission` gRPC methods (currently `// unimplemented` stubs) are implemented.
- Permission checks correctly reflect a user's assigned roles.
- Covered by unit tests.

**Status:** Not started — only the empty gRPC service scaffold exists (`authorization-service.ts` is 6 lines, both methods commented out). **Depends on US-2.1** (roles/permissions/user-roles/role-permissions tables).

---

## 6. Phase 9 — Onboarding / KYC

### US-6.1 - Onboarding state machine

> **As** a new user, <br>
> **I want** my onboarding/KYC progress tracked through defined states, <br>
> **so that** the platform knows what verification steps remain before I can trade.

*Maps to: not yet created — no `features/onboarding/` or similar exists*

**Acceptance Criteria:**

- Defined onboarding states (e.g. `registered`, `pending_verification`, `verified`, `rejected`).
- State transitions are validated (no skipping required steps).

**Status:** Not started — listed here rather than "blocked" because the state machine itself doesn't require an external decision, only the actual KYC provider integration does (see Section 8).

---

## 7. Phase 10 — Hardening

### US-7.1 - Security and failure-recovery test suite

> **As** an SRE/QA engineer, <br>
> **I want** dedicated security, load, and failure-recovery tests, <br>
> **so that** the auth service is verified against abuse and partial-outage scenarios before production use.

*Maps to: `test/security/`, `test/load/` (per README's planned structure — not yet created; only `tests/.gitkeep` currently exists)*

**Acceptance Criteria:**

- Security tests cover things like brute-force login attempts, token replay, and expired-key handling.
- Load tests establish baseline throughput/latency for login and token verification.
- Rate-limit tuning and key-rotation are explicitly tested.

**Status:** Not started — correctly sequenced last, since it depends on nearly every other phase being functional first.

---

## 8. Blocked User Stories (Cannot Be Developed Yet)

### US-8.1 - Gateway JWT verification integration

> **As** the API Gateway, <br>
> **I want** to verify access tokens locally using the auth service's JWKS, <br>
> **so that** most requests don't require a round-trip to the auth service.

*Maps to: this work lives in the `api-gateway` repository, not `auth-service` — see that project's Authentication story (US-7.1 in the `api-gateway` doc)*

**Reason Blocked:** This is Phase 7 of the plan and is explicitly gateway-side work. It's tracked in the separate `api-gateway` user stories document and depends on US-4.1/US-4.2 above (JWKS) being stable first.

---

### US-8.2 - SSO / OIDC providers

> **As** a user, <br>
> **I want** to sign in via an external identity provider (SSO), <br>
> **so that** I don't need a separate password for this platform.

*Maps to: not yet created*

**Reason Blocked:** The implementation plan explicitly states Phase 8 (SSO) should only begin "after the local authentication flow is stable" — i.e. after Phases 3–4 are complete. Starting this now would mean building against a moving target.

---

### US-8.3 - KYC provider integration

> **As** the platform, <br>
> **I want** to integrate a third-party KYC/identity-verification provider, <br>
> **so that** users can be verified before trading real energy/funds.

*Maps to: not yet created*

**Reason Blocked:** The plan itself states the KYC service boundary and provider must be *selected* before integration work starts ("Integrate the selected provider"). No provider decision has been made yet — this needs a team/supervisor decision, not just development time.

---

## Summary Table

| ID | Story | Phase | Status |
|------|--------|-------|--------|
| US-1.1 | Validate service configuration at startup | 1 | Done |
| US-1.2 | Structured logging | 1 | Partial — confirm redaction/logging split |
| US-1.3 | Database and Redis connectivity | 1 | Done |
| US-1.4 | Health and readiness endpoints | 1 | Done |
| US-2.1 | Core schema migrations | 2 | Not started — prerequisite for Phases 3–6 |
| US-3.1 | Password hashing primitive | 3 | Done |
| US-3.2 | User registration | 3 | Not started — depends on US-2.1 |
| US-3.3 | Login and logout | 3 | Not started — depends on US-2.1, US-3.2 |
| US-4.1 | JWT signing and key management | 4 | Done |
| US-4.2 | JWKS endpoint | 4 | Done |
| US-4.3 | Refresh tokens and rotation | 4 | Not started — depends on US-2.1, US-3.3 |
| US-4.4 | Session revocation ("logout all") | 4 | Not started — depends on US-4.3 |
| US-5.1 | Roles/permissions authorization checks | 6 | Not started — depends on US-2.1 |
| US-6.1 | Onboarding state machine | 9 | Not started |
| US-7.1 | Security/failure-recovery test suite | 10 | Not started — depends on all above |
| US-8.1 | Gateway JWT verification integration | 7 | Blocked — lives in `api-gateway` repo |
| US-8.2 | SSO / OIDC providers | 8 | Blocked — plan requires Phases 3–4 stable first |
| US-8.3 | KYC provider integration | 9 | Blocked — provider not yet selected |

---
