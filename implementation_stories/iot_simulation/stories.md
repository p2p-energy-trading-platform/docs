# IoT Simulation — User Stories

**Epic:** IoT Simulation
**Project:** PETPG
**Repository:** [`p2p-energy-trading-platform/iot-simulation`](https://github.com/p2p-energy-trading-platform/iot-simulation)

> This document breaks the IoT Simulation epic down into component-level user stories, grouped by functional area. Each story maps to a specific part of the `iot-simulation` repository structure and includes acceptance criteria for Jira ticket creation.

---

## 1. Weather Data Integration

### US-1.1 — Fetch live weather data from Open-Meteo
**As** the simulation engine, **I want** to fetch live weather data from Open-Meteo for each configured grid, **so that** solar generation reflects real-world conditions.

*Maps to: `src/weather/openMeteoClient.ts`*

**Acceptance Criteria:**
- One Open-Meteo API call is made per configured grid (not per house).
- Retrieved data includes at minimum: cloud cover, temperature, and solar irradiance (or equivalent fields needed for solar modeling).
- API failures (timeout, non-200 response) are caught and do not crash the service.
- Fetched data is cached/reused appropriately to avoid redundant calls within a single tick interval.

---

### US-1.2 — Clear-sky fallback model
**As** the simulation engine, **I want** to fall back to a clear-sky model when Open-Meteo is unavailable, **so that** the simulation keeps running without live weather data.

*Maps to: `src/weather/clearSkyFallback.ts`*

**Acceptance Criteria:**
- Fallback model calculates expected solar irradiance based on time of day, date, and location (no external API dependency).
- Fallback activates automatically when the live weather call fails or times out.
- A log/warning is emitted when the system switches to fallback mode.

---

### US-1.3 — Unified weather provider interface
**As** the simulation engine, **I want** a single weather provider interface that transparently switches between live and fallback data, **so that** downstream components don't need to know which source is active.

*Maps to: `src/weather/weatherProvider.ts`*

**Acceptance Criteria:**
- Downstream consumers (e.g. `SolarSimulator`) call one consistent method/interface regardless of data source.
- Switching between live and fallback is invisible to calling code (no conditional branching required outside the provider).
- Unit tests cover both the live-data path and the fallback path.

---

## 2. Grid & House Domain Modeling

### US-2.1 — Define grids and houses via config
**As** a system configurator, **I want** to define grids and houses via a `grids.yaml` config file, **so that** simulation scenarios can be set up without code changes.

*Maps to: `config/grids.yaml`, `src/config/loadConfig.ts`*

**Acceptance Criteria:**
- YAML config supports defining multiple grids, each with multiple houses.
- Each house entry supports configurable attributes (e.g. solar panel size, load archetype, flexible assets).
- Invalid or malformed config is detected at startup with a clear error message (fails fast, not silently).
- Config is validated against a defined schema/type (see US-4.2).

---

### US-2.2 — Per-house solar generation simulation
**As** the simulation engine, **I want** each house to model its own solar generation based on weather and panel specs, **so that** energy production varies realistically across houses.

*Maps to: `src/domain/SolarSimulator.ts`*

**Acceptance Criteria:**
- Solar output is calculated using the house's panel configuration (e.g. capacity, orientation) combined with current weather data.
- Output is zero or near-zero during nighttime hours.
- Output scales appropriately with cloud cover/irradiance changes.

---

### US-2.3 — Per-house load simulation
**As** the simulation engine, **I want** each house to model its own energy consumption using load archetypes and scale factors, **so that** demand patterns reflect different household types.

*Maps to: `src/domain/LoadSimulator.ts`*

**Acceptance Criteria:**
- At least 2–3 distinct load archetypes are supported (e.g. residential, small business).
- Each house's load can be scaled by a configurable factor without changing the base archetype.
- Generated load values follow a realistic daily pattern (e.g. peaks in morning/evening).

---

### US-2.4 — Flexible asset simulation (battery/EV)
**As** the simulation engine, **I want** to simulate flexible assets like batteries and EVs per house, **so that** more realistic prosumer behavior (storage/charging) is reflected in the data.

*Maps to: `src/domain/FlexibleAssetSimulator.ts`*

**Acceptance Criteria:**
- Houses can be optionally configured with a battery, an EV, both, or neither.
- Battery state of charge persists and updates correctly across simulation ticks.
- Charging/discharging behavior affects the house's net energy reading reported by the smart meter.

---

### US-2.5 — Combined smart meter reading
**As** the simulation engine, **I want** a SmartMeter component that combines solar, load, and flexible asset data into a single reading, **so that** each house produces one coherent telemetry payload.

*Maps to: `src/domain/SmartMeter.ts`*

**Acceptance Criteria:**
- A single reading per house combines solar generation, load consumption, and flexible asset net effect into one net energy value.
- Reading output conforms to the defined payload type (see US-4.2).
- Reading is deterministic given the same inputs (testable/reproducible).

---

## 3. Scheduling & Telemetry Publishing

### US-3.1 — Tick loop scheduler
**As** the simulation engine, **I want** a tick loop that decides when each meter publishes its reading, **so that** telemetry is generated at controlled, configurable intervals.

*Maps to: `src/scheduler/tickLoop.ts`*

**Acceptance Criteria:**
- Tick interval is configurable (not hardcoded).
- All configured houses are processed within each tick cycle.
- A slow/failed reading for one house does not block or delay processing of other houses.

---

### US-3.2 — MQTT topic structure & publishing
**As** a backend/platform consumer, **I want** smart meter readings published to MQTT topics structured as `gridx/{grid_id}/{house_id}/meter`, **so that** I can reliably subscribe to and route data per grid/house.

*Maps to: `src/mqtt/topics.ts`, `src/mqtt/mqttClient.ts`*

**Acceptance Criteria:**
- Topic naming strictly follows the `gridx/{grid_id}/{house_id}/meter` pattern for every published message.
- Payload published to each topic matches the defined smart meter reading schema.
- Topic names are generated programmatically (not manually duplicated per house) to avoid typos/inconsistency.

---

### US-3.3 — MQTT reconnection handling
**As** the simulation engine, **I want** the MQTT client to automatically reconnect on connection loss, **so that** telemetry publishing is resilient to network interruptions.

*Maps to: `src/mqtt/mqttClient.ts`*

**Acceptance Criteria:**
- Client automatically attempts reconnection after a dropped connection, using backoff (not an immediate tight retry loop).
- Messages generated during a disconnect are not silently lost without at least a log entry.
- Reconnection events are logged for observability.

---

## 4. Simulator State & Reliability

### US-4.1 — In-memory simulation state
**As** the simulation engine, **I want** to maintain in-memory simulation state across ticks, **so that** consecutive readings are consistent (e.g. battery charge carries over).

*Maps to: `src/store/simState.ts`*

**Acceptance Criteria:**
- State persists across tick cycles for the lifetime of the running process.
- State is scoped per house/grid (no cross-contamination between houses).
- State is initialized cleanly at startup, even with default/empty values.

---

### US-4.2 — Typed payload and config schemas
**As** a developer, **I want** strongly typed payload and config schemas, **so that** integration errors are caught at compile time rather than at runtime.

*Maps to: `src/types/payloads.ts`, `src/types/config.ts`*

**Acceptance Criteria:**
- All MQTT-published payloads conform to a shared TypeScript type/interface.
- All config file structures conform to a shared TypeScript type/interface.
- `npm run typecheck` passes with no type errors related to these schemas.

---

## 5. Developer Experience & Quality

### US-5.1 — Unit test coverage
**As** a developer, **I want** unit tests covering each domain and infrastructure component, **so that** simulation logic changes can be verified without manual testing.

**Acceptance Criteria:**
- Each file under `src/domain/` and `src/weather/` has at least one corresponding test file under `test/`.
- `npm run test` runs all tests successfully in CI.
- Critical logic (solar calculation, load scaling, battery state transitions) has explicit test cases for edge conditions (e.g. zero sunlight, full battery).

---

### US-5.2 — Lint and type-check enforcement
**As** a developer, **I want** lint and type-check scripts (`npm run validate`), **so that** code quality is enforced before merging.

**Acceptance Criteria:**
- `npm run lint` and `npm run typecheck` both run cleanly on the current `main` branch.
- `npm run validate` runs both checks in a single command.
- CI pipeline (`.github/workflows`) runs `validate` on pull requests.

---

### US-5.3 — Documented local setup
**As** a developer, **I want** a documented setup process (env config, dev/build/start commands), **so that** any team member can run the simulator locally without guidance.

**Acceptance Criteria:**
- README includes working install, configure (`.env`), dev, test, build, and start instructions.
- A new team member can go from clone to running instance using only the README.
- `.env.example` includes all required environment variables with sensible defaults.

---

## Summary Table

| ID | Story | Component |
|------|--------|-----------|
| US-1.1 | Fetch live weather data | `weather/openMeteoClient.ts` |
| US-1.2 | Clear-sky fallback model | `weather/clearSkyFallback.ts` |
| US-1.3 | Unified weather provider | `weather/weatherProvider.ts` |
| US-2.1 | Grid/house config | `config/grids.yaml`, `config/loadConfig.ts` |
| US-2.2 | Solar simulation | `domain/SolarSimulator.ts` |
| US-2.3 | Load simulation | `domain/LoadSimulator.ts` |
| US-2.4 | Flexible asset simulation | `domain/FlexibleAssetSimulator.ts` |
| US-2.5 | Smart meter reading | `domain/SmartMeter.ts` |
| US-3.1 | Tick loop scheduler | `scheduler/tickLoop.ts` |
| US-3.2 | MQTT topic publishing | `mqtt/topics.ts`, `mqtt/mqttClient.ts` |
| US-3.3 | MQTT reconnection | `mqtt/mqttClient.ts` |
| US-4.1 | In-memory state | `store/simState.ts` |
| US-4.2 | Typed schemas | `types/payloads.ts`, `types/config.ts` |
| US-5.1 | Unit test coverage | `test/` |
| US-5.2 | Lint/type-check | CI / scripts |
| US-5.3 | Documented setup | `README.md` |

---