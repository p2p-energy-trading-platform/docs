---
title: Grid Fee Cache
---

# Grid Fee Cache

## Purpose

The Matching Engine needs grid fee information during cross-zone matching.

Grid fees are not calculated by the Matching Engine. They are owned by a separate IoT ingestion & Dispatch service.

To keep matching fast, the Matching Engine must not call the IoT ingestion & Dispatch service during normal order matching. Instead, grid fee data is published to a Kafka compacted topic and loaded into memory by the Matching Engine.

---

## Why Kafka Compacted Topic is Used

Grid fee data represents the latest rule for a zone-to-zone transfer pair.

Example:

```text
Zone A → Zone B = Rs. 4/kWh
Zone B → Zone C = Rs. 6/kWh
Zone A → Zone A = Rs. 0/kWh
```

Only the latest value for each transfer pair is needed.

A Kafka compacted topic is suitable because Kafka keeps the latest message for each key.

Example key:

```text
seller_zone:buyer_zone
```

Example:

```text
ZONE_A:ZONE_B
ZONE_B:ZONE_C
ZONE_A:ZONE_A
```

## Kafka Topic

The IoT ingestion & Dispatch service publishes grid fee updates to a compacted Kafka topic.

Example topic:

```text
grid.transfer-rules.v1
```

The topic should be configured as a compacted topic:

```text
cleanup.policy=compact
```

This ensures that the latest rule for each zone pair is retained.

## Example Grid Fee Event

```json
{
  "seller_grid_zone": "ZONE_A",
  "buyer_grid_zone": "ZONE_B",
  "allowed": true,
  "grid_fee_per_kwh": 4,
  "version": 12,
  "updated_at": "2026-07-03T10:00:00Z"
}
```

The message key should be:

```text
ZONE_A:ZONE_B
```

The above means energy transfer fee from seller in zone A to buyer in zone B

## Matching Engine Startup Flow

When the Matching Engine starts, it must load the latest grid fee data before processing orders.

Startup flow:

```text
Matching Engine Starts

↓

Subscribe to grid.transfer-rules.v1 compacted topic

↓

Read grid transfer rules from beginning

↓

Build in-memory GridTransferCache

↓

Complete order book recovery

↓

Start consuming order events

↓

Begin matching
```

The Matching Engine should not begin matching until the GridTransferCache is ready.


## In-Memory Cache Structure

The Matching Engine stores grid transfer rules in memory.

## Runtime Updates

The Matching Engine should keep consuming the compacted topic even after startup.

If the IoT ingestion & Dispatch service publishes a new rule, the Matching Engine updates the in-memory cache.

Example:

```text
Old:
ZONE_A → ZONE_B = Rs. 4/kWh

New event:
ZONE_A → ZONE_B = Rs. 5/kWh

Matching Engine:
Update GridTransferCache in memory
```

New orders will use the updated grid fee.

Trades already executed should not be changed. Each trade event should include the grid rule version used during matching.

## Usage During Matching

For a BUY order:

```text
effective_ask = seller_price + grid_fee
```

For a SELL order:

```text
effective_bid = buyer_limit_price - grid_fee
```

If transfer is not allowed, the candidate order is skipped.

If no rule exists for a zone pair, the safest default is:

**transfer not allowed**





