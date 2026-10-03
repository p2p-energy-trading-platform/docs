---
connie-title: Auth Service - Account Management and Recovery Plan
---

# Auth Service - Account Management and Recovery Plan

## 1. Overview

This plan extends the existing Auth Service with account management,
password recovery, email verification, and profile update capabilities.

All authentication and account-management business logic must remain
inside the Auth Service.

Email delivery will initially use a temporary Mailtrap integration for
development and testing. The email delivery implementation must be
abstracted so that it can later be replaced with the platform's
Notification Service without changing the core authentication logic.

## 2. Objectives

Implement the following capabilities:

- Forgot password and password reset.
- User profile retrieval and updates.
- User name changes.
- User email changes with verification.
- Authenticated password changes.
- Temporary email delivery through Mailtrap.
- Secure token generation, expiration, and single-use enforcement.
- Session revocation after sensitive account changes.
- Future integration with the Notification Service.

## 3. Scope

### 3.1 In Scope

- Account profile management.
- Password change for authenticated users.
- Password recovery for users who cannot access their accounts.
- Email change requests and verification.
- Password reset and email verification token management using Redis.
- Temporary email delivery adapter.
- gRPC API contracts and TypeScript SDK integration.
- Unit and integration tests.
- Database migrations where required.

### 3.2 Out of Scope

- Building the Notification Service itself.
- Production email delivery infrastructure.
- Social login or external identity providers.
- Multi-factor authentication.
- User interface implementation.
- Changes to the platform's authorization policies beyond
  the requirements of these account-management operations.

## 4. Architecture

### 4.1 Responsibility Boundary

The Auth Service remains responsible for:

- Validating account-management requests.
- Verifying the authenticated user's identity.
- Validating current passwords.
- Hashing and updating passwords.
- Generating and validating recovery tokens.
- Managing email verification state.
- Updating user profile information.
- Revoking sessions when required.
- Coordinating email delivery through an abstraction.

The email adapter is responsible only for delivering messages.

It must not own password-reset rules, account state transitions,
token validation, or other authentication business logic.

### 4.2 Proposed Component Structure

The following structure is a proposed organization. Existing project
conventions should be preserved when implementing it.

```text
src/
├── features/
│   ├── account/
│   │   ├── get-profile.ts
│   │   ├── update-profile.ts
│   │   ├── change-password.ts
│   │   └── update-email.ts
│   ├── authentication/
│   │   ├── request-password-reset.ts
│   │   ├── reset-password.ts
│   │   └── verify-email-change.ts
│   └── email/
│       └── email-client.ts
├── infrastructure/
│   └── email/
│       └── mailtrap-email-client.ts
└── transport/
    └── grpc/
        └── services/
            └── account-service.ts
```

The final file structure may be adjusted to match the existing
Auth Service architecture.

## 5. Functional Requirements

### 5.1 User Profile Retrieval

**Description:**

An authenticated user can retrieve their own profile information.

**Requirements:**

- Identify the user from trusted authentication context.
- Return the user's ID, name, email, account status, and relevant
  profile information.
- Do not expose password hashes, session tokens, or internal secrets.
- Do not accept a client-supplied user ID as the source of identity.

**Acceptance Criteria:**

- An authenticated user can retrieve their profile.
- Unauthenticated requests are rejected.
- Sensitive credential information is never returned.
- The returned profile belongs to the authenticated user.

### 5.2 Update User Profile

**Description:**

An authenticated user can update their profile name.

**Requirements:**

- Support updating the user's first name and last name.
- Validate required fields and reasonable input lengths.
- Persist changes in PostgreSQL.
- Prevent users from modifying another user's profile.
- Return the updated profile after a successful operation.

**Acceptance Criteria:**

- Valid profile updates are persisted.
- Invalid input is rejected with an appropriate error.
- Unauthenticated requests are rejected.
- Changes are reflected in subsequent profile retrieval requests.

### 5.3 Change Password

**Description:**

An authenticated user can change their password after verifying
their current password.

**Requirements:**

- Require the current password.
- Validate the new password against the configured password policy.
- Verify the current password using the existing password hasher.
- Hash the new password using Argon2id.
- Replace the existing password hash.
- Revoke existing sessions after a successful password change.
- Ensure the operation is performed transactionally where appropriate.

**Acceptance Criteria:**

- A valid current password allows the password to be changed.
- An incorrect current password is rejected.
- The new password is stored only as a secure hash.
- The old password can no longer authenticate the user.
- Existing sessions are revoked after a successful change.
- The user can authenticate using the new password.

### 5.4 Forgot Password

**Description:**

A user who cannot access their account can request a password reset.

**Requirements:**

- Accept the user's email address.
- Normalize the email before lookup.
- Generate a cryptographically secure random reset token.
- Store only a hash of the reset token.
- Store the hashed token in Redis with the relevant user ID.
- Set a Redis TTL for automatic expiration.
- Deliver the reset instructions through the email abstraction.
- Return a generic response regardless of whether the email exists.
- Apply rate limiting to prevent abuse.

**Acceptance Criteria:**

- A valid account can initiate a password reset.
- Unknown email addresses do not reveal account existence.
- Reset tokens are stored as hashes.
- Expired and previously used tokens cannot be accepted.
- Reset requests are rate-limited.
- The reset email is delivered through the configured email adapter.

### 5.5 Reset Password

**Description:**

A user can set a new password using a valid password-reset token.

**Requirements:**

- Accept the reset token and new password.
- Hash the supplied token before Redis lookup..
- Verify that the token exists and has not expired.
- Consume the Redis token after successful validation so it cannot be reused.
- Validate the new password.
- Hash the new password using Argon2id.
- Update the user's credential.
- Mark the reset token as consumed.
- Revoke all active sessions for the user.
- Ensure password update and token consumption are handled safely to prevent token reuse.

**Acceptance Criteria:**

- A valid token permits a password reset.
- Invalid, expired, or consumed tokens are rejected.
- A reset token cannot be reused.
- The new password is securely hashed.
- Existing sessions are revoked.
- The user can log in using the new password.

## 6. Email Change and Verification

### 6.1 Request Email Change

**Description:**

An authenticated user can request a change to their registered email.

**Requirements:**

- Require an authenticated user.
- Accept the proposed new email address.
- Normalize and validate the address.
- Reject an address already associated with another account.
- Generate a secure verification token.
- Store the hashed token in Redis together with the user ID and proposed email.
- Set a Redis TTL for automatic expiration
- Send a verification message to the proposed email address.
- Keep the existing email active until verification succeeds.

**Acceptance Criteria:**

- The new email is not applied immediately.
- Duplicate email addresses are rejected.
- Verification tokens are stored as hashes.
- Expired or consumed tokens cannot be used.
- The existing email remains unchanged until verification.

### 6.2 Verify Email Change

**Description:**

A user confirms the proposed email address using a valid verification token.

**Requirements:**

- Hash the supplied token before Redis lookup.
- Verify that the token exists and has not expired.
- Retrieve the associated user ID and proposed email from Redis.
- Confirm that the proposed email remains available.
- Update the user's email.
- Mark the email as verified.
- Consume the Redis token after successful validation so it cannot be reused
- Revoke existing sessions if required by the account-security policy.
- Update the email in PostgreSQL only after successful token validation.

**Acceptance Criteria:**

- A valid verification token completes the email change.
- Invalid, expired, or reused tokens are rejected.
- Email uniqueness is enforced at the database level.
- The updated email is returned after successful verification.
- The old email is no longer used as the account's login email.

## 7. Temporary Email Delivery Integration

### 7.1 Email Client Abstraction

Create a provider-independent email interface inside Auth Service.

The interface should support the delivery of:

- Password-reset messages.
- Email-change verification messages.

The interface must not contain authentication business rules.

### 7.2 Mailtrap Adapter

Implement a temporary Mailtrap-backed email adapter for development.

**Requirements:**

- Use Mailtrap's supported SMTP integration.
- Read SMTP configuration from environment variables.
- Keep credentials outside source control.
- Support configurable sender name and email address.
- Handle delivery failures without exposing sensitive information.
- Avoid logging passwords, tokens, or complete verification links.
- Allow the email adapter to be replaced without modifying
  account-management use cases.

### 7.3 Environment Configuration

Proposed configuration:

```env
EMAIL_PROVIDER=mailtrap
EMAIL_FROM_NAME=GridX
EMAIL_FROM_ADDRESS=no-reply@example.com

MAILTRAP_HOST=
MAILTRAP_PORT=
MAILTRAP_USER=
MAILTRAP_PASSWORD=

PASSWORD_RESET_TOKEN_TTL_MINUTES=15
EMAIL_VERIFICATION_TOKEN_TTL_MINUTES=30
```

The example sender address must be replaced with an approved
development sender address.

The actual Mailtrap credentials must be supplied through local
environment configuration and must never be committed.

### 7.4 Future Notification Service Integration

The temporary Mailtrap adapter is a development implementation only.

When the Notification Service becomes available:

- Implement a Notification Service-backed email adapter.
- Preserve the existing email client interface where practical.
- Move provider-specific delivery configuration to the new adapter.
- Keep password-reset and email-verification rules inside Auth Service.
- Avoid duplicating account-management logic in the Notification Service.

## 8. Data Storage

The existing PostgreSQL schema contains:

- `users`
- `credentials`
- `sessions`

Permanent account and credential information will continue to be stored
in PostgreSQL.

Temporary password-reset and email-verification tokens will be stored
in Redis because they are short-lived authentication data.

### 8.1 Redis Token Storage

Password-reset tokens will be stored using a Redis key similar to:

`auth:password-reset:<token-hash>`

The Redis value will contain the associated user ID.

Email-change verification tokens will be stored using a Redis key similar to:

`auth:email-verification:<token-hash>`

The Redis value will contain:

- User ID.
- Proposed email address.
- Token metadata required for validation.

Only the token hash will be stored in Redis. The raw token will be
generated securely and delivered to the user through the email adapter.

Both token types will use Redis TTLs for automatic expiration.

### 8.2 Token Lifecycle

The token lifecycle is:

1. Generate a cryptographically secure random token.
2. Send the raw token to the user through the email adapter.
3. Hash the token.
4. Store the token hash and required metadata in Redis with a TTL.
5. When the user submits the token, hash the supplied value.
6. Look up the corresponding Redis entry.
7. Reject the request if the token does not exist or has expired.
8. Perform the required account operation.
9. Consume/delete the Redis token so it cannot be reused.

Redis will be used only for temporary token state. Permanent account
data remains in PostgreSQL.

### 8.3 PostgreSQL Requirements

No separate PostgreSQL tables are required for:

- Password-reset tokens.
- Email-change verification tokens.

PostgreSQL will continue to enforce permanent account constraints,
including email uniqueness and credential persistence.

Any required changes to the existing `users` or `credentials` tables
will be handled through normal database migrations.

## 9. Proposed API and gRPC Operations

The following operations are proposed additions to the Auth Service
contract.

| Operation | Purpose | Authentication |
|---|---|---|
| `GetProfile` | Retrieve the current user's profile | Required |
| `UpdateProfile` | Update name information | Required |
| `ChangePassword` | Change password using the current password | Required |
| `RequestPasswordReset` | Request password recovery | Not required |
| `ResetPassword` | Complete password recovery | Not required |
| `RequestEmailChange` | Request an email change | Required |
| `VerifyEmailChange` | Confirm the proposed email | Token-based |

The final RPC names and message structures must be aligned with
the existing protobuf conventions and TypeScript SDK.

Authenticated operations must use trusted identity metadata established
by the API Gateway.

Unauthenticated recovery operations must not rely on client-supplied
user IDs.

## 10. Security Requirements

- Use cryptographically secure random tokens.
- Store only token hashes.
- Enforce token expiration and single-use behavior.
- Use Argon2id for password hashing.
- Never log plaintext passwords, tokens, or secrets.
- Return generic responses for password-reset requests.
- Rate-limit sensitive authentication operations.
- Prevent email enumeration.
- Enforce email uniqueness in PostgreSQL.
- Revoke sessions after password changes and resets.
- Validate authenticated identity using trusted request context.
- Avoid exposing account details through error messages.
- Ensure database updates and token consumption are atomic.
- Keep email-provider credentials in environment configuration.
- Avoid including sensitive tokens in application logs or analytics.

## 11. Testing Strategy

### 11.1 Unit Tests

Cover:

- Profile validation.
- Password-change validation.
- Current-password verification.
- Password hashing.
- Reset-token generation and hashing.
- Token expiration.
- Single-use enforcement.
- Email normalization.
- Duplicate email handling.
- Generic forgot-password responses.
- Email adapter error handling.

### 11.2 Integration Tests

Cover:

- Profile retrieval and update against PostgreSQL.
- Password change and credential persistence.
- Forgot-password token storage and retrieval using Redis.
- Successful password reset using a Redis token.
- Invalid and expired Redis reset tokens.
- Reuse of consumed Redis tokens.
- Successful password reset.
- Invalid and expired reset tokens.
- Reuse of consumed tokens.
- Session revocation after password changes.
- Email-change verification.
- Duplicate email rejection.
- Email-change verification using Redis tokens.
- Mailtrap adapter configuration and delivery behavior.

Use a test email adapter for automated tests so that tests do not
depend on external email delivery.

### 11.3 Security Tests

Cover:

- Account enumeration.
- Token replay.
- Expired-token handling.
- Unauthorized profile access.
- Unauthorized password changes.
- Duplicate email race conditions.
- Recovery request rate limiting.
- Sensitive-data leakage through logs and error responses.

## 12. Implementation Phases

### Phase A - Contracts and Data Storage

- Review existing Auth Service and protobuf conventions.
- Define account-management request and response messages.
- Design Redis storage for password-reset and email-verification tokens.
- Define token TTLs and consumption behavior.
- Add required PostgreSQL migrations only for permanent account fields.
- Add Redis access methods and tests.

### Phase B - Profile Management

- Implement profile retrieval.
- Implement name updates.
- Validate authenticated user identity.
- Add database-backed integration tests.

### Phase C - Password Change

- Implement current-password verification.
- Implement secure password updates.
- Revoke existing sessions.
- Add unit and integration tests.

### Phase D - Password Recovery

- Implement reset-token generation and hashing.
- Store reset-token data in Redis with a TTL.
- Implement password-reset request handling.
- Implement Redis token validation and consumption.
- Implement password replacement and session revocation.
- Add expiration and replay-prevention tests.

### Phase E - Temporary Email Integration

- Define the email client abstraction.
- Implement the Mailtrap adapter.
- Add environment configuration.
- Integrate password-reset email delivery.
- Add email adapter tests.

### Phase F - Email Change

- Implement email-change requests.
- Implement verification-token generation and hashing.
- Store verification-token data in Redis with a TTL.
- Implement Redis token validation and consumption.
- Implement email verification.
- Enforce email uniqueness and expiration.
- Add integration tests.

### Phase G - Integration and Verification

- Register new gRPC operations.
- Update protobuf definitions.
- Regenerate the TypeScript SDK.
- Verify service integration.
- Run lint, formatting, type checking, tests, and build.
- Update implementation stories with verified status.

## 13. Definition of Done

The feature set is considered complete when:

- All required account-management operations are implemented.
- Passwords and tokens are stored securely.
- Password recovery and email verification enforce expiration
  and single-use rules.
- Authenticated operations use trusted identity context.
- Sensitive account changes revoke sessions according to policy.
- Temporary Mailtrap delivery works in the development environment.
- Automated tests cover success and failure scenarios.
- Database migrations and rollback behavior are verified.
- gRPC contracts and TypeScript SDK are updated.
- Lint, formatting, type checking, tests, and build pass.
- Documentation and implementation stories reflect the verified state.

## 14. Future Improvements

The following improvements may be considered after the initial
implementation:

- Notification Service integration.
- Production email provider configuration.
- Email delivery retries and delivery-status tracking.
- Account recovery audit events.
- Additional account-security notifications.
- Administrative account recovery workflows.

These improvements must preserve the Auth Service as the owner
of authentication and account-management business logic.
