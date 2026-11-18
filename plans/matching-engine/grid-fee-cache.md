---
connie-title: Grid Fee Cache
---

# Grid Fee Cache

**Not a finished feature.** The engine has a grid-transfer consumer and an in-memory cache type. The process in `main.cpp` does not start that consumer, and the cache still keys rules by a numeric zone. The behaviour below is what the cache is for. The code changes are in [proposed engine changes](proposed-engine-changes.md).

## Purpose

The matching engine needs the grid fee while it matches across grids. It does not calculate the fee, and it does not answer "what is the fee?" to a client.

A zone is a grid. The id is the string `grid_id` used by IoT, not `ZONE_A` and not a `uint32`.

To keep matching off the network, the engine does not call another service during a match. The publisher of the rules writes them to a compacted Kafka topic. The engine loads that topic into memory.

The order service does not read this topic and does not display the fee. A client that needs to show the fee reads it from the service that publishes the topic. That read RPC is not defined. It is not an order-service API and not an engine API.

## Topic

The engine's local configuration and its config tests use:

```text
grid.transfer
```

`cleanup.policy=compact`. The key is:

```text
seller_grid_id:buyer_grid_id
```

for example `grid-a:grid-b`.

`docker-compose.yml` currently sets `grid.transfer-rules.v1`. That is drift. Compose uses `grid.transfer`, the same as `.env`.

The message is `gridx.grid.v1.GridTransferRule`. The protobuf file still has numeric zone ids, and the old string names `seller_grid_zone` and `buyer_grid_zone` are reserved, so they cannot be reused. The replacement fields are `seller_grid_id` and `buyer_grid_id`. `grid_fee_per_kwh` is minor units of LKR per kWh (1 LKR = 100). A fee of 400 is 4.00 LKR/kWh.

```json
{
  "sellerGridId": "grid-a",
  "buyerGridId": "grid-b",
  "allowed": true,
  "gridFeePerKwh": 400,
  "version": 12,
  "updatedAt": "2026-07-03T10:00:00Z"
}
```

## Startup

The engine reads `grid.transfer` from the beginning until the current end, builds the cache, and only then recovers orders and starts matching. The full startup order, including recovery, is in the proposed-changes document. Matching does not start on an empty fee cache.

The engine keeps consuming the topic after startup. A new record replaces the rule for that grid pair. Trades already produced are not rewritten. Each trade records the rule version it used.

## During matching

For an incoming buy:

```text
effective_ask = seller_price + grid_fee
```

For an incoming sell:

```text
effective_bid = buyer_price - grid_fee
```

The energy price of an incoming sell is that effective bid (`buyer_price - grid_fee`), not the buyer's raw price with the fee added on top. The current sell matcher does the latter. That correction is part of the proposed engine changes.

If `allowed` is false, or there is no rule for the pair, the candidate is skipped. Same-grid trades use a fee of 0 and do not need a rule.
