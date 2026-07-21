---
connie-title: IoT Simulation - User Stories
---

# IoT Simulation - User Stories

* **Epic:** IoT Simulation
* **Repository:** [p2p-energy-trading-platform/iot-simulation](https://github.com/p2p-energy-trading-platform/iot-simulation)

> This document breaks the IoT Simulation epic down into component-level user stories, grouped by functional area. Each story maps to a specific part of the `iot-simulation` repository structure and includes acceptance criteria for Jira ticket creation.

---

## 1. Grid & House Domain Modeling

### US-1.1 - Define grids and houses via config
>
> **As** a system configurator, <br>
> **I want** to define grids and houses via a `grids.yaml` config file, <br>
> **so that** simulation scenarios can be set up without code changes.

*Maps to: `config/grids.yaml`, `src/config/loadConfig.ts`*

**Acceptance Criteria:**

- YAML config supports defining multiple grids, each with multiple houses.
- Each house entry supports configurable attributes (e.g. solar panel size, load archetype, flexible assets).
- Invalid or malformed config is detected at startup with a clear error message (fails fast, not silently).
- Config is validated against a defined schema/type (see US-4.2).

---

### US-1.2 - Per-house solar generation simulation
>
> **As** the simulation engine, <br>
> **I want** each house to model its own solar generation based on weather and panel specs, <br>
> **so that** energy production varies realistically across houses.

*Maps to: `src/domain/SolarSimulator.ts`*

**Acceptance Criteria:**

- Solar output is calculated using the house's panel configuration (e.g. capacity, orientation) combined with current weather data.
- Output is zero or near-zero during nighttime hours.
- Output scales appropriately with cloud cover/irradiance changes.

---

### US-1.3 - Per-house load simulation
>
> **As** the simulation engine, <br>
> **I want** each house to model its own energy consumption using load archetypes and scale factors, <br>
> **so that** demand patterns reflect different household types.

*Maps to: `src/domain/LoadSimulator.ts`*

**Acceptance Criteria:**

- At least 2–3 distinct load archetypes are supported (e.g. residential, small business).
- Each house's load can be scaled by a configurable factor without changing the base archetype.
- Generated load values follow a realistic daily pattern (e.g. peaks in morning/evening).

---

### US-1.4 - Flexible asset simulation (battery/EV)
>
> **As** the simulation engine, <br>
> **I want** to simulate flexible assets like batteries and EVs per house, <br>
> **so that** more realistic prosumer behavior (storage/charging) is reflected in the data.

*Maps to: `src/domain/FlexibleAssetSimulator.ts`*

**Acceptance Criteria:**

- Houses can be optionally configured with a battery, an EV, both, or neither.
- Battery state of charge persists and updates correctly across simulation ticks.
- Charging/discharging behavior affects the house's net energy reading reported by the smart meter.

---

### US-1.5 - Combined smart meter reading
>
> **As** the simulation engine, <br>
> **I want** a SmartMeter component that combines solar, load, and flexible asset data into a single reading, <br>
> **so that** each house produces one coherent telemetry payload.

*Maps to: `src/domain/SmartMeter.ts`*

**Acceptance Criteria:**

- A single reading per house combines solar generation, load consumption, and flexible asset net effect into one net energy value.
- Reading output conforms to the defined payload type (see US-4.2).
- Reading is deterministic given the same inputs (testable/reproducible).

---

### US-1.6 - House generation from config ratios
>
>**As** the simulation engine, <br>
>**I want** actual house objects to be generated from the ratios and counts defined in the grid config, <br>
>**so that** the simulator has a concrete set of houses to run against without requiring each house to be manually specified.

*Maps to: `src/domain/HouseFactory.ts`*

**Acceptance Criteria:**

- The correct total number of houses is generated per grid, matching the count defined in config.
- Each house is assigned a device_class (consumer, residential_prosumer, or commercial) according to prosumer_ratio and commercial_count values in the config.
- Each house is assigned a load_archetype, load_scale_factor, rated_solar_kw, and panel_efficiency_factor appropriate to its device class - commercial houses receive commercial-sized values, not residential-sized ones.

---

## 2. Weather Data Integration

### US-2.1 - Fetch live weather data from Open-Meteo
>
> **As** the simulation engine, <br>
> **I want** to fetch live weather data from Open-Meteo for each configured grid, <br>
> **So that** solar generation reflects real-world conditions.

*Maps to: `src/weather/openMeteoClient.ts`*

**Acceptance Criteria:**

- One Open-Meteo API call is made per configured grid (not per house).
- Retrieved data includes at minimum: cloud cover, temperature, and solar irradiance (or equivalent fields needed for solar modeling).
- API failures (timeout, non-200 response) are caught and do not crash the service.
- Fetched data is cached/reused appropriately to avoid redundant calls within a single tick interval.

---

### US-2.2 - Clear-sky fallback model
>
> **As** the simulation engine,<br>
> **I want** to fall back to a clear-sky model when Open-Meteo is unavailable,<br>
> **so that** the simulation keeps running without live weather data.

*Maps to: `src/weather/clearSkyFallback.ts`*

**Acceptance Criteria:**

- Fallback model calculates expected solar irradiance based on time of day, date, and location (no external API dependency).
- Fallback activates automatically when the live weather call fails or times out.
- A log/warning is emitted when the system switches to fallback mode.

---

### US-2.3 - Unified weather provider interface
>
> **As** the simulation engine, <br>
> **I want** a single weather provider interface that transparently switches between live and fallback data, <br>
> **so that** downstream components don't need to know which source is active.

*Maps to: `src/weather/weatherProvider.ts`*

**Acceptance Criteria:**

- Downstream consumers (e.g. `SolarSimulator`) call one consistent method/interface regardless of data source.
- Switching between live and fallback is invisible to calling code (no conditional branching required outside the provider).
- Unit tests cover both the live-data path and the fallback path.

---

## 3. Scheduling & Telemetry Publishing

### US-3.1 - Tick loop scheduler
>
> **As** the simulation engine, <br>
> **I want** a tick loop that decides when each meter publishes its reading, <br>
> **so that** telemetry is generated at controlled, configurable intervals.

*Maps to: `src/scheduler/tickLoop.ts`*

**Acceptance Criteria:**

- Tick interval is configurable (not hardcoded).
- All configured houses are processed within each tick cycle.
- A slow/failed reading for one house does not block or delay processing of other houses.

---

### US-3.2 - MQTT topic structure & publishing
>
> **As** a backend/platform consumer, <br>
> **I want** smart meter readings published to MQTT topics structured as `gridx/{grid_id}/{house_id}/meter`, <br>
> **so that** I can reliably subscribe to and route data per grid/house.

*Maps to: `src/mqtt/topics.ts`, `src/mqtt/mqttClient.ts`*

**Acceptance Criteria:**

- Topic naming strictly follows the `gridx/{grid_id}/{house_id}/meter` pattern for every published message.
- Payload published to each topic matches the defined smart meter reading schema.
- Topic names are generated programmatically (not manually duplicated per house) to avoid typos/inconsistency.

---

### US-3.3 - MQTT reconnection handling
>
> **As** the simulation engine, <br>
> **I want** the MQTT client to automatically reconnect on connection loss, <br>
> **so that** telemetry publishing is resilient to network interruptions.

*Maps to: `src/mqtt/mqttClient.ts`*

**Acceptance Criteria:**

- Client automatically attempts reconnection after a dropped connection, using backoff (not an immediate tight retry loop).
- Messages generated during a disconnect are not silently lost without at least a log entry.
- Reconnection events are logged for observability.

---

### US-3.4 - Receive and apply MQTT actuation commands
>
>**As** the simulation engine, <br>
>**I want** to receive actuation commands over MQTT and apply them to the relevant house's flexible asset state, <br>
>**so that** the Matching Engine can instruct batteries and EVs to charge or discharge, and those changes are reflected in subsequent meter readings.

*Maps to: `src/mqtt/mqttClient.ts (extend)`, `src/store/simState.ts (extend)`*

**Acceptance Criteria:**

- The MQTT client subscribes to the actuation command topic on startup.
- An incoming command correctly identifies the target house and asset by ID and applies the specified charge or discharge instruction to that asset's state in SimState.
- The updated state of charge is reflected in the very next tick's smart meter reading for that house.

---

## 4. Simulator State & Reliability

### US-4.1 - In-memory simulation state
>
> **As** the simulation engine, <br>
> **I want** to maintain in-memory simulation state across ticks, <br>
> **so that** consecutive readings are consistent (e.g. battery charge carries over).

*Maps to: `src/store/simState.ts`*

**Acceptance Criteria:**

- State persists across tick cycles for the lifetime of the running process.
- State is scoped per house/grid (no cross-contamination between houses).
- State is initialized cleanly at startup, even with default/empty values.

---

### US-4.2 - Typed payload and config schemas
>
> **As** a developer, <br>
> **I want** strongly typed payload and config schemas, <br>
> **so that** integration errors are caught at compile time rather than at runtime.

*Maps to: `src/types/payloads.ts`, `src/types/config.ts`*

**Acceptance Criteria:**

- All MQTT-published payloads conform to a shared TypeScript type/interface.
- All config file structures conform to a shared TypeScript type/interface.
- `npm run typecheck` passes with no type errors related to these schemas.

---

## 5. Developer Experience & Quality

### US-5.1 - Unit test coverage
>
> **As** a developer, <br>
> **I want** unit tests covering each domain and infrastructure component, <br>
> **so that** simulation logic changes can be verified without manual testing.

**Acceptance Criteria:**

- Each file under `src/domain/` and `src/weather/` has at least one corresponding test file under `test/`.
- `npm run test` runs all tests successfully in CI.
- Critical logic (solar calculation, load scaling, battery state transitions) has explicit test cases for edge conditions (e.g. zero sunlight, full battery).

---

### US-5.2 - Load and zone isolation testing
>
>**As** a platform engineer, <br>
>**I want** a load test script and a zone isolation test script for the IoT simulation layer, <br>
>**so that** I can verify the system handles at least 50 concurrent publishers across 3 grid zones without message loss or cross-grid data contamination.

*Maps to: `test/load/`, `test/isolation/`*

**Acceptance Criteria:**

- A k6 load test script starts 50 or more concurrent meter instances spread across at least 3 grid zones simultaneously.
- All the meters publish at the correct 5-second interval throughout the load test run without falling behind or dropping messages.
- A zone isolation test script subscribes to all topics and verifies that every published reading's grid_id matches the grid zone it was generated from - zero mismatches across a full test run.

---

## Summary Table

| ID | Story | Component |
|------|--------|-----------|
| US-1.1 | Grid/house config | `config/grids.yaml`, `config/loadConfig.ts` |
| US-1.2 | Solar simulation | `domain/SolarSimulator.ts` |
| US-1.3 | Load simulation | `domain/LoadSimulator.ts` |
| US-1.4 | Flexible asset simulation | `domain/FlexibleAssetSimulator.ts` |
| US-1.5 | Smart meter reading | `domain/SmartMeter.ts` |
| US-1.6 | House generation from config ratios | `src/domain/HouseFactory.ts` |
| US-2.1 | Fetch live weather data | `weather/openMeteoClient.ts` |
| US-2.2 | Clear-sky fallback model | `weather/clearSkyFallback.ts` |
| US-2.3 | Unified weather provider | `weather/weatherProvider.ts` |
| US-3.1 | Tick loop scheduler | `scheduler/tickLoop.ts` |
| US-3.2 | MQTT topic publishing | `mqtt/topics.ts`, `mqtt/mqttClient.ts` |
| US-3.3 | MQTT reconnection | `mqtt/mqttClient.ts` |
| US-3.4 | Receive and apply MQTT actuation commands | `src/mqtt/mqttClient.ts (extend)`, `src/store/simState.ts (extend)` |
| US-4.1 | In-memory state | `store/simState.ts` |
| US-4.2 | Typed schemas | `types/payloads.ts`, `types/config.ts` |
| US-5.1 | Unit test coverage | `test/` |
| US-5.2 | Load and zone isolation testing | `test/load/`, `test/isolation/` |

---
