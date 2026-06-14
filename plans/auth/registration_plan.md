## Register Plan

Contains flow of user registration and how iot smart meter can be registered and verified. The idea is taken from [auth.md](../../knowledge_pot/auth.md)

This is just a current idea. There can be changes later

Main flow:

1. User enters the registration flow and registers via usual account (sso or email + password)
1. We **may** have to provide KYC (know your customer) form
1. We need to create a mock system that replicates DEWA (in a much small scale). Our system asks the user to enter the smart meter key. The user enters the key.
1. The system sends a request to DEWA mock view. The user can approve the request there and this allows our system to verify and register the simulated smart meter.
1. The DEWA Mock system generates an asymmetric RSA key pair.
    * It writes the Private Key to a secure config file or database table that only the IoT Simulator can read. (It is much easier if both DEWA mock and Iot Simulator share the same database)
    * It writes the Public Key and verification status straight into the IoT Simulation & DEWA Service's shared database.
1. Immediately after saving the keys, the IoT Simulation Service broadcasts a registration event (Ex: `METER_VERIFIED`) containing the `meterId` and the `publicKey` to a MQTT broker. We can use Kafka Connect MQTT Source or open source plugins to push those messages to a dedicated Apache Kafka topic.
1. Data Pipeline IoT Ingestion Service consumes that event from the Kafka topic and immediately performs two tasks:
    * It writes a permanent copy of that publicKey into its own database table.
    * It simultaneously caches the key in redis
1. After that the simulator packages its telemetry metrics, generates a cryptographic signature using its private key, and publishes the whole bundle as a JSON string to a MQTT topic.
1. The Data Pipeline IoT Ingestion Service consumes the telemetry message from the Kafka stream. It pulls the matching public key straight from its fast local in-memory cache (or falls back to its own local database if the cache was wiped during a service restart) and executes the validation check.

Visual Diagram:

```
%%{init: {'theme': 'dark', 'themeVariables': { 'background': '#0d1117', 'primaryColor': '#1f6feb', 'mainBkg': '#161b22', 'nodeBorder': '#30363d' }}}%%
sequenceDiagram
    autonumber
    actor User
    participant WebApp as Web / Mobile Frontend
    participant DEWAMock as DEWA Mock View & Service
    participant IoTSim as IoT Simulator (Hardware Node)
    participant MQTT as MQTT Broker
    participant Kafka as Apache Kafka Stream
    participant Ingestion as IoT Ingestion Service & DB

    %% Phase 1 & 2: User Onboarding & Asset Claim
    rect rgb(33, 38, 45)
        note right of User: Phase 1 & 2: Account Onboarding & Asset Claim
        User->>WebApp: Register Account & Complete KYC
        User->>WebApp: Claim Asset (Enter Smart Meter ID & Key)
        WebApp->>DEWAMock: Send Link Request
        User->>DEWAMock: Manually Click "Approve Link"
    end

    %% Phase 3: Key Generation & Event Replication
    rect rgb(22, 27, 34)
        note right of DEWAMock: Phase 3: Key Provisioning & Replication
        DEWAMock->>DEWAMock: Generate RSA Key Pair
        DEWAMock->>IoTSim: Save Private Key (Shared DB/Config)
        DEWAMock->>DEWAMock: Save Public Key (Registry DB)
        DEWAMock->>MQTT: Broadcast METER_VERIFIED Event (MeterID + Public Key)
        MQTT->>Kafka: Pipeline Sync via Connect/Bridge
        Kafka->>Ingestion: Consume METER_VERIFIED Event
        Ingestion->>Ingestion: Save Public Key to Local DB & Redis Cache
    end

    %% Phase 4: Secure Data Streaming
    rect rgb(33, 38, 45)
        note right of IoTSim: Phase 4: Telemetry Data Pipeline
        loop Every 5 Seconds
            IoTSim->>IoTSim: Sign Data Payload using Private Key
            IoTSim->>MQTT: Publish Data + Signature Envelope
            MQTT->>Kafka: Pipeline Sync via Connect/Bridge
            Kafka->>Ingestion: Consume Telemetry Envelope
            Ingestion->>Ingestion: Fetch Public Key from Redis Cache (or fallback DB)
            Ingestion->>Ingestion: Execute crypto.verify() Math Check
            note over Ingestion: If True -> Clear & Route Data to Marketplace Engines
        end
    end
```