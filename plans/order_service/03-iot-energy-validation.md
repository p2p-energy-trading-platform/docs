---
connie-title: Order Service IoT Energy Validation
---

IoT Energy Validation
=====================

Purpose
-------

This document defines how the Order Service validates SELL orders against IoT meter data and how it prevents the same energy from being committed to more than one order.

The IoT service interprets telemetry and exposes meter and reading data. The Order Service decides whether an order is eligible and owns the allocation of energy to orders. A meter reading is evidence of a measurement. It is not a reservation.

The rules in this document apply to SELL orders of both types (LIMIT and MARKET). BUY orders use the IoT service only to find the buyer's grid.

Integration Boundary
--------------------

The Order Service calls `gridx.iot.v1.IotService` (protobuf `v1.17.1`) over gRPC. It never reads IoT Redis or TimescaleDB directly.

| Rule | Detail |
|---|---|
| Ownership | IoT defines a house owner as the user with an `APPROVED`, `PRIMARY_OWNER` DEWA meter registration. A user with a pending, rejected, or expired registration sees no house. |
| Owner filter is mandatory | IoT treats an empty `owner_user_id` as "no ownership check". The Order Service sends a non-empty `owner_user_id` (the authenticated user's UUID) on **every** call. A call without it is a programming error and must fail in tests. |
| Not-found ambiguity | IoT returns `NOT_FOUND` for an unknown house, a house the user does not own, and a house with no reading yet. The Order Service does not try to distinguish these from the error alone. |
| Network trust | The IoT service has no authentication interceptor. Only the gateway and trusted internal services may reach it, enforced at the network level. |
| Deadlines | 1 s per RPC, 2 s per order in total. No automatic retry inside a request. The client retries with the same idempotency key. |
| Caching | None in v1. Every SELL order reads current data. |

### RPCs used

| RPC | Used for | Orders |
|---|---|---|
| `ListHouses(owner_user_id, page_size=2)` | House, `meter_id`, `grid.grid_id`, `device_class`, `meter_status`, `last_heartbeat_at`, `rated_solar_kw` | BUY and SELL |
| `GetLatestReading(house_id, owner_user_id)` | `measured_at`, `seq`, and values for the sanity check | SELL only |

`GetHouse` (flexible assets) and `GetEnergySeries` (history) are not used in v1. They are reserved for a storage-aware or forecast-based policy.

### What each IoT field means

| Field | Meaning and unit | Use |
|---|---|---|
| `House.meter_status` | `ONLINE` if a heartbeat was received within IoT's fixed 10-minute liveness window, otherwise `OFFLINE` | Health gate |
| `House.rated_solar_kw` | Optional, `double`, rated solar capacity in kW | Sizes sellable capacity |
| `House.device_class` | `CONSUMER`, `RESIDENTIAL_PROSUMER`, `COMMERCIAL` | Not used as a rule. A house without `rated_solar_kw` simply has no capacity. |
| `MeterReading.measured_at` | Time the reading was measured | Freshness |
| `MeterReading.seq` | Per-meter sequence number | Diagnostics and logging |
| `MeterReading.solar_kw`, `net_kw`, storage values | **Instantaneous power in kW**, not energy | Sanity check only |
| `Grid.grid_id` | Grid identifier (string). There is no numeric zone ID. | Zone mapping (see below) |

Latest-reading keys in IoT's Redis carry no TTL and are never evicted. `GetLatestReading` can therefore return an old reading, so the Order Service must always check freshness itself.

SELL Order Validation Sequence
------------------------------

These steps run after the local checks, the permission check, and the idempotency lookup in the order validation rules. All of them happen before the creation transaction.

1. Call `ListHouses`. An empty list returns `METER_NOT_REGISTERED`. More than one house returns `HOUSE_AMBIGUOUS` (v1 supports one trading house per user).
2. Resolve `grid_zone_id` from `grid.grid_id` using the interim configuration map `ORDER_GRID_ZONE_MAP`. An unmapped grid returns `GRID_ZONE_UNMAPPED`.
3. Require `meter_status = ONLINE`, otherwise `METER_OFFLINE`.
4. Call `GetLatestReading` and require a usable current reading (next section), otherwise `READING_STALE`.
5. Require `rated_solar_kw` to be set, finite, and positive, otherwise capacity is zero (`ENERGY_INSUFFICIENT`).
6. Compute `capacity_wh` for the slot (see Sellable Energy).
7. In the creation transaction, allocate the quantity atomically against that capacity. If it does not fit, return `ENERGY_INSUFFICIENT`.
8. Commit the order, the allocation, and the outbox row together. The order is reported as accepted only after this commit.
9. The order is submitted for matching only afterwards, by the outbox publisher.

The acceptance boundary is the commit in step 8. If the allocation fails or the order cannot be durably recorded, the request fails and nothing is published.

### Usable reading

A reading is usable only if all of these hold:

- It exists. `NOT_FOUND` from `GetLatestReading` after a successful `ListHouses` means no reading yet.
- `now - measured_at <= IOT_READING_MAX_AGE` (default 60 s, twelve simulator ticks).
- `measured_at` is no more than 5 s in the future, to tolerate clock skew.
- `solar_kw` and `net_kw` are finite numbers and `solar_kw >= 0`.

The protocol has no explicit quality flag, so these value checks are the quality rule. Any unusable reading returns `READING_STALE`.

### Meter health

`meter_status` is the platform's health signal, but it is coarse: a meter stays `ONLINE` for up to 10 minutes after its last heartbeat. The 60 s reading rule is therefore the stricter test. Both are required. An offline meter with a recent reading is rejected, because offline overrides reading age.

Failure Behaviour
-----------------

Every failure here happens before the creation transaction, so **nothing is persisted, allocated, or published**.

| Condition | Reason code | gRPC status | Retryable |
|---|---|---|---|
| No house for the user | `METER_NOT_REGISTERED` | `FAILED_PRECONDITION` | No |
| More than one house | `HOUSE_AMBIGUOUS` | `FAILED_PRECONDITION` | No |
| Grid has no zone mapping | `GRID_ZONE_UNMAPPED` | `FAILED_PRECONDITION` | No |
| `meter_status` is `OFFLINE` | `METER_OFFLINE` | `FAILED_PRECONDITION` | Yes, after recovery |
| Reading missing, old, future-dated, or invalid | `READING_STALE` | `FAILED_PRECONDITION` | Yes |
| `rated_solar_kw` unset or not positive, or quantity does not fit | `ENERGY_INSUFFICIENT` | `FAILED_PRECONDITION` | No, unless capacity is released |
| IoT returns `UNAVAILABLE`, `DEADLINE_EXCEEDED`, or any other server error | `IOT_UNAVAILABLE` | `UNAVAILABLE` | Yes |
| IoT returns `INVALID_ARGUMENT` | `INTERNAL_ERROR` | `INTERNAL` | Yes (this is a bug in the Order Service request) |
| Serialization or deadlock retries exhausted | `ENERGY_ALLOCATION_CONFLICT` | `ABORTED` | Yes |

The service fails closed. If validation cannot establish that energy is eligible, the order is rejected.

A newer reading arriving after the check changes nothing. The reading is consulted once per request, and it never sizes the order, so there is no conflict to resolve between an older and a newer reading.

Sellable Energy
---------------

### Definition (v1)

Telemetry reports instantaneous power in kW. It does not say how much energy a house will have in a future 30-minute slot. These values are not interchangeable, so v1 sizes an order by capacity, not by the reading:

`capacity_wh = floor(rated_solar_kw x 1000 x 0.5)`

This is the energy the rated solar capacity could produce at full output over one 30-minute slot. The conversion from the `double` kW value happens once, at this boundary, and all later arithmetic is on `int64` Wh.

- The latest reading proves the meter is live and current. It does not size the order.
- Battery and V2G capacity are excluded. Stored energy can be discharged only once, so counting it in every slot would oversell across slots.
- The slot is the order's 30-minute delivery slot. Energy is tracked per `(meter, slot)`, and slots do not share capacity.
- This is a physical upper bound, not a forecast. Passing validation does not guarantee delivery.

### Upgrade path

The calculation sits behind a `SellableEnergyPolicy` interface. Candidates for later replacement are a historical estimate from `GetEnergySeries` (same slot on previous days), a storage-aware policy using `GetHouse`, or the AI/ML forecast. Switching policy changes only `capacity_wh`. The ledger, the lifecycle rules, and the error codes stay the same.

Allocation Ledger
-----------------

**Ownership.** The Order Service owns the authoritative allocation ledger, in PostgreSQL schema `order_management_data`. No other service allocates energy.

### Tables

| Table | Columns |
|---|---|
| `energy_slot_capacity` | `meter_id`, `delivery_slot_start`, `capacity_wh`, `allocated_wh`, `updated_at`. Primary key `(meter_id, delivery_slot_start)`. `CHECK (allocated_wh >= 0 AND allocated_wh <= capacity_wh)`. |
| `energy_allocations` | `order_id` (primary key), `meter_id`, `delivery_slot_start`, `allocated_wh`, `released_wh`, `released_at`. `CHECK (released_wh BETWEEN 0 AND allocated_wh)`. |

### Allocation

Allocation is one atomic conditional update inside the creation transaction, using the capacity computed for this request:

```sql
INSERT INTO energy_slot_capacity (meter_id, delivery_slot_start, capacity_wh, allocated_wh)
VALUES (:meter, :slot, :capacity, 0)
ON CONFLICT (meter_id, delivery_slot_start) DO NOTHING;

UPDATE energy_slot_capacity
   SET allocated_wh = allocated_wh + :qty,
       capacity_wh  = :capacity,
       updated_at   = now()
 WHERE meter_id = :meter
   AND delivery_slot_start = :slot
   AND allocated_wh + :qty <= :capacity;
-- 0 rows updated  =>  ENERGY_INSUFFICIENT, roll back
```

Using the capacity from the current request means a change in rated capacity takes effect on the next order. A separate "check then insert" is never used. Concurrent SELL orders for the same meter and slot serialize on the capacity row lock. Serialization or deadlock failures are retried up to three times inside the Order Service, then returned as `ENERGY_ALLOCATION_CONFLICT`. The order insert comes first in the transaction (guarded by the idempotency key), so a duplicate request never allocates.

### Lifecycle

| Event | Effect |
|---|---|
| SELL order created | `allocated_wh` increases by the quantity, in the creation transaction. |
| Fill (partial or full) | No change. Filled energy stays consumed. |
| `CANCEL_PENDING` | No change. Nothing is released on a request. |
| Terminal `CANCELLED`, `EXPIRED`, `REJECTED` | Release `remaining_quantity_wh` once, in the same transaction as the status change. |
| Terminal `FILLED` | Nothing to release. |
| MARKET remainder cancelled | Released at once with the terminal `CANCELLED`. |
| Reconciler `EXPIRED` later superseded by a Matching Engine event | The allocation is recomputed from the new remaining quantity, idempotently. |

Release is idempotent. It sets `released_wh = remaining` and `released_at` only where `released_at IS NULL`, and decreases `allocated_wh` by that amount in the same transaction. Retries, duplicate events, and recovery cannot release twice or create a second allocation, because the order is the primary key of `energy_allocations`.

### Ledger audit

A background audit checks, per `(meter, slot)`, that `allocated_wh` equals the sum of `allocated_wh - released_wh` over its allocations. A mismatch raises an alert and a drift metric. It never auto-corrects.

### Worked example

`rated_solar_kw = 5.0`, so `capacity_wh = 2500`.

| Step | Request | Result | `allocated_wh` |
|---|---|---|---|
| 1 | SELL A, 1800 Wh | Accepted | 1800 |
| 2 | SELL B, 1000 Wh (concurrent or later) | `ENERGY_INSUFFICIENT` (1800 + 1000 > 2500) | 1800 |
| 3 | SELL C, 700 Wh | Accepted | 2500 |
| 4 | A fills 500 Wh, then is cancelled | Remaining 1300 Wh released | 1200 |

Documented Limits of v1 Protection
----------------------------------

- Capacity is an upper bound from rated power, not a forecast or a measurement of energy actually produced.
- Filled energy is not reconciled against metered delivery. Delivery verification is a later settlement concern.
- One house maps to one ledger key. Multi-house users are rejected.
- Storage and V2G energy are excluded.
- A change to the meter registration after an order is placed does not cancel existing orders.

Observability and Tests
-----------------------

| Signal | Name |
|---|---|
| IoT call latency and result | `order_iot_call_duration_seconds{rpc,code}` |
| SELL rejections | `order_sell_validation_rejections_total{reason}` |
| Allocated energy | `order_energy_allocated_wh` (by slot window) |
| Ledger drift | `order_ledger_drift_total` |

Required tests:

- Every `IotService` result and error maps to the code in the failure table, using a fake IoT server.
- Every IoT call carries a non-empty `owner_user_id`.
- Concurrent SELL orders for one meter and slot never exceed `capacity_wh` (real PostgreSQL).
- A duplicate request with the same idempotency key allocates once.
- Cancel, expiry, rejection, reconciler expiry, and a superseding Matching Engine event leave the ledger consistent, and a repeated release changes nothing.
- A reading exactly at, just over, and in the future beyond the skew limit behaves as specified.

Decisions and Dependencies
--------------------------

### Resolved decisions

| ID | Open item | Decision |
|---|---|---|
| I-1 | Which gRPC methods and fields expose registration, authorization, and readings | `IotService.ListHouses` (ownership, meter, grid, status, rated capacity) and `GetLatestReading`, always with `owner_user_id`. |
| I-2 | Authoritative definition of sellable energy | `floor(rated_solar_kw x 500)` Wh per slot in v1, behind a `SellableEnergyPolicy` interface. |
| I-3 | How energy relates to delivery slots | Capacity is per `(meter, 30-minute slot)`. Slots do not share capacity. |
| I-4 | Freshness and meter-health policy | Reading no older than 60 s and not more than 5 s in the future, finite and non-negative values, and `meter_status = ONLINE`. Both health and freshness are required. |
| I-5 | Who owns the allocation ledger | The Order Service, in `order_management_data`. |
| I-6 | Consistency between order creation and allocation | One PostgreSQL transaction with an atomic conditional `UPDATE`. The order insert is guarded by the idempotency key. |
| I-7 | Release and consumption rules | Per the lifecycle table. Fills consume, terminal states release the remaining quantity once, release is idempotent. |
| I-8 | IoT timeout or conflicting newer reading | Fail closed with `IOT_UNAVAILABLE`, nothing persisted, no in-request retry. A newer reading never changes the outcome, because the reading does not size the order. |
| I-9 | Error codes and status mappings | See the failure table. Codes travel in `ErrorInfo.reason`. |

### Remaining items needing sign-off

| ID | Item | Owner |
|---|---|---|
| I-O1 | Approve the capacity-based sellable-energy policy as the v1 business definition of "tradeable". | IoT owner, product |
| I-O2 | Add `uint32 grid_zone_id` to `Grid` in `iot.proto` and in IoT's `grids` table, replacing the interim `ORDER_GRID_ZONE_MAP`. | IoT owner |
| I-O3 | Confirm the network policy that restricts access to the IoT gRPC port, since IoT has no authentication. | Infrastructure |
| I-O4 | Confirm the 60 s freshness threshold against the simulator cadence and the real device cadence. | IoT owner |
| I-O5 | Decide when storage and V2G energy join the policy, and the cross-slot allocation model it needs. | IoT owner, product |

Record confirmed decisions in the shared contracts and the PostgreSQL persistence document before describing them as existing behaviour.
