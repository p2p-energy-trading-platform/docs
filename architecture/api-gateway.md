---
connie-title: API Gateway
---

# GridX - API Gateway Documentation

* **Project:** P2P Energy Trading Platform (GridX)
* **Service:** Fastify API Gateway
* **Repository:** [api-gateway](https://github.com/p2p-energy-trading-platform/api-gateway)
* **Status:** Structured - implementation begins Weeks 10–13

> The Fastify API Gateway is the single entry point for all client requests from the GridX web dashboard and mobile app. It routes requests to the appropriate downstream microservices, enforces JWT authentication, applies rate limiting, and communicates with internal services over gRPC.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Project Structure](#4-project-structure)
5. [Environment Configuration](#5-environment-configuration)
6. [Rate Limiting](#6-rate-limiting)
7. [gRPC Server](#7-grpc-server)
8. [TypeScript SDK Integration](#8-typescript-sdk-integration)
9. [Route Reference](#9-route-reference)
10. [Authentication](#10-authentication)
11. [Running Locally](#11-running-locally)
12. [Implementation Status](#12-implementation-status)

---

## 1. Overview

The API Gateway is responsible for:

- Receiving all HTTP requests from the web dashboard and mobile app
- Validating JWT Bearer tokens on protected routes
- Applying rate limiting to prevent abuse and brute force attacks
- Routing requests to the correct downstream microservice
- Exposing a gRPC server for service-to-service communication
- Connecting to downstream services via gRPC using the TypeScript SDK
- Applying CORS and security headers
- Returning consistent error responses

The gateway does **not** contain business logic. It delegates all processing to the appropriate service.

---

## 2. Architecture

```text
Client (Web / Mobile)
        │
        ▼
Fastify API Gateway   ← HTTP (port 3000) + gRPC (port 50050)
        │
        ├── /auth/*          → Auth Service           (gRPC :50053)
        ├── /users/*         → User / Profile Service
        ├── /orders/*        → Order Management Service (gRPC :50052)
        ├── /trades/*        → Trade Service
        ├── /wallet/*        → Billing & Wallet Service
        ├── /market/*        → Market Ticker Service
        ├── /devices/*       → IoT Ingest & Dispatch Service
        ├── /notifications/* → Notification Service   (gRPC :50054)
        └── /dashboard/*     → IoT Ingest & Dispatch Service

Internal gRPC Server (port 50050)
        │
        └── Matching Engine  (gRPC :50051)
```

---

## 3. Tech Stack

| Tool | Purpose |
|---|---|
| [Fastify](https://fastify.dev/) | HTTP framework |
| [TypeScript](https://www.typescriptlang.org/) | Language |
| [@fastify/jwt](https://github.com/fastify/fastify-jwt) | JWT authentication |
| [@fastify/cors](https://github.com/fastify/fastify-cors) | CORS handling |
| [@fastify/helmet](https://github.com/fastify/fastify-helmet) | Security headers |
| [@fastify/rate-limit](https://github.com/fastify/fastify-rate-limit) | Rate limiting |
| [@grpc/grpc-js](https://github.com/grpc/grpc-node) | gRPC server and client |
| [@grpc/proto-loader](https://github.com/grpc/grpc-node/tree/master/packages/proto-loader) | Protobuf loading |

---

## 4. Project Structure

```text
api-gateway/
├── src/
│   ├── routes/
│   │   └── v1/
│   │       ├── auth.ts           # POST /auth/register, /login, /refresh, /logout
│   │       ├── orders.ts         # POST, GET, DELETE /orders
│   │       ├── trades.ts         # GET /trades
│   │       ├── wallet.ts         # GET /wallet, /transactions, /deposit, /withdraw
│   │       ├── market.ts         # GET /market/orderbook, /prices, /candles
│   │       ├── devices.ts        # GET /devices, POST /devices/dispatch
│   │       ├── notifications.ts  # GET, PATCH /notifications, /preferences
│   │       └── profile.ts        # GET, PATCH /users/me, /password, /preferences
│   ├── plugins/
│   │   ├── grpc-client.ts        # gRPC client connections to downstream services
│   │   └── grpc-server.ts        # Internal gRPC server for service-to-service comms
│   ├── config/
│   │   └── sdk.ts                # SDK and service URL configuration
│   ├── types/                    # Shared TypeScript types
│   ├── app.ts                    # App setup, plugins, rate limiting, route registration
│   └── main.ts                   # Server entry point (HTTP + gRPC)
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 5. Environment Configuration

Copy `.env.example` to `.env` before running locally:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP server port | `3000` |
| `JWT_SECRET` | Secret key for JWT signing | - |
| `NODE_ENV` | Environment | `development` |
| `RATE_LIMIT_MAX` | Max requests per window (global) | `100` |
| `RATE_LIMIT_WINDOW` | Rate limit time window | `1 minute` |
| `RATE_LIMIT_AUTH_MAX` | Max requests per window (auth routes) | `10` |
| `GATEWAY_BASE_URL` | Public base URL of the gateway | `http://localhost:3000` |
| `GRPC_PORT` | gRPC server port | `50050` |
| `MATCHING_ENGINE_URL` | Matching Engine gRPC address | `localhost:50051` |
| `ORDER_SERVICE_URL` | Order Service gRPC address | `localhost:50052` |
| `AUTH_SERVICE_URL` | Auth Service gRPC address | `localhost:50053` |
| `NOTIFICATION_SERVICE_URL` | Notification Service gRPC address | `localhost:50054` |

> **Note:** Never commit `.env` to version control. It is listed in `.gitignore`.

---

## 6. Rate Limiting

Rate limiting is applied globally using `@fastify/rate-limit` to protect the gateway from abuse and brute force attacks.

### Global Limit

All routes are limited to **100 requests per minute** by default.

### Auth Route Limit

Authentication routes (`/api/v1/auth/*`) have a stricter limit of **10 requests per minute** to prevent brute force login attempts.

### Health Check

The `/health` endpoint is excluded from rate limiting.

### Rate Limit Error Response

When a client exceeds the limit, the gateway returns:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later."
  }
}
```

---

## 7. gRPC Server

The gateway runs an internal gRPC server on port `50050` for service-to-service communication.

### Server Lifecycle

```text
Application Starts
        │
        ▼
gRPC Server starts on port 50050
        │
        ▼
HTTP Server starts on port 3000
        │
        ▼
SIGINT / SIGTERM received
        │
        ▼
HTTP Server closes gracefully
        │
        ▼
gRPC Server shuts down gracefully
```

### gRPC Client Connections

The gateway maintains gRPC client connections to downstream services:

| Service | Address | Purpose |
|---|---|---|
| Matching Engine | `localhost:50051` | Order matching and recovery |
| Order Service | `localhost:50052` | Order management |
| Auth Service | `localhost:50053` | Token validation |
| Notification Service | `localhost:50054` | Event notifications |

> **Note:** Proto file bindings will be wired in once `.proto` files are finalized in the `protobuf` repository under `proto/gridx/`.

---

## 8. TypeScript SDK Integration

The gateway uses the GridX TypeScript SDK generated from the `protobuf` repository.

### SDK Repository

[typescript-sdk](https://github.com/p2p-energy-trading-platform/typescript-sdk) - auto-generated from `.proto` files on every release of the `protobuf` repo.

### SDK Config (`src/config/sdk.ts`)

Centralizes all service URLs and gRPC connection options:

```typescript
export const SDK_CONFIG = {
  gatewayBaseUrl: process.env.GATEWAY_BASE_URL || 'http://localhost:3000',
  services: {
    matchingEngine: process.env.MATCHING_ENGINE_URL || 'localhost:50051',
    orderService: process.env.ORDER_SERVICE_URL || 'localhost:50052',
    authService: process.env.AUTH_SERVICE_URL || 'localhost:50053',
    notificationService: process.env.NOTIFICATION_SERVICE_URL || 'localhost:50054',
  },
  grpc: {
    keepaliveTimeMs: 10000,
    keepaliveTimeoutMs: 5000,
    keepalivePermitWithoutCalls: true,
  }
}
```

### SDK Generation Flow

```text
protobuf repo (proto files)
        │
        ▼
buf generate (on release)
        │
        ▼
typescript-sdk repo (auto-published)
        │
        ▼
api-gateway installs via npm
```

> **Note:** The TypeScript SDK will be installable via npm once the `typescript-sdk` repo publishes its first release. Until then, gRPC client stubs are commented placeholders.

---

## 9. Route Reference

**Base URL:** `https://api.gridx.io/v1` (production placeholder)
**Local URL:** `http://localhost:3000/api/v1`

### Health Check

```text
GET /health
```

Returns `{ "status": "ok", "service": "gridx-api-gateway" }`. Excluded from rate limiting.

---

### Authentication Routes

| Method | Route | Auth Required | Rate Limit |
|---|---|---|---|
| `POST` | `/auth/register` | No | 10/min |
| `POST` | `/auth/verify-email` | No | 10/min |
| `POST` | `/auth/login` | No | 10/min |
| `POST` | `/auth/refresh` | No | 10/min |
| `POST` | `/auth/logout` | Yes | 10/min |

---

### User Profile Routes

| Method | Route | Auth Required |
|---|---|---|
| `GET` | `/users/me` | Yes |
| `PATCH` | `/users/me` | Yes |
| `PATCH` | `/users/me/password` | Yes |
| `GET` | `/users/me/preferences` | Yes |
| `PATCH` | `/users/me/preferences` | Yes |
| `POST` | `/users/me/smart-meter` | Yes |
| `POST` | `/users/me/kyc` | Yes |

---

### Order Routes

| Method | Route | Auth Required |
|---|---|---|
| `POST` | `/orders` | Yes |
| `GET` | `/orders` | Yes |
| `GET` | `/orders/:orderId` | Yes |
| `DELETE` | `/orders/:orderId` | Yes |

---

### Trade Routes

| Method | Route | Auth Required |
|---|---|---|
| `GET` | `/trades` | Yes |
| `GET` | `/trades/:tradeId` | Yes |

---

### Wallet Routes

| Method | Route | Auth Required |
|---|---|---|
| `GET` | `/wallet` | Yes |
| `GET` | `/wallet/transactions` | Yes |
| `POST` | `/wallet/deposit` | Yes |
| `POST` | `/wallet/withdraw` | Yes |

---

### Market Data Routes

| Method | Route | Auth Required |
|---|---|---|
| `GET` | `/market/orderbook` | No |
| `GET` | `/market/prices` | No |
| `GET` | `/market/candles` | No |

---

### IoT Device & Dispatch Routes

| Method | Route | Auth Required |
|---|---|---|
| `GET` | `/devices` | Yes |
| `GET` | `/devices/:deviceId` | Yes |
| `POST` | `/devices/dispatch` | Yes |

---

### Notification Routes

| Method | Route | Auth Required |
|---|---|---|
| `GET` | `/notifications` | Yes |
| `PATCH` | `/notifications/read-all` | Yes |
| `PATCH` | `/notifications/:notificationId/read` | Yes |
| `GET` | `/notifications/preferences` | Yes |
| `PATCH` | `/notifications/preferences` | Yes |

---

### Dashboard Routes

| Method | Route | Auth Required |
|---|---|---|
| `GET` | `/dashboard/energy` | Yes |

---

## 10. Authentication

All routes marked **Auth Required** expect a valid JWT Bearer token:

```text
Authorization: Bearer <access_token>
```

Access tokens are issued by the Auth Service using **RS256** signing and expire after **15 minutes**. Use `POST /auth/refresh` with a valid refresh token to obtain a new access token.

Unauthorized requests return:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid authorization token.",
    "timestamp": "2026-07-21T09:00:00Z"
  }
}
```

---

## 11. Running Locally

### Prerequisites

- Node.js 18+
- npm

### Install and Run

```bash
# Clone the repo
git clone https://github.com/p2p-energy-trading-platform/api-gateway.git
cd api-gateway

# Install dependencies
npm install

# Set up environment
cp .env.example .env

# Run in development mode
npx tsx src/main.ts
```

Both the HTTP server and gRPC server will start:

```text
[gRPC] Server listening on port 50050
[HTTP] Server listening on port 3000
```

Test the health check:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{ "status": "ok", "service": "gridx-api-gateway" }
```

---

## 12. Implementation Status

> All routes currently return `501 Not Implemented`. Implementation begins in **Weeks 10–13** per the project timeline.

| Feature | Status | Planned Week |
|---|---|---|
| Rate Limiting |  Implemented | - |
| gRPC Server |  Structured | - |
| TypeScript SDK Config |  Structured | - |
| Auth Routes |  Not implemented | Week 10 |
| User Profile Routes |  Not implemented | Week 10 |
| Order Routes |  Not implemented | Week 10 |
| Trade Routes |  Not implemented | Week 11 |
| Wallet Routes |  Not implemented | Week 11 |
| Market Data Routes |  Not implemented | Week 11 |
| IoT Device & Dispatch Routes |  Not implemented | Week 12 |
| Notification Routes |  Not implemented | Week 12 |
| Dashboard Routes |  Not implemented | Week 13 |
| Proto file bindings |  Pending protobuf repo | Week 10 |
| TypeScript SDK npm install |  Pending sdk release | Week 10 |
