---
connie-title: Billing Service - Folder structure
---

# 09 – Folder structure

## Repository layout
```
billing-service/
├── cmd/
│   └── billing/
│       └── main.go                       # Application entrypoint (wires up DB, Redis, gRPC, workers)
├── internal/
│   ├── config/
│   │   └── config.go                     # Environment configuration (envconfig / viper)
│   ├── domain/
│   │   ├── errors.go                     # Domain errors mapping to gRPC status codes
│   │   └── models.go                     # Core structs (Wallet, Hold, Journal, etc.)
│   ├── store/
│   │   ├── postgres/
│   │   │   ├── db.go                     # pgxpool setup and transaction helper
│   │   │   ├── wallet_repo.go            # Row-level locking queries (SELECT ... FOR UPDATE)
│   │   │   ├── hold_repo.go              # Hold lifecycle queries
│   │   │   ├── ledger_repo.go            # Immutable journals & ledger lines
│   │   │   ├── deposit_repo.go           # Stripe deposit & webhook event deduplication
│   │   │   └── outbox_repo.go            # Transactional outbox polling
│   │   └── redis/
│   │       ├── client.go                 # Redis client connection setup
│   │       ├── idempotency.go            # Idempotency response cache operations (24h TTL)
│   │       └── keys.go                   # Redis key pattern definitions
│   ├── service/
│   │   ├── billing_usecase.go            # Core financial orchestrations (atomic DB tx + business rules)
│   │   └── wallet_usecase.go             # Wallet & Stripe payment logic
│   ├── provider/
│   │   └── stripe/
│   │       └── client.go                 # PaymentProvider interface implementation for Stripe
│   ├── worker/
│   │   ├── outbox_relay.go               # Background worker for outbox event publishing
│   │   └── reconciler.go                 # Background worker for expired holds & pending deposits
│   └── transport/
│       └── grpc/
│           ├── server.go                 # gRPC server setup
│           ├── interceptors.go           # Auth, tracing, recovery interceptors
│           ├── order_handler.go          # OrderBillingService implementation (Reserve, Settle, etc.)
│           ├── wallet_handler.go         # WalletService implementation (Deposits, Withdrawals, GetWallet)
│           └── admin_handler.go          # AdminBillingService implementation (Fee config, revenue)
├── migrations/
│   ├── 000001_initial_schema.sql         # Goose migration files (tables, indexes, check constraints)
│   ├── 000002_fee_configs.sql
│   └── embed.go                          # Embedded migration files for automated startup migration
├── Dockerfile
├── docker-compose.yml
├── Taskfile.yml
├── go.mod
└── go.sum
```