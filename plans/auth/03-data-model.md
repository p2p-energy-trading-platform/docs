---
connie-title: Auth Service Data Model
---

# Auth Service Data Model

## Users

The `users` table is the primary identity record.

Suggested fields:

- `id`
- `email`
- `status`
- `email_verified_at`
- `created_at`
- `updated_at`

Possible account states:

``` text
PENDING
ACTIVE
SUSPENDED
DISABLED
```

## Credentials

Suggested `credentials` fields:

- `id`
- `user_id`
- `password_hash`
- `created_at`
- `updated_at`

Only Auth Service should access password hashes.

If SSO is introduced, external identity mappings should be represented
separately rather than storing provider-specific information in the
password record.

## Sessions / Refresh Tokens

Suggested fields:

- `id`
- `user_id`
- `refresh_token_hash`
- `expires_at`
- `revoked_at`
- `created_at`
- `last_used_at`
- optional device/client metadata

Refresh tokens must be generated using a cryptographically secure random
generator.

Store only a hash of the refresh token.

## Roles

Suggested:

``` text
roles
-----
id
name
```

## Permissions

Suggested:

``` text
permissions
-----------
id
name
```

## Role Permissions

``` text
role_permissions
----------------
role_id
permission_id
```

## User Roles

``` text
user_roles
----------
user_id
role_id
```

This allows the authorization model to evolve without hardcoding role
checks throughout services.

## Account / Onboarding State

KYC should initially be modeled as account/onboarding state rather than
embedding a full KYC provider implementation into Auth.

Example states:

``` text
NOT_REQUIRED
PENDING
VERIFIED
REJECTED
```

The exact state model should be finalized when KYC requirements are
known.

## Database Principles

- PostgreSQL is authoritative.
- Use migrations.
- Add unique constraints for identities such as normalized email.
- Never store plaintext passwords.
- Never store plaintext refresh tokens.
- Use UTC timestamps.
- Use transactions around account creation and security-sensitive state changes.
