---
connie-title: Crash Recovery
---

# Crash recovery

This document is withdrawn.

The procedure it used to describe — a gRPC call that returns `OPEN` and `PARTIALLY_FILLED` orders, then starts the consumer — is not the recovery design. It does not match the engine that was written, and it is not the protocol to build.

Recovery is specified in [proposed engine changes](proposed-engine-changes.md). That document is not implemented. The engine has no recovery code today.

The order service's part of the same protocol, which is serving a snapshot when asked, is in [the order-service recovery note](../order_service/09-kafka-based-recovery.md).
