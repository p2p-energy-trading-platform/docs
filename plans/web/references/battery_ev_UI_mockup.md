# Energy Assets Dashboard

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

```
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

```
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

```
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

```
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

The simulator can later expose

- Charging Rate
- Remaining Charging Time
- Target SoC
- Departure Time
- Plug Status
- Battery Health

---

# Smart Meter Card

The Smart Meter represents the final net energy reading reported to the backend.

Unlike the battery or inverter, the Smart Meter combines all household energy flows.

Example

```
Import

4.3 kW

Export

7.2 kW
```

## Purpose

The Smart Meter aggregates:

```
House Consumption

+

Solar Generation

+

Battery Charging

+

Battery Discharging

+

EV Charging

=

Net Meter Reading
```

This is the value published to the backend over MQTT.

---

# Solar Inverter Card

Displays the current solar generation.

Example

```
Output

6.8 kW
```

## Information Displayed

| Field | Description |
|---------|-------------|
| Output | Current solar generation |
| Status | Online / Offline |
| Device ID | Inverter identifier |

---

## Future Metrics

Possible additions

- Daily Energy Generated
- Monthly Generation
- Inverter Temperature
- Efficiency
- Peak Power
- Lifetime Production

---

# Refresh Button

The Refresh button reloads the latest telemetry from the simulator.

Although telemetry updates automatically through MQTT, manual refresh is useful during debugging or reconnecting.

---

# Add Asset Button

Reserved for future implementation.

Possible uses

- Add Battery
- Add EV
- Add Smart Meter
- Add Solar Inverter

In the simulation environment, this may dynamically create new simulated devices.

---

# Real-Time Updates

Every asset updates automatically whenever MQTT telemetry is received.

Example flow

```
Simulator

↓

Battery SoC Updated

↓

MQTT Publish

↓

Backend

↓

WebSocket/API

↓

Dashboard Updates
```

No page refresh is required.

---

# Relation to US-1.4 — Flexible Asset Simulation

This page directly supports the implementation of **US-1.4 – Flexible Asset Simulation (Battery/EV)**.

### Acceptance Criteria Mapping

| Acceptance Criteria | Dashboard Support |
|---------------------|------------------|
| House may have Battery | Battery Card |
| House may have EV | EV Card |
| House may have Both | Battery + EV displayed together |
| House may have Neither | Cards hidden or disabled |
| Battery SoC persists | SoC progress bar updates continuously |
| Charging/discharging affects smart meter | Import/Export values update |
| EV charging affects net energy | Smart Meter reflects EV load |
| MQTT dispatch commands update battery | Battery status changes in real time |

---

# MQTT Integration

The dashboard is a visualization layer only.

It **does not control simulator logic directly.**

Instead, the backend communicates with the simulator using MQTT.

Example command

```json
{
  "command": "set_battery_rate_kw",
  "target_kw": -2.0,
  "duration_seconds": 3600
}
```

Simulator Flow

```
Backend

↓

MQTT Command

↓

Simulator

↓

Battery Behaviour Changes

↓

Battery SoC Updates

↓

Smart Meter Updates

↓

MQTT Telemetry

↓

Dashboard Refreshes
```

---

# Future Enhancements

The following features are planned to extend the dashboard:

- Battery charging/discharging history charts
- EV charging schedule
- Historical SoC graph
- Fleet overview for multiple houses
- Device fault indicators
- Battery health monitoring
- Dispatch command history
- MQTT message inspector
- Asset filtering and search
- Real-time event notifications

---

# Benefits

The Energy Assets dashboard provides:

- Real-time monitoring of distributed energy resources.
- Better visibility into prosumer energy behaviour.
- Validation of IoT simulation outputs.
- Easy monitoring of Battery and EV state.
- Clear visualization of energy import and export.
- Support for future smart grid dispatch and flexibility services.
