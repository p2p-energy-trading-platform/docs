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

* Biometrics auth & login/register page
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
* Fastify

---

### 4. Auth Service

Full Plan & Documentation: **Not available will be added in future**

Info: Service that utilizes JWT and OAuth 2.0 to handle registration, secure session management, and authentication across the platform.

**NOTE**: The rest will be filled later

