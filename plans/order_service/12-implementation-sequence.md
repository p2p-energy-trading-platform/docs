---
connie-title: Order Service Implementation Sequence
---

Order Service Implementation Sequence
=====================================

Purpose
-------

This document defines the order in which the Order Service and its dependencies are built, what each milestone delivers, what must be true before it is declared done, and which capabilities stay disabled until then.

It replaces the earlier single-service phase list. The verified state of the repositories shows that an order cannot flow end to end until work lands in six repositories, so the sequence is organised by **milestones that each produce a testable end-to-end capability**, with the work for every repository listed under each one.

Relative effort is given as S (days), M (about a week), and L (more than a week). It is a sizing aid, not a schedule.

Principles
----------

1. **Contracts first.** The shared contract changes are made before any service depends on them.
2. **Fakes before dependencies.** The Order Service is built and tested against a scripted fake engine, and the gateway against a fake `OrderService`, so no team waits for another.
3. **Disabled until verified.** A capability stays behind a flag, default off, until its tests pass against the real dependency.
4. **No claims ahead of the code.** A feature backed by a fake is labelled as such, and nothing is called complete while it depends on something that does not exist yet.
5. **Correctness before availability** wherever money or energy is involved.

Current State
-------------

Verified on 2026-11-02:

| Component | State | Gap |
|---|---|---|
| `order-service` | Repository does not exist. Database schema and role are provisioned and empty. | Everything |
| `matching-engine` | Tested components, no wired service. 18 required changes (E-1 to E-18). | See the engine checklist |
| `iot-ingestion-dispatch` | `IotService` complete. | `grid_zone_id` on `Grid` (an interim map avoids blocking) |
| `api-gateway` | No orders feature, no Order Service client, drops `ErrorInfo.reason`. | Orders feature and error forwarding |
| `auth-service` | `CheckPermission` works. | `trade:create` is not seeded |
| `billing-wallet-service` | Scaffolding only, no contract. | Reserve, settle, and release |
| `protobuf` | Order and trade events exist. | Additions in the Kafka, recovery, and API documents |
| `gridx-infra` | Schema, role, and Kafka transactions ready. | Order topics, no monitoring stack |
| `docs` | PR #87 plan files. | Updates in this plan set, stale architecture labels |

Workstreams
-----------

| ID | Workstream | Repository | Owner role |
|---|---|---|---|
| W0 | Shared contracts | `protobuf`, `go-sdk` | protobuf maintainers |
| W1 | Order Service | `order-service` (new) | Order Service team |
| W2 | Matching Engine | `matching-engine` | Matching Engine team |
| W3 | API Gateway | `api-gateway` | Gateway team |
| W4 | Infrastructure | `gridx-infra`, `gridx-workspace` | Infrastructure |
| W5 | Identity and devices | `auth-service`, `iot-ingestion-dispatch` | Auth and IoT owners |
| W6 | Billing and Wallet | `billing-wallet-service` | Billing team |
| W7 | Documentation | `docs` | Order Service team |

Milestones
----------

| Milestone | Outcome | Declared limits |
|---|---|---|
| **M0** Contracts and scaffolding | Shared contracts released, topics exist, the service skeleton builds, the plan is merged. No order behaviour. | No orders |
| **M1** First order end to end | A LIMIT order travels from the gateway to the engine and back. SELL and, in demo mode, BUY orders fill. | Demo only: no cancel, no duplicate protection in the engine, no recovery |
| **M2** Safe trading | Cancel, expiry, duplicates, correct prices, self-trade protection, exactly-once engine output, MARKET behind a flag. | No recovery, BUY unfunded |
| **M3** Resilient | The engine recovers from a crash without losing or duplicating anything. | BUY unfunded |
| **M4** Funded BUY | BUY orders reserve funds, and settlement follows. | |
| **M5** Production readiness | Monitoring, TLS and ACLs, performance, security review, exercised runbooks. | |

M4 and M5 can proceed in parallel once M3 is done.

### Dependency graph

| Work | Blocked by |
|---|---|
| Every Order Service increment beyond OS-1 | M0 contracts released |
| OS-3 to OS-5 (create, outbox, consumer) | Contracts (W0), and the fake engine (built inside OS-4) |
| Gateway orders feature | `order_service.proto` released, then a fake `OrderService` |
| Cross-service tests | Engine M1 (E-1 to E-8) |
| Cancel | Engine E-10, and OS-6 |
| Real money or credits moving | M2 complete, and the cross-zone price fix (E-12) |
| Recovery | Engine E-18 (exactly-once), then E-17 |
| Funded BUY | Billing contract, M2, and `read_committed` consumers |
| Production | M3, M4, and M5 |

### Feature flags and default states

| Capability | Flag | Default | Enabled when |
|---|---|---|---|
| Order creation | `ORDER_CREATION_ENABLED` | on | Always available, operators can switch off |
| MARKET orders | `ORDER_MARKET_ENABLED` | off | Engine E-16 released and MARKET tests pass (M2) |
| BUY orders | `BUY_RESERVATION_MODE` | `blocked` | `disabled` only in development, test, and demo. `required` at M4. |
| Grid zone source | `ORDER_GRID_ZONE_MAP` | interim map | Until IoT adds `grid_zone_id` |

Milestone Details
-----------------

### M0: Contracts and scaffolding

| Workstream | Work | Size |
|---|---|---|
| W0 | One `protobuf` pull request with the proto block from the Kafka document, `order_service.proto`, and `order_recovery_events.proto`. `buf lint` and `buf breaking` pass. Release a new `go-sdk` and gateway SDK. | M |
| W4 | Create `gridx.orders.v1`, `gridx.orders.updates.v1`, and `gridx.trades.v1` (6 partitions, retention 3, 3, and 7 days). Add Order Service variables and a compose service. Register `order-service` in the workspace. | S |
| W5 | Seed `trade:create` for the trading roles. | S |
| W1 | OS-0 (repository, CI, configuration, health, folder structure) and OS-1 (migration `00001`). | M |
| W7 | Merge PR #87 with files 01 to 13. Correct the stale labels in `architecture/base.md`. | S |

**Exit criteria**

- Contract checks pass and the SDK is released.
- Topics exist with the stated settings.
- CI is green on the empty service, and migration up and down passes (PER-01, PER-02, PER-03).
- Startup fails on a missing or invalid configuration value (SEC-07).
- The language decision (Go) is confirmed.

### M1: First order end to end

| Workstream | Work | Size |
|---|---|---|
| W1 | OS-2 domain and validation, OS-3 create, get, and list, OS-4 outbox and the fake engine, OS-5 updates consumer. | L |
| W2 | Engine M1: E-1 wire the service, E-2 honour validation and publish `REJECTED`, E-3 publish the incoming order's outcome, E-4 UUID `event_id` and `order_seq`, E-5 keys and idempotent producer, E-6 never skip a failed record, E-7 user UUID and trade slot, E-8 topic names from the environment. | L |
| W3 | Orders feature: create, get, list, error forwarding, CORS exposure, rate limits, deadlines. Built against a fake `OrderService`. | M |
| W5 | The interim `ORDER_GRID_ZONE_MAP` is configured. | S |

**Exit criteria** (all through the real gateway, with the real engine)

- A SELL order becomes `OPEN`. A crossing BUY fills both orders and produces one trade (MEI-02 scenarios 1, 2, 3).
- A rejected order becomes `REJECTED` and its allocation is released (scenario 7).
- A republished placement creates no second order and no second trade (scenario 8, MEI-03).
- Tests passing: VAL-01 to VAL-08, IOT-01 to IOT-07, PER-01 to PER-07, KAF-01 to KAF-06, STS-01 to STS-07, MEI-01, API-01 to API-06.

**Flag state:** `ORDER_ENV=demo` with `BUY_RESERVATION_MODE=disabled` for demonstrations, otherwise `blocked`. MARKET off.

**Declared limits:** demonstration only. There is no cancel, the engine does not yet deduplicate commands, and an engine restart loses its book.

### M2: Safe trading

| Workstream | Work | Size |
|---|---|---|
| W1 | OS-6 cancel and expiry, OS-7 MARKET behind the flag. | M |
| W2 | Engine M2: E-9 dedupe and echo, E-10 cancel, E-11 expiry events, E-12 cross-zone price fix and wiring, E-13 time-based trade IDs, E-14 self-trade prevention, E-15 zone and slot validation, E-16 MARKET, E-18 exactly-once output with fencing. | L |
| W3 | The cancel route. | S |

**Exit criteria**

- All ten cross-service scenarios pass with the real engine (MEI-02), including cancel racing a fill and an engine restart in the middle of a flow.
- Tests passing: CXL-01 to CXL-06, KAF-04, VAL-02, and the cross-zone price tests, plus the engine's own tests for E-9 to E-18.
- Every consumer of the engine's topics reads `read_committed`.
- The engine cannot match a user's order against their own.

**Flag state:** MARKET may be enabled in demo once its tests pass. BUY stays unfunded. Real credits must not move before this milestone is complete.

### M3: Resilient

| Workstream | Work | Size |
|---|---|---|
| W1 | OS-8 snapshot service and refusal rules. | M |
| W2 | E-17 recovery: startup sequence, snapshot validation, `CLOSING_EXPIRED`. | L |
| W4 | Create the two recovery topics. Confirm the grid transfer rules topic is compacted or fully retained. | S |

**Exit criteria**

- REC-01 to REC-04 pass.
- REC-05: at least 200 randomised engine crash cycles end with executed quantity never above order quantity and with Order Service and engine state equal.
- The nightly cross-service and fault-injection suites pass for a week.
- The `engine-recovery.md` runbook has been exercised.

### M4: Funded BUY

| Workstream | Work | Size |
|---|---|---|
| W6 | Billing contract in `protobuf` (`ReserveFunds`), reservation and hold handling, consumers of the updates and trades topics (`read_committed`), settlement, and rounding. | L |
| W1 | OS-9 Billing client and the `required` mode. | M |

**Exit criteria**

- WAL-02 and WAL-03 pass against the real Billing service.
- A BUY order in `required` mode reserves funds, fills, settles, and releases the unused hold correctly, including after cancel and expiry.
- Insufficient funds, a frozen wallet, and Billing unavailable are rejected with the right codes.
- Production startup refuses `BUY_RESERVATION_MODE=disabled`.

### M5: Production readiness

| Workstream | Work | Size |
|---|---|---|
| W4 | Monitoring stack with alert delivery and dashboards, Kafka TLS and SASL with the ACL matrix, network policies, secret storage. | L |
| W1 | OS-10 operations: alerts, runbooks, ledger audit, retention cleaner, dead-letter replay, performance tests. | M |
| W7 | Final documentation and the list of remaining limitations. | S |

**Exit criteria**

- Every item of the release checklist in the security, observability, and testing document is true.
- Performance targets are measured and met, or adjusted and approved.
- The security review of the threat table is done.
- Every runbook has been run at least once in a test environment.

Order Service Increments
------------------------

| ID | Increment | Needs | Tests |
|---|---|---|---|
| OS-0 | Repository, module, CI, Dockerfile, configuration validation, health, logging, metrics, tracing skeletons, folder structure | none | SEC-07 |
| OS-1 | Migration `00001` and the store package, transaction helper, trader accounts | OS-0 | PER-01 to PER-04 |
| OS-2 | Domain types, units, slot rules, status and transition matrix, request validation | OS-0 | VAL-01, VAL-03, STS-01 to STS-03 |
| OS-3 | `CreateOrder`, `GetOrder`, `ListOrders`: idempotency, IoT and Auth clients, allocation ledger, creation transaction | OS-1, OS-2, contracts | VAL-04 to VAL-08, IOT-01 to IOT-07 |
| OS-4 | Outbox publisher, producer, headers, and the scripted fake engine | OS-3 | PER-05, PER-06, KAF-06, MEI-01 |
| OS-5 | Updates consumer and apply logic, dead letters, allocation release | OS-4 | KAF-01 to KAF-05, STS-04 to STS-07, IOT-08 |
| OS-6 | `CancelOrder`, expiry reconciler, pending monitor | OS-5 | CXL-01 to CXL-05 |
| OS-7 | MARKET orders behind the flag | OS-5 | VAL-02, CXL-06 |
| OS-8 | Recovery snapshot service | OS-5 | REC-01 to REC-04 |
| OS-9 | Billing client, `required` mode, failure codes | OS-3, Billing contract | WAL-02 (fake), then WAL-03 |
| OS-10 | Alerts, runbooks, ledger audit, retention cleaner, dead-letter replay command, performance and fault-injection suites | OS-5 | IOT-09, PER-08, API and security suites |

Capability Gating
-----------------

| Capability | Status now | Must be true before enabling |
|---|---|---|
| LIMIT order creation | Not built | M1 exit criteria |
| Cancel | Not built | M2 exit criteria |
| MARKET orders | Not built, engine lacks it | E-16 released and MARKET tests pass |
| Engine crash recovery | Not built | M3 exit criteria |
| BUY with funds check | Billing not built | M4 exit criteria |
| BUY without funds check | Never in production | Development, test, and demo only |
| Real credits moving | Not built | M2 complete, E-12 fixed |
| Production deployment | Not ready | M3, M4, and M5 complete |

Contingencies
-------------

| Situation | Response |
|---|---|
| Exactly-once output (E-18) slips or librdkafka transactions are unavailable | Ship M1 and M2 without recovery and declare it. The runbook for an engine restart is: expire or cancel every active order through the Order Service before restarting, so no order is left in a book that no longer exists. Do not enable real credits without E-18. |
| Billing is not available | BUY stays `blocked` in production, or `disabled` in demo. SELL and the rest of the system are unaffected. |
| No monitoring stack | Metrics and alert rules are produced, and operators watch `/metrics` and logs manually. M5 cannot close until a stack exists. |
| Gateway work is late | Test the Order Service through its gRPC interface directly, and demonstrate with a command-line client. |
| The team prefers Node.js over Go for the Order Service | Decide before OS-0. The architecture, contracts, schema, and tests are unchanged, and the folder structure maps to the `auth-service` layout. |

Risks
-----

| Risk | Impact | Mitigation |
|---|---|---|
| The engine has 18 pending changes | Delays everything downstream | Milestone split, the scripted fake engine, early agreement on the checklist |
| Exactly-once with the C++ client is new to the team | Recovery slips or is unsafe | Early spike in M1, the contingency above |
| Units or ID mismatches across services (micro-AED, Wh, UUID versus `uint64`) | Wrong amounts or lost identity | Units written in proto comments, contract tests, the `user_uuid` fields |
| Contract drift between repositories | Silent failures | One `protobuf` pull request, `buf breaking`, SDK-based contract tests |
| Gateway drops error reasons | Clients cannot tell failures apart | Required gateway change, tested in API-01 |
| Billing not ready | No funded BUY | Fail-closed modes, M4 isolated from M1 to M3 |
| No monitoring stack | Alerts go nowhere | Alert rules in the repository, M5 gate |
| Clock skew between services | Wrong MARKET rejections | NTP, 5 s tolerance, grace periods |
| Single engine instance | Availability | Fencing prevents a split book. Recovery time is monitored. |

Documentation Tasks
-------------------

- Merge the plan files 01 to 13 into PR #87 with the consolidated follow-up edits.
- Replace `api-contracts.md` §4.3 and the order sections of §5 and §6 with the API document.
- Replace the engine's crash-recovery document with the Kafka protocol.
- Correct `architecture/base.md`: the Matching Engine is C++, the gateway is Fastify, and the Order Service is Go (once confirmed).
- Update the plan README with the dependency table and the decision index.

Definition of Done
------------------

The Order Service is ready within its declared scope when all of these hold for that scope:

- PostgreSQL durably stores orders and lifecycle history, and order and outbox creation are atomic (PER tests).
- Idempotency and concurrent requests are verified (VAL-05, IOT-06, IOT-07).
- Kafka consumers cause no duplicate business effects (KAF, STS tests).
- The API distinguishes persistence, submission, acceptance, and execution (API tests).
- IoT validation and SELL allocation follow the agreed ownership (IOT tests).
- Cancellation and expiry handle execution races and never overwrite newer outcomes or release resources twice (CXL tests).
- Recovery follows the implemented and tested protocol, if it is in the declared scope (REC tests).
- API, IoT, Kafka, and engine contracts are aligned and tested against the generated SDK.
- Security, resilience, and operational checks pass (SEC tests, fault injection, runbooks).
- MARKET and funded BUY are enabled only when their milestones are complete.
- Remaining limitations and blocked capabilities are documented, and every test that depends on a fake is labelled.

A passing Markdown lint check verifies formatting only. It does not establish implementation completeness or runtime correctness.

Decisions and Dependencies
--------------------------

### Resolved decisions

| ID | Open item | Decision |
|---|---|---|
| Z-1 | How the work is sequenced | Six milestones (M0 to M5), each ending in a testable end-to-end capability, with work for every repository listed under it. |
| Z-2 | Contracts | One `protobuf` pull request in M0, before any service depends on it. |
| Z-3 | Parallel work | A scripted fake engine for the Order Service and a fake `OrderService` for the gateway. |
| Z-4 | Default flag states | `ORDER_MARKET_ENABLED` off, `BUY_RESERVATION_MODE` `blocked`, creation on. |
| Z-5 | When BUY and MARKET become available | MARKET at M2 (flagged), funded BUY at M4. Unfunded BUY only in development, test, and demo. |
| Z-6 | Exactly-once slipping | The documented contingency. Real credits require it. |
| Z-7 | Definition of done | Tied to the test catalogue IDs and the release checklist. |

### Sign-off register by owner

Each item is defined in the document named by its prefix. "By" is the milestone that needs it.

| Owner | Items | By |
|---|---|---|
| **Matching Engine** | O-3, D-03, K-O1, K-O2, L-O1, L-O2, M-O1, M-O2, Y-O1, X-O4, R-O1, R-O2, R-O6, T-O6 (11), E-1 to E-18 | M1 to M3 |
| **protobuf maintainers** | K-O3, A-O2, R-O8, M-O3, L-O2 | M0 |
| **Infrastructure** | O-5, K-O4, P-O1, R-O5, K-O6, T-O1 to T-O4 (11) | M0, M3, M5 |
| **API Gateway** | O-4, A-O1, M-O4 (kill switch wording) | M1 |
| **Auth** | O-7, A-O3 | M0 |
| **IoT** | O-2, I-O1, I-O2, I-O3, I-O4, I-O5, R-O5 | M1 (zone map interim), M5 |
| **Billing and Settlement** | O-1, X-O1, X-O2, X-O3, L-O4, K-O5, R-O4, R-O6 | M4 |
| **Product** | O-6, L-O3, L-O5, P-O3, X-O5, M-O2, M-O4, A-O4, A-O5, T-O5 (11), T-O7 (11), R-O7 | M1 to M5 |
| **Team lead** | O-8, S-O1 (13), S-O2 (13), T-O8 (11), Z-O1 to Z-O4 | M0 |
| **Operations** | X-O6, Y-O4, R-O7 | M5 |
| **Docs** | A-O6, M-O5 | M0 |
| **Frontend** | A-O4 | M1 |

### Remaining items needing sign-off

| ID | Item | Owner |
|---|---|---|
| Z-O1 | Assign an owner and capacity to each workstream W0 to W7. | Team lead |
| Z-O2 | Agree the scope and target dates of M0 to M5. | Team lead, all owners |
| Z-O3 | Decide which milestone is the delivery target (for example, M2 for a demonstration and M4 for a funded demonstration). | Product, team lead |
| Z-O4 | Approve the contingencies, especially shipping without recovery. | Team lead, Matching Engine |

Record confirmed decisions in the shared contracts and in this document before describing any milestone as complete.
