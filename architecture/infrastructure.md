---
connie-title: GridX Infrastructure
---

# GridX Infrastructure

The following services needs to be bootstrapped for the infrastructure:

* MQTT - Done
* Redis - Done
* Postgres
* Timescaledb
* Apache Kafka

**NOTE**: Other services will be added later

Refer the following [document](https://github.com/p2p-energy-trading-platform/gridx-infra/blob/main/README.md) for available configs, ports, etc..

## MQTT additional config setup guides & Info

**NOTE**: Will be added

## Postgres additional config setup guides & Info

A postgres container needs to be added. One container with a single database is enough. This database must have a master user and password and also expose a port so developers can view the database externally (outside docker container).

Also instead of having multiple databases in a single postgres container, the better plan is to have **one database** and **multiple schemas** and each schema belongs to a specific service (so they will have different username and password).

A schema will have tables, triggers, views, etc that belong to a particular service.

For postgres the following schemas are needed, each schema should have a separate username and password.

Here are the schemas that need to be created:

* auth_data
* order_management_data
* billing_data
* notification_data

| Service | Schemas accessible for service user | Service user |
| -------- | -------- | -------- |
| Auth Service | auth_data | auth_service_user |
| Order Management Service | order_management_data | order_service_user |
| Billing & Wallet Service | billing_data | billing_service_user |
| Notification Service | notification_data | notification_service_user |

All of the above must be automatically setup via the docker-compose.yml and relavant files without needing manual configuration on each developer's laptop. Other important note is that these username and password configuration must be loaded from .env files.

To do the above you can include a init bash script that is run during container initialization that sets up the above schemas, username and password.

## Timescaledb additional config setup guides & Info

A timescaledb container needs to be added. Similarly to postgres a single timescaledb container with a single database is enough. Also this database must also have a master user and password and also expose a port so developers can view the database externally (outside docker container).

Just like postgres setup, in timescaledb, instead of having multiple databases in a single timescaledb container, the better plan is to have **one database** and **multiple schemas** and each schema belongs to a specific service(s) (so they will have different username and password).

For timescaledb the following schemas are needed, each schema should have a separate username and password.

Here are the schemas that need to be created:

* iot_data
* market_data

| Service | Schemas accessible for service user | Service user |
| -------- | -------- | -------- |
| Market Ticker Service | market_data | market_service_user |
| IoT ingestion & Dispatch Service | iot_data | iot_service_user |
| AI Forecasting engine | market_data & iot_data | ai_service_user |

As similarly follow the same setup and guidelines as mentioned above for postgresql for timescaledb container.
