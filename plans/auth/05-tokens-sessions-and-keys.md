---
connie-title: Tokens Sessions and Key Management
---

# Tokens, Sessions and Key Management

## Access Tokens

Use short-lived JWT access tokens.

Target lifetime:

``` text
10-15 minutes
```

The exact lifetime should be configurable.

Access tokens are signed by Auth Service and verified by the gateway
and, where appropriate, downstream services.

## Asymmetric Signing

Use an asymmetric algorithm such as EdDSA/Ed25519.

Architecture:

``` text
Auth Service
   |
   | private signing key
   v
sign JWT
   |
   v
JWT
   |
   +--> Gateway verifies with public key
   +--> Services verify with public key
```

Do not distribute a shared HMAC JWT secret to every microservice.

## JWKS

Expose:

``` text
/.well-known/jwks.json
```

The JWKS contains public verification keys.

JWTs should contain a `kid` so consumers can select the correct public
key during key rotation.

## Key Rotation

Support multiple active public keys during rotation:

``` text
old key -> still verifies existing tokens
new key -> signs new tokens
```

After all tokens signed with the old key have expired, the old public
key can be removed.

Private signing keys must be stored using the deployment environment's
secret-management mechanism.

## Refresh Tokens

Refresh tokens should be:

- Cryptographically random.
- Opaque.
- Long-lived relative to access tokens.
- Stored only as hashes.
- Rotated after use.
- Revocable per session.

## Redis Usage

Redis is appropriate for:

- Rate limiting.
- One-time verification tokens.
- Password reset tokens.
- Temporary state.
- Optional session/revocation caching.

Redis is not the source of truth for users or credentials.

## Token Validation

Gateway/downstream verification should check:

- Signature.
- Algorithm.
- Key ID.
- Issuer.
- Audience.
- Expiration.
- Not-before when used.
- Required subject.

Never accept an algorithm simply because it appears in an incoming JWT
header.

## Browser Storage

The final storage mechanism depends on the frontend architecture.

For browser applications, prefer secure, HTTP-only cookie patterns where
appropriate and avoid exposing long-lived refresh tokens to JavaScript
unnecessarily.
