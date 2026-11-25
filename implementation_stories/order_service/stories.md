---
connie-title: Order Service - User Stories
---

# Order Service - User Stories

- **Epic:** Order Service
- **Repository:** [p2p-energy-trading-platform/order-service](https://github.com/p2p-energy-trading-platform/order-service)
- **Documentation:** [Order Service Implementation Plan](https://github.com/p2p-energy-trading-platform/docs/tree/main/plans/order_service)
- **Project:** GridX P2P Energy Trading Platform
- **Language:** Go
- **Status:** Draft

> This document breaks the Order Service implementation plan into component-level user stories. It aligns the service with the wider GridX architecture, including the API Gateway, Auth Service, IoT Ingestion and Dispatch, PostgreSQL, Kafka, Matching Engine, and the existing Billing/Wallet protobuf contract. Acceptance criteria are intended to be specific enough for implementation, testing, and Jira ticket creation.

## 1. Order Service Foundation and Contracts

### US-1.1 - Establish the Order Service application structure

> **As** a GridX platform developer,\
> **I want** the Order Service organised into clearly separated application, domain, transport, provider, persistence, worker, and observability components,\
> **so that** order processing remains maintainable and integrations can be tested independently.

*Maps to: `12-service-folder-structure.md`, `cmd/`, `internal/app/`, `internal/config/`, `internal/domain/`, `internal/service/`, `internal/store/`, `internal/provider/`, `internal/transport/`, `internal/worker/`*

**Acceptance Criteria:**

- The service follows the documented Go folder structure and keeps business rules outside transport handlers.
- Domain models define order sides, order types, statuses, units, slots, transitions, and domain errors.
- Application startup and shutdown are coordinated through the app layer.
- External dependencies are accessed through explicit provider or repository interfaces.
- Configuration is loaded from environment variables and validated before the service starts.
- Unit tests can exercise domain and use-case logic without requiring live external services.

### US-1.2 - Define and publish the Order Service gRPC contract

> **As** the API Gateway,\
> **I want** a versioned gRPC Order Service contract,\
> **so that** authenticated client requests can be passed to the Order Service through a stable internal interface.

*Maps to: `10-api-and-error-handling.md`, `protobuf/proto/gridx/order/v1/`, `go-sdk`, `internal/transport/grpc/`*

**Acceptance Criteria:**

- The `gridx.order.v1.OrderService` contract defines `CreateOrder`, `GetOrder`, `ListOrders`, and `CancelOrder`.
- Request and response messages represent order IDs as decimal strings at the service boundary.
- Quantity is represented in integer watt-hours and price in integer LKR minor units per kWh.
- User identity is supplied through trusted request metadata and is not accepted from the order request body.
- The contract supports `LIMIT` and `MARKET` order types and all eight locally defined order statuses.
- Generated Go SDK types are used by the Order Service; the service does not maintain a separate incompatible copy of the contract.
- Contract changes are coordinated with the protobuf and SDK repositories before dependent service integration is considered complete.

### US-1.3 - Configure secure service startup and database migrations

> **As** a platform operator,\
> **I want** the Order Service to validate its runtime configuration and database schema before becoming ready,\
> **so that** the service does not accept requests when its required persistence layer is incompatible or unavailable.

*Maps to: `04-postgresql-persistence.md`, `12-service-folder-structure.md`, `internal/config/`, `internal/app/`, `cmd/migrate/`, `migrations/`*

**Acceptance Criteria:**

- Database credentials and service configuration are supplied through environment variables and are not committed to the repository.
- The service uses the `order_management_data` schema and the configured Order Service database role.
- Goose migrations are embedded and can be applied using the migration command.
- Startup checks that the applied migration version matches the latest embedded migration.
- The service refuses readiness when PostgreSQL is unavailable or the schema is behind.
- Production configuration rejects plaintext Kafka connections.
- `ORDER_CREATION_ENABLED=false` disables order creation without disabling order reads or cancellation.
- Graceful shutdown stops accepting new work and allows in-flight database and worker operations to finish within the configured shutdown period.

## 2. Order Validation and Creation

### US-2.1 - Validate order requests before persistence

> **As** a GridX energy-market participant,\
> **I want** invalid order requests rejected before they are stored,\
> **so that** only orders that satisfy the platform's trading rules enter the order lifecycle.

*Maps to: `01-order-validation.md`, `02-limit-and-market-orders.md`, `internal/domain/`, `internal/service/create_order_usecase.go`*

**Acceptance Criteria:**

- The service accepts only `BUY` and `SELL` sides and `LIMIT` and `MARKET` order types.
- Unspecified or unsupported enum values are rejected.
- Quantity is a positive multiple of 100 Wh and is between 100 Wh and 20,000 Wh inclusive.
- Price is required for both order types, is an integer number of LKR minor units per kWh, and is between 100 and 100,000 inclusive.
- The delivery slot starts on a UTC `:00` or `:30` boundary and ends exactly 30 minutes later.
- The delivery slot starts in the future and no more than 24 hours ahead.
- The client cannot supply or override `user_id`, `grid_id`, `expires_at`, or order status.
- LIMIT expiry is the delivery-slot end.
- MARKET expiry is the earlier of 30 seconds after creation or the delivery-slot end.
- Validation failures return the documented stable error reason and do not create an order, history row, allocation, or outbox event.

### US-2.2 - Authenticate the caller's trading permission

> **As** the Order Service,\
> **I want** to verify that the authenticated user has the `trade:create` permission,\
> **so that** only authorised GridX users can submit new orders.

*Maps to: `01-order-validation.md`, `11-security-observability-and-testing.md`, `protobuf/proto/gridx/auth/v1/auth.proto`, `internal/provider/auth/`, `internal/service/create_order_usecase.go`*

**Acceptance Criteria:**

- The service obtains the user UUID from trusted gateway-provided metadata.
- A missing or invalid user identity is rejected.
- `AuthService.CheckPermission` is called with permission `trade:create`.
- Successful permission decisions may be cached for 60 seconds as specified in the plan.
- An explicit permission denial returns `PERMISSION_DENIED` / `TRADING_NOT_PERMITTED`.
- An unavailable Auth Service returns `UNAVAILABLE` / `AUTH_UNAVAILABLE`; the service does not allow the order through.
- Auth calls use a one-second deadline.
- Access tokens and other credentials are never logged or exposed in metric labels.

### US-2.3 - Resolve the participant's GridX house and grid

> **As** a GridX participant,\
> **I want** my order to be associated with the grid of my registered house,\
> **so that** the Matching Engine can apply the correct zone-based matching rules.

*Maps to: `03-iot-energy-validation.md`, `01-order-validation.md`, `protobuf/proto/gridx/iot/v1/iot.proto`, `internal/provider/iot/`*

**Acceptance Criteria:**

- The Order Service calls `IotService.ListHouses` with the authenticated user's UUID.
- Both BUY and SELL orders resolve the participant's house and grid through IoT.
- An empty house result returns `METER_NOT_REGISTERED`.
- More than one house returns `HOUSE_AMBIGUOUS`.
- The service takes the zone from `House.grid.grid_id`.
- An empty grid ID is rejected as `INVALID_ORDER`.
- The service does not call the IoT device-registration API to claim or register meters.
- IoT calls use the specified one-second per-call deadline and two-second total order budget.
- The Order Service does not trust a client-supplied grid ID.

### US-2.4 - Validate SELL energy availability using IoT data

> **As** a prosumer placing a SELL order,\
> **I want** the Order Service to check that my registered meter is eligible and has sufficient slot capacity,\
> **so that** I cannot allocate more energy for sale than the platform's defined capacity policy permits.

*Maps to: `03-iot-energy-validation.md`, `01-order-validation.md`, `protobuf/proto/gridx/iot/v1/iot.proto`, `internal/service/`, `internal/provider/iot/`*

**Acceptance Criteria:**

- SELL orders require a house with an `ONLINE` meter status.
- The service calls `GetLatestReading` with the house ID and authenticated owner UUID.
- The reading must be no older than 60 seconds and no more than five seconds in the future.
- The reading must contain finite `solar_kw` and `net_kw` values, with `solar_kw >= 0`.
- `rated_solar_kw` must be finite and positive.
- Slot capacity is calculated as `floor(rated_solar_kw * 1000 * 0.5)` watt-hours.
- The reading is used to establish meter liveness and sanity, not as the order quantity or a production forecast.
- Battery and V2G energy are excluded from this version's capacity calculation.
- Missing, stale, future, invalid, or unavailable IoT data maps to the documented error reason and gRPC status.
- Every IoT call includes a non-empty `owner_user_id`.
- BUY orders do not call `GetLatestReading`; they use IoT only to resolve the participant's grid.
- Tests cover the specified boundary conditions and IoT failure responses using a fake IoT server.

### US-2.5 - Create orders idempotently

> **As** a GridX participant,\
> **I want** repeated submissions of the same order request to return the existing order,\
> **so that** network retries do not create duplicate orders or reserve the same energy more than once.

*Maps to: `01-order-validation.md`, `04-postgresql-persistence.md`, `10-api-and-error-handling.md`, `internal/service/create_order_usecase.go`, `internal/store/postgres/order_repo.go`*

**Acceptance Criteria:**

- Every create request requires an idempotency key of 8–64 characters matching `[A-Za-z0-9_-]`.
- The database enforces uniqueness on `(user_id, idempotency_key)`.
- A SHA-256 fingerprint is generated from side, order type, price, quantity, and delivery-slot start.
- Repeating the same key and fingerprint returns the existing order with `replayed = true`.
- Reusing the same key with a different fingerprint returns `ABORTED` / `IDEMPOTENCY_CONFLICT`.
- Concurrent requests with the same key cannot create multiple orders or multiple energy allocations.
- Idempotency is checked before making IoT calls where the plan specifies an existing request can be replayed.
- Rejected requests are not persisted.
- Tests cover replay, conflict, and concurrent duplicate requests.

### US-2.6 - Persist a new order and its command atomically

> **As** the Order Service,\
> **I want** to persist the order, its initial history, any SELL energy allocation, and its outbound command in one database transaction,\
> **so that** an accepted API request cannot leave the database and Kafka publication workflow in inconsistent states.

*Maps to: `01-order-validation.md`, `03-iot-energy-validation.md`, `04-postgresql-persistence.md`, `05-kafka-contracts-and-outbox.md`, `internal/service/create_order_usecase.go`, `internal/store/postgres/`*

**Acceptance Criteria:**

- The order is initially stored with status `PENDING`.
- The authenticated user's UUID and IoT-resolved house, meter, and grid values are persisted.
- The initial `order_status_history` row records the transition from no status to `PENDING`.
- For a SELL order, the energy allocation is created in the same transaction.
- The `order.accepted` outbox event is inserted in the same transaction.
- A transaction rollback leaves no partial order, history, allocation, or outbox record.
- The create response indicates `PENDING`; it does not claim that Kafka or the Matching Engine has acknowledged the order.
- The request path does not publish directly to Kafka.
- A Kafka outage does not cause an otherwise successful database transaction to be rolled back.

## 3. SELL Energy Allocation Ledger

### US-3.1 - Reserve SELL energy capacity per meter and delivery slot

> **As** the Order Service,\
> **I want** to maintain a durable energy allocation ledger for each meter and delivery slot,\
> **so that** concurrent SELL orders cannot reserve more energy than the configured slot capacity.

*Maps to: `03-iot-energy-validation.md`, `04-postgresql-persistence.md`, `internal/service/energy_ledger_usecase.go`, `internal/store/postgres/allocation_repo.go`*

**Acceptance Criteria:**

- The `energy_slot_capacity` table is keyed by `(meter_id, delivery_slot_start)`.
- The `energy_allocations` table records the allocated and released amount for each SELL order.
- Energy quantities are stored as integer watt-hours.
- Allocation uses a conditional database update that succeeds only when the new total does not exceed the slot capacity.
- Concurrent SELL orders for the same meter and slot are serialised by the database update.
- A failed capacity check returns `ENERGY_INSUFFICIENT` and rolls back the order transaction.
- Deadlock or serialization retries are limited to three attempts; exhausted retries return `ENERGY_ALLOCATION_CONFLICT`.
- The same idempotency key cannot allocate energy more than once.
- Tests prove that concurrent requests cannot exceed the configured capacity.

### US-3.2 - Release unused SELL energy on terminal order outcomes

> **As** the Order Service,\
> **I want** to release the unused portion of a SELL allocation when the Matching Engine reports a terminal outcome,\
> **so that** energy not committed to completed fills becomes available for another eligible order.

*Maps to: `03-iot-energy-validation.md`, `07-order-status-synchronization.md`, `08-cancellation-and-expiry.md`, `internal/service/energy_ledger_usecase.go`*

**Acceptance Criteria:**

- Unused SELL energy is released only when an authoritative terminal `OrderUpdated` event is applied.
- `CANCELLED`, `EXPIRED`, and `REJECTED` release the remaining allocated quantity as specified by the plan.
- `FILLED` releases nothing.
- `CANCEL_PENDING` does not release energy.
- For partially filled orders, filled energy remains consumed and only the remaining quantity is released.
- Release is performed in the same database transaction as the terminal status update.
- A conditional `released_at IS NULL` check ensures an allocation is released only once.
- Duplicate terminal events cannot decrement the ledger more than once.
- A periodic consistency check compares slot totals with allocation rows and raises an alert on drift; it does not silently rewrite the ledger.

## 4. PostgreSQL Persistence and Order Queries

### US-4.1 - Store durable order state and append-only status history

> **As** a GridX platform operator,\
> **I want** PostgreSQL to hold the authoritative durable order record and its status history,\
> **so that** order state remains available across service restarts and can be audited.

*Maps to: `04-postgresql-persistence.md`, `07-order-status-synchronization.md`, `internal/store/postgres/order_repo.go`, migrations*

**Acceptance Criteria:**

- The `orders` table stores the current order, quantities, status, ownership, grid, delivery slot, expiry, version, and engine sequence.
- The `order_status_history` table records each creation, user cancellation request, and applied engine status or quantity change.
- History rows identify the source as `USER`, `ME`, or `SYSTEM`.
- Status history is append-only; database triggers prevent updates and deletes.
- Remaining quantity is stored as the latest cumulative value received from the Matching Engine.
- Filled quantity is derived as `quantity_wh - remaining_quantity_wh` and is not independently mutated.
- Database constraints enforce valid quantities, slot alignment, expiry bounds, status/quantity relationships, and idempotency uniqueness.
- The service does not persist individual trade executions in this version.
- Database migrations and repository tests cover the documented schema and constraints.

### US-4.2 - Retrieve an order belonging to the authenticated user

> **As** a GridX participant,\
> **I want** to retrieve one of my orders by its order ID,\
> **so that** I can view its latest persisted status and order details.

*Maps to: `10-api-and-error-handling.md`, `internal/service/get_order_usecase.go`, `internal/store/postgres/order_repo.go`*

**Acceptance Criteria:**

- `GetOrder` accepts an order ID and derives the user UUID from trusted request metadata.
- The query returns an order only when it belongs to the authenticated user.
- A missing order and an order owned by another user both return `NOT_FOUND`.
- The response includes order type, side, price, original quantity, remaining quantity, derived filled quantity, status, reason, grid ID, delivery slot, expiry, and timestamps.
- Order IDs are represented as decimal strings at the gRPC and public API boundaries.
- The operation does not query the Matching Engine's in-memory order book.
- Tests cover successful retrieval, unknown IDs, and cross-user access attempts.

### US-4.3 - List the authenticated user's orders with pagination

> **As** a GridX participant,\
> **I want** to list my orders in pages,\
> **so that** I can review my trading activity without retrieving every order at once.

*Maps to: `10-api-and-error-handling.md`, `internal/service/list_orders_usecase.go`, `internal/store/postgres/order_repo.go`*

**Acceptance Criteria:**

- `ListOrders` returns only orders belonging to the authenticated user.
- Results are ordered newest first.
- The default page size is 20 and the maximum is 100.
- Pagination uses the documented page token based on the last order ID returned.
- The response contains the next page token when more results are available.
- A caller cannot use pagination parameters to access another user's orders.
- Tests cover default pagination, maximum page size, subsequent pages, empty results, and ownership isolation.

## 5. Kafka Integration and Transactional Outbox

### US-5.1 - Publish accepted orders through the transactional outbox

> **As** the Matching Engine,\
> **I want** validated and persisted order commands published to the configured Kafka topic,\
> **so that** orders can enter the matching pipeline without coupling the client request to broker availability.

*Maps to: `05-kafka-contracts-and-outbox.md`, `06-matching-engine-integration.md`, `internal/worker/outbox_relay.go`, `internal/store/postgres/outbox_repo.go`*

**Acceptance Criteria:**

- Order placement commands are published to `order.accepted`.
- The Kafka record key is the decimal text representation of the order ID.
- The payload uses the versioned Protobuf contract generated through `go-sdk`.
- The command includes the outbox event ID, order ID, Auth UUID, grid ID, side, order type, price, quantity, delivery slot, expiry, and creation timestamp as specified.
- The outbox publisher claims rows using a 30-second lease.
- A command is published with broker acknowledgement (`acks=all`) and the idempotent producer configuration.
- The row is marked published only after broker acknowledgement.
- Failed publication records the error and retries with exponential backoff from one second up to 60 seconds.
- A failed outbox row blocks later unpublished commands for the same order but does not block unrelated orders.
- Expired leases can be reclaimed after a worker restart.
- Duplicate delivery is safe because the same outbox event ID is reused.

### US-5.2 - Consume Matching Engine order-state updates reliably

> **As** the Order Service,\
> **I want** to consume authoritative order-state events from Kafka,\
> **so that** PostgreSQL reflects the Matching Engine's latest order outcomes.

*Maps to: `05-kafka-contracts-and-outbox.md`, `07-order-status-synchronization.md`, `internal/worker/state_consumer.go`, `internal/service/apply_order_update_usecase.go`*

**Acceptance Criteria:**

- The service consumes `OrderUpdated` messages from `order.state` using consumer group `order-service-updates`.
- Messages are decoded using the shared Protobuf contract.
- Kafka offsets are committed manually and only after the corresponding database transaction commits.
- The event ID is recorded in `processed_events` in the same transaction as its state change.
- Duplicate event IDs do not apply the update twice.
- Decode failures and invalid event IDs are stored in `consumer_dead_letters` with the appropriate stage before the offset is committed.
- Unknown order IDs are dead-lettered and alerted; the consumer does not create an order from an update.
- The consumer uses the documented seven-day processed-event retention, with topic retention and replay behaviour considered.
- Tests cover redelivery after a process crash between database commit and offset commit.

### US-5.3 - Preserve Kafka topic and message contract compatibility

> **As** a GridX integration developer,\
> **I want** the Order Service to use the agreed Kafka topics, keys, headers, and Protobuf payloads,\
> **so that** it interoperates with the Matching Engine and other platform services without ambiguous event routing.

*Maps to: `05-kafka-contracts-and-outbox.md`, `06-matching-engine-integration.md`, `protobuf/proto/gridx/order/v1/`, `gridx-infra` Kafka configuration*

**Acceptance Criteria:**

- The service publishes placement commands to `order.accepted` and cancellation commands to `order.cancel_requested`.
- It consumes engine status updates only from `order.state`.
- It does not consume `trade.executed` for order status or settlement.
- It does not create alternative topics such as `gridx.orders.v1`, `gridx.orders.updates.v1`, or `gridx.trades.v1`.
- Kafka message keys use the decimal order ID.
- Commands include the documented `x-message-type`, `x-event-id`, `x-request-id`, and `traceparent` headers when available.
- The service uses the corrected contract types for Auth UUIDs, string grid IDs, integer watt-hour quantities, MARKET order type, and REJECTED status.
- Topic creation and partition/retention configuration remain infrastructure responsibilities, not Order Service startup side effects.
- Contract changes are coordinated with the Matching Engine and protobuf repository.

## 6. Order Status Synchronization and Lifecycle

### US-6.1 - Apply Matching Engine status updates in sequence

> **As** the Order Service,\
> **I want** to apply valid Matching Engine updates using event IDs and per-order sequence numbers,\
> **so that** order state remains consistent even when Kafka delivers duplicate, delayed, or out-of-order messages.

*Maps to: `07-order-status-synchronization.md`, `04-postgresql-persistence.md`, `internal/service/apply_order_update_usecase.go`*

**Acceptance Criteria:**

- `event_id` is the deduplication key and `order_seq` is the ordering signal.
- `updated_at` is stored for history but is never used to order events.
- The event's user UUID must match the stored order owner.
- The event type, status, and remaining quantity must agree with the documented event contract.
- An older sequence is ignored and counted.
- A repeated sequence with identical status and quantity is treated as an echo.
- A repeated sequence with different content is quarantined and flags the order for reconciliation.
- A higher sequence may be applied even when there is a sequence gap, because remaining quantity is cumulative.
- Remaining quantity cannot increase or exceed the original quantity.
- An applied update changes status, remaining quantity, reason, engine sequence, version, and terminal timestamp as applicable.
- Status history and SELL energy release are committed in the same transaction as the update.
- The Kafka offset is committed only after the database transaction commits.

### US-6.2 - Enforce the documented order status transition rules

> **As** the Order Service,\
> **I want** to enforce the order lifecycle transition matrix,\
> **so that** invalid or contradictory Matching Engine events cannot corrupt persisted order state.

*Maps to: `01-order-validation.md`, `07-order-status-synchronization.md`, `08-cancellation-and-expiry.md`, `internal/domain/transitions.go`*

**Acceptance Criteria:**

- The service supports `PENDING`, `OPEN`, `PARTIALLY_FILLED`, `CANCEL_PENDING`, `FILLED`, `CANCELLED`, `EXPIRED`, and `REJECTED`.
- `PENDING` may transition to an engine-reported outcome according to the documented matrix.
- `OPEN` and `PARTIALLY_FILLED` may transition only through valid engine outcomes.
- `CANCEL_PENDING` remains pending while partial fills are reported and moves to the authoritative terminal outcome.
- Terminal states are never reversed.
- An identical newer terminal event is treated as an echo; a conflicting event is quarantined.
- MARKET orders never transition to `OPEN` or `PARTIALLY_FILLED`.
- A MARKET order may be cancelled from `PENDING` with the documented `IOC_REMAINDER` or `NO_LIQUIDITY` outcomes.
- Invalid transitions are recorded in the dead-letter table and set `needs_reconciliation`.
- Unit tests cover every cell and special case in the documented transition matrix.

### US-6.3 - Handle LIMIT and MARKET order outcomes correctly

> **As** a GridX participant,\
> **I want** LIMIT and MARKET orders to follow their defined lifecycle rules,\
> **so that** I receive an accurate outcome for resting orders and immediate-or-cancel orders.

*Maps to: `02-limit-and-market-orders.md`, `06-matching-engine-integration.md`, `07-order-status-synchronization.md`*

**Acceptance Criteria:**

- LIMIT orders may remain OPEN or PARTIALLY_FILLED until filled, cancelled, or expired.
- MARKET orders carry a required protection price and are treated as immediate-or-cancel by the Matching Engine contract.
- MARKET orders never rest in the order book and never become OPEN or PARTIALLY_FILLED.
- A fully matched MARKET order becomes FILLED.
- A partially matched MARKET order with an unfilled remainder becomes CANCELLED with reason `IOC_REMAINDER`.
- A MARKET order with no eligible liquidity becomes CANCELLED with reason `NO_LIQUIDITY`.
- A MARKET order that reaches the engine after its expiry is rejected with the documented `ORDER_EXPIRED` reason.
- The Order Service stores the user's requested price and does not calculate the final execution price, grid fee, trade value, or wallet movement.
- Tests use a fake engine publisher to verify the documented outcomes independently of current Matching Engine runtime support.

## 7. Cancellation and Expiry

### US-7.1 - Request cancellation through Kafka

> **As** a GridX participant,\
> **I want** to request cancellation of an active order,\
> **so that** the Matching Engine can stop further matching of the remaining quantity.

*Maps to: `08-cancellation-and-expiry.md`, `05-kafka-contracts-and-outbox.md`, `internal/service/cancel_order_usecase.go`, `internal/worker/outbox_relay.go`*

**Acceptance Criteria:**

- Cancellation is allowed from `PENDING`, `OPEN`, and `PARTIALLY_FILLED`.
- A repeated request for an order already in `CANCEL_PENDING` returns the current order and does not create another command.
- Terminal orders return `ABORTED` / `ORDER_NOT_CANCELLABLE`.
- A valid request changes the stored status to `CANCEL_PENDING`, appends USER history, and inserts an outbox command in one transaction.
- The command is published to `order.cancel_requested`, keyed by order ID.
- Cancellation does not release SELL energy at request time.
- The service does not assume cancellation succeeded when the command is published.
- The final outcome is applied only from `order.state`.
- Tests cover repeated cancellation, ownership checks, terminal orders, and command creation.

### US-7.2 - Resolve cancellation and matching races from engine sequence

> **As** a GridX participant,\
> **I want** a cancellation request to resolve consistently when a fill happens at nearly the same time,\
> **so that** the final order status and remaining quantity reflect the Matching Engine's authoritative decision.

*Maps to: `08-cancellation-and-expiry.md`, `07-order-status-synchronization.md`, `06-matching-engine-integration.md`*

**Acceptance Criteria:**

- The Order Service does not decide whether a fill or cancellation wins.
- A partial fill received while cancellation is pending updates the cumulative remaining quantity and keeps the order in `CANCEL_PENDING`.
- A final `CANCELLED` event with `USER_REQUEST` moves the order to CANCELLED.
- A `FILLED` event moves the order to FILLED even if cancellation was requested earlier.
- An engine response indicating an order is unknown is quarantined and flagged for reconciliation; it is not silently treated as a successful cancellation.
- A missing cancellation response leaves the order in `CANCEL_PENDING` and triggers the documented age alert.
- SELL energy is released only for the final unused quantity after an authoritative terminal event.
- Integration tests verify the race outcomes using a fake engine that emits scripted event sequences.

### US-7.3 - Record expiry only from authoritative Matching Engine events

> **As** the Order Service,\
> **I want** to record expiry when the Matching Engine reports it,\
> **so that** order expiry remains consistent with the component that owns matching and the order book.

*Maps to: `08-cancellation-and-expiry.md`, `06-matching-engine-integration.md`, `07-order-status-synchronization.md`*

**Acceptance Criteria:**

- LIMIT expiry is the end of the 30-minute delivery slot.
- MARKET expiry is the earlier of 30 seconds after creation or the delivery-slot end.
- The Order Service does not run a local timer or scheduled job that changes an order to EXPIRED.
- An authoritative `OrderUpdated` event with EXPIRED and reason `SLOT_ENDED` updates the persisted status.
- An order that reaches the engine after `expires_at` may be rejected with `ORDER_EXPIRED` as defined by the engine contract.
- Terminal expiry releases only the remaining SELL energy in the same transaction as the status update.
- Non-terminal orders past `expires_at` are surfaced through monitoring and investigated; their status is not locally fabricated.
- Tests verify that no service code path sets EXPIRED without an engine event.

## 8. Matching Engine Integration Boundary

### US-8.1 - Integrate with the Matching Engine order command and state contracts

> **As** the Order Service,\
> **I want** to exchange order commands and authoritative state events with the Matching Engine through the agreed Kafka contracts,\
> **so that** the two services can coordinate order processing without sharing internal state.

*Maps to: `05-kafka-contracts-and-outbox.md`, `06-matching-engine-integration.md`, `protobuf/proto/gridx/order/v1/`, Matching Engine integration documentation*

**Acceptance Criteria:**

- The Order Service publishes `OrderAccepted` to `order.accepted`.
- The Order Service publishes `OrderCancelRequested` to `order.cancel_requested`.
- The Order Service consumes `OrderUpdated` from `order.state`.
- The Order Service does not read the Matching Engine's in-memory order book.
- The Order Service does not consume `trade.executed` to infer order status.
- The first engine update is treated as the acknowledgement or outcome; Kafka publication alone is not acknowledgement.
- A missing engine acknowledgement leaves the order PENDING and is surfaced through monitoring.
- The service can be tested using a fake publisher/consumer that implements the documented event contract.
- Real-engine compatibility is tracked as an integration dependency because the current engine process does not yet support all required acknowledgements, MARKET handling, cancellation, expiry, and recovery flows.
- The Order Service does not silently implement Matching Engine responsibilities to compensate for missing engine functionality.

### US-8.2 - Keep Billing and Wallet responsibilities outside the current Order Service scope

> **As** a GridX platform developer,\
> **I want** the Order Service to preserve the existing Billing/Wallet service boundary,\
> **so that** order validation and matching orchestration do not create a second wallet or settlement implementation.

*Maps to: `01-order-validation.md`, `02-limit-and-market-orders.md`, `06-matching-engine-integration.md`, `08-cancellation-and-expiry.md`, `protobuf/proto/gridx/billing/v1/order_billing.proto`*

**Acceptance Criteria:**

- The current Order Service version does not reserve, release, or settle wallet credits.
- The service does not create wallet tables, duplicate billing RPCs, or publish substitute wallet events.
- The existing `OrderBillingService` contract remains the integration point for future `ReserveCredits`, `ReleaseReservation`, and `SettleTrade` operations.
- SELL energy allocation remains distinct from wallet credit reservation.
- Order price remains an integer LKR minor-unit amount per kWh; the Order Service does not calculate trade settlement totals.
- No acceptance test for this version requires a wallet movement or payment gateway call.
- Any future billing integration is handled as a separately agreed scope change with the Billing/Wallet service owners.

## 9. Matching Engine Recovery Support

### US-9.1 - Respond to Matching Engine recovery snapshot requests

> **As** the Matching Engine,\
> **I want** to request a consistent snapshot of acknowledged active orders from the Order Service,\
> **so that** the in-memory order books can be rebuilt after an engine restart.

*Maps to: `09-kafka-based-recovery.md`, `05-kafka-contracts-and-outbox.md`, `internal/service/recovery_usecase.go`, `internal/worker/recovery.go`*

**Acceptance Criteria:**

- The service consumes `RecoveryRequested` from `order.recovery.requests`.
- The service publishes recovery responses to `order.recovery.snapshots`.
- Snapshot messages use the agreed Protobuf contract and request ID as the Kafka key.
- Only orders with `me_seq > 0` are included; unacknowledged PENDING orders are excluded.
- Orders are read from a repeatable-read, read-only PostgreSQL transaction.
- The snapshot includes the documented engine-visible status mapping and cumulative remaining quantity.
- Snapshot chunks contain no more than 500 orders.
- Chunks are followed by a `RecoverySnapshotComplete` message with chunk count and order count.
- Rows are returned in stable `(created_at, order_id)` order.
- The service serves at most one recovery request every 10 seconds.
- Repeated requests with the same request ID return the same snapshot result as required by the plan.

### US-9.2 - Refuse unsafe recovery snapshots

> **As** the Matching Engine,\
> **I want** the Order Service to report when a reliable recovery snapshot cannot be produced,\
> **so that** the engine does not rebuild its order book from stale or unreconciled state.

*Maps to: `09-kafka-based-recovery.md`, `07-order-status-synchronization.md`, `internal/service/recovery_usecase.go`*

**Acceptance Criteria:**

- Before snapshot creation, the service waits up to 60 seconds for the order-state consumer to apply the stable `order.state` offsets.
- If consumer updates remain behind, the service publishes `RecoveryUnavailable` with reason `UPDATES_LAG`.
- If an order in the recovery window has `needs_reconciliation`, the service publishes `UNRECONCILED_ORDERS`.
- If a pending dead letter from `order.state` exists, the service refuses to send a normal snapshot.
- If PostgreSQL cannot be read, the service publishes `DATABASE_UNAVAILABLE`.
- The snapshot includes only the documented 96-hour creation window.
- The Order Service does not rebuild the Matching Engine's order book, stop matching, or publish expiry events as part of this responsibility.
- Tests cover lag, reconciliation flags, pending dead letters, database failure, and successful snapshot generation.

## 10. API Gateway Integration and Error Handling

### US-10.1 - Expose order operations through the API Gateway

> **As** an authenticated GridX client,\
> **I want** to create, view, list, and cancel orders through the API Gateway's HTTP API,\
> **so that** I can use order functionality without connecting directly to internal gRPC services.

*Maps to: `10-api-and-error-handling.md`, API Gateway order routes, `protobuf/proto/gridx/order/v1/`, `internal/transport/grpc/`*

**Acceptance Criteria:**

- The API Gateway exposes the documented routes under `/api/v1/orders`.
- The Order Service itself exposes gRPC and does not create a public HTTP order API.
- Every public route requires authentication.
- The gateway passes the authenticated user identity and request/correlation metadata to the Order Service.
- The gateway maps POST create to HTTP 202 for a new order and HTTP 200 for an idempotent replay.
- The gateway maps GET list and GET by ID to HTTP 200.
- The gateway maps DELETE cancellation requests to HTTP 202.
- The gateway enforces the documented write/read rate limits and 4 KB request body limit.
- The gateway does not accept client-supplied user ID, grid ID, expiry, or status.
- The gateway and Order Service use the same shared protobuf contract and stable error reasons.

### US-10.2 - Return consistent public and internal error responses

> **As** a GridX API client,\
> **I want** predictable error responses for invalid, unauthorised, unavailable, or conflicting order operations,\
> **so that** I can understand the outcome and decide whether a request can be retried.

*Maps to: `01-order-validation.md`, `10-api-and-error-handling.md`, `internal/transport/grpc/errors.go`, API Gateway error mapping*

**Acceptance Criteria:**

- The Order Service maps failures to the documented gRPC status codes and `google.rpc.ErrorInfo.reason` values.
- The API Gateway forwards the stable reason as the public error code.
- `INVALID_ARGUMENT` and `FAILED_PRECONDITION` map to HTTP 400.
- `UNAUTHENTICATED` maps to 401; `PERMISSION_DENIED` to 403; `NOT_FOUND` to 404; and `ABORTED` to 409.
- `UNAVAILABLE` maps to 503 and `DEADLINE_EXCEEDED` to 504, with `Retry-After` where specified.
- Unexpected failures map to HTTP 500 without exposing stack traces, credentials, SQL details, or internal secrets.
- A client can distinguish business errors such as `ENERGY_INSUFFICIENT` and `READING_STALE`.
- Tests cover the documented gRPC-to-HTTP mapping.

## 11. Observability, Security, and Operational Controls

### US-11.1 - Instrument Order Service operations with Prometheus metrics

> **As** a GridX operator,\
> **I want** the Order Service to expose operational and business-process metrics,\
> **so that** service health, order processing delays, dependency failures, and reconciliation issues can be monitored through the platform's Prometheus and Grafana stack.

*Maps to: `11-security-observability-and-testing.md`, `internal/observability/metrics.go`, `gridx-infra` Prometheus configuration and Grafana dashboards*

**Acceptance Criteria:**

- The service exposes a Prometheus `/metrics` endpoint on the configured metrics listener.
- Metrics include the documented create, cancel, applied update, ignored update, dead-letter, reconciliation, outbox, pending-age, expiry, IoT, Auth, SELL rejection, and ledger-drift signals.
- Metric labels use only bounded values such as result, order type, side, status, reason, RPC, and gRPC code.
- User IDs, order IDs, wallet IDs, meter IDs, grid IDs, request IDs, email addresses, tokens, and other unbounded or sensitive values are not metric labels.
- Metrics distinguish Order Service application behaviour from infrastructure exporter metrics already collected in Stage 2.
- The endpoint is reachable by the configured Prometheus scrape job over the internal monitoring network.
- Tests verify metric registration and representative success/failure increments.
- The service's readiness does not depend on the Matching Engine being online; a Kafka outage is reflected through outbox metrics and alerts rather than automatically making the process unready.

### US-11.2 - Provide structured logs and distributed tracing

> **As** a GridX developer or operator,\
> **I want** structured logs and trace context across gateway-to-service and service-to-dependency calls,\
> **so that** order processing issues can be investigated across the distributed GridX system.

*Maps to: `11-security-observability-and-testing.md`, `internal/observability/logging.go`, `internal/transport/grpc/interceptors.go`*

**Acceptance Criteria:**

- The service uses structured `slog` logging.
- Logs include relevant correlation fields such as order ID, user UUID, request ID, and stable reason codes where appropriate.
- Access tokens, passwords, database credentials, and other secrets are never logged.
- OpenTelemetry tracing continues the `traceparent` received from the API Gateway.
- Trace context is propagated to Auth and IoT calls and Kafka messages when available.
- Logs and traces allow operators to distinguish validation, persistence, outbox publication, engine acknowledgement, and status-application stages.
- Sensitive payload data is not copied wholesale into logs.

### US-11.3 - Configure health checks and operational alerts

> **As** a GridX operator,\
> **I want** health signals and alerts for stuck orders, failed dependencies, and inconsistent ledger or event state,\
> **so that** operational problems can be detected before they cause prolonged order-processing failures.

*Maps to: `11-security-observability-and-testing.md`, `08-cancellation-and-expiry.md`, `gridx-infra` Prometheus alert rules*

**Acceptance Criteria:**

- Readiness requires PostgreSQL availability and the expected migration version.
- Readiness does not require the Matching Engine to be online.
- Kafka unavailability leaves commands in the outbox and is exposed through unpublished-row and oldest-row-age metrics.
- Alerts cover unpublished outbox rows older than 30 seconds, PENDING orders older than 30 seconds, CANCEL_PENDING age, reconciliation flags, pending dead letters, ledger drift, and non-terminal orders past expiry.
- Alerts identify the relevant service and bounded reason/status labels without exposing personal or order-specific identifiers.
- The service preserves existing health-check behaviour and does not confuse process liveness with dependency readiness.
- Alert rules are integrated with the existing Prometheus monitoring configuration; notification delivery is handled by the platform's Alertmanager integration.

## 12. Testing, Reliability, and Delivery

### US-12.1 - Implement unit and integration tests for the Order Service

> **As** a GridX developer,\
> **I want** automated tests for order validation, persistence, integrations, and lifecycle behaviour,\
> **so that** the Order Service can be changed safely without breaking platform business rules.

*Maps to: `11-security-observability-and-testing.md`, `internal/`, `test/integration/`*

**Acceptance Criteria:**

- Unit tests cover both order types, price and quantity boundaries, slot validation, permission outcomes, idempotency, and error mapping.
- Fake Auth and IoT servers cover success, failure, deadline, ownership, meter status, and reading-freshness cases.
- PostgreSQL integration tests cover migrations, constraints, concurrent SELL allocation, idempotency, status history, and release-once behaviour.
- Kafka integration tests cover outbox retries, event deduplication, offset handling, and consumer redelivery.
- A fake Matching Engine produces scripted acknowledgement, fill, partial fill, rejection, cancellation, expiry, duplicate, stale-sequence, and delayed-acknowledgement events.
- Recovery tests cover valid snapshots and every documented refusal condition.
- Tests verify that Order Service does not consume `trade.executed` or call Billing/Wallet in this version.
- Go race detection is enabled for unit and integration packages.
- Integration tests use isolated test dependencies such as Testcontainers and do not require the live Matching Engine process.

### US-12.2 - Validate crash recovery and message-processing reliability

> **As** a GridX operator,\
> **I want** the Order Service to recover safely from process restarts and Kafka redelivery,\
> **so that** order commands and engine updates are not silently lost or applied more than once.

*Maps to: `05-kafka-contracts-and-outbox.md`, `07-order-status-synchronization.md`, `09-kafka-based-recovery.md`, `11-security-observability-and-testing.md`*

**Acceptance Criteria:**

- An outbox row with an expired lease can be claimed and retried after a worker restart.
- A command acknowledged by Kafka but not yet marked published may be republished with the same event ID.
- Consumers deduplicate repeated engine event IDs transactionally.
- A process crash after database commit but before Kafka offset commit results in safe redelivery.
- A process crash before database commit does not advance the Kafka offset.
- Recovery snapshots refuse to proceed when consumer lag or reconciliation state makes the snapshot unsafe.
- Restart tests confirm that persisted orders and outbox records remain available.
- Reliability tests do not delete persistent volumes or use destructive operations against shared GridX data.

### US-12.3 - Document Order Service setup, integration, and operations

> **As** a GridX developer or operator,\
> **I want** complete service documentation aligned with the platform's architecture and implementation decisions,\
> **so that** team members can configure, run, integrate, test, and troubleshoot the Order Service consistently.

*Maps to: all documents under `plans/order_service/`, repository README, `.env.example`, `Taskfile.yml`, `gridx-infra` monitoring documentation*

**Acceptance Criteria:**

- The service README explains responsibilities, architecture, dependencies, and the boundary with the API Gateway, Auth, IoT, Matching Engine, Kafka, PostgreSQL, and Billing/Wallet.
- Local setup, environment variables, migrations, build, test, and run commands are documented.
- gRPC methods, public gateway routes, request fields, status lifecycle, units, and stable error reasons are documented.
- Kafka topics, message keys, headers, Protobuf contracts, retry behaviour, and recovery topics are documented.
- The SELL energy capacity and allocation policy is documented, including its limitations.
- Observability metrics, health checks, Prometheus scrape configuration, and alert conditions are documented.
- External dependencies and incomplete Matching Engine/protobuf work are clearly identified rather than presented as already operational.
- Documentation does not claim that the Order Service performs matching, wallet reservation, trade settlement, or physical energy transfer.

---

## Summary Table

| ID | Story | Area |
|---|---|---|
| US-1.1 | Establish the Order Service application structure | Foundation |
| US-1.2 | Define and publish the Order Service gRPC contract | Protobuf / SDK |
| US-1.3 | Configure secure service startup and database migrations | Configuration / PostgreSQL |
| US-2.1 | Validate order requests before persistence | Validation |
| US-2.2 | Authenticate the caller's trading permission | Auth Service |
| US-2.3 | Resolve the participant's house and grid | IoT Service |
| US-2.4 | Validate SELL energy availability using IoT data | IoT Service |
| US-2.5 | Create orders idempotently | Order creation |
| US-2.6 | Persist a new order and its command atomically | PostgreSQL / Outbox |
| US-3.1 | Reserve SELL energy capacity per meter and slot | Energy ledger |
| US-3.2 | Release unused SELL energy on terminal outcomes | Energy ledger |
| US-4.1 | Store durable order state and append-only history | PostgreSQL |
| US-4.2 | Retrieve an order belonging to the caller | Query API |
| US-4.3 | List the caller's orders with pagination | Query API |
| US-5.1 | Publish accepted orders through the transactional outbox | Kafka |
| US-5.2 | Consume Matching Engine state updates reliably | Kafka |
| US-5.3 | Preserve Kafka topic and message contract compatibility | Integration contracts |
| US-6.1 | Apply Matching Engine updates in sequence | Lifecycle |
| US-6.2 | Enforce order status transition rules | Lifecycle |
| US-6.3 | Handle LIMIT and MARKET outcomes correctly | Order types |
| US-7.1 | Request cancellation through Kafka | Cancellation |
| US-7.2 | Resolve cancellation and matching races | Cancellation |
| US-7.3 | Record expiry only from authoritative engine events | Expiry |
| US-8.1 | Integrate with Matching Engine command and state contracts | Matching Engine |
| US-8.2 | Keep Billing and Wallet responsibilities outside current scope | Billing boundary |
| US-9.1 | Respond to Matching Engine recovery snapshot requests | Recovery |
| US-9.2 | Refuse unsafe recovery snapshots | Recovery |
| US-10.1 | Expose order operations through the API Gateway | API Gateway |
| US-10.2 | Return consistent public and internal errors | API / Error handling |
| US-11.1 | Instrument Order Service operations with Prometheus metrics | Observability |
| US-11.2 | Provide structured logs and distributed tracing | Observability |
| US-11.3 | Configure health checks and operational alerts | Operations |
| US-12.1 | Implement unit and integration tests | Testing |
| US-12.2 | Validate crash recovery and message-processing reliability | Reliability |
| US-12.3 | Document setup, integration, and operations | Documentation |

## Cross-Service Dependencies and Scope Boundaries

| GridX component | Order Service interaction | Responsibility boundary |
|---|---|---|
| API Gateway | Receives authenticated HTTP requests and calls Order Service gRPC methods | Gateway owns public HTTP, TLS, cookies, CORS, rate limits, and HTTP response mapping. |
| Auth Service | `CheckPermission` for `trade:create` | Auth owns identity and permission decisions; Order Service enforces the trading permission. |
| IoT Ingestion and Dispatch | `ListHouses` and `GetLatestReading` through `IotService` | IoT owns house and meter data; Order Service owns SELL slot allocation policy and ledger. |
| PostgreSQL | Durable order state, history, outbox, processed events, dead letters, and energy ledger | Order Service owns its `order_management_data` schema. |
| Kafka | Placement, cancellation, state updates, and recovery messages | Kafka transports events; PostgreSQL remains the durable order source of truth. |
| Matching Engine | Consumes order commands and publishes `OrderUpdated` | Matching Engine owns matching, fills, execution prices, expiry decisions, and cancellation outcomes. |
| Billing / Wallet | Existing `OrderBillingService` contract is the future integration point | Wallet reservation, release, and settlement are outside this version's implementation scope. |
| gridx-infra monitoring | Prometheus scrapes Order Service metrics; Grafana visualises them | Infrastructure monitoring is configured in `gridx-infra`; service metrics are implemented in Order Service. |
| Protobuf / Go SDK | Shared gRPC and Kafka message definitions | Contract changes must be coordinated with the protobuf and SDK repositories. |

## Implementation Notes and External Dependencies

- **Matching Engine readiness:** The Order Service can be developed and tested against the documented event contract and a fake engine. The current Matching Engine process does not yet support every required acknowledgement, MARKET, cancellation, expiry, and recovery behaviour. Real-engine integration must be tracked as a dependency; do not mark it complete based only on fake-engine tests.
- **Protobuf and SDK changes:** The plan identifies required contract changes, including Auth UUID and grid string representations, integer Wh quantities, MARKET support, REJECTED status, and recovery messages. Coordinate these changes with the protobuf and SDK owners.
- **Kafka infrastructure:** Topic creation, partition counts, retention, compaction, and broker security are infrastructure responsibilities. The Order Service must use the agreed topic names and must not silently create alternative topics.
- **Billing boundary:** Do not implement wallet calls, wallet tables, payment gateway behaviour, or settlement logic as part of these stories. Use the existing `OrderBillingService` contract if a later approved scope adds billing integration.
- **Physical energy delivery:** The service validates and allocates declared SELL capacity. It does not guarantee generation, operate meters, or perform physical energy transfer.
- **Requirements and blockers:** If an implementation detail conflicts with the approved plan, a shared contract, or another service's current behaviour, raise it with the project group and agree on the change before implementing a workaround.
