---
connie-title: Order Service Security, Observability and Testing
---

Security, Observability and Testing
====================================

Purpose
-------

This document defines the security boundary, the metrics, and the tests for the Order Service. Tests run against this service and a fake engine. They do not require the C++ process.

Security
--------

- The gateway authenticates the caller. This service trusts `x-gridx-user-id` only from that gateway, on the internal network.
- `CreateOrder` calls `AuthService.CheckPermission` with permission `trade:create`. A failure to reach Auth rejects the order.
- `GetOrder`, `ListOrders`, and `CancelOrder` return `NOT_FOUND` when the order belongs to someone else.
- IoT calls always set `owner_user_id` to that same UUID.
- Logs include `order_id`, `user_id`, `request_id`, and reason codes. They do not include access tokens.
- Production refuses to start when Kafka is configured for plaintext.
- `ORDER_CREATION_ENABLED=false` stops creates. It does not stop reads or cancels.
- Database credentials come from the environment. They are not written into the repository.

There is no billing call in this version, so there is no billing credential and no test that posts a wallet movement.

Observability
-------------

Structured logs with `slog`. Traces with OpenTelemetry, continuing `traceparent` from the gateway. Metrics with Prometheus.

| Metric | Meaning |
|---|---|
| `order_create_total{result,order_type,side}` | Create outcomes |
| `order_cancel_requests_total{result}` | Cancel outcomes |
| `order_updates_applied_total{status}` | Applied engine updates |
| `order_updates_ignored_total{reason}` | Duplicate, stale, or echo |
| `order_dead_letters_total{stage}` | Quarantined messages |
| `order_reconciliation_flagged_total` | Rows flagged `needs_reconciliation` |
| `order_outbox_unpublished` | Unpublished outbox rows |
| `order_outbox_oldest_unpublished_seconds` | Age of the oldest unpublished row |
| `order_pending_age_seconds` | Age of the oldest `PENDING` or `CANCEL_PENDING` |
| `order_past_expiry_open_total` | Non-terminal orders past `expires_at` |
| `order_iot_call_duration_seconds{rpc,code}` | IoT client |
| `order_auth_check_duration_seconds{code}` | Auth client |
| `order_sell_validation_rejections_total{reason}` | SELL rejections |
| `order_ledger_drift_total` | Ledger mismatches |

Alerts: unpublished outbox older than 30 s, a `PENDING` order older than 30 s, any `needs_reconciliation`, any pending dead letter, ledger drift, and a non-terminal order past `expires_at`.

Health: the process is ready when PostgreSQL is reachable and the migration version matches. It does not require the matching engine to be up. Kafka being down leaves the process ready and the outbox growing, which is the alert above.

Testing
-------

Use the Go test tool. Race detection is on for the unit and integration packages.

| Area | What is covered |
|---|---|
| Validation | Both order types, the price band, the quantity step, slot alignment, gate closure, the 24 h horizon, required MARKET price |
| Idempotency | Replay, conflict, and two concurrent creates with one key |
| IoT | Fake server for every failure in the energy document. Every call has `owner_user_id` |
| Ledger | Concurrent SELLs cannot pass capacity. Release runs once |
| Status | The transition matrix, including MARKET paths that must never become `OPEN` |
| Cancel | The race with a fill, using a fake that emits the two orders of events |
| Expiry | No test expects this service to write `EXPIRED` by itself |
| Outbox | A row is not marked published before acknowledgement. Placement of an order is not overtaken by its cancel |
| Recovery | A snapshot excludes `me_seq = 0`, refuses when a row is flagged, and repeats the same `request_id` |
| Consumer crash | Killing the process after the database commit and before the offset commit applies the event once |

The fake engine consumes `order.accepted` and `order.cancel_requested` and emits scripted `OrderUpdated` records: acknowledge, fill, partial fill, reject, cancel, MARKET `IOC_REMAINDER` and `NO_LIQUIDITY`, duplicate, stale sequence, and a delayed acknowledgement. Integration tests use PostgreSQL and Kafka through test containers.

A test that needs `ReserveCredits`, `ReleaseReservation`, or `SettleTrade` is out of scope. Those RPCs stay in `protobuf/proto/gridx/billing/v1/order_billing.proto` until a later change wires them.
