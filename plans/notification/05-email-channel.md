---
connie-title: Notification Service - Email Channel
---

# Email Channel

## 1. Provider

Email is sent through an `EmailProvider` interface, the same shape Auth Service already uses:

```ts
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  category?: string;
  idempotencyKey?: string;
}

export interface EmailSendResult {
  providerMessageId: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}
```

| Environment | Provider | Notes |
|---|---|---|
| Local / CI | Mailtrap **Sandbox** | Emails go to a test inbox and never reach real users |
| Production | Mailtrap **Email Sending** (transactional stream) | Same SDK as Auth Service. Can be swapped for Amazon SES or Postmark by adding another adapter |

Provider errors are mapped to **temporary** (retry: timeouts, 429, 5xx) or **permanent** (do not retry: invalid address, 4xx validation errors).

## 2. Send flow

1. Worker claims an `email` delivery job.
2. Calls `AuthService.GetUser(user_id)` for the current email, name and locale.
3. Skips the job (`skip_reason`) if the user is disabled, the email is unverified (non-security types), or the address is in `email_suppressions`.
4. Renders the template (subject, HTML, plain text) with the user's locale and time zone.
5. Adds headers:
   - `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` for non-mandatory categories,
   - `X-GridX-Delivery-Id: <delivery id>` for tracing and duplicate detection.
6. Sends and stores `provider_message_id`, sets `status = 'sent'`.

## 3. Templates

Templates are written with **React Email** as TSX components in `src/templates/email/`.

- `render()` produces HTML with inlined styles that works in Gmail, Outlook and Apple Mail.
- `render(..., { plainText: true })` produces the plain-text part. Every email has both.
- A shared `<Layout>` component holds the GridX logo, footer, address and the "Manage notifications" link.
- Templates receive **already formatted** values (money, energy, dates) from a shared formatter, so all channels show the same numbers.
- `npm run email:preview` starts the React Email preview server for designers to review templates.
- Snapshot tests render every template with sample data to catch broken layouts.

## 4. Deliverability (production checklist)

Industry-standard requirements before sending real email:

- [ ] Use a dedicated sending sub-domain, e.g. `notify.<domain>`, so problems do not affect the main domain.
- [ ] **SPF** record authorising the provider.
- [ ] **DKIM** signing with the provider's keys.
- [ ] **DMARC** record, starting with `p=none` and reports, then moving to `p=quarantine`.
- [ ] `From: GridX <no-reply@notify.<domain>>` and a monitored `Reply-To` support address.
- [ ] One-click unsubscribe (RFC 8058) on non-mandatory email. Required by Gmail and Yahoo bulk sender rules.
- [ ] Keep the complaint rate below 0.1% (alert at 0.08%).
- [ ] No open/click tracking pixels on transactional email (privacy, and fewer spam signals).
- [ ] Plain-text part on every message.

## 5. Bounces and complaints

The provider sends delivery webhooks to `POST /webhooks/email/mailtrap` (Fastify, on the `api` role).

| Event | Action |
|---|---|
| delivered | `status = 'delivered'` |
| hard bounce | `status = 'failed'`, add to `email_suppressions` |
| soft bounce | Keep `sent`. After 3 soft bounces in 7 days, treat as hard bounce |
| spam complaint | Add to `email_suppressions` (reason `complaint`), turn off all non-mandatory email categories for the user |
| unsubscribe | Turn off email for that category |

Webhook security: verify the provider signature or a shared secret, reject old timestamps (replay protection), and process idempotently by provider event ID.

Security emails (category `security`) are still sent to suppressed addresses **only** if the reason is `manual`. They are never sent after a hard bounce (the address does not exist).

## 6. Unsubscribe link

- The link contains a signed token: `HMAC-SHA256(secret, user_id + category + expiry)`. No login is needed to unsubscribe (legal and provider requirement).
- `GET /api/v1/notifications/unsubscribe?token=...` shows a confirmation page (web app).
- `POST` to the same URL (one-click, from the mail client) turns off the category immediately.
- Tokens expire after 60 days. Secrets are rotated using a key ID in the token.

## 7. Email volume rules

To avoid flooding inboxes:

- Trade and order emails are **off by default** (in-app and push cover them). Users can turn them on.
- When enabled, more than 5 trading emails in 10 minutes are collapsed into one summary email ("You had 12 trades in the last 10 minutes").
- A daily trading summary email is a later improvement (phase 8).
