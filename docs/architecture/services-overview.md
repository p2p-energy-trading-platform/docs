## Services Overview

Document describes the services of the application and related tech stack decided as of now.

The project consists of the following modules:

1. Web frontend
1. Mobile frontend
1. API gateway
1. Auth Service
1. IoT simulation
1. Data Pipeline
1. Market Ticker Service
1. Order Management Service
1. Matching Engine
1. AI/ML forecast engine
1. Billing & Wallet Service
1. Notification Service

Detailed explanation of the project, tech stacks and technical plans will be listed in the following sections.

NOTE: These are not finalized and subjected to change!

---

### 1. Web frontend

Full Plan & Documentation: **Not available will be added in future**

Info: An interactive dashboard that provides full order book depth visibility, real-time portfolio P&L tracking, and candlestick chart overlays. Users can monitor live solar generation and manage their wallet here.

#### Features:

**NOTE**: Just basic idea

* User login / registration view
* Dual mode telemtry dashboard (based on sell or buy)
* Algorithmic auto trading (for casual homeowners)
* Manual trading
* Order book depth view
* Wallet page and transaction ledger
* In app notification page

#### Techstack & Justifications:

* Next JS 16 - most members are familiar with next js
* Tailwind v4
* React 19 - has compilation and avoid unnecessary boilerplate
* Tanstack query and store (or zustand) 
* Lightweight trading charts
* Component library - not decided

---

### 2. Mobile Frontend

Full Plan & Documentation: **Not available will be added in future**

Info: A cross-platform mobile application designed for household prosumers to monitor live solar generation, view nearby grid zone maps, manage wallets, and receive push alerts.

#### Features:

* Login/register page
* Simplified home view with buy/sell toggle
* Interactive minimal charts
* Automated dashboards
* Unified wallet and ledger screen
* Push notifications


#### Techstack & Justifications:

* React Native
* Expo
* Trading charts - Not decided (options - [React native wagmi charts](https://github.com/coinjar/react-native-wagmi-charts#candlestick-chart))
* Tanstack query and zustand
* Local storage - Not decided (options - [React native mmkv](https://github.com/mrousavy/react-native-mmkv))

---

### 3. API Gateway

Full Plan & Documentation: **Not available will be added in future**

Info: A centralized entrypoint that handles external client REST and WebSocket traffic, routes requests via gRPC, and enforces rate limiting via Redis.

#### Features:

* Route requests from frontend clients to backend services and vice versa
* Handle REST/Websocket connections
* Edge caching (via redis)
* Communicate with backend services via gRPC
* Fast authorization
* Enforce rate limiting via redis (optional)

#### Techstack & Justifications:

* Node JS
* Fastify: Less boilerplate, simple and easy to develop

---

### 4. Auth Service

Full Plan & Documentation: [Auth Plans](../plans/auth/README.md)

Info: Service that utilizes JWT and OAuth 2.0 to handle registration, secure session management, and authentication across the platform.

#### Features:

* User Authentication & Identity Management
* Stateless JWT Issuance
* Session Revocation & Blacklisting

#### Techstack & Justification:

* Node JS
* Fastify: Less boilerplate, rich ecosystem for auth simple and easy to develop
* OAuth 2.0 / JWT Standard

---

#### 5. IoT Simulation

Full Plan & Documentation: **Not available will be added in future**

Info: A dynamic telemetry simulation layer to publish synthetic solar generation data every few seconds to inject physical supply signals into the exchange. Also includes a mock DEWA app to allow users to register their smart meters to the gridX system.

#### Services:

* IoT Smart Meter Simulator
* DEWA Mock App

#### Features:

* IoT smart meter data generation
* House, grids models, generation & seeding
* Multiple types of users local to iot simulation (prosumers, consumers, energy generators)
* Weather data integration
* Energy consumption/generation randomness
* IoT meter registration and payload security
* Indirect Reactivity to system trading events
* DEWA Mock app for simulating 3rd party smart meter software & registration with gridx

#### Techstack & Justification:

* Node JS
* Fastify: HTTP gateway between mock app and smart meters
* Next js: DEWA mock app (very simple barebones web app)

---

### 6. Data Pipeline

Full Plan & Documentation: **Not available will be added in future**

Info: A robust event streaming and data processing pipeline that handles smart meter feeds, trade events and machine learning pipeline.

#### Services/Concerns:

* IoT smart meter data pipeline: pipeline + ingestion consumer
* Candle & trade events pipeline: pipeline + market ticker service (acts as consumer too)
* MLOps Pipeline: pipeline + dbt + minio 

#### Services:

* MQTT Broker
* Apache Kafka + plugins
* Redis
* Timescaledb
* MinIO

#### Features:

* Receives incoming data via mqtt broker from smart meters and pushes it to kafka
* Passes trade events published by OMS and matching engine
* Stores recent data in timescaledb and uses minio for historical data
* Use tools (dbt) to aggregrate frequently needed data for easy access
* Trigger automatic model training via MLOPs pipeline
* Redis for caching and quick data access between several services

#### Techstack & Justification:

* MQTT broker: Connect IoT smart meters with system
* Apache Kafka: For raw events streaming between services
* Redis: Fast cache and state management
* Timescaledb: For storing records of recent data
* dbt: Performing data transformations, integrates with mlops pipeline. Very lightweight
* duckDB: Very lightweight, can be used to query minio. Bridges dbt and minio
* Minio: For historical data storage
* Go/Nodejs/plugins: For data ingestion services (included inbetween pipelines)

---

### 7. Market Ticker Service

Full Plan & Documentation: **Not available will be added in future**

Info: Ticker service that listens to trade events and streams real time candle data, paints hot candles, and aggregrates handles to timescaledb 

#### Features:

* Instantly loads and caches top recent candles in redis (memory store)
* Opens gRPC streaming to api gateway to instantly stream live candles
* Consumes trade events and writes closed candle data to storage layers

#### Techstack & Justification:

* Go - Concurrent I/O Handling, native support for gRPC

---

### 8. Order Management Service

Full Plan & Documentation: **Not available will be added in future**

Info: A service that validates incoming orders, checks pre trade filters, handles idempotency and publishes orders to Apache Kafka

#### Features:

* Routes trade requests/responses
* Handles trigger pre trade logic / filters before matching engine gets the event
* Handles idempotency checks

#### Techstack & Justification:

* Go - low latency, native support for kafka and gRPC

---

### 9. Matching Engine

Full Plan & Documentation: **Not available will be added in future**

Info: A high performance atomic machine engine that maintains in memory sorted order book to pair energy
buy or sell orders.

#### Features:

* Atomic Order Matching
* In-Memory Order Book Maintenance
* Consumes incoming orders from dedicated Kafka ingest topics and instantly emits events
* Deterministic State Recovery

#### Techstack & Justification:

* C++ - Deterministic Execution and low latency

---

### 10. AI/ML forecast engine

Full Plan & Documentation: **Not available will be added in future**

Info: A predictive service that trains models on historical OHLCV data to serve 24 hour energy price and demand forecasts

#### Features:

* Automated Model Training Pipelines (combines with data pipeline)
* 24-Hour Predictive Forecasting
* Analyzes forecasted spikes to predict potential grid stress or localized energy surpluses
* Expose relavant forecast data for quick actions

#### Techstack & Justification:

* FastAPI - Python ecosystem is beneficial for ai/ml services
* Prophet - Simple and robust enough

---

### 11. Billing & Wallet Service

Full Plan & Documentation: **Not available will be added in future**

Info: A transaction service that consumes executed trades and performs financial settlement, and updates user balances in the core database.

#### Features:

* Asynchronous Clearing & Settlement
* ACID-Compliant Wallet Management
* Temporary locking of buyer's credits and only release upon matching (escrow ledgering)
* Audit Logging & Invoicing

#### Techstack & Justification:

* Go - High transactional safety and concurrency

---

### 12. Notification Service

Full Plan & Documentation: **Not available will be added in future**

Info: An event-driven service that triggers instant push notifications via Expo Push and handles system wide notification alerts for in-app, email and other channels

#### Features:

* Multi-Channel Dispatch Engine
* Expo Push Token Management
* Real-Time Trade & Matching Alerts
* Smart Meter & Grid Alerts

#### Techstack & Justification:

* Fastify - Asynchronous I/O Execution and easy to build



