---
connie-title: Billing Service - Testing
---

# 08 – Testing, Observability and Security

## Testing strategy

### Unit and property tests (`money`, state machines)

- Table tests for `TradeValue` and `Fee` with edge cases: 1 Wh, huge quantities, zero bps, min fee, half-up boundaries.
- Property tests: for random qty/price/bps, `buyer_debit == seller_credit + platform_credit`; fee never negative; fee never exceeds value.
- State machine tests: every legal transition passes, every illegal one fails (deposit, withdrawal, hold).
- Split-fee properties: with both rates random, `buyer_fee + seller_fee == platform_credit`; a buyer reservation at max price always covers any fill at or below it, including fees.

### Integration tests (real Postgres + Redis via testcontainers)

- Reserve → settle → release round trips; verify wallet, hold, journal, ledger lines.
- Partial fills across several trades; final fill releases the remainder.
- Price improvement returns the difference.
- Market buy: reserve at collar, fill well below it, remainder released on final fill; a fill above the collar is rejected.
- Fee rate changes while a buy order is open: the buyer fee on later fills still uses the locked rate.
- Market buy without a collar is rejected.
- Idempotency: replay each mutating RPC 5× => single effect, identical response.
- Same key with a different payload → `IDEMPOTENCY_CONFLICT`.
- Insufficient funds, frozen wallet, unknown hold.
- Redis down/flushed: all flows still correct.

### Stripe sandbox tests

- Unit/CI: `MockProvider` plus signed fixture payloads, so no network is needed.
- Webhook signature: valid, tampered body, wrong secret, stale timestamp all behave correctly.
- Duplicate `evt_` delivered twice (also in parallel) credits exactly once.
- `checkout.session.completed` with mismatched amount or currency does not credit; it raises an alert.
- `checkout.session.expired` marks the deposit EXPIRED; a late success after expiry is flagged for review.
- Manual/E2E with Stripe CLI: `stripe listen --forward-to <gateway>/webhooks/stripe`, then pay with test card 4242 4242 4242 4242; also a declined card and a 3-D Secure card.
- Crash between "insert deposit" and "create Checkout Session": retry returns the same session (Stripe idempotency key).

### Concurrency tests (the ones that catch real bugs)

- 100 goroutines reserving on one wallet with total demand > balance: successes never exceed balance.
- Opposite settlements A→B and B→A in parallel: no deadlock.
- Reserve and withdraw racing on the same funds.
- Duplicate webhook deliveries in parallel: credited once.

### Fault injection

- Kill the process between DB commit and response; client retries; result unchanged.
- Fail the outbox publish; relay retries; no lost events, duplicates tolerated.

### Invariant auditor (also runs in production every N minutes)

1. For every journal: `SUM(lines) = 0`.
2. For every wallet: `available + reserved == SUM(ledger_lines)` for its account.
3. For every wallet: `reserved == SUM(remaining of ACTIVE holds)`.
4. Global: `SUM(all account balances) == 0` (user wallets + revenue + clearing).
5. No negative balances.
Any violation → alert + auto-freeze option for the affected wallet.

### End-to-end

- E2E in the dev cluster: deposit (mock) → place orders → match → settle → withdraw.

## Observability

### Metrics (Prometheus)

- RPC: rate, latency histogram, error rate by method and reason.
- Business: `reservations_total`, `insufficient_funds_total`, `settlements_total`, `settlement_latency_seconds`, `fees_collected_minor_total`, `deposits_total{status}`, `withdrawals_total{status}`, `stripe_webhook_events_total{type,result}`.
- Health: active holds count, oldest active hold age, outbox lag (unpublished rows, age), DB pool saturation, auditor violations (must be 0).

### Logging

- Structured JSON with `trace_id`, `rpc`, `caller`, `user_id`, `order_id`, `trade_id`.
- Log amounts, never destination bank details, tokens, or webhook secrets.

### Tracing

OpenTelemetry spans for RPC → service → DB queries; propagate context from gateway/OMS.

### Alerts

- Auditor violation (page)
- Settlement failure rate > 0 sustained
- Outbox lag > 1 min
- Holds older than expected
- Spike in `INSUFFICIENT_FUNDS` or withdrawals (fraud signal)

## Security

| Area | Measure |
|---|---|
| User identity | Billing trusts the gateway for `user_id`. A wallet RPC always operates on the wallet of the metadata user, never a user_id from the request body |
| Input validation | Positive amounts, max trade value, max deposit/withdrawal, bounded page sizes |
| Secrets | Stripe secret key, webhook signing secret, DB creds, encryption key from env/secret store |
| Webhooks | Verify `Stripe-Signature` on the exact raw body with a timestamp tolerance andreject otherwise. Return 2xx only after the transaction commits amd the gateway route must not parse or re-encode the body |
| Redirect URLs | Gateway allowlists `success_url`/`cancel_url` |
| Data at rest | Encrypt withdrawal destination fields. DB role for the app has no `UPDATE/DELETE` on ledger tables |
| Auditability | Immutable journals. Admin actions recorded with `reviewed_by` amd adjustments require a reason and actor |
| Money integrity | Integer math only, DB `CHECK` constraints and zero-sum journals |
