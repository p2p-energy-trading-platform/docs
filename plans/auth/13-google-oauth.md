---
connie-title: Google OAuth Sign-In
---

# Google sign-in (OAuth 2.0 / OpenID Connect) for GridX

## Context
Sign-in has a "Google" button ([SignInForm.tsx:163](frontend-web/src/components/auth/SignInForm.tsx#L163)) that does nothing. We want real "Continue with Google" on both sign-in and sign-up.

Decisions already made:
- **Existing email:** auto-link Google to the existing account (Google has verified the email).
- **New Google user:** create the account as `ACTIVE` + email-verified, name from Google, then continue sign-up at the **KYC step**.
- **Placement:** the button goes on sign-in and on Create Account.

## Approach: server-side Authorization Code flow + PKCE
The browser never handles Google tokens. The gateway runs the redirects and sets the same `gridx_access` / `gridx_refresh` cookies that password login sets. The auth-service holds the Google client secret, verifies Google's identity, and creates or finds the user.

```
Browser ──GET /api/v1/auth/google/start?returnTo=/dashboard──▶ Gateway
Gateway: create state + PKCE verifier + nonce → Redis (10 min, one-time)
         set gridx_oauth_state cookie (httpOnly, SameSite=Lax) → 302 to Google
Google consent ──302──▶ Gateway GET /api/v1/auth/google/callback?code&state
Gateway: check the state cookie matches and read+delete the Redis entry
         gRPC LoginWithGoogle{code, code_verifier, redirect_uri, nonce} ──▶ Auth-service
Auth-service: exchange code at Google → verify id_token (jose + Google JWKS:
         iss, aud, exp, nonce, email_verified) → find/link/create user → session
         ◀── tokens + is_new_user
Gateway: setSessionCookies() → 302 to frontend
         new user → /sign-up   existing → returnTo (default /dashboard)
         on error → /sign-in?error=google
```

## 1. Protobuf: [auth.proto](protobuf/proto/gridx/auth/v1/auth.proto)
- `rpc LoginWithGoogle(LoginWithGoogleRequest) returns (LoginWithGoogleResponse);`
- Request: `code`, `code_verifier`, `redirect_uri`, `nonce`.
- Response: the `LoginResponse` fields plus `bool is_new_user`.
- Run `buf format/lint/breaking`, merge, publish the SDK, then bump the SDK in the gateway and auth-service (and update `package-lock.json`, the lesson from last time).

## 2. Auth service
- **Migration** `2026101xxxxxxx_create_user_identities.sql`: table `user_identities(id, user_id FK users ON DELETE CASCADE, provider TEXT, provider_subject TEXT, email, created_at)` with `UNIQUE(provider, provider_subject)` and an index on `user_id`. No change to `credentials`: a Google-only user simply has no credentials row, so password login's `INNER JOIN` keeps returning "Invalid email or password".
- **Config** in [config/schema.ts](auth-service/src/config/schema.ts): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ALLOWED_REDIRECT_URIS` (comma list, validated against the request).
- **`infrastructure/oauth/google-client.ts`**:
  - `exchangeCode()` does a `fetch` POST to `https://oauth2.googleapis.com/token`.
  - `verifyIdToken()` uses `jose` (already a dependency) with `createRemoteJWKSet('https://www.googleapis.com/oauth2/v3/certs')`, checking issuer `accounts.google.com` / `https://accounts.google.com`, audience = client id, and nonce.
  - It sits behind an interface so tests can fake it.
- **`features/authentication/login-with-google.ts`** (`LoginWithGoogleUseCase`):
  1. Reject if `email_verified !== true`.
  2. Find a `user_identities` row by `('google', sub)` and use that user.
  3. Otherwise find by email (`userRepo.findByEmail`). If found, insert the identity (auto-link). If the user is `PENDING`, also set `ACTIVE` + `email_verified_at`, since Google proved ownership.
  4. Otherwise create the user (`ACTIVE`, `email_verified_at = now()`, `name` from Google `name`, falling back to the email local-part and truncated to 100) plus the identity in one transaction, with `isNewUser = true`.
  5. Block `SUSPENDED` / `DISABLED` the same way [login.ts](auth-service/src/features/authentication/login.ts) does.
  6. Issue tokens and a session. Pull login.ts's token/session block into a shared `issueSession()` helper so both use cases reuse it.
- **Repository** ([users/repository.ts](auth-service/src/features/users/repository.ts)): `findByIdentity`, `linkIdentity`, `createUserWithIdentity`, `markEmailVerified`.
- **gRPC** ([auth-service.ts](auth-service/src/transport/grpc/services/auth-service.ts)): add a `loginWithGoogle` handler and wire the use case in `app.ts`.
- **Google-only users and passwords:**
  - Make reset-password **upsert** the credentials row (repository.ts ~L196 is an `UPDATE`), so "Forgot password" lets them add a password.
  - Make change-password return a clear "No password set, use Forgot password" error instead of `NOT_FOUND`.

## 3. API gateway
- **Config** ([config/schema.ts](api-gateway/src/config/schema.ts), [env.ts](api-gateway/src/config/env.ts), [types.ts](api-gateway/src/config/types.ts)): add `GOOGLE_CLIENT_ID`, `GOOGLE_OAUTH_REDIRECT_URI` (the gateway callback URL) and `FRONTEND_BASE_URL`. Validate `FRONTEND_BASE_URL` is one of `CORS_ORIGINS`, reusing `parseCorsOrigins`.
- **New `features/auth/google.ts`** with routes added in [routes.ts](api-gateway/src/features/auth/routes.ts), both `auth: 'public'` with a new rate-limit policy `auth-oauth` (e.g. 20/min) in [rate-limits.ts](api-gateway/src/policies/rate-limits.ts):
  - `GET /api/v1/auth/google/start`:
    - Accept only a relative `returnTo` path (must start with `/`, not `//`) to prevent open redirects.
    - Generate `state`, `nonce` and the PKCE `verifier` with `randomBytes(32)`, and `challenge = S256(verifier)`.
    - Store `{verifier, nonce, returnTo}` in Redis at `oauth:google:{sha256(state)}` with `EX 600`, using the existing `fastify.redis`.
    - Set the `gridx_oauth_state` cookie (httpOnly, `secure` from config, **SameSite=Lax regardless of `COOKIE_SAME_SITE`** so it survives the redirect back from Google, path `/api/v1/auth/google`, maxAge 600).
    - 302 to `https://accounts.google.com/o/oauth2/v2/auth` with `response_type=code`, `scope=openid email profile`, `prompt=select_account`, plus `state`, `nonce`, `code_challenge` and `code_challenge_method=S256`.
  - `GET /api/v1/auth/google/callback`:
    - If Google returned `error`, or the state is missing or mismatched, or the Redis entry is missing (use `GETDEL`), redirect to `${FRONTEND_BASE_URL}/sign-in?error=google`.
    - Otherwise call the auth client, then `setSessionCookies()` from [cookies.ts](api-gateway/src/features/auth/cookies.ts), clear the state cookie, and redirect to `/sign-up` if `isNewUser`, else `returnTo`.
  - The callback is a top-level GET, so check that the [csrf.ts](api-gateway/src/plugins/csrf.ts) plugin skips GETs.
- **Auth client** ([auth-client.ts](api-gateway/src/transport/grpc/clients/auth-client.ts)): add `loginWithGoogle`, following the `register` pattern, plus a deadline entry in `deadlines.ts`.

## 4. Frontend web
- **[features/auth/api.ts](frontend-web/src/features/auth/api.ts)**: `getGoogleSignInUrl(returnTo = '/dashboard')` builds `${VITE_API_BASE_URL}/api/v1/auth/google/start?returnTo=…` (reuse `API_BASE_URL` / `env` from [api-client.ts](frontend-web/src/lib/api-client.ts)).
- **New `components/auth/GoogleSignInButton.tsx`**: the existing outline button markup and `/auth/google.svg`, with `onClick` → `window.location.assign(getGoogleSignInUrl())`. It's a full-page navigation, not fetch.
- **[SignInForm.tsx](frontend-web/src/components/auth/SignInForm.tsx)**: replace the inert button with `<GoogleSignInButton />`. Read `?error=google` from the route search (validate it in [sign-in.tsx](frontend-web/src/routes/_auth/sign-in.tsx)) and show "Google sign-in failed. Please try again." with the existing `toast`/`FieldError`.
- **[CreateAccountForm.tsx](frontend-web/src/components/auth/CreateAccountForm.tsx)**: add the same "or continue with" divider and `<GoogleSignInButton />`.
- **Sign-up resume** needs no new logic. [SignupView.tsx](frontend-web/src/components/auth/SignupView.tsx) already moves `ACTIVE` users to the `kyc` view, and [sign-up.tsx](frontend-web/src/routes/sign-up.tsx) `beforeLoad` redirects signed-in users to `/dashboard`. That redirect must let a just-registered Google user through to finish onboarding: gate it on onboarding being complete (KYC status from `/auth/me`), not just "has user". Check what `/me` returns and add `kycStatus` to `meResponseSchema` if it's missing.

## 5. Google Cloud setup (manual, one time)
- In Google Cloud Console, create an OAuth client of type **Web application**.
- Authorized redirect URI: `http://localhost:8000/api/v1/auth/google/callback` for dev, plus the production gateway URL.
- Consent screen scopes: `openid`, `email`, `profile`.
- Put the client id and secret in each service's `.env` and `.env.example` (placeholders only), and in the infra secrets for `gridx-infra`.

## Verification
- **Auth-service unit tests** with a faked `GoogleClient`: new user created ACTIVE with name and identity; existing identity logs in; existing email gets auto-linked and a PENDING user is activated; `email_verified=false` rejected; bad nonce/aud rejected; suspended user blocked; reset-password creates a credential for a Google-only user.
- **Gateway integration tests**, in the style of `tests/integration/auth-register.test.ts` with a fake auth-service:
  - `/start` gives 302 to Google with the right params, sets the state cookie and writes the Redis entry.
  - `/start` rejects `returnTo=//evil.com` or an absolute URL.
  - `/callback` with a matching state sets session cookies and redirects (new user → `/sign-up`, existing → `returnTo`).
  - Mismatched or replayed state, or a Google `error`, redirects to `/sign-in?error=google`.
- **Typecheck, lint and format** in all three services: `npm run typecheck/lint/format:check`, and `tsc`/eslint/prettier in the frontend.
- **Manual end-to-end** with `docker-compose.root.yml` up and real dev Google credentials:
  1. New Gmail account: lands on the sign-up KYC step and `users.name` is the Google name.
  2. Sign out and back in with Google: goes to the dashboard.
  3. Existing password account with the same email: Google signs it in and adds a `user_identities` row, and the password still works.
  4. Cancel on the Google consent screen: back on sign-in with the error message.
