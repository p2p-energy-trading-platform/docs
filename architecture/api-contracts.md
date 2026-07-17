---
connie-title: API Contracts
---

# GridX — API Contracts Documentation

**Project:** P2P Energy Trading Platform (GridX)
**Version:** v1.0.0 (Draft)
**Status:** Draft — contracts based on planned architecture. Teams should update field names and routes as implementation progresses.

> This document defines all API contracts for the GridX platform including REST HTTP endpoints (Fastify API Gateway), gRPC service definitions (Matching Engine), Kafka async event schemas, and IoT MQTT telemetry payloads.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Authentication](#2-authentication)
3. [REST API — Fastify API Gateway](#3-rest-api--fastify-api-gateway)
4. [gRPC Contracts — Matching Engine](#4-grpc-contracts--matching-engine)
5. [Kafka Event Contracts](#5-kafka-event-contracts)
6. [IoT MQTT Telemetry Contracts](#6-iot-mqtt-telemetry-contracts)
7. [Protobuf SDK Generation](#7-protobuf-sdk-generation)
8. [Error Codes Reference](#8-error-codes-reference)

---

## 1. Architecture Overview

```
Client (Web / Mobile)
        │
        ▼
Fastify API Gateway          ← REST / HTTP
        │
        ├──────────────────────────────────────────┐
        ▼                                          ▼
Auth Service                              Order Service
(JWT / RS256)                         (PostgreSQL + Kafka)
                                               │
                                               ▼
                                        Kafka Topic
                                    gridx.orders.v1
                                               │
                                               ▼
                                     Matching Engine        ← gRPC / C++
                                    (In-Memory Order Book)
                                               │
                                               ▼
                                        Kafka Topics
                              gridx.trades.v1 / gridx.orders.updates.v1
                                               │
                              ┌────────────────┼────────────────┐
                              ▼                ▼                ▼
                    Settlement Service   Market Data      Notification
                                          Service           Service
IoT Simulator
(MQTT / TypeScript)
        │
        ▼
MQTT Broker (Mosquitto)          ← gridx/{grid_id}/{house_id}/meter
        │
        ▼
Kafka Pipeline (Kafka + TimescaleDB + S3)
```

---

## 2. Authentication

All REST endpoints (except `/auth/login` and `/auth/register`) require a valid JWT Bearer token.

### 2.1 Token Types

| Token | Lifetime | Purpose |
|---|---|---|
| Access Token | 15 minutes | Authenticate API requests |
| Refresh Token | 7 days | Generate new access tokens |

### 2.2 Authorization Header

```
Authorization: Bearer <access_token>
```

### 2.3 JWT Payload Structure

```json
{
  "userId": "USR1001",
  "email": "user@example.com",
  "role": "PROSUMER",
  "permissions": [
    "SELL_ENERGY",
    "BUY_ENERGY",
    "VIEW_WALLET"
  ],
  "iat": 1700000000,
  "exp": 1700003600
}
```

### 2.4 JWT Claims

| Field | Type | Description |
|---|---|---|
| `userId` | string | Unique user identifier |
| `email` | string | User email address |
| `role` | string | User role: `CONSUMER`, `PROSUMER`, `ADMIN` |
| `permissions` | string[] | Allowed operations |
| `iat` | int64 | Token issued at (Unix timestamp) |
| `exp` | int64 | Token expiry (Unix timestamp) |

### 2.5 Signing Algorithm

```
Algorithm: RS256 (RSA Signature with SHA-256)
Header: { "alg": "RS256", "typ": "JWT" }
```

### 2.6 User Roles & Permissions

| Role | Permissions |
|---|---|
| `CONSUMER` | `BUY_ENERGY`, `VIEW_WALLET`, `VIEW_DASHBOARD` |
| `PROSUMER` | `BUY_ENERGY`, `SELL_ENERGY`, `VIEW_WALLET`, `VIEW_DASHBOARD` |
| `ADMIN` | All permissions |

---

## 3. REST API — Fastify API Gateway

**Base URL:** `https://api.gridx.io/v1`
**Content-Type:** `application/json`

---

### 3.1 Authentication Endpoints

#### POST `/auth/register`

Register a new user account.

**Request Body:**

```json
{
  "name": "Amal Perera",
  "email": "amal@example.com",
  "password": "SecurePassword123!",
  "role": "PROSUMER",
  "gridZone": "ZONE_A"
}
```

**Request Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Full name |
| `email` | string | Yes | Valid email address |
| `password` | string | Yes | Minimum 8 characters |
| `role` | string | Yes | `CONSUMER` or `PROSUMER` |
| `gridZone` | string | Yes | User's grid zone identifier |

**Response `201 Created`:**

```json
{
  "userId": "USR1001",
  "name": "Amal Perera",
  "email": "amal@example.com",
  "role": "PROSUMER",
  "gridZone": "ZONE_A",
  "createdAt": "2026-07-15T10:00:00Z"
}
```

---

#### POST `/auth/login`

Authenticate a user and receive JWT tokens.

**Request Body:**

```json
{
  "email": "amal@example.com",
  "password": "SecurePassword123!"
}
```

**Response `200 OK`:**

```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 900,
  "tokenType": "Bearer"
}
```

---

#### POST `/auth/refresh`

Exchange a refresh token for a new access token.

**Request Body:**

```json
{
  "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response `200 OK`:**

```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 900,
  "tokenType": "Bearer"
}
```

---

#### POST `/auth/logout`

Revoke the current refresh token and terminate the session.

**Headers:** `Authorization: Bearer <access_token>`

**Response `200 OK`:**

```json
{
  "message": "Session terminated successfully."
}
```

---

### 3.2 User Profile Endpoints

#### GET `/users/me`

Get the authenticated user's profile.

**Headers:** `Authorization: Bearer <access_token>`

**Response `200 OK`:**

```json
{
  "userId": "USR1001",
  "name": "Amal Perera",
  "email": "amal@example.com",
  "role": "PROSUMER",
  "gridZone": "ZONE_A",
  "createdAt": "2026-07-15T10:00:00Z"
}
```

---

#### PATCH `/users/me`

Update the authenticated user's profile.

**Headers:** `Authorization: Bearer <access_token>`

**Request Body:**

```json
{
  "name": "Amal K. Perera"
}
```

**Response `200 OK`:**

```json
{
  "userId": "USR1001",
  "name": "Amal K. Perera",
  "email": "amal@example.com",
  "role": "PROSUMER",
  "gridZone": "ZONE_A",
  "updatedAt": "2026-07-15T11:00:00Z"
}
```

---

### 3.3 Order Endpoints

#### POST `/orders`

Place a new energy buy or sell order.

**Headers:** `Authorization: Bearer <access_token>`

**Required Permission:** `BUY_ENERGY` or `SELL_ENERGY`

**Request Body:**

```json
{
  "side": "BUY",
  "orderType": "LIMIT",
  "pricePerKwh": 47,
  "quantityKwh": 100,
  "deliverySlotStart": "2026-07-15T10:00:00Z",
  "deliverySlotEnd": "2026-07-15T10:30:00Z"
}
```

**Request Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `side` | string | Yes | `BUY` or `SELL` |
| `orderType` | string | Yes | `LIMIT` (only supported type in v1) |
| `pricePerKwh` | int64 | Yes | Limit price in smallest currency unit |
| `quantityKwh` | int64 | Yes | Energy quantity in kWh |
| `deliverySlotStart` | string (ISO 8601) | Yes | Start of 30-minute delivery window |
| `deliverySlotEnd` | string (ISO 8601) | Yes | End of 30-minute delivery window |

**Response `201 Created`:**

```json
{
  "orderId": "ORD-20260715-001",
  "userId": "USR1001",
  "gridZone": "ZONE_A",
  "side": "BUY",
  "orderType": "LIMIT",
  "pricePerKwh": 47,
  "quantityKwh": 100,
  "remainingQuantityKwh": 100,
  "status": "OPEN",
  "deliverySlotStart": "2026-07-15T10:00:00Z",
  "deliverySlotEnd": "2026-07-15T10:30:00Z",
  "createdAt": "2026-07-15T09:45:00Z"
}
```

---

#### GET `/orders`

List all orders for the authenticated user.

**Headers:** `Authorization: Bearer <access_token>`

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `status` | string | Filter by: `OPEN`, `PARTIALLY_FILLED`, `FILLED`, `CANCELLED`, `EXPIRED` |
| `side` | string | Filter by: `BUY` or `SELL` |
| `limit` | int | Results per page (default: 20, max: 100) |
| `offset` | int | Pagination offset (default: 0) |

**Response `200 OK`:**

```json
{
  "orders": [
    {
      "orderId": "ORD-20260715-001",
      "side": "BUY",
      "orderType": "LIMIT",
      "pricePerKwh": 47,
      "quantityKwh": 100,
      "remainingQuantityKwh": 60,
      "status": "PARTIALLY_FILLED",
      "deliverySlotStart": "2026-07-15T10:00:00Z",
      "deliverySlotEnd": "2026-07-15T10:30:00Z",
      "createdAt": "2026-07-15T09:45:00Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

---

#### GET `/orders/:orderId`

Get details of a specific order.

**Headers:** `Authorization: Bearer <access_token>`

**Response `200 OK`:** Same structure as a single order object above.

---

#### DELETE `/orders/:orderId`

Cancel an open order.

**Headers:** `Authorization: Bearer <access_token>`

**Response `200 OK`:**

```json
{
  "orderId": "ORD-20260715-001",
  "status": "CANCELLED",
  "cancelledAt": "2026-07-15T09:50:00Z"
}
```

---

### 3.4 Trade Endpoints

#### GET `/trades`

List all completed trades for the authenticated user.

**Headers:** `Authorization: Bearer <access_token>`

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `limit` | int | Results per page (default: 20, max: 100) |
| `offset` | int | Pagination offset (default: 0) |
| `from` | string (ISO 8601) | Filter trades from this date |
| `to` | string (ISO 8601) | Filter trades to this date |

**Response `200 OK`:**

```json
{
  "trades": [
    {
      "tradeId": "TRD-20260715-001",
      "buyOrderId": "ORD-20260715-001",
      "sellOrderId": "ORD-20260715-002",
      "buyerGridZone": "ZONE_A",
      "sellerGridZone": "ZONE_A",
      "energyPricePerKwh": 47,
      "gridFeePerKwh": 0,
      "buyerTotalPricePerKwh": 47,
      "quantityKwh": 40,
      "gridRuleVersion": 12,
      "executedAt": "2026-07-15T10:02:00Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

---

### 3.5 Wallet Endpoints

#### GET `/wallet`

Get the authenticated user's virtual wallet balance.

**Headers:** `Authorization: Bearer <access_token>`

**Required Permission:** `VIEW_WALLET`

**Response `200 OK`:**

```json
{
  "userId": "USR1001",
  "balance": 125000,
  "currency": "LKR",
  "lastUpdatedAt": "2026-07-15T10:05:00Z"
}
```

---

#### GET `/wallet/transactions`

Get the wallet transaction history.

**Headers:** `Authorization: Bearer <access_token>`

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `limit` | int | Results per page (default: 20) |
| `offset` | int | Pagination offset |
| `type` | string | `CREDIT` or `DEBIT` |

**Response `200 OK`:**

```json
{
  "transactions": [
    {
      "transactionId": "TXN-20260715-001",
      "type": "CREDIT",
      "amount": 1880,
      "currency": "LKR",
      "description": "Energy sale — TRD-20260715-001",
      "tradeId": "TRD-20260715-001",
      "createdAt": "2026-07-15T10:02:00Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

---

### 3.6 Market Data Endpoints

#### GET `/market/orderbook`

Get the current public order book for a delivery slot.

**Query Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `deliverySlotStart` | string (ISO 8601) | Yes | Start of the delivery slot |
| `gridZone` | string | No | Filter by grid zone |

**Response `200 OK`:**

```json
{
  "deliverySlotStart": "2026-07-15T10:00:00Z",
  "deliverySlotEnd": "2026-07-15T10:30:00Z",
  "buyOrders": [
    { "pricePerKwh": 50, "totalQuantityKwh": 200 },
    { "pricePerKwh": 47, "totalQuantityKwh": 150 }
  ],
  "sellOrders": [
    { "pricePerKwh": 43, "totalQuantityKwh": 80 },
    { "pricePerKwh": 45, "totalQuantityKwh": 120 }
  ],
  "lastUpdatedAt": "2026-07-15T10:01:30Z"
}
```

---

#### GET `/market/prices`

Get recent market price history.

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `from` | string (ISO 8601) | Start of range |
| `to` | string (ISO 8601) | End of range |
| `gridZone` | string | Filter by zone |

**Response `200 OK`:**

```json
{
  "prices": [
    {
      "deliverySlotStart": "2026-07-15T09:00:00Z",
      "averagePricePerKwh": 45,
      "minPricePerKwh": 42,
      "maxPricePerKwh": 49,
      "totalVolumeKwh": 520
    }
  ]
}
```

---

### 3.7 Dashboard / Energy Endpoints

#### GET `/dashboard/energy`

Get the authenticated user's energy generation and consumption summary.

**Headers:** `Authorization: Bearer <access_token>`

**Required Permission:** `VIEW_DASHBOARD`

**Response `200 OK`:**

```json
{
  "userId": "USR1001",
  "gridZone": "ZONE_A",
  "currentPeriod": {
    "solarGenerationKwh": 12.4,
    "householdLoadKwh": 8.1,
    "batteryStateOfCharge": 0.72,
    "netEnergyKwh": 4.3,
    "timestamp": "2026-07-15T10:00:00Z"
  },
  "today": {
    "totalGenerationKwh": 48.2,
    "totalConsumptionKwh": 31.5,
    "totalSoldKwh": 16.7,
    "totalBoughtKwh": 0.0,
    "earnings": 785
  }
}
```

---

## 4. gRPC Contracts — Matching Engine

**Service:** Matching Engine
**Language:** C++20
**Protocol:** gRPC / HTTP/2
**Serialization:** Protocol Buffers (proto3)
**Package:** `gridx.matching.v1`

> These `.proto` definitions are the source of truth for the Matching Engine gRPC contracts. They should be added to the `protobuf` repository under `proto/gridx/matching/v1/`.

---

### 4.1 Order Service

**File:** `proto/gridx/matching/v1/order.proto`

```protobuf
syntax = "proto3";

package gridx.matching.v1;

option go_package = "github.com/p2p-energy-trading-platform/go-sdk/gen/gridx/matching/v1;matchingv1";

import "google/protobuf/timestamp.proto";

// Order side
enum OrderSide {
  ORDER_SIDE_UNSPECIFIED = 0;
  ORDER_SIDE_BUY = 1;
  ORDER_SIDE_SELL = 2;
}

// Order type
enum OrderType {
  ORDER_TYPE_UNSPECIFIED = 0;
  ORDER_TYPE_LIMIT = 1;
}

// Order status
enum OrderStatus {
  ORDER_STATUS_UNSPECIFIED = 0;
  ORDER_STATUS_OPEN = 1;
  ORDER_STATUS_PARTIALLY_FILLED = 2;
  ORDER_STATUS_FILLED = 3;
  ORDER_STATUS_CANCELLED = 4;
  ORDER_STATUS_EXPIRED = 5;
  ORDER_STATUS_REJECTED = 6;
}

// Represents a buy or sell order in the matching engine
message Order {
  string order_id = 1;
  string user_id = 2;
  string grid_zone = 3;
  OrderSide side = 4;
  OrderType order_type = 5;
  int64 price_per_kwh = 6;
  int64 quantity_kwh = 7;
  int64 remaining_quantity_kwh = 8;
  OrderStatus status = 9;
  google.protobuf.Timestamp delivery_slot_start = 10;
  google.protobuf.Timestamp delivery_slot_end = 11;
  google.protobuf.Timestamp expires_at = 12;
  google.protobuf.Timestamp created_at = 13;
}

// Event published to Kafka when a new order is placed
message OrderPlacedEvent {
  Order order = 1;
}

// Event published when an order's status changes
message OrderUpdatedEvent {
  string order_id = 1;
  OrderStatus status = 2;
  int64 remaining_quantity_kwh = 3;
  google.protobuf.Timestamp updated_at = 4;
}
```

---

### 4.2 Trade Service

**File:** `proto/gridx/matching/v1/trade.proto`

```protobuf
syntax = "proto3";

package gridx.matching.v1;

option go_package = "github.com/p2p-energy-trading-platform/go-sdk/gen/gridx/matching/v1;matchingv1";

import "google/protobuf/timestamp.proto";

// Represents a completed trade between a buyer and seller
message Trade {
  string trade_id = 1;
  string buy_order_id = 2;
  string sell_order_id = 3;
  string buyer_id = 4;
  string seller_id = 5;
  string buyer_grid_zone = 6;
  string seller_grid_zone = 7;
  int64 energy_price_per_kwh = 8;
  int64 grid_fee_per_kwh = 9;
  int64 buyer_total_price_per_kwh = 10;
  int64 quantity_kwh = 11;
  int32 grid_rule_version = 12;
  google.protobuf.Timestamp delivery_slot_start = 13;
  google.protobuf.Timestamp delivery_slot_end = 14;
  google.protobuf.Timestamp executed_at = 15;
}

// Event published to Kafka when a trade is executed
message TradeExecutedEvent {
  Trade trade = 1;
}
```

---

### 4.3 Grid Transfer Rules

**File:** `proto/gridx/matching/v1/grid_transfer.proto`

```protobuf
syntax = "proto3";

package gridx.matching.v1;

option go_package = "github.com/p2p-energy-trading-platform/go-sdk/gen/gridx/matching/v1;matchingv1";

import "google/protobuf/timestamp.proto";

// Defines whether energy transfer between two grid zones is allowed
// and the associated grid fee
message GridTransferRule {
  string seller_grid_zone = 1;
  string buyer_grid_zone = 2;
  bool allowed = 3;
  int64 grid_fee_per_kwh = 4;
  int32 version = 5;
  google.protobuf.Timestamp updated_at = 6;
}

// Event published to the compacted Kafka topic when a grid transfer rule changes
message GridTransferRuleUpdatedEvent {
  GridTransferRule rule = 1;
}
```

---

### 4.4 Recovery Service

**File:** `proto/gridx/matching/v1/recovery.proto`

```protobuf
syntax = "proto3";

package gridx.matching.v1;

option go_package = "github.com/p2p-energy-trading-platform/go-sdk/gen/gridx/matching/v1;matchingv1";

// Request sent by the Matching Engine to the Order Service during recovery
message GetActiveOrdersRequest {
  // Optional: filter by grid zone
  repeated string grid_zones = 1;
}

// Response from Order Service with active orders for recovery
message GetActiveOrdersResponse {
  repeated Order orders = 1;
}

// Recovery service — called by Matching Engine at startup
service RecoveryService {
  rpc GetActiveOrders(GetActiveOrdersRequest) returns (GetActiveOrdersResponse);
}
```

---

## 5. Kafka Event Contracts

**Serialization:** Protocol Buffers (proto3)
**Broker:** Apache Kafka

---

### 5.1 Topic Reference

| Topic | Type | Producer | Consumers | Description |
|---|---|---|---|---|
| `gridx.orders.v1` | Standard | Order Service | Matching Engine | New order placed events |
| `gridx.orders.updates.v1` | Standard | Matching Engine | Order Service, Notification | Order status update events |
| `gridx.trades.v1` | Standard | Matching Engine | Settlement, Market Data, Notification | Completed trade events |
| `gridx.grid-transfer-rules.v1` | Compacted | IoT Dispatch Service | Matching Engine | Grid transfer rule updates |
| `gridx.meter-telemetry.v1` | Standard | IoT Pipeline | Market Data, TimescaleDB, S3 | Smart meter readings from IoT |

---

### 5.2 `gridx.orders.v1` — Order Placed Event

**Message:** `OrderPlacedEvent` (see section 4.1)

**Kafka Message Key:** `order_id`

**Example payload (JSON representation):**

```json
{
  "order": {
    "orderId": "ORD-20260715-001",
    "userId": "USR1001",
    "gridZone": "ZONE_A",
    "side": "ORDER_SIDE_BUY",
    "orderType": "ORDER_TYPE_LIMIT",
    "pricePerKwh": 47,
    "quantityKwh": 100,
    "remainingQuantityKwh": 100,
    "status": "ORDER_STATUS_OPEN",
    "deliverySlotStart": "2026-07-15T10:00:00Z",
    "deliverySlotEnd": "2026-07-15T10:30:00Z",
    "expiresAt": "2026-07-15T10:30:00Z",
    "createdAt": "2026-07-15T09:45:00Z"
  }
}
```

---

### 5.3 `gridx.orders.updates.v1` — Order Updated Event

**Message:** `OrderUpdatedEvent` (see section 4.1)

**Kafka Message Key:** `order_id`

**Example payload (JSON representation):**

```json
{
  "orderId": "ORD-20260715-001",
  "status": "ORDER_STATUS_PARTIALLY_FILLED",
  "remainingQuantityKwh": 60,
  "updatedAt": "2026-07-15T10:02:00Z"
}
```

---

### 5.4 `gridx.trades.v1` — Trade Executed Event

**Message:** `TradeExecutedEvent` (see section 4.2)

**Kafka Message Key:** `trade_id`

**Example payload (JSON representation):**

```json
{
  "trade": {
    "tradeId": "TRD-20260715-001",
    "buyOrderId": "ORD-20260715-001",
    "sellOrderId": "ORD-20260715-002",
    "buyerId": "USR1001",
    "sellerId": "USR1002",
    "buyerGridZone": "ZONE_A",
    "sellerGridZone": "ZONE_A",
    "energyPricePerKwh": 47,
    "gridFeePerKwh": 0,
    "buyerTotalPricePerKwh": 47,
    "quantityKwh": 40,
    "gridRuleVersion": 12,
    "deliverySlotStart": "2026-07-15T10:00:00Z",
    "deliverySlotEnd": "2026-07-15T10:30:00Z",
    "executedAt": "2026-07-15T10:02:00Z"
  }
}
```

---

### 5.5 `gridx.grid-transfer-rules.v1` — Grid Transfer Rule Event

**Topic type:** Compacted (`cleanup.policy=compact`)
**Message:** `GridTransferRuleUpdatedEvent` (see section 4.3)
**Kafka Message Key:** `seller_grid_zone:buyer_grid_zone` (e.g. `ZONE_A:ZONE_B`)

**Example payload (JSON representation):**

```json
{
  "rule": {
    "sellerGridZone": "ZONE_A",
    "buyerGridZone": "ZONE_B",
    "allowed": true,
    "gridFeePerKwh": 4,
    "version": 12,
    "updatedAt": "2026-07-15T10:00:00Z"
  }
}
```

> **Note:** If no rule exists for a zone pair, the Matching Engine treats transfer as **not allowed** by default.

---

## 6. IoT MQTT Telemetry Contracts

**Broker:** Mosquitto MQTT
**Host Port:** `8883` (Windows) / `1883` (Linux)
**Container:** `gridx-mqtt`
**Protocol:** MQTT 3.1.1
**Payload Format:** JSON

---

### 6.1 Topic Structure

```
gridx/{grid_id}/{house_id}/meter
```

**Examples:**
```
gridx/grid-001/house-001/meter
gridx/grid-001/house-002/meter
gridx/grid-002/house-001/meter
```

| Segment | Description |
|---|---|
| `grid_id` | Unique identifier for the grid/neighbourhood |
| `house_id` | Unique identifier for the house within the grid |
| `meter` | Fixed suffix — indicates smart meter reading |

---

### 6.2 Smart Meter Telemetry Payload

Published by the IoT Simulator on every tick interval (configurable, default every 30 seconds).

```json
{
  "meterId": "METER-GRID001-HOUSE001",
  "houseId": "house-001",
  "gridId": "grid-001",
  "gridZone": "ZONE_A",
  "timestamp": "2026-07-15T10:00:30Z",
  "solar": {
    "generationKwh": 1.24,
    "panelCapacityKw": 5.0,
    "irradianceWm2": 620.5,
    "cloudCoverPercent": 15
  },
  "load": {
    "consumptionKwh": 0.81,
    "archetype": "RESIDENTIAL",
    "scaleFactor": 1.0
  },
  "flexibleAssets": {
    "battery": {
      "present": true,
      "stateOfChargePercent": 72.0,
      "capacityKwh": 10.0,
      "netKwh": 0.30
    },
    "ev": {
      "present": false,
      "stateOfChargePercent": null,
      "capacityKwh": null,
      "netKwh": null
    }
  },
  "netEnergyKwh": 0.73,
  "weatherSource": "LIVE",
  "deliverySlotStart": "2026-07-15T10:00:00Z",
  "deliverySlotEnd": "2026-07-15T10:30:00Z"
}
```

---

### 6.3 Telemetry Payload Fields

| Field | Type | Description |
|---|---|---|
| `meterId` | string | Unique smart meter identifier |
| `houseId` | string | House identifier |
| `gridId` | string | Grid/neighbourhood identifier |
| `gridZone` | string | Trading zone (e.g. `ZONE_A`) |
| `timestamp` | string (ISO 8601) | Reading timestamp |
| `solar.generationKwh` | float | Solar energy generated this tick |
| `solar.panelCapacityKw` | float | Installed panel capacity in kW |
| `solar.irradianceWm2` | float | Solar irradiance in W/m² |
| `solar.cloudCoverPercent` | int | Cloud cover percentage (0–100) |
| `load.consumptionKwh` | float | Household energy consumed this tick |
| `load.archetype` | string | `RESIDENTIAL` or `SMALL_BUSINESS` |
| `load.scaleFactor` | float | Load multiplier applied to archetype |
| `flexibleAssets.battery.present` | boolean | Whether battery is configured |
| `flexibleAssets.battery.stateOfChargePercent` | float | Battery charge level (0–100) |
| `flexibleAssets.battery.capacityKwh` | float | Total battery capacity |
| `flexibleAssets.battery.netKwh` | float | Net battery effect this tick (+ charging, - discharging) |
| `flexibleAssets.ev.present` | boolean | Whether EV is configured |
| `netEnergyKwh` | float | Net = solar - load - battery_net (positive = surplus) |
| `weatherSource` | string | `LIVE` (Open-Meteo) or `FALLBACK` (clear-sky model) |
| `deliverySlotStart` | string (ISO 8601) | Current 30-minute delivery slot start |
| `deliverySlotEnd` | string (ISO 8601) | Current 30-minute delivery slot end |

---

### 6.4 Weather Fallback Behaviour

| `weatherSource` | Meaning |
|---|---|
| `LIVE` | Real irradiance/cloud data from Open-Meteo API |
| `FALLBACK` | Estimated using clear-sky model (Open-Meteo unavailable) |

---

## 7. Protobuf SDK Generation

The `protobuf` repository auto-generates SDKs for all services using **Buf**.

### 7.1 SDK Targets

| SDK | Repository | Language | Usage |
|---|---|---|---|
| `go-sdk` | `p2p-energy-trading-platform/go-sdk` | Go | Matching Engine, Order Service |
| `typescript-sdk` | `p2p-energy-trading-platform/typescript-sdk` | TypeScript | Web Dashboard, Mobile App |
| `cpp-sdk` | `p2p-energy-trading-platform/cpp-sdk` | C++ | Matching Engine internals |

### 7.2 `buf.gen.yaml` — Generation Config

```yaml
version: v2
clean: true
plugins:
  # Go protobuf message types
  - remote: buf.build/protocolbuffers/go
    out: gen/go
    opt:
      - paths=source_relative
  # Go gRPC client/server stubs
  - remote: buf.build/grpc/go
    out: gen/go
    opt:
      - paths=source_relative
  # TypeScript protobuf message types
  - remote: buf.build/bufbuild/es
    out: gen/typescript
    opt:
      - target=ts
  # C++ protobuf message types
  - remote: buf.build/protocolbuffers/cpp
    out: gen/cpp
```

### 7.3 Local Development Commands

```bash
# Format proto files
buf format -w

# Lint proto files
buf lint

# Check for breaking changes against main
buf breaking --against '.git#branch=main'

# Generate SDK code locally
buf generate

# Clean generated files
rm -rf gen/
```

### 7.4 Proto File Naming Conventions

| Rule | Example |
|---|---|
| Use versioned packages | `package gridx.matching.v1;` |
| Align file path with package | `proto/gridx/matching/v1/order.proto` |
| Always set `go_package` | `option go_package = "github.com/p2p-energy-trading-platform/go-sdk/gen/gridx/matching/v1;matchingv1";` |
| Never reuse field numbers | Use `reserved` for removed fields |

---

## 8. Error Codes Reference

### 8.1 REST HTTP Status Codes

| Status Code | Meaning | When Used |
|---|---|---|
| `200 OK` | Success | GET, PATCH, DELETE success |
| `201 Created` | Resource created | POST order, POST register |
| `400 Bad Request` | Invalid request body | Missing required fields, invalid values |
| `401 Unauthorized` | Missing or invalid JWT | No Authorization header, expired token |
| `403 Forbidden` | Insufficient permissions | Role doesn't have required permission |
| `404 Not Found` | Resource not found | Order/trade ID doesn't exist |
| `409 Conflict` | Duplicate resource | Email already registered |
| `422 Unprocessable Entity` | Business rule violation | Invalid delivery slot, quantity too low |
| `500 Internal Server Error` | Server error | Unexpected failures |

### 8.2 REST Error Response Format

```json
{
  "error": {
    "code": "ORDER_SLOT_EXPIRED",
    "message": "The delivery slot for this order has already passed.",
    "timestamp": "2026-07-15T10:35:00Z"
  }
}
```

### 8.3 gRPC Status Codes

| gRPC Status | Meaning |
|---|---|
| `OK` | Success |
| `INVALID_ARGUMENT` | Invalid order fields |
| `NOT_FOUND` | Order or zone not found |
| `FAILED_PRECONDITION` | Matching engine not ready (recovering) |
| `UNAVAILABLE` | Service temporarily unavailable |
| `INTERNAL` | Unexpected internal error |

---

