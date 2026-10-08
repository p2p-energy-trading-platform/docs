---
connie-title: Authentication & Profile - User Stories
---

# Authentication & Profile - User Stories

* **Epic:** Authentication & Profile
* **Repositories:** `frontend-web`, `api-gateway`, `auth-service`

> This document breaks the Authentication & Profile epic down into user stories, grouped by functional area. Each story spans the three repositories above and maps to the part each repository is responsible for. Acceptance criteria are written for Jira ticket creation. A story is only Done when it meets the Definition of Done at the end of this document.

---

## 1. Account Access

### US-1.1 - Log in with email and password

> **As** a registered GridX user, <br>
> **I want** to log in using my email address and password, <br>
> **so that** I can securely access my GridX account.

*Maps to: `frontend-web` (Sign In page, form validation, token handling), `api-gateway` (login routing, rate limiting), `auth-service` (credential validation, tokens, sessions)*

**Acceptance Criteria:**

- User can open the Sign In page and enter their email address and password.
- The frontend sends the login request through the API Gateway, which forwards it to the Auth Service.
- The Auth Service normalizes the email address and validates the email and password.
- Invalid credentials are rejected with an appropriate error.
- Users with a non-active account cannot log in.
- A valid login generates an access token and a refresh token, and creates a user session.
- Authentication errors are displayed appropriately in the frontend.
- Login requests are protected by the appropriate API Gateway rate limit.

---

### US-1.2 - Register a new account

> **As** a new user, <br>
> **I want** to create a GridX account using my email address and password, <br>
> **so that** I can access the GridX platform.

*Maps to: `frontend-web` (Sign Up/Register page), `api-gateway` (registration routing, rate limiting), `auth-service` (user creation, password hashing, verification code generation and email)*

**Acceptance Criteria:**

- User can open the Sign Up/Register page and enter the required registration information.
- The frontend sends the registration request through the API Gateway, which forwards it to the Auth Service.
- Registration fields are validated, the email address is normalized, and the password meets the required password policy.
- Registration is rejected if the email address is already registered.
- The password is securely hashed before being stored.
- A new user account is created successfully.
- An email verification OTP/code is generated and stored temporarily with an expiration time.
- A verification email is sent to the user's email address, and the user is directed to the email verification step.
- Registration requests are protected by the appropriate API Gateway rate limit.

---

### US-1.3 - Verify email address

> **As** a newly registered user, <br>
> **I want** to verify my email address using the verification code sent to me, <br>
> **so that** my GridX account can be verified.

*Maps to: `frontend-web` (verification screen), `api-gateway` (verification routing), `auth-service` (OTP validation, account verification)*

**Acceptance Criteria:**

- User is shown an email verification screen after registration and can enter the verification code/OTP.
- The frontend sends the verification request through the API Gateway, which forwards it to the Auth Service.
- The Auth Service validates the verification code. Expired and invalid codes are rejected.
- A valid code changes the user's email verification status, and the user receives a confirmation message.
- The frontend never treats the user as verified when verification fails.
- Appropriate error messages are displayed for invalid or expired codes.

---

## 2. Password Recovery

### US-2.1 - Request a password-reset link

> **As** a GridX user who has forgotten my password, <br>
> **I want** to request a password-reset link using my email address, <br>
> **so that** I can regain access to my account.

*Maps to: `frontend-web` (Forgot Password page), `api-gateway` (reset-request routing, rate limiting), `auth-service` (reset token, email, expiration)*

**Acceptance Criteria:**

- User can open the Forgot Password page from the Sign In page and enter their registered email address.
- The frontend sends the password-reset request through the API Gateway, which forwards it to the Auth Service.
- The email address is validated and normalized.
- A temporary password-reset token with an expiration time is generated.
- A password-reset email containing a link to the Reset Password page is sent to the user's email address.
- Invalid or expired reset requests are handled appropriately.
- The frontend displays an appropriate response to the user.
- Password-reset requests are protected by the appropriate API Gateway rate limit.

---

### US-2.2 - Reset password with a reset link

> **As** a GridX user with a valid password-reset link, <br>
> **I want** to create a new password, <br>
> **so that** I can regain secure access to my account.

*Maps to: `frontend-web` (Reset Password page), `api-gateway` (reset routing), `auth-service` (password update, token invalidation, session revocation)*

**Acceptance Criteria:**

- User can open the Reset Password page using a valid reset token, then enter and confirm a new password.
- The frontend sends the reset request through the API Gateway, which forwards it to the Auth Service.
- The Auth Service validates the reset token. Expired or invalid tokens are rejected.
- The new password is validated against the password policy, and the confirmation must match.
- The new password is securely hashed and stored.
- The reset token is invalidated after successful use.
- Existing user sessions are revoked after a successful password reset.
- User receives a successful password-reset confirmation and can log in using the new password.

---

## 3. Profile & Account Management

### US-3.1 - Update profile name

> **As** an authenticated GridX user, <br>
> **I want** to change my profile name, <br>
> **so that** my account displays my preferred name.

*Maps to: `frontend-web` (Profile Settings UI), `api-gateway` (profile routing, authentication), `auth-service` (profile update and validation)*

**Acceptance Criteria:**

- Authenticated user can open Profile Settings, see their current profile information, and edit their profile name.
- The frontend sends the profile update request through the API Gateway, which forwards it to the Auth Service.
- The request requires an authenticated user.
- Profile name cannot be empty and must comply with the maximum allowed length.
- The updated profile name is persisted and the updated profile information is returned to the frontend.
- The frontend displays the updated profile name.
- Appropriate validation errors are displayed to the user.

---

### US-3.2 - Change email address

> **As** an authenticated GridX user, <br>
> **I want** to change my account email address, <br>
> **so that** I can keep my account associated with my current email.

*Maps to: `frontend-web` (email-change UI), `api-gateway` (email-change routing, authentication), `auth-service` (email change, verification, token handling)*

**Acceptance Criteria:**

- Authenticated user can open the email change option in Profile Settings and enter a new email address that differs from the current one.
- The frontend sends the email-change request through the API Gateway, which forwards it to the Auth Service.
- The request requires an authenticated user.
- The new email address is normalized. The change is rejected if the new email is already registered.
- A temporary email-change verification token with an expiration time is generated and sent to the new email address.
- The email change is not finalized until the new email is verified. Invalid or expired tokens are rejected.
- A successfully verified email address is updated in the user's account.
- The updated profile information is returned to the frontend, which displays the updated email address.

---

### US-3.3 - Change password

> **As** an authenticated GridX user, <br>
> **I want** to change my current password, <br>
> **so that** I can maintain the security of my account.

*Maps to: `frontend-web` (password-change UI), `api-gateway` (password-change routing, authentication), `auth-service` (password verification, hashing, update)*

**Acceptance Criteria:**

- Authenticated user can open the Change Password option in Profile Settings and enter their current password, a new password, and a confirmation.
- The frontend sends the password-change request through the API Gateway, which forwards it to the Auth Service.
- The request requires an authenticated user.
- The Auth Service verifies the current password. An incorrect current password is rejected.
- The new password is validated against the password policy, and the confirmation must match.
- The new password is securely hashed before being stored, and the password is updated successfully.
- Appropriate session handling is applied after the password change.
- User receives a successful password-change confirmation.
- Appropriate validation and authentication errors are displayed in the frontend.

---

## Summary Table

| ID | Story | `frontend-web` | `api-gateway` | `auth-service` |
|------|--------|----------------|---------------|----------------|
| US-1.1 | Log in with email and password | Login UI, form validation, token handling | Login routing, rate limiting | Credential validation, tokens, sessions |
| US-1.2 | Register a new account | Registration UI | Registration routing, rate limiting | User creation, password hashing, verification |
| US-1.3 | Verify email address | Verification UI | Verification routing | OTP validation, account verification |
| US-2.1 | Request a password-reset link | Forgot-password UI | Reset-request routing, rate limiting | Reset token, email, expiration |
| US-2.2 | Reset password with a reset link | Reset-password UI | Reset routing | Password update, token invalidation, sessions |
| US-3.1 | Update profile name | Profile UI | Profile routing/authentication | Profile update and validation |
| US-3.2 | Change email address | Email-change UI | Email-change routing/authentication | Email change, verification, token handling |
| US-3.3 | Change password | Password-change UI | Password-change routing/authentication | Password verification, hashing, update |

---

## Definition of Done

A user story is considered **Done** only when the required functionality works across the relevant repositories.

- Frontend UI is implemented, with frontend validation and error handling.
- API Gateway route is implemented and integrated.
- Authentication/authorization requirements are enforced.
- Auth Service business logic is implemented.
- Database/session/token changes are implemented where required.
- Email/OTP functionality works where applicable.
- API integration between frontend, gateway, and auth service works.
- Success and failure scenarios have been tested.
- Relevant unit/integration tests pass.
- Changes are committed and pushed to the appropriate repository/branch.

---
