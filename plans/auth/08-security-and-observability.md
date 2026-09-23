---
connie-title: Auth Security and Observability
---

# Auth Security and Observability

## Password Security

Use Argon2id with parameters selected for the deployment environment.

Never log:

- Passwords.
- Password hashes.
- Refresh tokens.
- Password-reset tokens.
- Private keys.
- Client secrets.

## Rate Limiting

Apply rate limits to:

- Login.
- Registration.
- Password reset.
- Email verification.
- Refresh operations.
- SSO callback endpoints where applicable.

Use Redis for distributed rate limiting.

## Account Enumeration

Where appropriate, avoid revealing whether an email address exists
through registration/reset responses.

Security-sensitive responses should not provide unnecessary information
to attackers.

## CSRF

If browser authentication uses cookies, apply an appropriate CSRF
protection strategy.

## TLS

All externally exposed authentication endpoints must use HTTPS.

Internal gRPC communication should use secure transport in deployed
environments.

## Service Identity

Internal services should have distinct identities.

mTLS/workload identity is preferred where the infrastructure supports
it.

## Audit Events

Record security-relevant events such as:

- Registration.
- Login success/failure.
- Logout.
- Password change.
- Password reset.
- Email verification.
- Session revocation.
- Role/permission changes.
- Account suspension.

Do not place secrets in audit records.

## Observability

Use OpenTelemetry for:

- Distributed traces.
- Metrics.
- Correlation/request IDs.

Useful metrics include:

- Login success/failure rate.
- Registration rate.
- Password reset requests.
- Token refresh rate.
- Authentication latency.
- gRPC errors.
- Rate-limit rejections.

## Health Checks

Provide separate liveness/readiness checks.

Readiness should account for required dependencies such as PostgreSQL
when appropriate.

## Testing

Minimum test layers:

1. Unit tests for password/token/session logic.
2. Integration tests for PostgreSQL and Redis.
3. gRPC contract tests.
4. API tests through the gateway.
5. Security regression tests.
6. End-to-end registration/login/refresh/logout flow tests.
