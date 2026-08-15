# Authentication and Authorization

## Decision: RS256 access tokens with JWKS

Use asymmetrically signed JWT access tokens. Start with RS256 because it is widely supported and straightforward for the team to operate.

- The Auth Service has the private signing key and is the only service that signs access tokens.
- The Auth Service publishes current and retiring public keys as a JSON Web Key Set (JWKS).
- The API Gateway retrieves and caches the JWKS and verifies access tokens locally.
- The gateway never receives the Auth Service private key.
- A `kid` header identifies the signing key and permits rotation without an outage.

`JWT_SECRET` should not be part of the gateway configuration. In `@fastify/jwt`, the option named `secret` can also be a public key or an asynchronous key resolver; its name does not imply that a shared HMAC secret is required.

## Why not HS256 with a shared secret?

HS256 can be secure when supplied with a strong, protected secret, but every verifier that possesses the shared secret can also mint valid tokens. A gateway compromise could therefore become an Auth Service signing compromise. With RS256, the gateway holds only public verification material and cannot forge access tokens.

RS256 is not inherently universally stronger than HS256; it gives this architecture a safer separation of duties. EdDSA or ES256 can be evaluated later, but algorithm migration should not block the first implementation.

## Token types

Access and refresh tokens have different purposes and must use mutually exclusive validation rules.

### Access token

- A short-lived JWT, initially 10–15 minutes.
- Sent to the gateway as `Authorization: Bearer <token>`.
- Contains only claims needed for authentication and coarse authorization.
- Never stored in logs or returned in errors.

Recommended claims:

| Claim | Purpose |
|---|---|
| `iss` | Stable Auth Service issuer identifier |
| `sub` | Stable user identifier |
| `aud` | Intended resource server, initially the GridX API Gateway |
| `exp` | Expiration time |
| `iat` | Issued-at time |
| `jti` | Unique token identifier when revocation/audit requires it |
| `scope` | Space-delimited or structured coarse permissions |
| `roles` | Optional broad roles; do not use as a substitute for resource authorization |
| `typ` | Explicit token type, such as `at+jwt` |
| `ver` | Optional account/token version for revocation strategy |

Do not put passwords, secrets, sensitive profile data, or frequently changing domain state in the token.

### Refresh token

- Opaque, high-entropy credential rather than a general-purpose access JWT.
- Accepted only by the Auth Service refresh endpoint through the gateway.
- Stored hashed at rest by the Auth Service and associated with a session/device.
- Rotated on every successful use, with reuse detection.
- Revocable on logout, password change, compromise, or administrative action.

For browser clients, prefer a `Secure`, `HttpOnly`, appropriately scoped cookie for the refresh token and implement CSRF protection. The precise mobile secure-storage approach belongs in the client plan.

## Gateway verification requirements

The gateway must reject an access token unless all applicable checks pass:

- Signature verifies against a trusted JWKS key.
- Algorithm is exactly one of the configured allowed algorithms; initially only `RS256`.
- `kid` resolves to a trusted key and is not used to select an attacker-controlled URL.
- `iss` exactly matches the configured Auth Service issuer.
- `aud` contains the configured gateway audience.
- `exp` is in the future and `iat` is reasonable.
- Token type matches the access-token profile.
- Required claims are present and correctly typed.
- Optional revocation/token-version policy accepts the token.

The JWKS URL is configured by the deployment, not derived blindly from an untrusted token. Cache known keys. On an unknown `kid`, perform one bounded refresh, apply request coalescing and backoff, and reject the token if the key remains unknown. Retain old public keys until every token signed with them has expired.

## Fastify responsibilities

The Auth Service registers `@fastify/jwt` with private and public key material and signs using explicitly configured `algorithm`, `iss`, and `aud` values. The gateway registers it with a JWKS-backed public-key resolver and explicit verification constraints.

Decoding a JWT is not verification. Route code must use verified claims from the authentication hook, never values returned by decode alone.

## Authentication route categories

- Public: register, login, refresh, password-reset initiation and completion.
- Authenticated: logout current session, logout all sessions, profile read/update, password change, MFA management.
- Privileged: account administration, if it is exposed through the public API.

“Public” means no existing access token is required. These routes still require strict schemas, Redis rate limits, abuse detection, and Auth Service controls.

## Authorization division

The gateway performs coarse checks attached declaratively to routes:

```text
POST /api/v1/orders -> authenticated + orders:write
GET  /api/v1/orders -> authenticated + orders:read
```

The downstream service remains authoritative for resource and state checks, such as ownership, market status, account eligibility, and whether an operation is legal at that moment. Financial and trading operations must not rely solely on gateway checks.

Maintain a route authorization matrix containing:

- Route and method.
- Whether authentication is required.
- Required scopes or roles.
- Owning service/RPC.
- Resource-level checks expected from the owner.
- Audit-event requirement.

## Revocation and account changes

Short access-token lifetime is the default bound on stale permissions. Refresh-session revocation prevents new access tokens. For immediate enforcement on selected high-risk operations, choose one of:

- An Auth Service token-version/account-status lookup with bounded caching.
- A Redis deny list keyed by `jti` until token expiration.
- An Auth Service introspection RPC for only those operations.

Avoid a mandatory Auth Service call for every normal request unless immediate revocation requirements justify its latency and availability cost.

## Internal identity propagation

After successful verification, the gateway sends only required identity context to downstream services as canonical gRPC metadata. This is the selected identity-propagation model; the original access token is not forwarded, and the gateway does not create a separate internal assertion.

The metadata contains only the claims required by the target RPC, for example:

```text
x-gridx-user-id
x-gridx-user-scopes
x-gridx-user-roles       # only when required
x-gridx-tenant-id        # only if tenancy is introduced
x-request-id
traceparent
```

The gateway derives these values only from the successfully verified access token and its own request context. Downstream services use the subject and permissions for resource-level authorization and domain decisions.

This model relies on the service channel establishing that the caller really is the gateway. During local plaintext development, downstream gRPC ports must remain reachable only inside the private development network and the metadata must be treated as development-only trust. Before any untrusted or production network is used, the planned service mesh must provide mTLS/workload identity and authorization policies allowing only the gateway workload to call client-facing RPCs.

Never forward client-provided identity headers as trusted values. Remove them at ingress and generate canonical internal metadata after verification.

## Configuration

Gateway authentication configuration should include:

```text
AUTH_ISSUER
AUTH_AUDIENCE
AUTH_JWKS_URI
AUTH_ALLOWED_ALGORITHMS=RS256
AUTH_CLOCK_TOLERANCE_SECONDS
AUTH_JWKS_CACHE_TTL_SECONDS
AUTH_JWKS_REQUEST_TIMEOUT_MS
```

The Auth Service additionally needs a protected private key reference, current `kid`, and rotation configuration. Prefer a secrets manager or key-management service in production; do not place private keys in the repository or ordinary environment examples.

## Key rotation procedure

1. Generate a new key pair in the approved key store.
2. Publish the new public key in JWKS with a new `kid` while retaining the old key.
3. Allow gateway caches to observe the new key.
4. Begin signing new tokens with the new private key.
5. Retain the old public key for at least the maximum lifetime of tokens it signed, plus clock tolerance and cache margin.
6. Remove the retired public key and securely retire the private key.

## References

- [RFC 8725: JSON Web Token Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725.html)
- [Fastify JWT documentation](https://github.com/fastify/fastify-jwt)
