---
connie-title: Billing Service - Domain Model and Database Schema
---

# 02 – Domain Model and Database Schema

## Money representation

- All amounts are `BIGINT` **minor units**: `1 credit = 100 units`, so `45.50 LKR = 4550`.
- Energy quantity is an integer in **Wh** (not kWh) to avoid decimals.
- Prices are integer minor units **per kWh**.
- Trade value = `round_half_up(qty_wh * price_per_kwh_minor / 1000)`.

## Entities

### wallets

One row per user. Cached balances for fast reads/locks; the ledger is the audit truth.

```sql
CREATE TABLE wallets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL UNIQUE,            -- opaque ref to auth-service
  available     BIGINT NOT NULL DEFAULT 0 CHECK (available >= 0),
  reserved      BIGINT NOT NULL DEFAULT 0 CHECK (reserved  >= 0),
  status        TEXT   NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','FROZEN','CLOSED')),
  version       BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`total = available + reserved`. A `FROZEN` wallet rejects reserve/withdraw (this is a future admin tool for disputes).

### holds

A lock on part of a wallet's funds. Used for **order reservations** and **pending withdrawals** (same mechanism).

```sql
CREATE TABLE holds (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id        UUID NOT NULL REFERENCES wallets(id),
  kind             TEXT NOT NULL CHECK (kind IN ('ORDER','WITHDRAWAL')),
  ref_id           UUID NOT NULL,                 -- order_id or withdrawal_id
  -- order holds only (NULL for withdrawals):
  order_type       TEXT CHECK (order_type IN ('LIMIT','MARKET')),
  qty_wh           BIGINT,
  max_price_per_kwh BIGINT,                       -- limit price, or price collar for market orders
  buyer_fee_bps    INT,                           -- buyer rate locked when the hold was created
  buyer_fee_config_id UUID,
  amount_total     BIGINT NOT NULL CHECK (amount_total > 0),
  amount_consumed  BIGINT NOT NULL DEFAULT 0 CHECK (amount_consumed >= 0),
  amount_released  BIGINT NOT NULL DEFAULT 0 CHECK (amount_released >= 0),
  status           TEXT NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','RELEASED','EXPIRED')),
  expires_at       TIMESTAMPTZ,                   -- safety net only
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, ref_id),                          -- makes ReserveCredits idempotent
  CHECK (amount_consumed + amount_released <= amount_total)
);
CREATE INDEX holds_expiry_idx ON holds (expires_at) WHERE status = 'ACTIVE';
```

`remaining = amount_total - amount_consumed - amount_released`.

The buyer's fee rate is **snapshotted into the hold**, so a later fee change can never make an existing reservation too small. `max_price_per_kwh` is also a settlement guard so that no fill may execute above it.

### ledger_accounts

Wallet accounts plus system accounts.

```sql
CREATE TABLE ledger_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL CHECK (type IN ('USER_WALLET','PLATFORM_REVENUE','PAYMENT_CLEARING')),
  wallet_id   UUID UNIQUE REFERENCES wallets(id),  -- only for USER_WALLET
  name        TEXT NOT NULL
);
```

**NOTE**: We can seed two system accounts: `PLATFORM_REVENUE` (fees earned) and `PAYMENT_CLEARING` (counter-party for money entering/leaving the platform: deposits debit it, withdrawals credit it).

### journals and ledger_lines (immutable)

```sql
CREATE TABLE journals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type             TEXT NOT NULL CHECK (type IN ('DEPOSIT','WITHDRAWAL','TRADE_SETTLEMENT','ADJUSTMENT')),
  idempotency_key  TEXT NOT NULL UNIQUE,          -- Ex: 'settle:<trade_id>'
  ref_type         TEXT NOT NULL,
  ref_id           UUID NOT NULL,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_lines (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journal_id     UUID NOT NULL REFERENCES journals(id),
  account_id     UUID NOT NULL REFERENCES ledger_accounts(id),
  amount         BIGINT NOT NULL CHECK (amount <> 0),   -- signed: + credit to account, - debit
  balance_after  BIGINT,                                -- for user wallets: total after line
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ledger_lines_account_idx ON ledger_lines (account_id, id DESC);
```

- **Invariant:** `SUM(amount)` per `journal_id` = 0 (check in code before commit and verify in reconciliation).
- Revoke `UPDATE/DELETE` on both tables from the app DB role. Corrections are new `ADJUSTMENT` journals.

### trade_settlements

One row per settled trade. This makes `SettleTrade` idempotent and gives a clean audit record.

```sql
CREATE TABLE trade_settlements (
  trade_id         UUID PRIMARY KEY,
  journal_id       UUID NOT NULL REFERENCES journals(id),
  buyer_wallet_id  UUID NOT NULL REFERENCES wallets(id),
  seller_wallet_id UUID NOT NULL REFERENCES wallets(id),
  buy_order_id     UUID NOT NULL,
  sell_order_id    UUID NOT NULL,
  qty_wh           BIGINT NOT NULL,
  price_per_kwh    BIGINT NOT NULL,
  trade_value      BIGINT NOT NULL,
  buyer_fee        BIGINT NOT NULL,
  seller_fee       BIGINT NOT NULL,
  buyer_fee_bps    INT NOT NULL,
  seller_fee_bps   INT NOT NULL,
  buyer_fee_config_id  UUID NOT NULL,
  seller_fee_config_id UUID NOT NULL,
  settled_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### fee_configs

```sql
CREATE TABLE fee_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_fee_bps   INT NOT NULL CHECK (buyer_fee_bps  BETWEEN 0 AND 2000),
  seller_fee_bps  INT NOT NULL CHECK (seller_fee_bps BETWEEN 0 AND 2000),
  effective_from  TIMESTAMPTZ NOT NULL,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

This table is Append-only. The active row is the latest with `effective_from <= now()`. Old rows should not be editied. Currently in this plan there is no per-trade minimum fee.

### deposits and withdrawals

```sql
CREATE TABLE deposits (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id             UUID NOT NULL REFERENCES wallets(id),
  amount                BIGINT NOT NULL CHECK (amount > 0),   -- credits to grant (minor units)
  provider              TEXT NOT NULL DEFAULT 'stripe',
  provider_ref          TEXT UNIQUE,                          -- Stripe Checkout Session id (cs_...)
  provider_payment_ref  TEXT,                                 -- PaymentIntent id (pi_...), filled on completion
  charge_currency       TEXT NOT NULL,                        -- 'lkr' or 'usd'
  charge_amount         BIGINT NOT NULL,                      -- minor units of charge_currency, fixed at intent creation
  fx_rate               NUMERIC(18,8),                        -- credits per 1 charge-currency unit; NULL when charging in LKR
  status                TEXT NOT NULL CHECK (status IN ('PENDING','COMPLETED','FAILED','EXPIRED','REFUNDED','DISPUTED')),
  expires_at            TIMESTAMPTZ,
  journal_id            UUID REFERENCES journals(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Webhook de-duplication: one row per provider event processed
CREATE TABLE provider_events (
  provider     TEXT NOT NULL,
  event_id     TEXT NOT NULL,                                 -- Stripe evt_...
  type         TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE withdrawals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id       UUID NOT NULL REFERENCES wallets(id),
  hold_id         UUID NOT NULL REFERENCES holds(id),
  amount          BIGINT NOT NULL CHECK (amount > 0),
  destination     JSONB NOT NULL,                  -- bank account / payout details (encrypt sensitive fields)
  status          TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','PAID','REJECTED','CANCELLED','FAILED')),
  reviewed_by     UUID,
  journal_id      UUID REFERENCES journals(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### outbox

Transactional outbox for publishing wallet events (balance changed, trade settled) to the event bus.

**NOTE**: Any notification realted events must be sent to the notification service (currently not implemented). So the way how outbox is structured or how it is send is not confimed yet.

```sql
CREATE TABLE outbox (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic         TEXT NOT NULL,
  key           TEXT NOT NULL,
  payload       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ
);

CREATE INDEX outbox_unpublished_idx ON outbox (id) WHERE published_at IS NULL;
```

## Why holds don't create ledger lines

A hold only *encumbers* the user's own money; nothing moves between accounts. So reserving shifts `available -> reserved` inside the wallet row and updates the hold, with no journal. Journals are written when money **actually changes owner** (settlement, deposit, payout).

Invariant used in reconciliation:

`wallet.reserved == SUM(remaining) of ACTIVE holds for that wallet`

`wallet.available + wallet.reserved == SUM(ledger_lines.amount) for that wallet's account`
