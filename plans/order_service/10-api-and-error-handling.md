---
connie-title: Order Service API and Error Handling
---

Order Service API and Error Handling
====================================

Purpose
-------

This document defines the proposed API behavior, request validation, response semantics, and error handling for the Order Service.

The final routes, request and response schemas, and status codes must align with the API Gateway and shared API contracts. The endpoints below are proposals, not confirmation of the existing implementation.

Proposed Endpoints
------------------

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/orders` | Create and submit an order |
| GET | `/orders` | List the authenticated user's orders |
| GET | `/orders/:orderId` | Retrieve an order |
| DELETE | `/orders/:orderId` | Request cancellation of an order |

Confirm the actual route prefix, path conventions, authentication requirements, pagination format, and response envelopes against the existing API Gateway and shared contracts.

Authentication and Authorization
--------------------------------

- Derive the authenticated user identity from the trusted authentication context.
- Never trust a user ID supplied only in the request body or query parameters.
- Verify order ownership or the required administrative permission before returning order details or requesting cancellation.
- Apply the project's established authentication, authorization, rate-limiting, and request-validation middleware.
- Avoid exposing whether another user's private order exists when the security policy requires ownership checks to be indistinguishable from not-found responses.

Request Validation
------------------

Order creation must validate:

- Order side and supported order type.
- Positive quantity and supported numeric precision.
- Delivery slot and applicable trading rules.
- Required limit price for LIMIT orders.
- Market-order protection fields for MARKET BUY orders, if supported.
- SELL meter registration, authorization, reading freshness, and available energy, where applicable.
- Request schema, field lengths, and required values.
- Idempotency key format and reuse rules.

Reject unsupported order types and fields rather than silently accepting or ignoring them.

Validation must be consistent with the shared contracts and the Matching Engine's actual capabilities. Do not enable MARKET orders solely because the API accepts their request fields.

Asynchronous Order Creation
---------------------------

Order submission involves validation, durable persistence, Kafka publication, and a later Matching Engine outcome.

The API must distinguish between these stages:

- The request was invalid or rejected before an order was created.
- The order was durably created and is awaiting downstream processing.
- The Matching Engine accepted or rejected the order.
- The order has received one or more executions.
- The order reached a terminal lifecycle state.

A successful API response must not imply Matching Engine acceptance or execution unless that outcome has actually been confirmed.

Use `202 Accepted` when the API contract represents an asynchronous submission that is still awaiting downstream processing. Use `201 Created` only where the defined API semantics and implementation support reporting a created resource at that stage.

The response should include the order identifier and the initial known status, together with any agreed request or correlation identifier. The client must be able to retrieve the latest known order state using the agreed read endpoint.

Idempotency
-----------

Order creation must support the agreed idempotency mechanism.

- A repeated request with the same key and equivalent payload must not create another order.
- Reusing a key with a different payload must produce a consistent conflict response.
- Concurrent requests using the same key must be handled safely.
- The stored idempotency outcome must remain consistent with the durable order-creation transaction.
- Retrying a request must not cause duplicate placement commands or unintended duplicate orders.

The exact header name, key scope, retention period, payload comparison rules, and response replay behavior must match the shared API contract.

Cancellation API
----------------

`DELETE /orders/:orderId` represents a cancellation request, not necessarily a completed cancellation.

The API must:

- Authenticate the caller and verify permission to cancel the order.
- Validate whether the order can enter the cancellation workflow.
- Persist the pending state and cancellation outbox command atomically.
- Return a response that accurately represents the known outcome.
- Allow the client to retrieve the updated order state after asynchronous processing.

Use `202 Accepted` when cancellation has been durably requested but the Matching Engine's definitive outcome is pending, provided this matches the API contract.

A timeout or unavailable dependency must not be interpreted as proof that the cancellation failed or succeeded. The client should be able to determine the current known state and safely retry according to the agreed idempotency rules.

Proposed HTTP Status Codes
--------------------------

The following mapping is a proposal and must be checked against the existing API Gateway and shared contracts.

| Condition | Proposed status |
|---|---:|
| Malformed request or invalid syntax | 400 |
| Missing or invalid authentication | 401 |
| Authenticated caller lacks permission | 403 |
| Order not found or intentionally concealed | 404 |
| Idempotency conflict or incompatible current state | 409 |
| Well-formed request rejected by a business validation rule | 422 |
| Required dependency temporarily unavailable | 503 |
| Unexpected internal failure | 500 |

Do not use one status code for every validation failure. Follow the established contract for malformed requests, unsupported values, and business-rule violations.

Where an operation has already been durably accepted, do not report a failure that encourages the client to create a duplicate operation. Error responses must reflect whether the operation was rejected before persistence or whether its outcome remains unknown.

Error Response Format
---------------------

Use a stable, machine-readable error response consistent with the existing API contract.

The response should contain the fields defined by that contract, potentially including:

- Stable error code.
- Safe, human-readable message.
- Request or correlation identifier.
- Field-level validation details when applicable.

Do not introduce a new response envelope until the gateway and shared API contracts have been inspected.

Candidate error codes include:

- `INVALID_ORDER`
- `ORDER_NOT_FOUND`
- `ORDER_NOT_CANCELLABLE`
- `IDEMPOTENCY_CONFLICT`
- `ENERGY_INSUFFICIENT`
- `METER_NOT_REGISTERED`
- `METER_NOT_AUTHORIZED`
- `READING_STALE`
- `IOT_UNAVAILABLE`
- `MATCHING_ENGINE_UNAVAILABLE`

These codes are illustrative until confirmed against the existing contracts. Keep error codes stable so clients do not need to parse message text.

Dependency Failures
-------------------

Handle IoT, Kafka, PostgreSQL, and other dependency failures according to the actual operation stage.

- Do not persist a successfully submitted order as failed merely because a later event is delayed.
- Do not claim that an order was accepted because a Kafka publish was attempted.
- Use the transactional outbox for durable publication where required by the architecture.
- Apply bounded retries and timeouts to transient failures.
- Avoid exposing broker metadata, internal hostnames, SQL details, or raw dependency errors to clients.
- Ensure logs include sufficient diagnostic context without exposing secrets or sensitive telemetry.

Observability and Security
--------------------------

- Assign or propagate a request or correlation identifier according to the gateway contract.
- Log validation failures, authorization failures, dependency failures, and unexpected exceptions at appropriate levels.
- Track request latency, error rates, idempotency conflicts, and downstream processing delays.
- Redact access tokens, credentials, secrets, and sensitive user or meter information.
- Return generic safe messages for unexpected internal errors.
- Never return stack traces, SQL errors, internal broker details, or secret configuration values.

Contract and Implementation Dependencies
----------------------------------------

Before implementing or changing the API, verify:

1. Existing gateway routes and shared request/response schemas.
2. Authentication and authorization middleware.
3. Supported order types and validation rules.
4. The distinction between persisted, submitted, accepted, and executed orders.
5. Idempotency header, scope, persistence, and replay semantics.
6. Cancellation request and response behavior.
7. HTTP status and error-code conventions.
8. Dependency timeout, retry, and correlation-ID behavior.

Keep proposed routes, response fields, and error codes marked as unconfirmed until they match the actual shared contracts and implementation.
