---
connie-title: Introduction to data pipelines
---

# Introduction to data pipelines

This document covers both the overall and indepth plan of the data pipelines.

### Overview of data pipeline

The data pipeline is split into the following areas:

1. IoT smart meter data pipeline
1. Candle & Trade event pipeline
1. MLOps pipeline

### Iot smart meter data pipeline

Data is emittied by IoT simulator to the MQTT broker. There is a connector or plugin (not decided yet on plugin) that connects to apache kafka and enables the data to be streamed from MQTT broker to an Apache Kafka topic.

Then this topic is consumed by `IoT data ingestion and dispatch` service. The service handles storing this data in the following storage tiers:

* Hot storage - Redis (recent data only)
* Warm storage - timescaledb (3 to 6 months data)

Seperate tools are used to write to cold storage

* Cold storage - minio (historical data)

Why?

Hot storage - Instant sub millisecond data access to iot smart meter data for order management service and other relavant services that need to pull the current feed or status of iot smart meter devices.

Warm storage - holds recent data that are older than a day / few hours. Persistently stores data so it can be accessed with ease for past few weeks.

Cold storage - for long term storage. In a real system it is not feasible to store everything in warm storage as it is expensive. This data will later be used to train the models.

### Candle & Trade Event pipeline

**NOTE**: The matching engine plan is still not fully confirmed. The following might change after the plan is finalized!

The order management service pushes data to a specific kafka topic that is consumed by matching engine. The matching engine also outputs completed trades in a kafka topic that is consumed by both order management service and market ticket service. This data is used to both update the live orders and candle data.

The data is also stored in 3 tiers:

* Hot storage - Redis (current (active/open) orders, real time and recent candles)
* Warm storage - timescaledb (2 weeks data - present data)
* Cold storage - minio (historical data)

Why?

Hot storage - Instant sub millisecond access to active/open orders. The live and recent candles can also be stored here.

Warm storage - This is used to store order book snapshot in a relational table (postgres) and also candles for each timeframes in timescaledb.

Cold storage - To store historical candle data for all timeframes (1m, 15m, 30m, etc). We can also store historical ordewrbook snapshots here if needed (unsure if we are going to store historical order book depth, I need to discuss this with team mates)

### MLOps pipeline

**NOTE**: This is planned for 2nd semester so plan of this is currently not rsearched


### Note on ingestion

The following ingestion services should only handle persisting data to redis and timescaledb only. They should not worry about minio.

* Market ticker service
* IoT ingestion & Dispatch service

Batching data and persisting to minio should be done by a separate tool that can directly stream data from apache kafka to minio. The following tools/plugin can be used (not decided which tool to use yet).

* Kafka Connect S3 Sink Plugin
* Vector (by Datadog)

The data that should be pushed by the above tools to minio are:

* raw smart meter data
* order book depth
* market candle data

**NOTE**: Market candle data is formed by the market ticket service and will not appear in a kafka topic. Making market ticker service push to all 3 storage tiers is not ideal and an anti pattern. The proper plan I have come up for this is: let market ticker service push the data back to apache kafka and then let the above tools batch the candles and store them in minio buckets. This is a much better pattern. This plan will be eloborated in the market ticker plans!







