---
connie-title: gRPC
---

# GridX - API Gateway gRPC Documentation

* **Project:** P2P Energy Trading Platform (GridX)
* **Service:** Fastify API Gateway
* **Component:** gRPC Client Infrastructure
* **Repository:** [api-gateway](https://github.com/p2p-energy-trading-platform/api-gateway)
* **Status:** Foundation implemented - service integration pending protobuf contracts

> The API Gateway uses gRPC as the internal communication protocol between microservices. This document describes the gRPC architecture, client configuration, protobuf workflow, SDK integration, and current implementation status.

---

# Table of Contents

1. [Overview](#1-overview)
2. [gRPC Architecture](#2-grpc-architecture)
3. [Why gRPC](#3-why-grpc)
4. [Gateway gRPC Responsibilities](#4-gateway-grpc-responsibilities)
5. [Project Structure](#5-project-structure)
6. [gRPC Client Configuration](#6-grpc-client-configuration)
7. [Configured Services](#7-configured-services)
8. [Protocol Buffer Integration](#8-protocol-buffer-integration)
9. [TypeScript SDK Integration](#9-typescript-sdk-integration)
10. [Go SDK Integration](#10-go-sdk-integration)
11. [Connection Management](#11-connection-management)
12. [Current Implementation Status](#12-current-implementation-status)
13. [Future Improvements](#13-future-improvements)

---

# 1. Overview

The GridX API Gateway follows a hybrid communication architecture:

- REST API for external client communication
- gRPC for internal microservice communication

The gateway receives requests from:

- Web Dashboard
- Mobile Application

and communicates with internal GridX services through gRPC.

The API Gateway does not contain business logic. It forwards requests to the responsible microservice.

---

# 2. gRPC Architecture

```text
                    Web / Mobile Client
                           |
                           |
                      HTTP REST API
                           |
                           |
                  +----------------+
                  | API Gateway    |
                  | Fastify        |
                  | Port: 3000     |
                  +----------------+
                           |
                           |
                    gRPC Client Layer
                           |
        +------------------+------------------+
        |                  |                  |
        |                  |                  |
 +-------------+   +-------------+   +-------------+
 | Auth        |   | Order       |   | Matching    |
 | Service     |   | Service     |   | Engine      |
 | :50053      |   | :50052      |   | :50051      |
 +-------------+   +-------------+   +-------------+

 +-------------+   +-------------+   +-------------+
 | Trade       |   | Wallet      |   | Device      |
 | Service     |   | Service     |   | Service     |
 | :50055      |   | :50056      |   | :50057      |
 +-------------+   +-------------+   +-------------+
```

---

# 3. Why gRPC

GridX uses gRPC because internal services require efficient communication.

## Benefits

### High Performance

gRPC uses Protocol Buffers instead of JSON.

Advantages:

- Smaller payload size
- Faster serialization
- Lower latency communication

### Strongly Typed Contracts

Service contracts are defined using `.proto` files.

Example:

```proto
service OrderService {

  rpc CreateOrder(CreateOrderRequest)
      returns(CreateOrderResponse);

}
```

This provides:

- Compile-time validation
- Consistent API contracts
- Reduced integration errors

### Multi-language Support

The same protobuf definition can generate:

- TypeScript clients
- Go clients
- C++ clients

This allows different GridX services to use different languages.

---

# 4. Gateway gRPC Responsibilities

The API Gateway gRPC layer is responsible for:

- Creating gRPC client connections
- Managing service endpoints
- Handling connection options
- Communicating with internal services
- Preparing generated SDK integration

The gateway does not currently expose a public gRPC API.

Current architecture:

```text
Client
 |
 |
REST
 |
 |
API Gateway
 |
 |
gRPC Client
 |
 |
Internal Services
```

---

# 5. Project Structure

Current gRPC-related structure:

```text
api-gateway/

├── src/
│
├── plugins/
│   └── grpc-client.ts
│
├── config/
│   └── sdk.ts
│
├── routes/
│
└── main.ts
```

---

# 6. gRPC Client Configuration

The gateway stores all gRPC service configuration centrally.

Location:

```text
src/config/sdk.ts
```

Example:

```typescript
export const SDK_CONFIG = {

services: {

matchingEngine:
localhost:50051,

orderService:
localhost:50052,

authService:
localhost:50053,

notificationService:
localhost:50054

}

}
```

Benefits:

- No hardcoded service addresses
- Easy environment changes
- Deployment friendly

---

# 7. Configured Services

| Service | Address | Purpose |
|-|-|-|
| Matching Engine | localhost:50051 | Order matching |
| Order Service | localhost:50052 | Order lifecycle |
| Auth Service | localhost:50053 | Authentication |
| Notification Service | localhost:50054 | User notifications |
| Trade Service | localhost:50055 | Trade management |
| Wallet Service | localhost:50056 | Wallet transactions |
| Device Service | localhost:50057 | IoT device communication |

---

# 8. Protocol Buffer Integration

GridX maintains protobuf contracts in a separate repository.

Repository:

```text
protobuf
```

Structure:

```text
protobuf/

├── proto/
│   └── gridx/
│
├── buf.yaml
│
└── buf.gen.yaml
```

The protobuf repository acts as the source of truth.

Workflow:

```text
.proto Files
      |
      |
buf generate
      |
      |
Generated SDKs
      |
      |
GridX Services
```

---

# 9. TypeScript SDK Integration

The API Gateway will consume the generated TypeScript SDK.

Repository:

```text
typescript-sdk
```

Purpose:

- Generated protobuf messages
- Generated gRPC clients
- Type-safe communication

Generation flow:

```text
protobuf repository
        |
        |
buf generate
        |
        |
typescript-sdk
        |
        |
api-gateway
```

Current status:

The SDK integration is prepared.

Actual generated clients will be connected after protobuf services are finalized.

---

# 10. Go SDK Integration

Repository:

```text
go-sdk
```

The Go SDK is intended for Go-based GridX backend services.

Potential consumers:

- Matching Engine
- Trading Engine
- AI Forecast Service

Generation flow:

```text
protobuf
   |
buf generate
   |
go-sdk
   |
backend services
```

Benefits:

- Shared contracts
- Strong typing
- Reduced manual API integration

---

# 11. Connection Management

The gRPC client uses keepalive configuration.

Current settings:

```typescript
keepaliveTimeMs:10000

keepaliveTimeoutMs:5000

keepalivePermitWithoutCalls:true
```

Purpose:

- Detect inactive connections
- Maintain healthy channels
- Improve reliability

---

# 12. Current Implementation Status

| Feature | Status |
|-|-|
| gRPC dependency setup | Completed |
| gRPC configuration layer | Completed |
| Service URL management | Completed |
| Keepalive configuration | Completed |
| gRPC client structure | Completed |
| Generated SDK integration | Pending |
| Proto service bindings | Pending |
| REST to gRPC mapping | Pending |

---

# 13. Future Improvements

## Generated Client Integration

Replace temporary clients with generated SDK clients.

Example:

```typescript
orderClient.createOrder()
```

## gRPC Error Handling

Convert gRPC errors into REST responses.

Example:

```text
gRPC NOT_FOUND
        |
HTTP 404
```

## Secure gRPC Communication

Production improvements:

- TLS encryption
- Service authentication
- Certificate management

---

# Summary

The GridX API Gateway now contains the foundation required for gRPC-based microservice communication.

Implemented:

- gRPC client configuration
- Service endpoint management
- SDK preparation
- Protobuf integration workflow

Pending:

- Final protobuf contracts
- Generated SDK installation
- Actual service RPC implementation
