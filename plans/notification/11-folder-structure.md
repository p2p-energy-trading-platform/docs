---
connie-title: Notification Service - Folder Structure
---

# Folder Structure

New repository: `notification-service` in the `p2p-energy-trading-platform` organisation. The layout follows `auth-service` so the team can move between the two easily.

```text
notification-service/
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
├── tsconfig.json
├── scripts/
│   ├── check-config.ts
│   └── retry-deliveries.ts
├── src/
│   ├── main.ts
│   ├── app.ts
│   ├── config/
│   ├── errors/
│   ├── observability/
│   ├── plugins/
│   ├── transport/
│   │   └── grpc/
│   ├── consumer/
│   │   ├── kafka-consumer.ts
│   │   ├── router.ts
│   │   ├── dlq.ts
│   │   └── handlers/
│   │       ├── trade-executed.ts
│   │       ├── order-events.ts
│   │       ├── device-status.ts
│   │       └── grid-rule-changed.ts
│   ├── features/
│   │   ├── notifications/
│   │   ├── preferences/
│   │   ├── devices/
│   │   └── unsubscribe/
│   ├── delivery/
│   │   ├── queue.ts
│   │   ├── worker.ts
│   │   ├── backoff.ts
│   │   ├── rate-limit.ts
│   │   └── channels/
│   │       ├── in-app.ts
│   │       ├── email.ts
│   │       └── push.ts
│   ├── jobs/
│   │   ├── push-receipts.ts
│   │   ├── retention.ts
│   │   └── stuck-jobs-reaper.ts
│   ├── templates/
│   │   ├── registry.ts
│   │   ├── format.ts
│   │   ├── types/
│   │   └── email/
│   └── infrastructure/
│       ├── database/
│       │   ├── client.ts
│       │   └── migrations/
│       ├── kafka/
│       ├── redis/
│       ├── auth-client/
│       ├── email/
│       └── push/
└── tests/
    ├── unit/
    ├── integration/
    └── fixtures/
```

## Workspace changes

- Add `notification-service` to `REPOS` in `gridx-workspace/Taskfile.yml`.
- Include `./notification-service/docker-compose.yml` in `docker-compose.root.yml`.
- Add `notification-service=skeleton` to `.analysis-maturity`.
- Add `NOTIFICATION_SERVICE_*` variables to the service `.env.example` (DB user already exists in `gridx-infra`).
