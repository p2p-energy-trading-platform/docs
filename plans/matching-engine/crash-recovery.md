# Crash Recovery

## Purpose

This document describes how the Matching Engine recovers after an unexpected shutdown or restart.

The Matching Engine stores active Order Books in memory (RAM). If the application crashes, the in-memory data is lost. The recovery process rebuilds the Order Books before normal operation resumes.

---

# Why Crash Recovery is Needed

The Matching Engine keeps active orders in memory to achieve low-latency matching.

Example:

```text
Matching Engine

↓

RAM

↓

Order Books
```

If the application crashes:

```text
Matching Engine

↓

Crash

↓

RAM Cleared

↓

Order Books Lost
```

Although the Order Books are lost, the orders themselves are not lost because they are already stored by the Order Service.

---

# Recovery Architecture

```text
User

↓

Order Service

↓

PostgreSQL

↓

Kafka

↓

Matching Engine

↓

Order Books (RAM)
```

The Order Service stores every new order before publishing it to Kafka.

The Matching Engine only keeps active orders in memory for fast matching.

---

# Recovery Process

When the Matching Engine starts, it performs a recovery process before accepting new orders.

The recovery process rebuilds every Grid Zone Order Book using active orders stored by the Order Service.

---

# Recovery Flow

```text
Matching Engine Starts

↓

Initialize Components

↓

Recovery Manager Starts

↓

Request OPEN Orders

↓

Order Service

↓

PostgreSQL

↓

Return Active Orders

↓

Group Orders by Grid Zone

↓

Rebuild Order Books

↓

Recovery Complete

↓

Start Kafka Consumer

↓

Begin Order Matching
```

---

# Recovery Steps

## Step 1 - Start the Matching Engine

The Matching Engine starts and initializes its internal components.

At this stage, no orders are processed.

---

## Step 2 - Start Recovery Manager

The Recovery Manager begins the recovery process.

The Kafka Consumer remains stopped until recovery is completed.

---

## Step 3 - Request Active Orders

The Recovery Manager requests all active orders from the Order Service.

Only active orders are requested.

Completed orders are ignored.

---

## Step 4 - Load Orders

The Order Service loads active orders from PostgreSQL.

Only orders with the following statuses are returned:

* OPEN
* PARTIALLY_FILLED

Orders with these statuses are not returned:

* FILLED
* CANCELLED
* REJECTED

---

## Step 5 - Rebuild Order Books

The Matching Engine groups the received orders by Grid Zone.

Each order is inserted into the correct Order Book.

Example:

```text
Northern

├── Buy Book
└── Sell Book

Central

├── Buy Book
└── Sell Book
```

After this step, the in-memory Order Books are fully restored.

---

## Step 6 - Start Kafka Consumer

After recovery is completed, the Kafka Consumer starts.

The Matching Engine begins processing new incoming orders.

---

# Recovery States

The Matching Engine moves through the following states during startup.

```text
STARTING

↓

RECOVERING

↓

READY

↓

RUNNING
```

### STARTING

The application is starting.

Internal components are initialized.

---

### RECOVERING

The Recovery Manager rebuilds the Order Books.

No matching is performed during this state.

---

### READY

The recovery process is complete.

All Order Books are available.

---

### RUNNING

The Kafka Consumer starts.

The Matching Engine begins normal order processing.

---

# Handling Partially Filled Orders

Partially filled orders must be restored using their remaining quantity.

Example:

Original Order

```text
Quantity = 100
```

Already Matched

```text
40
```

Remaining

```text
60
```

During recovery, only the remaining quantity is added back to the Order Book.

---

# Orders Received During Recovery

New orders may arrive while recovery is running.

Kafka stores these events until the Matching Engine is ready.

Example:

```text
Recovery Running

↓

Kafka Stores New Orders

↓

Recovery Complete

↓

Kafka Consumer Starts

↓

Process Waiting Orders
```

This prevents new orders from being lost.

---

# Error Handling

If the Recovery Manager cannot retrieve active orders:

* Retry the request.
* Do not start the Kafka Consumer.
* Do not perform order matching.
* Continue recovery until successful.

The Matching Engine should never process new orders with an incomplete Order Book.

---

