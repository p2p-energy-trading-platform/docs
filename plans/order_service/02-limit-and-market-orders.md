---
connie-title: Limit and Market Orders
---

Limit and Market Orders
=======================

Purpose
-------

This document defines the proposed behaviour of LIMIT and MARKET orders in GridX. The Order Service validates and coordinates order submission, while the Matching Engine determines eligible matches, execution prices, and authoritative fill quantities.

The behaviours described here are design requirements until verified against the shared contracts and Matching Engine implementation.

LIMIT Orders
------------

A LIMIT order specifies the price boundary at which a participant is willing to trade.

- **BUY:** The buyer's maximum acceptable execution price.
- **SELL:** The seller's minimum acceptable execution price.
- **Partial fills:** Each confirmed fill reduces the remaining order quantity.
- **Resting quantity:** Any unfilled quantity may remain available for matching while the order is active.
- **Order lifetime:** An order remains eligible for matching until it is filled, cancelled, expired, or otherwise made ineligible under the agreed lifecycle rules.

The Matching Engine must enforce the limit price when determining whether two orders can match. The exact execution-price rule must be consistent with the shared contract and matching algorithm.

Fees, settlement deductions, and other charges must have explicitly defined treatment. The meaning of the limit price must not be ambiguous between the price used for matching and the amount ultimately credited or debited.

MARKET Orders
-------------

A MARKET order attempts to execute against eligible opposite-side liquidity without specifying a conventional limit price.

The proposed initial time-in-force policy is immediate-or-cancel (IOC), subject to confirmation that the Matching Engine supports it.

Under this policy:

1. The Matching Engine evaluates eligible opposite-side orders.
2. The order may execute through multiple fills, subject to its protection rules.
3. Any unfilled remainder is cancelled rather than left resting in the order book.
4. If no eligible liquidity exists, no trade is executed and the order does not remain open.
5. The resulting status and execution details are communicated using the agreed API and event contracts.

A MARKET order must never bypass price protection, quantity validation, authorization, or other applicable trading rules.

The exact status for a partially filled order whose remainder is cancelled, and for an order with no fills, must be agreed with the shared contract and Matching Engine implementation.

Market BUY Protection
---------------------

A MARKET BUY order must have a defined spending or price-protection rule before it is supported end to end.

Candidate approaches include:

- **Maximum quote budget:** Limit the total amount the buyer is authorized to spend on the order.
- **Maximum acceptable execution price:** Prevent execution above a specified price per unit of energy.

These approaches are not equivalent. The selected mechanism must be defined in the shared contract and enforced by the Matching Engine.

The implementation must also define how fees, rounding, multiple fills, and any applicable settlement adjustments affect the protection limit.

GridX currently uses admin-funded wallet credits and does not include a payment gateway in the project scope. Any future fund reservation or wallet integration must be designed consistently with the existing wallet and settlement model. This document does not assume that automatic reservation is already implemented.

SELL Order Constraints
----------------------

A MARKET SELL or LIMIT SELL order must satisfy the applicable energy-availability and authorization rules before it can be accepted for matching.

The implementation must define:

- How sellable energy is established and validated.
- How concurrent orders are prevented from committing the same available energy more than once.
- How meter validation and energy availability relate to the order's delivery slot.
- Whether fees or settlement deductions affect the seller's minimum acceptable price.
- How rejected or cancelled orders affect any energy allocation or reservation.

The Order Service, energy-validation component, and Matching Engine must use consistent rules. The authoritative source of available energy and the ownership of any reservation mechanism remain to be verified.

Matching Engine Requirements
----------------------------

Verify the following against the actual implementation:

- LIMIT and MARKET order types are represented in the shared schema.
- LIMIT price boundaries are enforced for both BUY and SELL orders.
- The agreed MARKET time-in-force policy is supported.
- Partial fills and multiple executions update filled and remaining quantities correctly.
- MARKET BUY protection is enforced during matching.
- No-liquidity outcomes are handled consistently.
- IOC remainders are cancelled and cannot remain eligible for later matching.
- Order statuses and execution events follow the shared contract.
- Concurrent matching, cancellation, and execution do not produce inconsistent quantities or terminal states.
- Fees, energy quantities, prices, and rounding follow agreed precision rules.

An API accepting a MARKET order does not establish that the Matching Engine supports it end to end.

Open Decisions and Dependencies
-------------------------------

Resolve these points before treating the proposed behaviour as implemented:

1. Does the current Matching Engine support MARKET orders and IOC?
2. Which market BUY protection mechanism is supported by the shared schema?
3. What statuses represent a no-fill market order and a partially filled IOC order?
4. What is the authoritative execution-price rule for LIMIT orders?
5. How are fees and settlement adjustments applied to BUY and SELL price boundaries?
6. What component validates available sellable energy and prevents concurrent over-allocation?
7. How are matching results and execution events delivered to the Order Service?
8. How do wallet credits and settlement records account for multiple fills and rounding?

Record confirmed decisions in the relevant shared contract or implementation documentation before updating this document to describe them as existing behaviour.
