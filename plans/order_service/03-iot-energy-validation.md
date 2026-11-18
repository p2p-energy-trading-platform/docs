---
connie-title: Order Service IoT Energy Validation
---

IoT Energy Validation
=====================

Purpose
-------

This document defines how the Order Service checks SELL orders against IoT data and how it keeps the same energy from being committed to two orders.

IoT exposes houses and readings. The Order Service decides eligibility and owns the allocation ledger. A meter reading is a measurement, not a reservation.

The rules apply to SELL orders of both types. BUY orders call IoT only to learn the buyer's grid.

Integration
-----------

The Order Service calls `gridx.iot.v1.IotService` in `protobuf/proto/gridx/iot/v1/iot.proto`. That service is already implemented and registered next to meter registration. This plan does not add a new IoT RPC.

`DeviceRegistrationService` is the meter-claim API. The order service does not call it. A user with no approved house simply has an empty `ListHouses` result.

| Rule | Detail |
|---|---|
| Owner filter | An empty `owner_user_id` skips the ownership check. This service always sends the caller's UUID. A call without it is a defect and must fail in tests. |
| Not found | IoT uses `NOT_FOUND` for an unknown house, a house the user does not own, and a house with no reading. This service does not try to tell those apart from the error alone. |
| Trust | IoT does not authenticate the RPC. Only the gateway and internal services may reach it. |
| Deadlines | 1 s per RPC, 2 s for the order. No retry inside the request. The client retries with the same idempotency key. |
| Cache | None. Every SELL reads current data. |

| RPC | Use | Orders |
|---|---|---|
| `ListHouses(owner_user_id, page_size=2)` | House, `meter_id`, `grid.grid_id`, `meter_status`, `last_heartbeat_at`, `rated_solar_kw` | BUY and SELL |
| `GetLatestReading(house_id, owner_user_id)` | `measured_at` and a sanity check of the power values | SELL only |

`GetHouse`, `GetEnergySeries`, and `GetEnergySummary` exist and are not used. They stay available for a later storage or forecast policy.

| Field | Use |
|---|---|
| `House.meter_status` | `ONLINE` when a heartbeat arrived inside IoT's 10-minute window, otherwise `OFFLINE`. |
| `House.rated_solar_kw` | Optional kilowatts. Sizes the slot capacity. |
| `House.device_class` | Not a trading rule. No rated solar means no capacity. |
| `MeterReading.measured_at` | Freshness. |
| `MeterReading.solar_kw`, `net_kw` | Instantaneous kilowatts. Sanity check only, not the order size. |
| `Grid.grid_id` | The zone. Stored and sent to the engine as a string. |

Latest-reading keys in IoT Redis have no TTL, so `GetLatestReading` can return an old reading. This service always checks freshness itself.

SELL sequence
-------------

These steps run after local checks, permission, and the idempotency lookup, and before the creation transaction.

1. `ListHouses`. Empty is `METER_NOT_REGISTERED`. More than one house is `HOUSE_AMBIGUOUS`. One trading house per user.
2. Take `grid_id` from `House.grid.grid_id`. An empty id is `INVALID_ORDER`.
3. `meter_status` must be `ONLINE`, otherwise `METER_OFFLINE`.
4. `GetLatestReading` must be usable, otherwise `READING_STALE`.
5. `rated_solar_kw` must be finite and positive, otherwise `ENERGY_INSUFFICIENT`.
6. Compute slot capacity.
7. In the creation transaction, allocate the quantity. If it does not fit, `ENERGY_INSUFFICIENT`.
8. Commit the order, the allocation, and the outbox row together.
9. The outbox publisher submits the order after that commit.

A usable reading exists, is no older than 60 s, is no more than 5 s in the future, and has finite `solar_kw` and `net_kw` with `solar_kw >= 0`. `NOT_FOUND` after a successful `ListHouses` means there is no reading yet and is `READING_STALE`.

`meter_status` can stay `ONLINE` for up to 10 minutes after the last heartbeat. The 60 s reading rule is stricter. Both are required. An offline meter with a recent reading is rejected.

Every failure above happens before the transaction, so nothing is stored or published, except `ENERGY_INSUFFICIENT` from the allocation update and `ENERGY_ALLOCATION_CONFLICT` from a database retry, which roll the transaction back.

| Condition | Reason | gRPC status | Retryable |
|---|---|---|---|
| No house | `METER_NOT_REGISTERED` | `FAILED_PRECONDITION` | No |
| More than one house | `HOUSE_AMBIGUOUS` | `FAILED_PRECONDITION` | No |
| Meter offline | `METER_OFFLINE` | `FAILED_PRECONDITION` | Yes, after it recovers |
| Reading missing, old, future, or invalid | `READING_STALE` | `FAILED_PRECONDITION` | Yes |
| No rated solar, or the quantity does not fit | `ENERGY_INSUFFICIENT` | `FAILED_PRECONDITION` | No, unless capacity is released |
| IoT unavailable or deadline exceeded | `IOT_UNAVAILABLE` | `UNAVAILABLE` | Yes |
| IoT `INVALID_ARGUMENT` | `INTERNAL_ERROR` | `INTERNAL` | Yes. The request this service sent is wrong. |
| Deadlock retries exhausted | `ENERGY_ALLOCATION_CONFLICT` | `ABORTED` | Yes |

If eligibility cannot be established, the order is rejected. A newer reading after the check does not change the order. The reading is consulted once and does not size it.

Sellable energy
---------------

Telemetry is instantaneous power. It does not say how much energy a future 30-minute slot will contain. Capacity for one slot is:

`capacity_wh = floor(rated_solar_kw * 1000 * 0.5)`

That is full rated output for 30 minutes. The `double` is converted once. Later arithmetic is `int64` watt-hours.

- The reading proves the meter is live. It does not size the order.
- Battery and V2G energy are excluded. Stored energy can be discharged once, so counting it in every slot would oversell it.
- Capacity is per `(meter_id, delivery_slot_start)`. Slots do not share it.
- Passing the check does not promise that the energy will be produced.

The calculation sits behind `SellableEnergyPolicy`. A later policy may use `GetEnergySeries` or `GetHouse`. It changes only `capacity_wh`. The ledger and the error codes stay.

Allocation ledger
-----------------

The Order Service owns the ledger in schema `order_management_data`.

| Table | Columns |
|---|---|
| `energy_slot_capacity` | `meter_id`, `delivery_slot_start`, `capacity_wh`, `allocated_wh`, `updated_at`. Primary key `(meter_id, delivery_slot_start)`. `allocated_wh` stays between 0 and `capacity_wh`. |
| `energy_allocations` | `order_id` primary key, `meter_id`, `delivery_slot_start`, `allocated_wh`, `released_wh`, `released_at`. `released_wh` stays between 0 and `allocated_wh`. |

Allocation is one conditional update inside the creation transaction, using the capacity of this request:

```sql
INSERT INTO energy_slot_capacity (meter_id, delivery_slot_start, capacity_wh, allocated_wh)
VALUES ($meter, $slot, $capacity, 0)
ON CONFLICT (meter_id, delivery_slot_start) DO NOTHING;

UPDATE energy_slot_capacity
   SET allocated_wh = allocated_wh + $qty,
       capacity_wh  = $capacity,
       updated_at   = now()
 WHERE meter_id = $meter
   AND delivery_slot_start = $slot
   AND allocated_wh + $qty <= $capacity;
```

Zero rows updated is `ENERGY_INSUFFICIENT` and a rollback. Concurrent SELLs for the same meter and slot serialize on that row. Deadlock and serialization failures retry up to three times, then `ENERGY_ALLOCATION_CONFLICT`. The order insert, guarded by the idempotency key, happens before the allocation, so a duplicate never allocates.

| Event | Ledger |
|---|---|
| SELL created | `allocated_wh` increases by the quantity |
| Fill | No change. Filled energy stays consumed |
| `CANCEL_PENDING` | No change |
| Terminal `CANCELLED`, `EXPIRED`, or `REJECTED` | Release `remaining_quantity_wh` once, in the same transaction as the status change |
| `FILLED` | Nothing to release |
| MARKET remainder cancelled | Released with that terminal `CANCELLED` |

Release sets `released_wh` and `released_at` only where `released_at IS NULL`, and decreases `allocated_wh` by the same amount. A second delivery does not release again.

A periodic check compares `allocated_wh` with the sum of `allocated_wh - released_wh` on the allocation rows for that meter and slot. A mismatch raises an alert. It does not rewrite the ledger.

Example. `rated_solar_kw = 5.0`, so `capacity_wh = 2500`.

| Step | Request | Result | `allocated_wh` |
|---|---|---|---|
| 1 | SELL A, 1800 Wh | Stored | 1800 |
| 2 | SELL B, 1000 Wh | `ENERGY_INSUFFICIENT` | 1800 |
| 3 | SELL C, 700 Wh | Stored | 2500 |
| 4 | A fills 500 Wh, then is cancelled | 1300 Wh released | 1200 |

Limits of this rule: capacity is rated power, not a forecast. Filled energy is not compared with later meter delivery. One house is one ledger key. Storage and V2G are excluded. A registration change after the order is stored does not cancel that order.

Tests
-----

- Every IoT result maps to the failure table, using a fake server.
- Every IoT call sends a non-empty `owner_user_id`.
- Concurrent SELLs for one meter and slot never pass `capacity_wh`.
- The same idempotency key allocates once.
- Cancel, expiry, and rejection release once. A repeated release changes nothing.
- A reading at the age limit, just past it, and too far in the future behaves as specified.
