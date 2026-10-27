---
connie-title: Order Service IoT Energy Validation
---

IoT Energy Validation
=====================

Purpose
-------

This document defines the proposed validation requirements for SELL orders backed by IoT meter data.

The IoT Service is responsible for interpreting telemetry and exposing validated readings. The trading system must separately establish whether energy is eligible for sale and whether that energy has already been allocated to another order.

A validated meter reading is evidence of an energy measurement. It is not, by itself, a reservation or guarantee that the same quantity remains available for another sale.

Integration Boundary
--------------------

The Order Service must use the IoT Service's approved internal gRPC API to retrieve meter and energy information.

- Do not query the IoT Service's Redis cache directly.
- Do not query the IoT Service's TimescaleDB directly.
- Treat the IoT Service as the authority for meter registration, ownership information exposed by its contract, and validated telemetry.
- Treat the agreed energy-allocation component as the authority for energy already committed to active orders.
- Define explicit timeouts and failure handling for IoT requests.

The IoT API contract must be verified before the Order Service depends on any particular field or RPC method.

SELL Order Validation
---------------------

Before a SELL order is accepted for matching, the system must perform the following checks:

1. Confirm that the meter is registered and eligible for trading.
2. Confirm that the seller is authorized to use the meter.
3. Retrieve a validated energy reading through the approved IoT API.
4. Validate the reading's timestamp or sequence and apply the agreed freshness policy.
5. Check the meter's health and any other eligibility conditions defined by the IoT contract.
6. Determine the energy quantity eligible for sale for the relevant delivery slot.
7. Account for existing allocations so that the same energy cannot be committed to multiple orders.
8. Create the order and its required allocation consistently, using the agreed transaction or reservation mechanism.
9. Submit the order for matching only after the required validation and allocation steps have succeeded.

The implementation must define the exact acceptance boundary. A request must not be reported as successfully accepted if a required allocation failed or the order could not be durably recorded.

Required IoT API Information
----------------------------

Confirm whether the existing IoT API exposes the following information:

- Meter identifier.
- Meter registration and eligibility status.
- Meter-to-user association or an equivalent authorization result.
- Validated energy reading and its unit.
- Reading timestamp, sequence number, or equivalent freshness metadata.
- Meter health or connectivity information, where available.
- Any validated energy-availability information supported by the IoT contract.

The current latest-reading API may require an extension. Do not assume that all these fields are already available.

Energy Availability and Delivery Slots
--------------------------------------

The system must define how sellable energy is calculated before accepting a SELL order.

The calculation must account for:

- The validated energy measurement and its unit.
- The delivery slot associated with the order.
- Existing active allocations for the same energy source and applicable delivery period.
- The treatment of cancelled, expired, rejected, and filled orders.
- Any additional eligibility rules established by the energy and settlement design.

The team must clarify whether the available-energy value represents instantaneous power, measured energy over a period, cumulative energy, or an already calculated sellable quantity. These values are not interchangeable.

The IoT Service and trading system must agree on the meaning and units of every energy quantity used for validation.

Freshness and Failure Behaviour
-------------------------------

The IoT and trading teams must agree on the maximum permitted reading age and how it is evaluated.

A new SELL order must be rejected when required validation cannot establish that the energy is eligible for sale. This includes readings that are stale, invalid, missing, or unavailable, subject to the agreed operational policy.

The policy must distinguish between:

- A stale or invalid reading.
- An unregistered or unauthorized meter.
- A meter that fails the agreed health or eligibility checks.
- Insufficient sellable energy.
- An IoT request that times out or fails.
- An allocation conflict caused by another concurrent request.

An offline indicator alone must not replace the freshness and eligibility rules. The team must explicitly decide whether an offline meter with a recent validated reading is acceptable.

Candidate Error Codes
---------------------

The following codes are proposed names, not confirmed shared-contract values:

- `METER_NOT_REGISTERED`
- `METER_NOT_AUTHORIZED`
- `METER_OFFLINE`
- `READING_STALE`
- `ENERGY_INSUFFICIENT`
- `IOT_UNAVAILABLE`
- `ENERGY_ALLOCATION_CONFLICT`

Confirm the final names, HTTP or gRPC status mapping, and retryability rules against the shared API contract.

Preventing Overselling
----------------------

Telemetry does not reserve energy.

For example, if 10 kWh is eligible for sale and one order allocates 7 kWh, another concurrent order must not be allowed to allocate the same original 10 kWh without accounting for the first allocation.

The system must establish one authoritative allocation mechanism. Possible designs include an allocation ledger owned by the Order Service or an explicitly defined allocation API provided by another service. The final choice must follow the agreed service boundaries.

Regardless of ownership, the implementation must ensure that:

- Availability checks and allocation decisions cannot race in a way that permits overselling.
- Concurrent allocation attempts are serialized or protected by an appropriate atomic mechanism.
- Duplicate requests do not create duplicate allocations.
- Order creation and allocation remain consistent when one operation fails.
- Cancellation, expiry, rejection, and completion update allocations according to defined lifecycle rules.
- Retries and recovery do not recreate or release an allocation incorrectly.

If the allocation ledger is stored in PostgreSQL, use appropriate transactions, locking, constraints, or another verified concurrency-control mechanism. A separate check followed by an unprotected insert is insufficient.

Open Decisions and Dependencies
-------------------------------

Resolve these points before treating the proposed behaviour as implemented:

1. Which gRPC methods and fields currently expose meter registration, authorization, and validated readings?
2. What is the authoritative definition of sellable energy?
3. How are energy quantities associated with delivery slots?
4. What freshness threshold and meter-health policy apply?
5. Which service owns the authoritative energy-allocation ledger?
6. How are order creation and energy allocation made consistent?
7. When and how are allocations released or consumed across cancellation, expiry, rejection, and fills?
8. What happens when an IoT request times out or its response conflicts with a newer reading?
9. Which error codes and status mappings are defined in the shared contracts?

Record confirmed decisions in the relevant contracts and implementation documentation before describing them as existing behaviour.
