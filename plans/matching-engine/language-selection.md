---
connie-title: Matching Engine Language Selection
---

# Matching Engine Language Selection

This document explains why C++ was selected for the Matching Engine and why other languages were not chosen.

## Requirements

The matching engine is the core component of the trading platform.

Main requirements:

- Low latency order processing
- In-memory order book
- High throughput
- Predictable performance
- Support for concurrent connections
- Suitable for future optimisation

---

## Selected Language: C++

### Why C++

C++ was selected because it is widely used in trading systems and low-latency applications.

Advantages:

- High performance
- Direct memory management
- No garbage collector
- Low runtime overhead
- Mature ecosystem
- Suitable for implementing efficient data structures
- Good support for multi-threading and concurrency

The matching engine is expected to maintain the order book in memory and process orders with minimal delay. C++ provides the level of control needed for this type of system.

---

## Other Languages Considered

### Go

Advantages:

- Simple syntax
- Good concurrency support
- Fast development speed
- Good standard library

Reasons not selected:

- Uses a garbage collector
- Less control over memory management
- Not as common as C++ in low-latency trading systems

Go remains a strong alternative and may be used for supporting services.

---

### Java

Advantages:

- Mature ecosystem
- Good concurrency support
- Strong tooling

Reasons not selected:

- Garbage collection can introduce latency spikes
- Higher memory usage compared to C++
- Less direct control over system resources

---

### Node.js

Advantages:

- Fast development
- Good ecosystem
- Team familiarity

Reasons not selected:

- Single-threaded event loop
- Not designed for performance-critical matching engines
- Lower performance compared to C++

Node.js is better suited for APIs and web services.

---

### Python

Advantages:

- Easy to learn
- Rapid development
- Large ecosystem

Reasons not selected:

- Lower execution speed
- Not suitable for low-latency matching workloads
- Global Interpreter Lock (GIL) limitations

Python is more suitable for analytics, simulations, and machine learning components.

---

## Notes

During the initial project planning stage, the team selected Go as the preferred language for the matching engine due to its simplicity, concurrency support, and fast development speed.

However, during the proposal review and discussion phase, feedback was received regarding the importance of low-latency processing and industry-standard practices in trading systems.

Following additional research into matching engine architectures, performance requirements, and technologies commonly used in financial exchanges, the team decided to move forward with C++ for the matching engine component.

This decision is based on the current understanding of the project requirements and may be revisited if future requirements or technical constraints change.

## Conclusion

C++ was selected as the primary language for the Matching Engine because it provides high performance, predictable latency, direct memory control, and is commonly used in performance-critical trading systems.

Other languages such as Go, Java, Node.js, and Python remain suitable for supporting services but were not selected for the matching engine.
