---
connie-title: IoT ingestion and DEWA mock App Connection
---

# Iot Ingestion and Dewa Mock App

## Database changes

The database tables need to additionally store details related to users table. For now let's focus on one primary user and also have options for future secondary users (with limited access).

Example:

```sql
CREATE TABLE user_houses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    meter_id VARCHAR(50) NOT NULL REFERENCES meters(meter_id),
    registration_id VARCHAR(50) UNIQUE NOT NULL, -- Tracks the DEWA/Platform registration attempt
    role VARCHAR(30) NOT NULL DEFAULT 'PRIMARY_OWNER', -- 'PRIMARY_OWNER', 'VIEWER', 'OPERATOR'
    approval_status VARCHAR(30) NOT NULL, -- 'PENDING', 'DEWA_APPROVAL_PENDING', 'REJECTED', 'APPROVED', 'EXPIRED'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraint: Ensure a meter can only have ONE active PRIMARY_OWNER at a time
    CONSTRAINT unique_primary_owner_per_meter UNIQUE (meter_id, role) 
    -- (Note: If role is 'PRIMARY_OWNER', this prevents two users from claiming the same meter as primary)
);
```

We still have not added logic or plan related to multi user access for a single smart meter. But we will retain the above format in case we decide to add. By default the initial meter id registration with user account is for the `PRIMARY_OWNER`.

## How the IoT service registers and polls device status

- **Local State Management**: The IoT Ingestion and Dispatch Service rely on local database records (such as the user_houses table) to cache the registration state machine (PENDING -> DEWA_APPROVAL_PENDING -> APPROVED -> REGISTERED).
- **Polling Mechanism**: When awaiting verification, the backend service polls the DEWA mock endpoint (`GET /api/link-requests/:requestId`) or listens for status updates to transition the device state locally before telemetry begins routing into the P2P trading engine. Polling interval must be 3 - 5 seconds and maximum timeout per device registration is 10 minutes.

The following endpoints can be accessed by iot ingestion.

| Method | Endpoint | Description | Request / Response Payload Example |
| :--- | :--- | :--- | :--- |
| **POST** | `/api/link-requests` | Called by your platform when a user initiates a meter claim. | **Req:** `{"registrationId": "REG-123", "meterId": "METER-001", "userReference": "USER-123"}`<br>**Res:** `{"status": "PENDING", "message": "Link request created"}` |
| **GET** | `/api/link-requests/:requestId` | Called by your platform to poll or check the approval status. | **Res:** `{"registrationId": "REG-123", "meterId": "METER-001", "status": "APPROVED"}` |

### 1. How the IoT Service Sends the Request

When a user initiates a meter claim through the frontend, the  IoT Ingestion and Dispatch Service handles the outbound integration with the DEWA mock:

- Payload Generation: The service constructs a registration payload containing a unique registrationId, the target meterId, and the user's reference (userReference).

- HTTP Client Dispatch: Using a dedicated HTTP client transport layer, the service dispatches a `POST /api/link-requests` request to the external DEWA Mock application.

- State Persistence: Simultaneously, the service records the initial attempt in the database (Ex: inside the user_houses table) with an approval_status of `DEWA_APPROVAL_PENDING`.

### 2. How the Polling Logic Works

Because DEWA approval relies on a manual human action in an external portal, the IoT Ingestion and Dispatch Service service manages an asynchronous polling routine:

- Interval & Timeout Design: The service polls the DEWA mock endpoint (`GET /api/link-requests/:requestId`) at a fixed interval (e.g., every 3 to 5 seconds) over a capped duration (Ex: up to 3 minutes max).
- State Transition Handlers:
    - If DEWA returns `APPROVED`: The service updates the local database row to `REGISTERED` / `APPROVED`, unlocking the grid node for telemetry ingestion and P2P trading.
    - If DEWA returns `REJECTED`: The service updates the local state to `REJECTED` and terminates the loop.
    - If a timeout occurs: The service flags the registration attempt as failed or expired by marking local state as `EXPIRED`, allowing the user to retry.

### 3. Reverify smart meter logic

In case, the platform marks it as expired but the user updates it as successful in DEWA mock app, then the system has no way of checking or knowing about this (because the polling has timed out). In this case, it is better to have an reverify rpc that checks or triggers the polling again.

- Check if the request id exists, if it does not trigger the prcoess again by sending a new request.
- If the request id exists, then trigger the polling logic again


## Recommended Folder Structure Additions

To cleanly accommodate the registration workflow, client calls to DEWA, and polling logic within the existing Go microservice layout, we should introduce a new `registration`/ package inside `internal/`

```text
iot-ingestion/
├── internal/
│   ├── registration/                 # <-- NEW PACKAGE FOR REGISTRATION & DEWA INTEGRATION
│   │   ├── client.go                 # HTTP client wrapper for DEWA Mock API calls
│   │   ├── poller.go                 # Background polling loop with backoff/timeouts
│   │   └── service.go                # Orchestrates claim initiation & state machine transitions
│   ├── store/
│   │   └── postgres/
│   │       ├── pool.go
│   │       ├── user_houses_writer.go # <-- NEW: Manages user_houses (user-to-meter) mappings
│   │       ...
```


## gRPC methods

The IoT service needs to expose the following methods so other services can call and use them. The following methods are primarily related to iot smart meter registration in the system.


```proto
service DeviceRegistrationService {
  // Initiates a new link request with the platform and triggers DEWA mock integration
  rpc InitiateMeterClaim(ClaimMeterRequest) returns (ClaimMeterResponse);
  
  // Queries the current platform registration and state machine status for a meter
  rpc GetRegistrationStatus(GetStatusRequest) returns (GetStatusResponse);
  
  // Internal validation method used by the ingestion pipeline to verify active node ownership
  rpc ValidateDeviceAssociation(ValidateDeviceRequest) returns (ValidateDeviceResponse);

  // Reverification in case of any timeouts or isses
  rpc ReverifyRegistration(ReverifyRequest) returns (ReverifyResponse);
}

message ClaimMeterRequest {
  string user_reference = 1;
  string meter_id = 2;
}

message ClaimMeterResponse {
  string registration_id = 1;
  string status = 2;
}

message GetStatusRequest {
  string registration_id = 1;
}

message GetStatusResponse {
  string registration_id = 1;
  string meter_id = 2;
  string approval_status = 3;
}

message ValidateDeviceRequest {
  string meter_id = 1;
}

message ValidateDeviceResponse {
  bool is_registered = 2;
  string primary_user_id = 3;
}

message ReverifyRequest {
  string registration_id = 1;
  string user_reference = 2; // Optional: for audit or security validation
}

message ReverifyResponse {
  string registration_id = 1;
  string meter_id = 2;
  string previous_status = 3;
  string current_status = 4; // e.g., "APPROVED", "PENDING", "REJECTED", "EXPIRED"
  bool success = 5;
  string message = 6;
}
```

**NOTE**: In future more methods will be needed as we go on integrating the functionalities in the frontend inorder to show visual information or additional actions. For now the above are enough!



