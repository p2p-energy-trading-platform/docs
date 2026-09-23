---
connie-title: Authentication and Registration Flows
---

# Authentication and Registration Flows

## Account Registration

Initial flow:

``` text
Client
  |
  | registration details
  v
API Gateway
  |
  v
Auth Service
  |
  +--> validate input
  +--> normalize email
  +--> hash password with Argon2id
  +--> create user
  +--> create credential
  +--> create verification state
  |
  v
Response
```

Email verification should be required before the account reaches the
fully active state when the product requires verified email.

## Login

``` text
Client
  |
  | email + password
  v
Gateway
  |
  v
Auth Service
  |
  +--> find account
  +--> verify password
  +--> check account status
  +--> create session
  +--> issue access token
  +--> issue refresh token
  |
  v
Client
```

Failed login attempts should be rate limited.

## Access Token

Use a short-lived JWT.

Recommended claims:

``` json
{
  "sub": "user-id",
  "iss": "auth-service",
  "aud": "api",
  "iat": 0,
  "exp": 0,
  "jti": "token-id"
}
```

Roles/scopes may be included when useful, but avoid putting unnecessary
personal or mutable information into the token.

## Refresh Flow

``` text
Client
  |
  | refresh token
  v
Auth Service
  |
  +--> hash presented token
  +--> locate session
  +--> verify not expired/revoked
  +--> rotate refresh token
  +--> issue new access token
  |
  v
Client
```

Refresh-token rotation should invalidate the previous token.

## Logout

Logout should revoke the relevant refresh-token/session record.

Because access tokens are short-lived, normal logout does not require a
database lookup on every API request.

Immediate access-token revocation can be added later if a
business/security requirement makes it necessary.

## Password Reset

``` text
User
  |
  | request reset
  v
Auth Service
  |
  +--> create random one-time token
  +--> store hashed token with TTL
  +--> send reset message
  |
  v
User
  |
  | reset token + new password
  v
Auth Service
```

Password reset tokens should be single-use and short-lived.

## SSO

SSO should be implemented using a standard OIDC/OAuth flow when
providers are introduced.

The Auth Service should map the external identity to an internal user
record.

The internal user ID remains the stable application identity.

## KYC

Account onboarding should contain a KYC state:

``` text
PENDING -> VERIFIED
        \-> REJECTED
```
