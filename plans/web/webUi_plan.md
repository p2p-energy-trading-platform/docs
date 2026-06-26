# Web UI Plan – Peer-to-Peer Energy Trading Platform

## Project Overview
This document describes the web interface design plan for the Peer-to-Peer Energy Trading Platform. The system enables prosumers (households and businesses) to buy, sell, and monitor energy in real-time using a trading-style dashboard.

---

## UI Design Goals

- Provide a **real-time trading experience** similar to financial exchanges
- Ensure **clear visibility of energy production and consumption**
- Enable **fast and intuitive trading actions (buy/sell)**
- Maintain **simple and user-friendly navigation**

---

## Main Navigation Structure

The web application will use a sidebar-based layout:

- Login / Signup
- Energy Monitor
- Market / Trading
- Wallet
- Analytics
- Profile / Settings
- Notifications (dropdown / panel)

---

## Pages Overview

### 1. Authentication Pages
- Login Page
- Signup Page

**Purpose:**
Secure access using JWT/OAuth authentication.

---

### 2. Profile Page
- Manage user details (name, address, grid zone)
- Manage energy assets (solar system, smart meter ID)
- Verify installation and meter details
- Update production capacity

---

### 3. Energy Monitor Page
- Real-time solar energy production dashboard
- Consumption vs production comparison
- Historical energy generation trends
- Daily energy usage charts
- Smart meter status monitoring

---

### 4. Market / Trading Page (Core Module)
- Live buy/sell order book (bids & asks)
- Place buy bid orders (kWh + price)
- Place sell orders (surplus energy)
- Auto-matching engine visualization
- Spot price movement (real-time)
- Market depth visualization
- Trade execution updates
- Volatility alerts

---

### 5. Wallet Page
- Energy credit balance (kWh / currency equivalent)
- Transaction history (buy/sell logs)
- Automatic balance updates after trades

---

### 6. Analytics Page
- Historical price trends (OHLC charts)
- AI-based energy price forecasting
- Energy usage analytics

---

### 7. Notifications Panel
- Trade execution alerts
- Price spike alerts (sell opportunity)
- Low price alerts (buy opportunity)
- System notifications

---

## UI Design Principles

- Clean and minimal layout
- Dark theme with energy-focused accent colors (green, yellow, blue)
- Real-time updates using WebSocket integration
- Responsive design (desktop-first, mobile-friendly)
- Card-based UI for metrics and charts

---

## Key UI Components

- Live Price Chart (Candlestick / OHLC)
- Order Book Table (Bids vs Asks)
- Energy Flow Cards (Production vs Consumption)
- Wallet Summary Card
- Market Depth Graph
- Alert Notification Panel

---

## Real-Time Features

- Live energy price updates
- Instant trade execution updates
- Real-time solar production monitoring
- Dynamic order book updates
- Market volatility alerts

---

## UX Strategy

- Trading page acts as the **main control center**
- Energy Monitor focuses on **physical energy behavior**
- Wallet focuses on **financial settlement**
- Analytics focuses on **decision making**
- Profile focuses on **system configuration**

---

## Summary

The web UI is designed as a **real-time energy trading dashboard inspired by financial exchanges**, enabling prosumers to actively participate in energy markets with full visibility and control.