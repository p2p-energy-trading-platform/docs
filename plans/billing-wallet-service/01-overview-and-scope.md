---
connie-title: Billing Service - Overview
---

# 01 – Overview

## Purpose

The Billing & Wallet service owns **all money-like state** in the platform: user credit balances, credit reservations for open orders, trade settlement, the platform commission, and deposits/withdrawals. It is the single source of truth for "who has how many credits".


## Some stuff to watch out for or keep note of

Our mentor asked us to make this system be like it is functioning in Sri Lanka. But Sri Lanka has no infra or any incentive to handle any project like this. Meanwhile UAE does (smart meter, dewa utility app, etc). But future panels can ask problematic questions if we decide to go full lankan based system. It is better to approach the LKR or AED currency as not something set in stone. In this document, I will use LKR.

## Core concepts

| Concept | Meaning |
|---|---|
| Credit | In-app unit. 1 LKR = 1 credit. Stored as integer **minor units** (1 credit = 100 units) so there is never floating point |
| Wallet | One per user. Has `available` and `reserved` balances |
| Hold (reservation) | Credits locked against an order (or a withdrawal) so they cannot be double-spent |
| Journal / ledger | Immutable double-entry record of every real movement of credits |
| Settlement | Turning a matched trade into ledger movements: buyer pays, seller receives, platform takes fee |
| Platform account | System-owned ledger accounts (revenue, payment clearing) |

## Features

- Wallet creation and balance queries
- Reserve / adjust / release credits for limit and market buy orders
- Trade settlement with platform fee
- Deposits via Stripe Checkout (sandbox/test mode first) and admin-approved withdrawals, behind a payment-provider interface
- Transaction history
- Fee configuration
- Reconciliation and audit tooling

## Callers and trust boundary

| Caller | Allowed RPCs (conceptual no enforcement on allowed/disallowed) |
|---|---|
| Order Management Service (OMS) | `ReserveCredits`, `AdjustReservation`, `ReleaseReservation`, `SettleTrade` |
| API Gateway | `GetWallet`, `ListTransactions`, `CreateDepositIntent`, `ConfirmDeposit` (webhook relay), `RequestWithdrawal`, `CancelWithdrawal`, `ListWithdrawals`, admin RPCs |

**NOTE**: There is no enforcement on allowed or dissallowed rpc's for now. Those will be added later if needed.

- Billing has **no access to the auth DB**. It stores `user_id` (UUID) as an opaque reference with no cross-database FK. The gateway authenticates the user and passes `user_id` (and `role` for admin RPCs) in gRPC metadata.

## Design principles

1. **Postgres is the source of truth:** Redis is only for caching, idempotency fast-path and rate limiting. No money state lives only in Redis.
2. **Integers only:** Minor units, explicit rounding rules, no floats.
3. **Double-entry ledger:** Every journal sums to zero. Balances are derivable from the ledger.
4. **Everything is Idempotent:** Every mutating RPC can be retried safely (network retries between services are certain).
5. **One DB transaction per business operation:** Wallet row updates, hold updates, journal lines and outbox events commit together.
6. **Fail closed:** Insufficient funds or any uncertainty rejects the operation. Currency value never goes negative (also enforced by DB `CHECK`).

## Confirmed Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Fees | **Balanced split**: buyer and seller both pay a commission. Default 1% (100 bps) each, so the platform earns 2% of trade value. Rates are configurable per side [fees-and-commission](./05-fees-and-commission.md)|
| 2 | Order types | **Limit and market** orders. Market buys carry a mandatory price collar (worst acceptable price) so the reservation is always bounded [reservation-and-settlement](./04-reservation-and-settlement-flow.md) |
| 3 | Payments | **Stripe**, test/sandbox mode first, using hosted Checkout + webhooks [deposit-and-withdrawal](./06-deposit-and-withdrawal.md) |
| 4 | Withdrawals | Admin-approved, paid out manually for now (Stripe Connect payouts later) |
| 5 | Settlement trigger | OMS calls `SettleTrade` after the matching engine emits a trade |
| 6 | Wallet creation | Lazy: created on first use, optionally pre-created from a `user.created` event |
| 7 | Rounding | Half-up per fee [fees-and-commission](./05-fees-and-commission.md) |
| 8 | Market order price collar | OMS derives and sends `max_price_per_kwh` and billing rejects a market buy without this. |
| 9 | Chargebacks and refunds | Currently manually handled (freeze wallet + admin adjustment) |