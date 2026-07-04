---
connie-title: IoT Simulator - Plan
---

# IoT Simulator - Plan

* **Author:** Hanan (M.S.H. Ahmed)
* **Scope:** IoT Simulator module only - smart meters, houses, load, solar, weather
* **Stack:** Node.js + TypeScript, MQTT (Mosquitto)
* **Status:** Draft v1

---

## 1. What this simulator does

The IoT simulator pretends to be the real world. It pretends to be houses with solar panels, and the smart meters attached to them. Its only job is this: **make up realistic energy numbers, and publish them over MQTT.**

That's it. It doesn't place orders. It doesn't know prices. It doesn't talk to the matching engine, the backend, Kafka, or any database that belongs to the trading system. It only knows about houses, weather, and electricity.

Why this rule matters: one day we might replace this simulator with real smart meters (real hardware, like an ESP32 chip). If that happens, nothing else in the system should need to change. A real meter can't call our matching engine - it just reports numbers. So our simulator has to behave the same way, even though it's fake.

Keep this one sentence in mind for the rest of the document: **the simulator only reports what's happening in its pretend physical world. It never reaches into the trading system.**

---

## 2. What data it sends

Every meter sends one JSON message per tick (a "tick" being one reading, e.g. every 5 seconds). There are three kinds of meters, based on what kind of house they're attached to:

- **`consumer`** - a normal house with no solar panels. Only uses electricity.
- **`residential_prosumer`** - a house with solar panels. Can produce and use electricity.
- **`commercial`** - a bigger generator, like a small solar farm or a factory rooftop. Same idea as a prosumer, just much bigger.

### 2.1 The meter reading

This is the main message. It gets sent constantly, every tick.

```json
{
  "schema_version": "1.0",
  "meter_id": "meter-grid01-house0042",
  "house_id": "house0042",
  "grid_id": "grid01",
  "device_class": "residential_prosumer",
  "timestamp": "2026-06-16T09:30:05Z",
  "seq": 184231,
  "readings": {
    "solar_kw": 2.41,
    "consumption_kw": 0.87,
    "net_kw": 1.54,
    "storage_assets": [
      {
        "asset_id": "bat_001",
        "asset_type": "bess",
        "soc_pct": 63.5,
        "power_kw": -0.30,
        "capacity_kwh": 10.0
      },
      {
        "asset_id": "ev_001",
        "asset_type": "ev",
        "soc_pct": 41.0,
        "power_kw": -1.5,
        "capacity_kwh": 40.0,
        "plugged_in": true
      }
    ]
  },
  "meta": {
    "weather_irradiance_wm2": 612.0,
    "cloud_cover_pct": 18
  }
}
```

A few things to know about this:

- **`net_kw`** is just `solar_kw - consumption_kw` (plus a bit from the battery, if there is one). A positive number means the house has surplus power to sell. A negative number means it needs to buy. This is exactly what a real smart meter would calculate too.
- If a house has **no battery** or other storage mediums then the **`storage_assets`** field will be empty.
- The **`meta`** block is just extra debug info - it lets us double check that solar output makes sense given the weather, without having to call the weather API again ourselves. Nothing downstream should depend on this block existing.
- **`schema_version`** exists so that if we change this format later, nothing breaks silently.

### 2.2 The heartbeat

Every so often (say, once a minute), each meter also sends a much smaller message that just says "I exist, and here's what I am":

```json
{
  "schema_version": "1.0",
  "grid_id": "grid01",
  "house_id": "house0042",
  "meter_id": "meter-grid01-house0042",
  "status": "online",
  "device_class": "residential_prosumer",
  "rated_solar_kw": 5.0,
  "flexible_assets": [
    {
      "asset_id": "bat_001",
      "asset_type": "bess",
      "capacity_kwh": 10.0,
      "max_charge_kw": 3.5,
      "max_discharge_kw": 3.5
    },
    {
      "asset_id": "ev_001",
      "asset_type": "ev",
      "capacity_kwh": 40.0,
      "max_charge_kw": 7.2,
      "max_discharge_kw": 3.6,
      "v2g_capable": true
    }
  ]
}
```

**NOTE**: There is a different flow to register smart meters themselves as mentioned in [registration plan](../auth/registration_plan.md). In here we also include private/public key to validate message payloads. We have to add this to above schema eventually!

**NOTE**: We must also make this as a way to register new storage mediums to our system.

The point of this message is so that anyone listening can figure out what houses exist and what they're capable of, just by listening to MQTT - without the simulator ever needing to tell anyone directly.

---

## 3. Where the weather comes from

We use **Open-Meteo** (open-meteo.com). It's free, doesn't need an API key, and gives generous limits. This was already decided earlier and stays the same.

We call this endpoint: `GET https://api.open-meteo.com/v1/forecast`

The fields we actually care about:

- **`shortwave_radiation`** - how much sunlight is hitting the ground, in W/m². This is the main number we use.
- **`direct_radiation`** and **`diffuse_radiation`** - slightly more detailed sunlight numbers, useful later if we want to model panel angle more precisely.
- **`cloud_cover`** - percentage of sky covered in cloud.
- **`temperature_2m`** - air temperature, which slightly affects how efficient solar panels are.

One thing to be careful of: these are **hourly averages looking backward**, not instant readings. So the number for 9am is the average over the hour before 9am, not the exact value at 9am. We shouldn't treat it as instantaneous.

Here's how we actually use it:

1. Every **grid** (zone) gets a fixed location - a latitude and longitude.
2. One small background process per grid (not per house!) checks Open-Meteo every 15–30 minutes. We don't need to check more often than that, because the underlying weather forecast itself doesn't change minute to minute - only our own simulated noise does.
3. Each house then works out its own solar output like this:

   `solar_kw = rated_solar_kw × (irradiance / 1000) × panel_efficiency_factor`

   ...with a small bit of random noise added on top, so two houses under the same sky don't produce identical numbers.
4. If Open-Meteo is down or unreachable, we fall back to a simple **clear-sky model** - basically a sine-wave shape based on time of day, so the simulation keeps running instead of breaking.

---

## 4. Building the world - grids, houses, and meters

### 4.1 Why we use more than one grid

A grid is a zone - a small group of houses that trade locally with each other. If we only had one giant pool of houses, the whole "trade with people near you" idea (which is central to the project) wouldn't really show up anywhere. Multiple grids are also cheap to set up now, and painful to add later, so we build this in from day one.

### 4.2 How a grid is structured

```
Grid (e.g. "grid01")
 └── Houses (a mix of consumers, prosumers, and commercial generators)
      └── Every house has: 1 Smart Meter, 1 Load simulator
      └── Prosumer / Commercial houses also have: 1 Solar simulator
      └── Some of those also have: 1 Battery simulator (optional)
```

So a basic consumer house is just 2 things: a Load simulator and a Smart Meter. A prosumer house with a battery is up to 4 things: Solar, Load, Battery, and the Smart Meter that ties them together. Weather is shared across the whole grid, not duplicated per house.

### 4.3 Houses aren't all the same size

We don't just simulate households. A grid can also have a **commercial** generator - something like a small solar farm or a co-op installation that sells a lot more power than any single house. This matters because it makes the order book more interesting: instead of only lots of tiny sell orders, we also get the occasional big one.

The nice part is that a commercial entity isn't a special case in code - it's the exact same Smart Meter, Solar, Load, and Battery classes as a normal house. Only the numbers are bigger:

| Type | What it is | Typical solar size | Load pattern |
|---|---|---|---|
| `consumer` | Normal house, no solar | - | Household pattern |
| `residential_prosumer` | House with solar panels | 2–8 kW | Household pattern |
| `commercial` | Small farm / factory rooftop / co-op | 50–300 kW | Office pattern - quiet at night, busy 9–5 |

### 4.4 Everything is set by config, not hardcoded

We define grids, how many houses they have, and what mix of house types they have, in a config file - not in code. So adding a new grid or changing how many houses exist is a one-line change, not a code change.

```yaml
grids:
  - grid_id: grid01
    location: { lat: 6.9271, lon: 79.8612 }   # Colombo, as a placeholder
    houses: 50
    prosumer_ratio: 0.4
    battery_ratio: 0.5       # of the prosumers, how many also have a battery
    commercial_count: 2      # separate from the ratio above
  - grid_id: grid02
    location: { lat: 9.6615, lon: 80.0255 }   # Jaffna, as a placeholder
    houses: 30
    prosumer_ratio: 0.3
```

This also means scaling up later (more grids, more houses, even modelling something like a UAE-style setup with many zones) is just a config change, since each `grid_id` already behaves like its own independent zone.

### 4.5 Making houses use different amounts of electricity

If every house followed the exact same usage pattern, the data would look obviously fake. Real households use electricity differently depending on who lives there and what their day looks like - quiet at night, busy in the morning, dips during the day if everyone's out, then a peak in the evening.

We build this with three simple layers stacked together:

`consumption_kw = archetype_curve(hour_of_day) × house_scale_factor × (1 + noise)`

- **The archetype** is just "what shape does this house's day follow." We pick from a small fixed list: `apartment_single` (quiet, small peaks), `family_both_work` (quiet all day, sharp evening peak), `family_home_daytime` (steady use all day with small bumps), `large_house` (higher usage throughout), and `commercial_daytime` (quiet at night, busy during work hours - used for commercial entities).
- **The scale factor** is just "how big is this household's usage overall" - a number we pick once when the house is created (smaller houses get a smaller number, bigger ones get a bigger number) and then never change again.
- **The noise** is small random jitter added every tick, so the numbers aren't perfectly smooth - just like appliances switching on and off in real life.

Each house picks one archetype and one scale factor when it's created, and keeps them for as long as the simulator runs:

```yaml
house_id: house0042
device_class: residential_prosumer
load_archetype: family_both_work
load_scale_factor: 1.34
```

Whether archetypes get assigned completely at random, or deliberately balanced (e.g. "make sure 50% of this grid is `family_both_work`"), is still open.

### 4.6 Making solar output different between houses

All houses in the same grid share one weather reading - we don't call the weather API separately for every single house. So if every house has the same sun, why would two houses produce different amounts of solar power? Because the houses themselves are different, not the weather:

`solar_kw = shared_grid_irradiance × (rated_solar_kw / 1000) × panel_efficiency_factor × (1 + house_noise)`

- **Shared grid irradiance** is same for every house in this grid, right now.
- **Rated solar size** is how big this house's panels are - bigger houses or commercial entities simply have a bigger number here.
- **Panel efficiency** represents things like panel angle, shading, or how well-maintained the panels are. We pick this once per house when it's created.
- **House noise** is small random jitter, representing things a single shared weather number can't capture - like a cloud shadow that happens to pass over one roof but not the one next door.

So a house's stored details end up looking like this:

```yaml
house_id: house0042
device_class: residential_prosumer
rated_solar_kw: 5.0
panel_efficiency_factor: 0.88
```

### 4.7 Houses keep the same ID forever

A house's ID (like `house0042`) and its meter's ID are fixed when the house is first created, and they don't change if we restart the simulator. This matters a lot since the rest of the system needs to recognize the same house every time, not think a new one appeared after every restart.

---

## 5. Indirect Reactivity between IoT simulation and GridX system

**NOTE**: Only for houses with energy storage mediums

### 5.1 Architectural Principle of Indirect Reactivity

The GridX platform operates on a strict separation of concerns between the financial ledger and the physical microgrid state. The core backend never directly mutates the state or the database of the physical simulator. Instead, it relies on a decoupled, closed-loop asynchronous mechanism termed **Indirect Reactivity**.

The physical assets report their instantaneous state metrics upwards to the system. When a condition requires a physical shift in power behavior, the system dispatches an outbound actuation command downstream. The simulator receives this command, modifies its internal hardware calculations, and the resulting change is naturally observed in the subsequent data cycle. This design perfectly preserves subsystem isolation and mirrors real-world cloud-to-hardware smart grid infrastructure.

### 5.2 Supported Energy Storage Mediums (Flexible Assets)

Because weather patterns (solar generation) and baseload human consumption are highly inflexible variables, the system relies entirely on flexible energy storage mediums to execute reactive commands. The system dynamically discovers and supports two major categories of storage assets:

* Stationary Battery Energy Storage Systems (BESS): Residential or commercial home batteries (Ex: lithium-ion setups) that can absorb localized surplus power during generation peaks or discharge energy to offset deficits.

* Mobile Electric Vehicle (EV) Storage: Electric vehicle batteries integrated through smart chargers utilizing Vehicle-to-Grid (V2G) capabilities. These act as deferrable loads that can dynamically alter or pause their charging rates based on external command payloads.

**NOTE**: The above needs to be properly modelled in the above schemas!

### 5.3 Dispatch service & Actuation Execution via MQTT Commands

**NOTE**: VERY IMPORTANT: Dispatch service is not part of the simulation! It is a separate service that runs along the data pipelines inside IoT ingestion service.

Refer to the `Dspatch Service` topic in the following [document]('../data_pipelines/iot_ingestion.md')

### 5.4 Simulator State Processing

1. Payload Ingestion: The IoT simulator catches the inbound JSON packet over the dedicated actuation topic.

1. State Transition: The simulator processes the values within its local execution context (simState.ts), modifying the internal State of Charge (SoC) parameters of the battery matrix.

1. Meter Convergence: On the very next 5-second tick loop, the calculated net metrics (net_kw) naturally converge with the newly applied physical behavior, closing the loop.

```
net_kw = solar_kw - consumption_kw - sum(asset.power_kw for asset in storage_assets where power_kw < 0)
+ sum(asset.power_kw for asset in storage_assets where power_kw > 0)
```

---

## 6. Two separate memories, not one shared one

This came from an important note: the simulator and the real backend system must each keep their **own separate record** of houses and grids. They should describe the same things, using the same shape, but they must never read from the same source.

- **The simulator's own memory** - just something simple it keeps for itself (an in-memory map, or a small local file/database) holding all the houses, grids, and their live state (like current battery charge). This is the simulator's private picture of its own pretend world.
- **The backend's own memory** - its own database, built up by listening to MQTT/Kafka traffic over time. It learns that a house exists because it sees that house's heartbeat or readings arrive - not by peeking into the simulator's files or memory directly.
- Both sides should agree on what a "house" or "grid" *looks like* (same fields, same IDs), so they're clearly talking about the same things - but each side fills in that picture independently, from its own observations. This mirrors real life: a power company's customer records and a meter's own internal memory both "know" the meter exists, but neither one reads the other's database.
- **The only way the simulator talks to anything else is through the MQTT broker.** No shared files, no shared database connection, no direct callback from the simulator into the backend. This single rule is what keeps the whole design honest.

A nice side effect: if a house ID ever shows up on one side but never on the other, that's a real bug signal - just like a mismatch in a real meter inventory would be.

---

## 7. Where we're simplifying compared to the real world

| In real life | What we do instead | Why |
|---|---|---|
| Real solar panel + inverter, real sunlight | Open-Meteo sunlight × panel size × efficiency | We skip panel aging, exact shading, and fine temperature effects |
| Real meters often sample every few seconds but only send data every 5–15 minutes to save bandwidth | We send every tick immediately (every 5 seconds) | We don't need to save bandwidth, since MQTT is cheap for us |
| Real household usage shaped by actual appliances, people coming and going | A daily pattern + random noise, picked per house | Good enough realism without modelling individual appliances |
| Real batteries have chemistry, losses, and degrade over time | Simple charge tracking with one fixed efficiency number | Battery chemistry isn't needed for what we're demonstrating |
| Real meters report through things like cellular networks or Zigbee | We use MQTT | It's the right level of detail, and real hardware can also speak MQTT later if we switch |
| Real weather changes smoothly across a whole area | One shared reading per grid, refreshed periodically | Close enough; we fake the small moment-to-moment changes with noise |

The general idea: where it's cheap to do the real thing properly (weather-driven solar, MQTT, calculating net power correctly), we do it properly. Where the real thing needs hardware-level detail we don't actually need for this project (battery chemistry, individual appliances), we simplify - but in a way that could be made more detailed later without a rewrite.

---

## 8. How the project is organised in code

**Language:** TypeScript.

```
iot-simulator/
├── package.json
├── tsconfig.json
├── .eslintrc.json
├── config/
│   └── grids.yaml                  # all grid/house settings
├── src/
│   ├── index.ts                    # starts everything up
│   ├── config/
│   │   └── loadConfig.ts
│   ├── weather/
│   │   ├── openMeteoClient.ts       # calls Open-Meteo, one call per grid
│   │   ├── clearSkyFallback.ts      # backup model if Open-Meteo is down
│   │   └── weatherProvider.ts       # picks live data or fallback
│   ├── domain/
│   │   ├── Grid.ts
│   │   ├── House.ts
│   │   ├── SolarSimulator.ts
│   │   ├── LoadSimulator.ts          # archetype + scale factor logic
│   │   ├── FlexibleAssetSimulator.ts  # Holds asset details (batter, ev)
│   │   └── SmartMeter.ts            # combines everything into one reading
│   ├── mqtt/
│   │   ├── mqttClient.ts            # connecting, reconnecting
│   │   └── topics.ts                # topic naming, e.g. gridx/{grid_id}/{house_id}/meter
│   ├── scheduler/
│   │   └── tickLoop.ts              # decides when each meter publishes
│   ├── store/
│   │   └── simState.ts              # the simulator's own memory
│   └── types/
│       ├── payloads.ts              # the exact shapes
│       └── config.ts                # the exact shapes
├── test/
│   └── ...                         # tests for each piece above
└── README.md
```

---

## 9. What we need to prove - evaluation targets

This section lists only the targets that the IoT simulator is directly responsible for. These come from the project's evaluation plan which covers the whole system. The targets below are the slice that belongs to this module.

### 9.1 What the evaluators will ask about the simulator

The evaluation panel will check whether the data pipeline can handle real load. The IoT simulator is the thing generating that load - it's the source of all the meter events that flow into the rest of the system. So the simulator needs to produce enough realistic and well-structured data to let the pipeline prove itself.

On top of that, the simulator has its own separate pass, merit, and distinction targets for multi-grid behaviour, explained in section 9.3.

### 9.2 The specific numbers we need to hit

| What is being measured | Target | Notes |
|---|---|---|
| Publish frequency | Every 5 seconds per meter, configurable | This is the tick rate agreed in section 4.4 |
| Minimum concurrent meters | At least 50 MQTT publishers running at the same time | Spread across at least 3 separate grid zones |
| Minimum grid zones | At least 3, each with its own independent solar curve | Each zone must behave differently and not just be copies of each other |
| Solar curve realism | The solar output must visibly peak at midday and drop at dusk | This should be visible on the price chart downstream |
| MQTT delivery guarantee | Zero missed messages with QoS 1 at-least-once delivery confirmed | QoS 1 means the broker confirms every message was received |
| Zone isolation | A message from Zone A must never appear in Zone B | The simulator enforces this by keeping grids strictly separate |
| Price coupling | A supply drop must produce a visible price rise within 10 seconds on the chart | The simulator causes this indirectly through the weather signal - see section 5 |

### 9.3 Pass, merit, and distinction levels

These are the three grading levels defined for the IoT multi-grid module.

**Pass** - at least one zone is working and publishing real meter readings.

**Merit** - all three zones are running and behaving independently from each other with different solar curves and different load patterns.

**Distinction** - the price in the different zones visibly diverges on the chart because each zone has genuinely different supply conditions at the same moment.

The distinction target is the most important one to understand. It's not just about having three grids running. It's about demonstrating that different weather (because each grid has a different location in the config) produces different supply, which produces different prices in each zone. This is the whole point of running multiple grids instead of one, and it only works if the indirect reactivity approach from section 5 is implemented correctly.

### 9.4 How we test these targets

**Unit tests** cover the solar curve shape (does it peak at midday, does it drop at dusk), the load archetype curves (do they follow the right daily shape), and the net power calculation (`net_kw = solar_kw - consumption_kw` must always be correct).

**Integration tests** check that a reading published by the simulator over MQTT actually arrives at the broker without being dropped. These run with QoS 1 enabled and confirm every message is acknowledged.

**Load test** starts at least 50 meter instances across 3 grids simultaneously and checks that all of them keep publishing at the correct 5-second interval without falling behind or dropping messages.

**Realism check** runs the simulator for at least one simulated day and inspects the solar curve shape - the output must be clearly higher at midday than at dawn or dusk. This can be done by plotting the data in Grafana or a simple script.

**Zone isolation check** confirms that each grid's readings carry the correct `grid_id` and that no reading from grid01 has a `grid_id` of grid02 or vice versa.

The load testing tool is k6. Unit and integration tests use Jest with ts-jest. The realism and isolation checks can be done with a Grafana dashboard or a short test script.

---

## 10. Things we still need to decide as a team

- Exact tick speed for each meter type - we're assuming 5 seconds for the main reading, but should solar/load update faster internally even if the meter only reports every 5 seconds?
- How many grids and houses to actually run by default for the demo (this is just a config value, not a code decision).
- Should house archetypes be assigned completely randomly, or should we guarantee a specific mix per grid?
- Should `commercial_count` be a fixed number per grid, or a ratio like `prosumer_ratio`?
- Should the `meta` block in weather info be removed before we consider this "final," since a real meter wouldn't actually know the weather - only its own output?
- We need to agree on the exact MQTT topic names with whoever builds the Kafka bridge, so both sides agree independently rather than guessing each other's format.