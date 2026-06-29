# GridX — Project Charter

## General Project Information

| Field | Detail |
|---|---|
| **Project Name** | Peer-to-Peer Energy Trading Platform |
| **Mentor** | Dinendra Karunarathne |
| **Co-Supervisor** | Dilki Sewwandi |
| **Project Start Date** | May 2026 |
| **Project End Date** | Apr 2027 |

---

## Project Overview

### Problem Statement

Traditional centralized energy grids face severe operational and financial inefficiencies due to the rapid growth of domestic solar prosumers. Currently, individuals generating excess solar power must sell it back to a main utility grid at low rates, while neighboring households buy electricity at high retail rates. Centralized utilities struggle with peak load balancing and lack the infrastructure to process spikes smoothly. Without a local trading framework, grid bottlenecks waste clean energy and cost homeowners money.

### Proposed Solution

We propose a local, peer-to-peer energy trading platform that lets neighbors buy and sell solar power directly to each other. The system tracks energy data in real-time, secures transactions, and forecasts future energy prices.

### Objectives

- **Fast Order Matching** — Build a trading system that matches energy buyers and sellers instantly to handle rapid changes in power supply.
- **Scalable Data Handling** — Design a data pipeline that can process live data streams from thousands of neighborhood smart meters simultaneously.
- **Price & Demand Forecasting** — Create a predictive tool that accurately forecasts energy prices and household power usage 24 hours in advance.

---

## High-Level Scope

| In-Scope | Out-of-Scope |
|---|---|
| Full software simulator (no real power) | Real electricity transactions |
| Go-based matching engine & API | Physical grid hardware / digital meters |
| IoT simulator via MQTT | Legal / regulatory compliance |
| Kafka pipeline + TimescaleDB + S3 | Commercial deployment |
| AI price forecasting (Prophet/LSTM) | Integration with real user systems |
| React web dashboard + mobile app | Hardware procurement |
| Docker + CI/CD (GitHub Actions) | Live grid connection |
| Grafana observability dashboards | Financial settlement processing |

---

## Risks, Constraints, and Assumptions

| Risk / Constraint | Likelihood | Mitigation Strategy |
|---|---|---|
| Data Sync & Transaction Errors | Medium | Implement strict transaction validation rules and backend state verification |
| Dashboard Interface Lag | Medium | Optimize frontend rendering logic |
| Team Technical Learning Curve | High | Front-load standalone research tasks, provide pre-built code skeletons |
| Scope Creep | Medium | Establish rigid feature freezing by Week 11 |
| Latency & Race Conditions | High | Prioritize building optimized, fine-tuned services |

---

## RACI Responsibility Matrix

**Legend:** R = Responsible · A = Accountable · I = Informed · — = Not Involved

| System Domain | Keerthigan | Manimehalan | Hanan | Vidurshan | Sivajan | Dilaxshan | Santhosh | Supervisor |
|---|---|---|---|---|---|---|---|---|
| Core Matching Engine | A | R | R | — | — | — | — | I |
| AI/ML Forecasting Engine | R | A | R | — | — | — | — | I |
| Data Pipeline | R | A | — | — | — | — | — | I |
| Billing & Virtual Wallet | — | R | — | — | A | — | — | I |
| IoT Smart Meter Simulator | — | R | A | — | — | — | — | I |
| Dashboards & Visualizations | — | — | — | A | — | R | — | I |
| Fastify API Gateway | R | — | — | R | — | A | — | I |
| Central Auth Service | R | — | — | R | A | — | — | I |
| Web Dashboard UI | — | — | — | — | R | R | A | I |
| Mobile App | — | — | — | — | R | A | R | I |
| Notification | A | — | — | — | — | — | R | I |

> **Note:** Column order and name mapping were carried over directly from the source table. Please double-check the Keerthigan/Manimehalan/Hanan/Sivajan/Dilaxshan/Santhosh column alignment against the original PDF before relying on this for assignment purposes, since dense multi-person RACI tables are the most likely place for a transcription slip.

---

## Key Project Milestones & Timeline

### Phase 1

| Weeks | Milestone |
|---|---|
| 1–3 | Requirement Analysis & Project Research |
| 1–12 (Continuous) | Agile Sprint Management, Requirement Engineering & Explicit Jira User Story Formulation |
| 1–3 | Core Repository Setup, Docker Environments & Layouts |
| 4–6 | Standalone IoT Smart Meter Data Simulator |
| 4–6 | Next.js Web Dashboard Interface Components |
| 6–11 | Mobile and React Native UI Component Screens |
| 4–9 | Kafka / MQTT Pipeline & Live Event Ingestion |
| 10–14 | Matching Logic |
| 10–13 | API Gateway |
| 13–15 | Auth Service |
| 5–15 (Continuous) | Manual Component, Visual Regression & Functional Acceptance Testing |

### Phase 2

| Weeks | Milestone |
|---|---|
| 16–30 (Continuous) | Lifecycle Requirement, Lifecycle Engineering & Continuous Jira Ticket Structuring for Core Upgrades |
| 16–25 (Continuous) | Frontend Integrations |
| 16–18 | Order Management Service |
| 16–21 | AI Forecasting Engine |
| 22–25 | Billing & Wallet Service |
| 20–26 | Analytics Dashboards & Historical Usage Visualizations |
| 22–25 | Notifications Service |
| 1–30 (Continuous) | System Integration Testing, Regression Suites & End-to-End Release Auditing |
| 1–30 (Continuous) | Code Review |

---

## Document Control

| Prepared By | Role | Date |
|---|---|---|
| P. Vidurshan | Business Analyst | 18/6/2026 |
