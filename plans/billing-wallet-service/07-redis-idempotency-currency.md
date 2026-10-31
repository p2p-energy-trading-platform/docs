---
connie-title: Billing Service - Redis, Idempotency and Concurrency
---

# 07 – Redis, Idempotency and Concurrency

## Main rule

Postgres decides. Redis may be empty or flushed at any time and billing must remain **correct** (only slower).

## Concurrency control (Postgres)

- Row-level locks: `SELECT ... FOR UPDATE` on `wallets` and `holds` inside a single transaction.
- **Lock ordering:** when a transaction touches multiple wallets (settlement), lock them sorted by `wallet_id`. Prevents A - B deadlocks.
- Isolation: default `READ COMMITTED` is enough because of explicit row locks. Retry on `40001` (serialization) and `40P01` (deadlock) up to 3 times with jitter, then return `ABORTED/RETRYABLE_CONTENTION`.
- Keep transactions short and avoid the following: no network calls (payment providers, other gRPC) inside a DB transaction.
- DB `CHECK (available >= 0 AND reserved >= 0)` makes overspending impossible even if code has a bug.
- Hot wallet concern: a market maker with many fills serialises on one wallet row. THis can be added if needed later by batching settlements per wallet (`SettleTrades`).

## Idempotency (layered)

| Layer | Mechanism | Role |
|---|---|---|
| Natural keys in Postgres | `holds UNIQUE(kind, ref_id)`, `trade_settlements PK trade_id`, `journals.idempotency_key UNIQUE`, `deposits.provider_ref UNIQUE` | **Authoritative** |
| Request fingerprint | Store a hash of the request payload with the key. If same key + different hash then that means `IDEMPOTENCY_CONFLICT` | Catches caller bugs |
| Redis response cache | `idem:{rpc}:{key}` => serialized response and TTL is 24h | This is Fast path only. Can be skipped on cache miss and fall through to DB |

Flow for a mutating RPC:

1. Redis hit => return cached response
1. Otherwise run the DB transaction, which is naturally idempotent
1. On success, best-effort write response to Redis.

## What Redis is used for

| Use | Key pattern | TTL | Notes |
|---|---|---|---|
| Idempotency response cache | `idem:{rpc}:{key}` | 24h | Optional optimisation |
| Wallet read cache for gateway | `wallet:{user_id}` | 5–10s | Updated after commit; **never** used to decide reserve/settle |
| Fee config invalidation | pub/sub channel `billing:fee_config` | n/a | Replicas reload config |
| Sweeper/outbox relay leader lease (optional) | `lock:sweeper` `SET NX PX` | 30s | Not required if you use `FOR UPDATE SKIP LOCKED` |

**NOTE**: API Gateway already implements rate limiting and deadline per user facing route. If any extra rate limiting is needed, discuss with team mates.

**IMPORTANT**: Do not use Redis locks to protect balances because our planned DB row locks already do it with stronger guarantees.

## Events (transactional outbox)

- Business transaction inserts rows into `outbox` in the same commit.
- A relay goroutine polls unpublished rows (`ORDER BY id`, `FOR UPDATE SKIP LOCKED`) and publishes them to the event bus (Not decided how to do this, need to clarify with team-mates), then marks `published_at`.
- At-least-once delivery: consumers dedupe by `event_id`.
- Topics: `billing.wallet.updated` (key = user_id), `billing.trade.settled` (key = trade_id), `billing.deposit.completed`, `billing.withdrawal.updated`.
- The WebSocket/market-data service can consume `wallet.updated` to push live balance changes to the Wallet page without polling billing.
