---
connie-title: Energy Assets Dashboard
---

## Overview

The **Energy Assets** page provides a centralized view of all energy-related devices connected to a prosumer's home.

Unlike a traditional smart meter dashboard that only displays electricity consumption, this dashboard visualizes all distributed energy resources (DERs) participating in the IoT simulation.

These include:

- Battery Storage
- Electric Vehicle (EV)
- Solar Inverter
- Smart Meter

The page updates in real time using MQTT telemetry published by the IoT simulator.

---

# Objectives

The Energy Assets dashboard allows users to:

- Monitor every energy device connected to a house.
- Observe battery and EV charging behaviour.
- View the contribution of solar generation.
- Track electricity imported from or exported to the grid.
- Verify simulator behaviour during testing.
- Monitor assets affected by backend dispatch commands.

---

# Dashboard Layout

```text
Energy Assets
│
├── Summary Cards
│
├── Battery Card
│
├── EV Card
│
├── Smart Meter Card
│
└── Solar Inverter Card
```

Each card represents one physical or simulated IoT device.

---

# Summary Section

Located at the top of the page.

This provides a quick overview of the current energy system.

Example

```text
4/4 Devices Online

Solar Output      6.8 kW

Battery SoC       82%

Grid Import       4.3 kW

Grid Export       7.2 kW
```

## Purpose

Instead of checking every individual asset, operators can instantly understand the overall status of the house.

### Metrics

| Metric | Description |
|---------|-------------|
| Devices Online | Number of connected IoT devices |
| Solar Output | Current solar generation |
| Battery SoC | Current battery charge percentage |
| Grid Import | Power currently imported from the grid |
| Grid Export | Power currently exported to the grid |

---

# Battery Card

The Battery card displays the current status of the simulated battery.

Example

```text
Battery #1

Status
Charging

State of Charge
82%

Capacity
13.5 kWh
```

## Information Displayed

| Field | Description |
|---------|-------------|
| Battery Name | Device identifier |
| Status | Charging, Discharging or Idle |
| State of Charge | Current battery percentage |
| Capacity | Total battery storage |
| Device ID | Unique simulator device ID |

---

## Future Metrics

Additional values can be displayed later.

- Charge Rate (kW)
- Discharge Rate (kW)
- Battery Health
- Cycle Count
- Estimated Remaining Time
- Temperature

---

# Electric Vehicle Card

Displays information about the EV connected to the house.

Example

```text
Tesla Model Y

Connected

State of Charge

65%

V2G Available

12 kWh
```

## Information Displayed

| Field | Description |
|---------|-------------|
| Vehicle Name | EV model |
| Connection Status | Connected / Disconnected |
| Battery Percentage | Current SoC |
| Vehicle-to-Grid Capacity | Available energy for grid support |
| Device ID | EV simulator ID |

---

## Future Metrics

The simulator can later expose:

- Charging Rate
- Remaining Charging Time
- Target SoC
- Departure Time
- Plug Status
- Battery Health

---