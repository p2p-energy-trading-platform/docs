---
connie-title: IoT Ingestion - gRPC setup
---

# gRPC setup

*Add document later*


## gRPC interfaces (planned - not implemented in this phase)

**Ingestion query interface** - other services will need to *read* hot/warm data:

- `GetLatestReading(house_id)` - hits Redis
- `GetHistoricalReadings(house_id, start_time, end_time)` - hits TimescaleDB
- `GetGridSummary(grid_id)` - aggregate view across a grid's houses

**Dispatch command interface** - per section 7, the Order Service would make a gRPC call *to* the Dispatch Service to *trigger* an actuation - a command/write interface, belonging to Dispatch rather than Ingestion.

**Neither is being built this phase.** The Ingestion query interface may reuse relevant telemetry messages from section 3.2 as response types once those contracts are finalized. The Dispatch command interface needs its own request/response contracts, including an `ActuationCommand`, and those should be designed when Dispatch is properly scoped rather than forced into the current telemetry messages.