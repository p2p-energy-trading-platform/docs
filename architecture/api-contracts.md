---
connie-title: API Contracts
---

# GridX - API Contracts Documentation

* **Project:** P2P Energy Trading Platform (GridX)
* **Version:** v1.1.0 (Draft)
* **Status:** Draft - contracts based on planned architecture. Teams should update field names and routes as implementation progresses.

> This document defines all API contracts for the GridX platform including REST HTTP endpoints (Fastify API Gateway), gRPC service definitions (Matching Engine), Kafka async event schemas, IoT MQTT telemetry payloads, and the smart meter registration flow.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Authentication](#2-authentication)
3. [Registration Flow](#3-registration-flow)
4. [REST API - Fastify API Gateway](#4-rest-api--fastify-api-gateway)
5. [gRPC Contracts - Matching Engine](#5-grpc-contracts--matching-engine)
6. [Kafka Event Contracts](#6-kafka-event-contracts)
7. [IoT MQTT Telemetry Contracts](#7-iot-mqtt-telemetry-contracts)
8. [IoT Dispatch Contracts](#8-iot-dispatch-contracts)
9. [Data Storage Tiers](#9-data-storage-tiers)
10. [Protobuf SDK Generation](#10-protobuf-sdk-generation)
11. [Error Codes Reference](#11-error-codes-reference)

---

## 1. Architecture Overview

```text
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
Kafka Topic: smart-meter-raw
        │
        ▼
IoT Ingest & Dispatch Service
        │
        ├── Hot Storage  → Redis (sub-millisecond)
        ├── Warm Storage → PostgreSQL + TimescaleDB
        └── Cold Storage → MinIO / S3 (Parquet / CSV)
```

---

## 2. Authentication

All REST endpoints (except `/auth/login`, `/auth/register`, and `/health`) require a valid JWT Bearer token.

### 2.1 Token Types

| Token | Lifetime | Purpose |
|---|---|---|
| Access Token | 15 minutes | Authenticate API requests |
| Refresh Token | 7 days | Generate new access tokens |

### 2.2 Authorization Header

```text
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

```text
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

## 3. Registration Flow

User registration follows a 3-step onboarding flow. KYC and Smart Meter connection are optional and can be completed later.

### 3.1 Registration Steps

```text
Step 1: Account Creation
        │  Email + Password + Terms agreement
        ▼
Step 2: Email Verification
        │  6-digit OTP sent to registered email (expires in 10 minutes)
        ▼
Step 3a: KYC (Optional)
        │  Legal name, National ID/Passport, Country, Date of Birth, Document upload
        ▼
Step 3b: Smart Meter Connection (Optional)
        │  User enters Smart Meter ID
        │  System sends connection request to DEWA Mock Service
        ▼
Dashboard
```

### 3.2 Smart Meter Registration Flow

When a user submits their Smart Meter ID, the following sequence occurs:

```text
User enters Smart Meter ID
        │
        ▼
Web App sends link request to DEWA Mock Service
        │
        ▼
User manually approves the link in DEWA Mock View
        │
        ▼
DEWA Mock Service generates RSA Key Pair
        │
        ├── Private Key → saved to IoT Simulator (shared DB / config)
        └── Public Key  → saved to DEWA Mock Registry DB
        │
        ▼
DEWA Mock publishes METER_VERIFIED event to MQTT Broker
        │
        ▼
MQTT-Kafka Bridge syncs event to Kafka
        │
        ▼
IoT Ingestion Service consumes METER_VERIFIED event
        │
        ├── Saves Public Key to local DB
        └── Caches Public Key in Redis
```

### 3.3 METER_VERIFIED Event Payload

Published to MQTT then synced to Kafka when a smart meter is successfully registered.

```json
{
  "event": "METER_VERIFIED",
  "meterId": "MTR-7829-XY",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
  "verifiedAt": "2026-07-21T09:00:00Z"
}
```

### 3.4 Telemetry Signature Verification Flow

After registration, the IoT Simulator signs all telemetry payloads:

```text
IoT Simulator packages telemetry metrics
        │
        ▼
Signs payload using RSA Private Key
        │
        ▼
Publishes signed bundle to MQTT topic
        │
        ▼
IoT Ingestion Service consumes from Kafka
        │
        ▼
Fetches Public Key from Redis cache (fallback: local DB)
        │
        ▼
Executes crypto.verify() check
        │
        ├── Valid   → routes data to marketplace engines
        └── Invalid → rejects payload, logs security event
```

---

## 4. REST API - Fastify API Gateway

**Base URL:** `https://api.gridx.io/v1`
**Content-Type:** `application/json`
**Repository:** [api-gateway](https://github.com/p2p-energy-trading-platform/api-gateway)

---

### 4.1 Authentication Endpoints

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

#### POST `/auth/verify-email`

Verify email address using a 6-digit OTP.

**Request Body:**

```json
{
  "email": "amal@example.com",
  "otp": "214681"
}
```

**Response `200 OK`:**

```json
{
  "message": "Email verified successfully.",
  "verified": true
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

### 4.2 User Profile Endpoints

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
  "kycStatus": "NOT_SUBMITTED",
  "smartMeterStatus": "PENDING",
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

#### PATCH `/users/me/password`

Update the authenticated user's password.

**Headers:** `Authorization: Bearer <access_token>`

**Request Body:**

```json
{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewPassword456!",
  "confirmPassword": "NewPassword456!"
}
```

**Response `200 OK`:**

```json
{
  "message": "Password updated successfully."
}
```

---

#### GET `/users/me/preferences`

Get the authenticated user's trading preferences.

**Headers:** `Authorization: Bearer <access_token>`

**Response `200 OK`:**

```json
{
  "defaultOrderType": "LIMIT",
  "defaultPriceMode": "RECOMMENDED",
  "monthlyEnergyLimitKwh": 500,
  "maxTradeValueAed": 1000,
  "autoRecommendSellPrice": true,
  "allowDispatchAutomation": false
}
```

---

#### PATCH `/users/me/preferences`

Update the authenticated user's trading preferences.

**Headers:** `Authorization: Bearer <access_token>`

**Request Body:**

```json
{
  "defaultOrderType": "LIMIT",
  "autoRecommendSellPrice": true,
  "allowDispatchAutomation": true
}
```

**Response `200 OK`:**

```json
{
  "message": "Preferences updated successfully."
}
```

---

#### POST `/users/me/smart-meter`

Submit a smart meter connection request.

**Headers:** `Authorization: Bearer <access_token>`

**Request Body:**

```json
{
  "smartMeterId": "MTR-7829-XY"
}
```

**Response `200 OK`:**

```json
{
  "smartMeterId": "MTR-7829-XY",
  "status": "PENDING",
  "message": "Connection request sent to utility provider for approval."
}
```

---

#### POST `/users/me/kyc`

Submit KYC identity verification documents.

**Headers:** `Authorization: Bearer <access_token>`

**Request Body (multipart/form-data):**

| Field | Type | Required | Description |
|---|---|---|---|
| `legalFullName` | string | Yes | Legal full name |
| `nationalId` | string | Yes | National ID or Passport number |
| `country` | string | Yes | Country of residence |
| `dateOfBirth` | string (ISO 8601) | Yes | Date of birth |
| `document` | file | Yes | PNG, JPG, or PDF up to 10 MB |

**Response `200 OK`:**

```json
{
  "kycStatus": "PENDING",
  "message": "KYC submission received. Verification in progress."
}
```

---

### 4.3 Order Endpoints

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

### 4.4 Trade Endpoints

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

#### GET `/trades/:tradeId`

Get details of a specific trade.

**Headers:** `Authorization: Bearer <access_token>`

**Response `200 OK`:** Same structure as a single trade object above.

---

### 4.5 Wallet Endpoints

#### GET `/wallet`

Get the authenticated user's virtual wallet balance.

**Headers:** `Authorization: Bearer <access_token>`

**Required Permission:** `VIEW_WALLET`

**Response `200 OK`:**

```json
{
  "userId": "USR1001",
  "balance": 125000,
  "currency": "AED",
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
      "currency": "AED",
      "description": "Energy sale - TRD-20260715-001",
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

#### POST `/wallet/deposit`

Deposit funds into the wallet.

**Headers:** `Authorization: Bearer <access_token>`

**Request Body:**

```json
{
  "amount": 50000,
  "currency": "AED",
  "paymentMethod": "BANK_TRANSFER"
}
```

**Response `200 OK`:**

```json
{
  "transactionId": "TXN-20260715-002",
  "type": "CREDIT",
  "amount": 50000,
  "currency": "AED",
  "status": "COMPLETED",
  "createdAt": "2026-07-15T10:10:00Z"
}
```

---

#### POST `/wallet/withdraw`

Withdraw funds from the wallet.

**Headers:** `Authorization: Bearer <access_token>`

**Request Body:**

```json
{
  "amount": 20000,
  "currency": "AED",
  "paymentMethod": "BANK_TRANSFER"
}
```

**Response `200 OK`:**

```json
{
  "transactionId": "TXN-20260715-003",
  "type": "DEBIT",
  "amount": 20000,
  "currency": "AED",
  "status": "COMPLETED",
  "createdAt": "2026-07-15T10:15:00Z"
}
```

---

### 4.6 Market Data Endpoints

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

#### GET `/market/candles`

Get candlestick chart data for the Trading Terminal.

**Query Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `interval` | string | Yes | `1m`, `5m`, `15m`, `1H`, `4H`, `1D` |
| `from` | string (ISO 8601) | No | Start of range |
| `to` | string (ISO 8601) | No | End of range |

**Response `200 OK`:**

```json
{
  "interval": "1m",
  "candles": [
    {
      "timestamp": "2026-07-15T10:00:00Z",
      "open": 0.45,
      "high": 0.48,
      "low": 0.43,
      "close": 0.47,
      "volumeKwh": 120
    }
  ]
}
```

---

### 4.7 IoT Device & Dispatch Endpoints

#### GET `/devices`

List all connected IoT devices for the authenticated user.

**Headers:** `Authorization: Bearer <access_token>`

**Response `200 OK`:**

```json
{
  "devices": [
    {
      "deviceId": "BAT001",
      "type": "BATTERY",
      "name": "Battery #1",
      "status": "ONLINE",
      "stateOfChargePercent": 82,
      "capacityKwh": 13.5
    },
    {
      "deviceId": "EV001",
      "type": "EV",
      "name": "Tesla Model Y",
      "status": "CONNECTED",
      "stateOfChargePercent": 65,
      "v2gAvailableKwh": 12
    }
  ],
  "total": 2
}
```

---

#### GET `/devices/:deviceId`

Get real-time status of a specific device.

**Headers:** `Authorization: Bearer <access_token>`

**Response `200 OK`:** Same structure as a single device object above.

---

#### POST `/devices/dispatch`

Send a dispatch command to an energy asset.

**Headers:** `Authorization: Bearer <access_token>`

**Request Body:**

```json
{
  "assetId": "bat_001",
  "assetType": "bess",
  "command": "set_power_kw",
  "targetKw": -3.0,
  "durationSeconds": 3600
}
```

**Request Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `assetId` | string | Yes | Asset identifier |
| `assetType` | string | Yes | `bess` (battery), `ev` |
| `command` | string | Yes | `set_power_kw` |
| `targetKw` | float | Yes | Target power in kW (negative = discharge) |
| `durationSeconds` | int | Yes | Duration of the dispatch command |

**Response `201 Created`:**

```json
{
  "dispatchId": "dsp_20260715_0042_001",
  "assetId": "bat_001",
  "assetType": "bess",
  "command": "set_power_kw",
  "targetKw": -3.0,
  "durationSeconds": 3600,
  "issuedAt": "2026-07-15T14:00:00Z",
  "expiresAt": "2026-07-15T15:00:00Z",
  "status": "EXECUTING"
}
```

---

### 4.8 Notification Endpoints

#### GET `/notifications`

Get all notifications for the authenticated user.

**Headers:** `Authorization: Bearer <access_token>`

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `category` | string | `DISPATCH`, `TRADES`, `SYSTEM`, `ACCOUNT` |
| `unread` | boolean | If `true`, return only unread notifications |
| `limit` | int | Results per page (default: 20) |
| `offset` | int | Pagination offset |

**Response `200 OK`:**

```json
{
  "notifications": [
    {
      "notificationId": "NTF-001",
      "category": "TRADES",
      "title": "Trade matched successfully",
      "description": "Your buy order TRD-7821 matched for 25.5 kWh at RM 0.45/kWh.",
      "read": false,
      "createdAt": "2026-07-15T10:18:00Z"
    }
  ],
  "unreadCount": 3,
  "total": 10
}
```

---

#### PATCH `/notifications/read-all`

Mark all notifications as read.

**Headers:** `Authorization: Bearer <access_token>`

**Response `200 OK`:**

```json
{
  "message": "All notifications marked as read."
}
```

---

#### PATCH `/notifications/:notificationId/read`

Mark a single notification as read.

**Headers:** `Authorization: Bearer <access_token>`

**Response `200 OK`:**

```json
{
  "notificationId": "NTF-001",
  "read": true
}
```

---

#### GET `/notifications/preferences`

Get the user's notification preferences.

**Headers:** `Authorization: Bearer <access_token>`

**Response `200 OK`:**

```json
{
  "tradeConfirmations": true,
  "dispatchStatus": false,
  "walletChanges": true,
  "marketingUpdates": false,
  "deliveryChannels": {
    "inApp": true,
    "email": true,
    "sms": false
  }
}
```

---

#### PATCH `/notifications/preferences`

Update notification preferences.

**Headers:** `Authorization: Bearer <access_token>`

**Request Body:**

```json
{
  "dispatchStatus": true,
  "deliveryChannels": {
    "email": false
  }
}
```

**Response `200 OK`:**

```json
{
  "message": "Notification preferences updated successfully."
}
```

---

### 4.9 Dashboard Endpoints

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

## 5. gRPC Contracts - Matching Engine

**Service:** Matching Engine
**Language:** C++20
**Protocol:** gRPC / HTTP/2
**Serialization:** Protocol Buffers (proto3)
**Package:** `gridx.matching.v1`

> These `.proto` definitions are the source of truth for the Matching Engine gRPC contracts. They should be added to the `protobuf` repository under `proto/gridx/matching/v1/`.

---

### 5.1 Order Service

**File:** `proto/gridx/matching/v1/order.proto`

```protobuf
syntax = "proto3";

package gridx.matching.v1;

option go_package = "github.com/p2p-energy-trading-platform/go-sdk/gen/gridx/matching/v1;matchingv1";

import "google/protobuf/timestamp.proto";

enum OrderSide {
  ORDER_SIDE_UNSPECIFIED = 0;
  ORDER_SIDE_BUY = 1;
  ORDER_SIDE_SELL = 2;
}

enum OrderType {
  ORDER_TYPE_UNSPECIFIED = 0;
  ORDER_TYPE_LIMIT = 1;
}

enum OrderStatus {
  ORDER_STATUS_UNSPECIFIED = 0;
  ORDER_STATUS_OPEN = 1;
  ORDER_STATUS_PARTIALLY_FILLED = 2;
  ORDER_STATUS_FILLED = 3;
  ORDER_STATUS_CANCELLED = 4;
  ORDER_STATUS_EXPIRED = 5;
  ORDER_STATUS_REJECTED = 6;
}

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

message OrderPlacedEvent {
  Order order = 1;
}

message OrderUpdatedEvent {
  string order_id = 1;
  OrderStatus status = 2;
  int64 remaining_quantity_kwh = 3;
  google.protobuf.Timestamp updated_at = 4;
}
```

---

### 5.2 Trade Service

**File:** `proto/gridx/matching/v1/trade.proto`

```protobuf
syntax = "proto3";

package gridx.matching.v1;

option go_package = "github.com/p2p-energy-trading-platform/go-sdk/gen/gridx/matching/v1;matchingv1";

import "google/protobuf/timestamp.proto";

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

message TradeExecutedEvent {
  Trade trade = 1;
}
```

---

### 5.3 Grid Transfer Rules

**File:** `proto/gridx/matching/v1/grid_transfer.proto`

```protobuf
syntax = "proto3";

package gridx.matching.v1;

option go_package = "github.com/p2p-energy-trading-platform/go-sdk/gen/gridx/matching/v1;matchingv1";

import "google/protobuf/timestamp.proto";

message GridTransferRule {
  string seller_grid_zone = 1;
  string buyer_grid_zone = 2;
  bool allowed = 3;
  int64 grid_fee_per_kwh = 4;
  int32 version = 5;
  google.protobuf.Timestamp updated_at = 6;
}

message GridTransferRuleUpdatedEvent {
  GridTransferRule rule = 1;
}
```

---

### 5.4 Recovery Service

**File:** `proto/gridx/matching/v1/recovery.proto`

```protobuf
syntax = "proto3";

package gridx.matching.v1;

option go_package = "github.com/p2p-energy-trading-platform/go-sdk/gen/gridx/matching/v1;matchingv1";

message GetActiveOrdersRequest {
  repeated string grid_zones = 1;
}

message GetActiveOrdersResponse {
  repeated Order orders = 1;
}

service RecoveryService {
  rpc GetActiveOrders(GetActiveOrdersRequest) returns (GetActiveOrdersResponse);
}
```

---

## 6. Kafka Event Contracts

**Serialization:** Protocol Buffers (proto3)
**Broker:** Apache Kafka

---

### 6.1 Topic Reference

| Topic | Type | Producer | Consumers | Description |
|---|---|---|---|---|
| `gridx.orders.v1` | Standard | Order Service | Matching Engine | New order placed events |
| `gridx.orders.updates.v1` | Standard | Matching Engine | Order Service, Notification | Order status update events |
| `gridx.trades.v1` | Standard | Matching Engine | Settlement, Market Data, Notification | Completed trade events |
| `gridx.grid-transfer-rules.v1` | Compacted | IoT Dispatch Service | Matching Engine | Grid transfer rule updates |
| `gridx.meter-telemetry.v1` | Standard | IoT Pipeline | Market Data, TimescaleDB, S3 | Smart meter readings from IoT |
| `smart-meter-raw` | Standard | MQTT-Kafka Bridge | IoT Ingest & Dispatch Service | Raw IoT smart meter telemetry |
| `order-placements` | Standard | Order Management Service | Matching Engine | Order placement events |
| `completed-trades` | Standard | Matching Engine | Market Ticker Service | Completed trade events for market data |
| `market-candles` | Standard | Market Ticker Service | Cold Ingestion Engine, Web Dashboard | Candlestick market data |

> **Note:** Kafka topic names are not yet finalized. Names marked above may change during implementation.

---

### 6.2 `gridx.orders.v1` - Order Placed Event

**Kafka Message Key:** `order_id`

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

### 6.3 `gridx.orders.updates.v1` - Order Updated Event

**Kafka Message Key:** `order_id`

```json
{
  "orderId": "ORD-20260715-001",
  "status": "ORDER_STATUS_PARTIALLY_FILLED",
  "remainingQuantityKwh": 60,
  "updatedAt": "2026-07-15T10:02:00Z"
}
```

---

### 6.4 `gridx.trades.v1` - Trade Executed Event

**Kafka Message Key:** `trade_id`

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

### 6.5 `gridx.grid-transfer-rules.v1` - Grid Transfer Rule Event

**Topic type:** Compacted (`cleanup.policy=compact`)
**Kafka Message Key:** `seller_grid_zone:buyer_grid_zone`

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

## 7. IoT MQTT Telemetry Contracts

**Broker:** Mosquitto MQTT
**Host Port:** `8883` (Windows) / `1883` (Linux)
**Container:** `gridx-mqtt`
**Protocol:** MQTT 3.1.1
**Payload Format:** JSON

---

### 7.1 Telemetry Topic Structure

```text
gridx/{grid_id}/{house_id}/meter
```

**Examples:**

```text
gridx/grid-001/house-001/meter
gridx/grid-001/house-002/meter
gridx/grid-002/house-001/meter
```

---

### 7.2 Smart Meter Telemetry Payload

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

### 7.3 Telemetry Payload Fields

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
| `flexibleAssets.battery.netKwh` | float | Net battery effect this tick |
| `flexibleAssets.ev.present` | boolean | Whether EV is configured |
| `netEnergyKwh` | float | Net = solar - load - battery_net |
| `weatherSource` | string | `LIVE` or `FALLBACK` |
| `deliverySlotStart` | string (ISO 8601) | Current 30-minute delivery slot start |
| `deliverySlotEnd` | string (ISO 8601) | Current 30-minute delivery slot end |

---

### 7.4 Weather Fallback Behaviour

| `weatherSource` | Meaning |
|---|---|
| `LIVE` | Real irradiance/cloud data from Open-Meteo API |
| `FALLBACK` | Estimated using clear-sky model (Open-Meteo unavailable) |

---

## 8. IoT Dispatch Contracts

The Dispatch Service sends physical adjustment commands over MQTT to the IoT Simulator.

### 8.1 Dispatch Topic Structure

```text
grid01/{house_id}/actuator/battery/{battery_id}
```

**Example:**

```text
grid01/house-001/actuator/battery/bat_001
```

> **Note:** This topic format is not yet finalized and may change during implementation.

---

### 8.2 Dispatch Command Payload

```json
{
  "dispatch_id": "dsp_20260616_0042_001",
  "asset_id": "bat_001",
  "asset_type": "bess",
  "command": "set_power_kw",
  "target_kw": -3.0,
  "duration_seconds": 3600,
  "issued_at": "2026-06-16T14:00:00Z",
  "expires_at": "2026-06-16T15:00:00Z"
}
```

### 8.3 Dispatch Command Fields

| Field | Type | Description |
|---|---|---|
| `dispatch_id` | string | Unique dispatch command identifier |
| `asset_id` | string | Target asset identifier |
| `asset_type` | string | `bess` (battery energy storage system) or `ev` |
| `command` | string | `set_power_kw` |
| `target_kw` | float | Target power in kW (negative = discharge, positive = charge) |
| `duration_seconds` | int | How long to maintain the command |
| `issued_at` | string (ISO 8601) | When the command was issued |
| `expires_at` | string (ISO 8601) | When the command expires |

---

## 9. Data Storage Tiers

The IoT Ingest & Dispatch Service routes data across three storage tiers based on access speed requirements.

| Tier | Technology | Access Speed | Purpose |
|---|---|---|---|
| Hot | Redis (In-Memory) | Sub-millisecond | Live meter feed, public keys cache, active sessions |
| Warm | PostgreSQL + TimescaleDB | Milliseconds | Persistent order data, time-series meter readings |
| Cold | MinIO / S3 (Parquet / CSV) | Seconds | Long-term analytical storage, ML training data |

### 9.1 Storage Flow

```text
IoT Ingest & Dispatch Service
        │
        ├── Hot  → Redis            ← live sensor feed, public key cache
        ├── Warm → PostgreSQL       ← standard relational data
        │          TimescaleDB      ← time-series hyper tables
        └── Cold → MinIO / S3       ← batch write, Parquet/CSV buckets
```

> **Future Scope:** Cold storage feeds an MLOps pipeline planned for Semester 2.

---

## 10. Protobuf SDK Generation

The `protobuf` repository auto-generates SDKs for all services using **Buf**.

### 10.1 SDK Targets

| SDK | Repository | Language | Usage |
|---|---|---|---|
| `go-sdk` | `p2p-energy-trading-platform/go-sdk` | Go | Order Service, Settlement Service |
| `typescript-sdk` | `p2p-energy-trading-platform/typescript-sdk` | TypeScript | Web Dashboard, Mobile App |
| `cpp-sdk` | `p2p-energy-trading-platform/cpp-sdk` | C++ | Matching Engine internals |

### 10.2 `buf.gen.yaml` - Generation Config

```yaml
version: v2
clean: true
plugins:
  - remote: buf.build/protocolbuffers/go
    out: gen/go
    opt:
      - paths=source_relative
  - remote: buf.build/grpc/go
    out: gen/go
    opt:
      - paths=source_relative
  - remote: buf.build/bufbuild/es
    out: gen/typescript
    opt:
      - target=ts
  - remote: buf.build/protocolbuffers/cpp
    out: gen/cpp
```

### 10.3 Local Development Commands

```bash
buf format -w
buf lint
buf breaking --against '.git#branch=main'
buf generate
rm -rf gen/
```

### 10.4 Proto File Naming Conventions

| Rule | Example |
|---|---|
| Use versioned packages | `package gridx.matching.v1;` |
| Align file path with package | `proto/gridx/matching/v1/order.proto` |
| Always set `go_package` | `option go_package = "github.com/p2p-energy-trading-platform/go-sdk/gen/gridx/matching/v1;matchingv1";` |
| Never reuse field numbers | Use `reserved` for removed fields |

---

## 11. Error Codes Reference

### 11.1 REST HTTP Status Codes

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

### 11.2 REST Error Response Format

```json
{
  "error": {
    "code": "ORDER_SLOT_EXPIRED",
    "message": "The delivery slot for this order has already passed.",
    "timestamp": "2026-07-15T10:35:00Z"
  }
}
```

### 11.3 gRPC Status Codes

| gRPC Status | Meaning |
|---|---|
| `OK` | Success |
| `INVALID_ARGUMENT` | Invalid order fields |
| `NOT_FOUND` | Order or zone not found |
| `FAILED_PRECONDITION` | Matching engine not ready (recovering) |
| `UNAVAILABLE` | Service temporarily unavailable |
| `INTERNAL` | Unexpected internal error |
