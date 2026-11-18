---
connie-title: Order Service Folder Structure
---

Order Service Folder Structure
==============================

Folder structure of order service

Layout
------

```text
order-service/
├── cmd/
│   ├── order/main.go
│   └── migrate/main.go
├── internal/
│   ├── app/
│   │   ├── app.go
│   │   └── shutdown.go
│   ├── config/
│   │   ├── config.go
│   │   └── validate.go
│   ├── domain/
│   │   ├── order.go
│   │   ├── status.go
│   │   ├── transitions.go
│   │   ├── units.go
│   │   ├── slot.go
│   │   ├── energy.go
│   │   └── errors.go
│   ├── service/
│   │   ├── create_order_usecase.go
│   │   ├── cancel_order_usecase.go
│   │   ├── get_order_usecase.go
│   │   ├── list_orders_usecase.go
│   │   ├── apply_order_update_usecase.go
│   │   ├── recovery_usecase.go
│   │   └── energy_ledger_usecase.go
│   ├── store/postgres/
│   │   ├── db.go
│   │   ├── order_repo.go
│   │   ├── outbox_repo.go
│   │   ├── allocation_repo.go
│   │   ├── processed_event_repo.go
│   │   ├── dead_letter_repo.go
│   │   ├── retry.go
│   │   └── errors.go
│   ├── provider/
│   │   ├── iot/client.go
│   │   └── auth/client.go
│   ├── transport/grpc/
│   │   ├── server.go
│   │   ├── interceptors.go
│   │   ├── errors.go
│   │   └── services/order_handler.go
│   ├── worker/
│   │   ├── outbox_relay.go
│   │   ├── state_consumer.go
│   │   └── recovery.go
│   └── observability/
│       ├── logging.go
│       └── metrics.go
├── migrations/
│   ├── embed.go
│   └── 20261118120000_create_orders.sql
├── test/integration/
├── Dockerfile
├── docker-compose.yml
├── Taskfile.yml
└── .env.example
```
