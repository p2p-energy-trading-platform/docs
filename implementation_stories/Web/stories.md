---
connie-title: Web - User Stories
---

# GridX Web Dashboard - User Stories

* **Epic:** Web Dashboard UI
* **Project:** PETPG
* **Framework:** Next.js
* **Roles:** Consumer, Prosumer
* **Status:** Draft

> User stories derived directly from Figma designs. Each story maps to a specific screen or component visible in the design. Stories are organized by page/feature area and grouped under epics matching the sidebar navigation.

---

## Table of Contents

1. [Landing Page](#1-landing-page)
2. [Authentication - Sign In](#2-authentication---sign-in)
3. [Registration Flow](#3-registration-flow)
4. [Dashboard](#4-dashboard)
5. [Energy Assets - Energy Generation](#5-energy-assets---energy-generation)
6. [Energy Assets - Energy Devices](#6-energy-assets---energy-devices)
7. [Trading Terminal - Buy](#7-trading-terminal---buy)
8. [Trading Terminal - Sell](#8-trading-terminal---sell)
9. [Wallet & Transactions](#9-wallet---transactions)
10. [Trade History](#10-trade-history)
11. [Notifications](#11-notifications)
12. [Profile](#12-profile)
13. [Global / Layout](#13-global---layout)

---

## 1. Landing Page

### US-1.1 - Landing page hero section

>**As** a visitor, <br>
>**I want** to see a compelling hero section with a headline, key platform stats, and live market ticker, <br>
>**so that** I immediately understand what GridX does and feel confident it is a live, active platform.

**Acceptance Criteria:**

- Hero headline and subheading are displayed prominently.

- Platform stats visible: registered users (12,400+), trading power (1.2 GW), uptime (98.9%).

- Live market ticker widget shows at least 2 grid zone prices with live indicators.

- "Get Started" and "Learn More" CTA buttons are visible and functional.

---

### US-1.2 - Features section

>**As** a visitor, <br>
>**I want** to see a grid of platform features with icons and descriptions, <br>
>**so that** I understand what the platform offers before signing up.

**Acceptance Criteria:**

- 6 feature cards displayed: Peer-to-Peer Trading, Real-Time Marketplace, Smart Meter Integration, Secure Transactions, AI Market Insights, Wallet & Settlement.

- Each card has an icon, title, and short description.

- Section is responsive and renders correctly on desktop.

---

### US-1.3 - How it works section

>**As** a visitor, <br>
>**I want** to see a simple 4-step onboarding flow explained visually, <br>
>**so that** I understand how to get started on the platform.

**Acceptance Criteria:**

- 4 numbered steps shown: Create an Account, Connect Smart Meter, Buy or Sell Energy, Receive Payments.

- Each step has a number, title, and short description.

- Steps are laid out horizontally on desktop.

---

### US-1.4 - Platform features grid

>**As** a visitor, <br>
>**I want** to see all 8 platform feature tiles (Live Marketplace, Order Book, Price Charts, Trade History, Meter Monitoring, Wallet Management, Smart Notifications, AI Price Forecasting), <br>
>**so that** I can assess the full feature set before registering.

**Acceptance Criteria:**

- 8 feature tiles rendered in a grid layout.

- Each tile has a number, title, and one-line description.

---

### US-1.5 - User persona section

>**As** a visitor, <br>
>**I want** to see three distinct participant personas (Generate & Sell, Buy Clean Local Energy, Advanced Trading Tools), <br>
>**so that** I can identify which role applies to me.

**Acceptance Criteria:**

- Three participant cards rendered side by side.

- Each card has a label (Prosumer, Consumer, Trader), headline, bullet list of benefits, and a CTA button.

- "Prosumer" card is visually highlighted as recommended.

---

### US-1.6 - FAQ section

>**As** a visitor, <br>
>**I want** to see answers to common questions about GridX, <br>
>**so that** I can resolve doubts without contacting support.

**Acceptance Criteria:**

- At least 6 FAQ items displayed.

- Items are expandable/collapsible (accordion).

- Questions cover: how P2P trading works, smart meter support, solar panel requirement, data security, fees, and API access.

---

### US-1.7 - Footer and final CTA

>**As** a visitor, <br>
>**I want** to see a final CTA banner and a footer with navigation links, <br>
>**so that** I can sign up or find further information easily.

**Acceptance Criteria:**

- Final CTA section shows "Create Free Account" and "Talk to Sales" buttons.

- Footer includes: Platform, Company, and Support link groups.

- Privacy Policy and Terms & Conditions links are present.

---

## 2. Authentication - Sign In

### US-2.1 - Sign in form

>**As** a registered user, <br>
>**I want** to sign in with my email and password, <br>
>**so that** I can access my GridX trading account.

**Acceptance Criteria:**

- Email address and password fields are displayed.

- "Show/Hide" password toggle is present.

- "Remember me" checkbox is available.

- "Forgot Password?" link is visible and functional.

- "Sign In" button submits the form.

- On success, user is redirected to the Dashboard.

- On failure, an inline error message is shown below the form.

---

### US-2.2 - Sign in page marketing panel

>**As** a returning user, <br>
>**I want** to see a motivational marketing panel on the sign in page, <br>
>**so that** the brand and value proposition are reinforced during login.

**Acceptance Criteria:**

- Left panel shows headline, supporting copy, and 3 bullet points (24/7 live energy marketplace, Bank-grade encrypted sessions, Instant portfolio sync).

- "LIVE ENERGY MARKETPLACE" badge is visible.

- Panel is hidden or stacked on mobile viewports.

---

### US-2.3 - Navigation to registration from sign in

>**As** a new visitor on the sign in page, <br>
>**I want** to be able to navigate to the Create Account page, <br>
>**so that** I can register without going back to the landing page.

**Acceptance Criteria:**

- "New to GridX? Create Account" link is visible below the Sign In button.

- Clicking it navigates to the Create Account page (Step 1 of registration).

---

## 3. Registration Flow

### US-3.1 - Create account (Step 1 of 3)

>**As** a new user, <br>
>**I want** to create a GridX account using my email and password, <br>
>**so that** I can access the platform.

**Acceptance Criteria:**

- Registration stepper shows 3 steps: Account (active), KYC, Smart Meter.

- Email address, Password, and Confirm Password fields are present.

- Password show/hide toggle is available on both password fields.

- "I agree to the GridX Terms and Privacy Policy" checkbox must be checked to proceed.

- "Create Account" button is disabled until all fields are valid and checkbox is checked.

- "Already have an account? Sign in" link is visible.

- On success, user advances to Step 2 (Verify Email).

---

### US-3.2 - Verify email (between Step 1 and Step 2)

>**As** a new user, <br>
>**I want** to verify my email address using a 6-digit OTP code, <br>
>**so that** GridX can confirm my email before proceeding.

**Acceptance Criteria:**

- 6 individual digit input boxes are displayed.

- The email address used during registration is shown on screen.

- OTP auto-advances to the next digit box on input.

- "Didn't receive the verification code? Resend" link is available.

- Code expiry reminder shown: "Code expires in 10 minutes".

- "Verify Email" button submits the OTP.

- On success, user advances to KYC step.

---

### US-3.3 - KYC identity verification (Step 2 of 3)

>**As** a new user, <br>
>**I want** to optionally complete KYC identity verification, <br>
>**so that** I can unlock higher trading limits and wallet payouts.

**Acceptance Criteria:**

- Step 2 (KYC) is highlighted in the registration stepper.

- Fields: Legal Full Name, National ID / Passport, Country (dropdown), Date of Birth (date picker).

- Document upload area supports PNG, JPG, PDF up to 10 MB via drag-and-drop or file picker.

- "Skip for Now" button allows user to proceed without completing KYC.

- "Submit KYC" button submits the form.

- KYC status is visible on Profile page as "Not submitted" or "Pending" after skipping or submitting.

---

### US-3.4 - Connect smart meter (Step 3 of 3)

>**As** a new user, <br>
>**I want** to optionally connect my smart meter during registration, <br>
>**so that** GridX can automatically track my energy production and consumption.

**Acceptance Criteria:**

- Step 3 (Smart Meter) is highlighted in the registration stepper.

- A single "Smart Meter ID" input field is shown (e.g. MTR-7829-XY).

- "Skip for Now" button allows user to complete registration without connecting a meter.

- "Send Connection Request" button submits the meter ID and sends an approval request to the utility app.

- Smart meter status on Profile page shows "Pending" after submission.

- Right panel copy explains compatibility: SMETS2 & most SMETS1 meters.

---

## 4. Dashboard

### US-4.1 - Dashboard KPI summary cards

>**As** a prosumer, <br>
>**I want** to see my key energy and financial metrics at a glance on the dashboard, <br>
>**so that** I can quickly assess my current trading position.

**Acceptance Criteria:**

- 4 KPI cards displayed at the top: Net Surplus (kWh), Solar Generated (kWh), Consumed (kWh), Wallet Balance (AED).

- Each card shows the primary metric value, unit, and a supporting sub-label (e.g. "Available to sell or store", "This month · X kWh today").

- Wallet Balance card shows net month-to-date change (e.g. "+RM 108.20 net this month").

- Cards update in real time from live data.

---

### US-4.2 - Asset Fleet panel

>**As** a prosumer, <br>
>**I want** to see the status of all my connected energy assets on the dashboard, <br>
>**so that** I can monitor their current state without navigating to the Energy Assets page.

**Acceptance Criteria:**

- Asset Fleet panel displays up to 4 device cards: Battery, EV, Smart Meter, Solar Inverter.

- Each card shows: device name, online/offline status badge, primary metric (SOC % or kW output), and a progress bar.

- "All online" indicator shown when all devices are connected.

- Clicking a device card navigates to the Energy Devices tab.

---

### US-4.3 - Active Dispatches panel

>**As** a prosumer, <br>
>**I want** to see active dispatch commands on the dashboard, <br>
>**so that** I know what automated actions are currently running on my assets.

**Acceptance Criteria:**

- Active Dispatches panel shows all currently executing dispatch commands.

- Each dispatch row shows: device name, mode (e.g. Discharging / Charging), target value (e.g. -2 kW), remaining time (e.g. 42 min), and status badge (EXECUTING).

- "Settings" link in the panel header navigates to dispatch settings.

---

### US-4.4 - Generation vs Consumption chart

>**As** a prosumer, <br>
>**I want** to see a live line/area chart comparing solar generation and household load throughout the day, <br>
>**so that** I can understand my energy flow patterns.

**Acceptance Criteria:**

- Chart displays Solar (orange) and Load (blue) lines over a 24-hour period.

- Chart title shows "Generation vs Consumption" and subtitle shows "Today's energy flow (kW)".

- Chart renders with time on the x-axis and kW on the y-axis.

- Legend labels for Solar and Load are visible.

---

### US-4.5 - Trading Activity panel

>**As** a prosumer, <br>
>**I want** to see my today's trading activity and current market price on the dashboard, <br>
>**so that** I can track my trading performance at a glance.

**Acceptance Criteria:**

- "Sold Today" shows kWh sold and revenue value.

- "Bought Today" shows kWh bought and cost value.

- "Current Market Price" shows live price per kWh with percentage change (e.g. AED 0.470 +4.7%).

- "Net P&L This Month" shown in a highlighted card with percentage vs last month.

---

### US-4.6 - Recent Trades section

>**As** a prosumer, <br>
>**I want** to see my most recent trades on the dashboard, <br>
>**so that** I can quickly review completed activity without navigating to Trade History.

**Acceptance Criteria:**

- Recent Trades section shows the latest 3–5 trades in a compact list.

- Each row shows: Trade ID, type (Buy/Sell), counterparty, energy (kWh), price/kWh, total, and timestamp.

- "View all" link navigates to the full Trade History page.

---

## 5. Energy Assets - Energy Generation

### US-5.1 - Energy Assets stat bar

>**As** a prosumer, <br>
>**I want** to see 4 real-time fleet-level metrics at the top of the Energy Assets page, <br>
>**so that** I have an instant overview before drilling into tabs.

**Acceptance Criteria:**

- 4 stat cards displayed: Solar Output (kW), Battery SOC (%), Grid Import (kW), Grid Export (kW).

- Each card shows current value, unit, and a short label (e.g. "Current generation", "Average across fleet", "Drawing from grid", "Sending to grid").

- Values update in real time.

---

### US-5.2 - Energy Generation / Energy Devices tab toggle

>**As** a prosumer, <br>
>**I want** to switch between Energy Generation and Energy Devices views using a tab toggle, <br>
>**so that** I can access both views from the same page without extra navigation.

**Acceptance Criteria:**

- Two tabs visible: "Energy Generation" and "Energy Devices".

- Active tab is visually highlighted (white background, bold text).

- Switching tabs updates the main content area without a full page reload.

---

### US-5.3 - Solar Generation Today line chart

>**As** a prosumer, <br>
>**I want** to see a line chart comparing solar generation and consumption throughout today, <br>
>**so that** I can identify peak generation periods and consumption patterns.

**Acceptance Criteria:**

- Line chart shows Solar (orange) and Consumption (blue) over 24 hours.

- Chart title "Solar Generation Today" and last updated timestamp are visible.

- X-axis shows time intervals; Y-axis shows kW values.

- Legend labels for Solar and Consumption are displayed.

---

### US-5.4 - Energy Generation bar chart with period toggle

>**As** a prosumer, <br>
>**I want** to view my energy generation history with Daily, Weekly, and Monthly views, <br>
>**so that** I can track generation trends over different time periods.

**Acceptance Criteria:**

- Bar chart displayed below the line chart under the "ENERGY GENERATION" heading.

- Three toggle buttons: Daily, Weekly, Monthly.

- Active period button is visually highlighted.

- Chart updates to show the correct period's data when a toggle is clicked.

---

### US-5.5 - Production vs Consumption donut chart

>**As** a prosumer, <br>
>**I want** to see a donut chart showing the ratio of production to consumption, <br>
>**so that** I can instantly know my surplus or deficit percentage.

**Acceptance Criteria:**

- Donut chart displayed in the right panel with a large percentage in the center (e.g. 63% SURPLUS).

- Legend shows Generated (kW) and Consumed (kW) values.

- Chart colour coding: generated vs consumed segments clearly distinguishable.

---

### US-5.6 - Active Alerts panel

>**As** a prosumer, <br>
>**I want** to see active energy alerts on the Energy Generation page, <br>
>**so that** I am notified of significant events like high production or surplus availability.

**Acceptance Criteria:**

- "ACTIVE ALERTS" section displays alert cards.

- At least 2 alert types visible: "High production detected" (neutral) and "Surplus available for trading" (action - highlighted in green/red).

- "Surplus available for trading" alert links to the Trading Terminal.

---

### US-5.7 - Today's Summary panel

>**As** a prosumer, <br>
>**I want** to see a summary of today's energy generation figures in the right panel, <br>
>**so that** I have a quick numeric reference alongside the charts.

**Acceptance Criteria:**

- "TODAY'S SUMMARY" panel shows at minimum: Generated (kWh) value.

- Panel is positioned in the right column alongside the donut chart.

---

## 6. Energy Assets - Energy Devices

### US-6.1 - Device cards grid

>**As** a prosumer, <br>
>**I want** to see all my connected devices displayed as individual cards with real-time status, <br>
>**so that** I can monitor each asset's current state.

**Acceptance Criteria:**

- 4 device cards displayed in a grid: Battery #1, Tesla Model Y (EV), Smart Meter, Solar Inverter.

- Each card shows: device name, device type label, online/connected status badge, primary metric, progress bar (for battery/EV), and device ID.

- Battery #1: State of Charge %, Capacity (kWh), ID (BAT001), status (Charging/Discharging).

- Tesla Model Y: State of Charge %, V2G Available (kWh), ID (EV001), status (Connected).

- Smart Meter: Net Flow (kW), Import (kW), Export (kW), ID (MTR001), status (Online).

- Solar Inverter: Output (kW), Peak Today (kW), ID (INV001), status (Online).

- "Refresh" button triggers a data refresh.

- Device count shown: "4/4 online".

---

### US-6.2 - Solar Generation Today chart (Devices tab)

>**As** a prosumer, <br>
>**I want** to see the Solar vs Consumption line chart on the Devices tab too, <br>
>**so that** I have generation context while reviewing device status.

**Acceptance Criteria:**

- Solar Generation Today chart rendered below the device grid.

- Same Solar (orange) / Consumption (blue) line chart as on the Generation tab.

- Chart subtitle: "kW output over 24 hours".

---

### US-6.3 - Battery & EV Status panel

>**As** a prosumer, <br>
>**I want** to see a detailed Battery & EV status panel on the Devices tab, <br>
>**so that** I can monitor charging rate, temperature, and SOC for each flexible asset.

**Acceptance Criteria:**

- "Battery & EV Status" panel shows fleet state of charge overview.

- Battery #1 section shows: capacity, online status, SOC % with progress bar, Charging Rate (kW), Temperature (°C).

- Tesla Model Y section shows: similar metrics with EV-specific fields.

- Panel updates in real time.

---

## 7. Trading Terminal - Buy

### US-7.1 - Live price ticker bar

>**As** a trader, <br>
>**I want** to see the current energy price and 24-hour market statistics at the top of the Trading Terminal, <br>
>**so that** I can assess market conditions before placing an order.

**Acceptance Criteria:**

- Current price displayed prominently (e.g. RM 0.470 /kWh) with percentage change badge (+4.7%).

- 24h High, 24h Low, and 24h Volume stats visible.

- Market status badge shows "Market Open" (green) or "Market Closed" (red).

- Values update in real time.

---

### US-7.2 - Candlestick price chart

>**As** a trader, <br>
>**I want** to see a candlestick chart of ENERGY/RM price history, <br>
>**so that** I can analyse price trends before deciding when and at what price to trade.

**Acceptance Criteria:**

- Candlestick chart rendered with green (up) and red (down) candles.

- Timeframe selector with options: 1m, 5m, 15m, 1H, 4H, 1D - active selection visually highlighted.

- Chart label shows "ENERGY / RM" and chart type "Candlestick".

- Price levels shown on Y-axis; time on X-axis.

- Dashed horizontal lines show reference price levels.

- Date/time tooltip visible on hover.

---

### US-7.3 - Order Book

>**As** a trader, <br>
>**I want** to see the live Order Book showing current bids and asks, <br>
>**so that** I can understand market depth before placing a limit order.

**Acceptance Criteria:**

- Order Book split into Bids (green) and Asks (red) columns.

- Each side shows: Price (RM), Quantity (kWh), Total (RM).

- Spread value displayed (e.g. Spread: RM 0.002).

- At least 5 rows per side visible.

- Values update in real time.

---

### US-7.4 - Buy order panel

>**As** a consumer or prosumer, <br>
>**I want** to place a buy order for energy at a specified price and quantity, <br>
>**so that** I can purchase energy from other participants at the best available price.

**Acceptance Criteria:**

- "Buy Energy" tab is active (highlighted green) when buy panel is shown.

- Available Balance displayed (e.g. RM 2,847.50).

- Order Type selector with two options: "Market Order" and "Limit Order" - Limit Order active by default.

- Amount (kWh) input field with 4 quick-select preset buttons: 10, 25, 50, 100 kWh.

- Price (RM/kWh) input field (editable for Limit Order).

- Order summary shows: Subtotal, Platform Fee (2%), Total Cost.

- "Buy X kWh" CTA button - dynamically updates with the entered quantity.

- Button is disabled if amount or price fields are empty or invalid.

---

### US-7.5 - Buy/Sell tab toggle on Trading Terminal

>**As** a trader, <br>
>**I want** to switch between Buy and Sell modes using a tab toggle, <br>
>**so that** I can place either type of order from the same terminal without navigating away.

**Acceptance Criteria:**

- "Buy Energy" and "Sell Energy" tabs displayed side by side.

- Active tab is visually highlighted (green for Buy, red for Sell).

- Switching tabs updates the order panel on the right without reloading the chart or order book.

---

## 8. Trading Terminal - Sell

### US-8.1 - Sell order panel

>**As** a prosumer, <br>
>**I want** to place a sell order for my surplus energy at a specified price and quantity, <br>
>**so that** I can sell excess solar generation to other participants.

**Acceptance Criteria:**

- "Sell Energy" tab is active (highlighted red) when sell panel is shown.

- "Available to Sell" shown in kWh (e.g. 122.7 kWh - sourced from net surplus).

- Price Recommendation section shows three options: Conservative (fast fill), Recommended (best balance - highlighted), Premium (max revenue), each with a price in RM/kWh.

- Clicking a recommendation auto-fills the Limit Price field.

- Quantity (kWh) input with max value shown (e.g. Max: 122.7 kWh).

- Limit Price (RM/kWh) input field.

- Revenue breakdown shows: Gross Revenue, Platform Fee (2% deducted), Net Revenue.

- "Sell X kWh" CTA button - dynamically updates with the entered quantity.

- Button is disabled if quantity exceeds available surplus or price is empty.

---

## 9. Wallet & Transactions

### US-9.1 - Wallet summary bar

>**As** a user, <br>
>**I want** to see my total wallet balance and this month's financial summary at the top of the Wallet page, <br>
>**so that** I can quickly assess my financial position.

**Acceptance Criteria:**

- Total Wallet Balance shown prominently with currency (e.g. AED 2,847.50) and percentage change badge.

- Last updated timestamp displayed below the balance.

- This Month Revenue, This Month Expense, and Net Profit cards shown side by side.

- Each card shows current value and percentage change vs last month.

- "Deposit" and "Withdraw" action buttons visible in the summary bar.

---

### US-9.2 - Revenue Analytics chart

>**As** a user, <br>
>**I want** to see a line chart of my revenue and profit over time, <br>
>**so that** I can track my financial performance trends.

**Acceptance Criteria:**

- Line chart labelled "Revenue Analytics" with Revenue (blue) and Profit (green) lines.

- X-axis shows monthly labels (Jan–Jun).

- Legend with Revenue/Profit toggle is visible.

---

### US-9.3 - Monthly Income Summary chart

>**As** a user, <br>
>**I want** to see a grouped bar chart showing monthly revenue vs profit, <br>
>**so that** I can compare income and profit month by month.

**Acceptance Criteria:**

- Grouped bar chart labelled "Monthly Income Summary".

- Two bars per month: Revenue (blue) and Profit (green).

- X-axis shows monthly labels; Y-axis shows RM values.

- Revenue/Profit toggle visible.

---

### US-9.4 - Transaction History table

>**As** a user, <br>
>**I want** to see a paginated table of all my wallet transactions, <br>
>**so that** I can review individual credits, debits, deposits, and withdrawals.

**Acceptance Criteria:**

- Table columns: TXN ID, TYPE, AMOUNT, DATE, STATUS, REFERENCE.

- Transaction types include: Trade Revenue (credit, green), Trade Payment (debit, red), Deposit (credit, green), Withdrawal (debit, red).

- Status shown as "Completed" (green text) or "Pending".

- Reference links to the associated trade or deposit ID.

- "Export →" button allows exporting the transaction history.

- Table is paginated or scrollable.

---

## 10. Trade History

### US-10.1 - Trade History KPI cards

>**As** a user, <br>
>**I want** to see summary statistics at the top of the Trade History page, <br>
>**so that** I can quickly understand my overall trading performance.

**Acceptance Criteria:**

- 4 KPI cards displayed: Total Trades (count), Total Bought (RM), Total Sold (RM), Net P&L (RM - can be negative).

- Negative Net P&L displayed in red; positive in green.

---

### US-10.2 - Trading Performance chart

>**As** a user, <br>
>**I want** to see a line chart of daily net profit/loss, <br>
>**so that** I can visualise my trading performance over the past week.

**Acceptance Criteria:**

- Line chart labelled "Trading Performance" with subtitle "Daily net profit / loss (RM)".

- X-axis shows daily dates; Y-axis shows RM value (can go negative).

- "Export" button in the top right exports the chart or underlying data.

---

### US-10.3 - Trade History table with filters

>**As** a user, <br>
>**I want** to search and filter my trade history by type, status, and date, <br>
>**so that** I can find specific trades quickly.

**Acceptance Criteria:**

- Search input field filters trades by trade ID or counterparty name.

- "Type" dropdown filter: All, Buy, Sell.

- "Status" dropdown filter: All, Completed, Pending, Failed.

- "Select date" date picker filters by date range.

- Table columns: TRADE ID, TYPE, COUNTERPARTY, ENERGY (KWH), PRICE/KWH, TOTAL, DATE & TIME, STATUS.

- Counterparty name is shown (anonymised or real depending on privacy setting).

- Pagination shown at bottom: "Showing 1 to 5 of 10 trades", with page controls and rows-per-page selector.

---

## 11. Notifications

### US-11.1 - Notification summary stat cards

>**As** a user, <br>
>**I want** to see a summary of my unread notifications categorised by type, <br>
>**so that** I can quickly prioritise what needs my attention.

**Acceptance Criteria:**

- 5 summary cards at the top: Unread (total), Dispatch Alerts, Trade Events, System, Account.

- Each card shows a count and short description.

- Active/selected card is visually highlighted.

- Clicking a card filters the notification list to that category.

---

### US-11.2 - Notification Center feed

>**As** a user, <br>
>**I want** to browse all my notifications in a scrollable feed with category tabs, <br>
>**so that** I can see all events relevant to my account in one place.

**Acceptance Criteria:**

- "Notification Center" heading with subtitle "Latest events from your energy trading account".

- "Mark all as read" button marks all visible notifications as read.

- Tab filters: All, Unread, Trades, Account, System.

- Each notification row shows: icon, title, description, timestamp (relative e.g. "2 min ago"), and category badge (Dispatch, Trades, System, Account).

- Unread notifications have a blue dot indicator.

- Notification types seen in designs: Dispatch command executing, Trade matched successfully, EV charging command completed, Utility connection pending, KYC review reminder.

---

### US-11.3 - Notification Preferences panel

>**As** a user, <br>
>**I want** to control which types of notifications I receive, <br>
>**so that** I only get alerts that are relevant to me.

**Acceptance Criteria:**

- "Notification Preferences" panel on the right side.

- 4 toggle switches: Trade confirmations (on by default), Dispatch status (off), Wallet changes (on), Marketing updates (off).

- Each toggle has a label and short description.

- "Save Changes" button saves the updated preferences.

---

### US-11.4 - Delivery Channels panel

>**As** a user, <br>
>**I want** to choose how high-priority notifications are delivered to me, <br>
>**so that** I receive critical alerts through my preferred channels.

**Acceptance Criteria:**

- "Delivery Channels" panel below Notification Preferences.

- 3 toggle options: In-app notifications (always enabled, toggle disabled), Email alerts (toggleable), SMS fallback (toggleable).

- Each option has a label and short description.

- Changes saved via the same "Save Changes" button.

---

## 12. Profile

### US-12.1 - Personal information form

>**As** a user, <br>
>**I want** to view and update my personal profile information, <br>
>**so that** my account details are accurate.

**Acceptance Criteria:**

- Form fields: Full Name, Email Address, Phone Number (with country code dropdown), Country/Region (dropdown).

- "Save Changes" button submits the updated profile.

- Success/error feedback shown after saving.

- User avatar/initials shown with online status indicator.

- Role label shown below name (e.g. "Prosumer · Individual Account").

---

### US-12.2 - Security panel

>**As** a user, <br>
>**I want** to update my account password from the Profile page, <br>
>**so that** I can maintain account security.

**Acceptance Criteria:**

- "Security" panel shows: Current Password, New Password, Confirm Password fields.

- "Update password" button submits the password change.

- Error shown if current password is incorrect.

- Error shown if new password and confirm password do not match.

---

### US-12.3 - Account Status panel

>**As** a user, <br>
>**I want** to see my current account status (Trading Mode, KYC, Smart Meter) on my Profile page, <br>
>**so that** I know which features I have access to and what actions are pending.

**Acceptance Criteria:**

- 3 status rows: Trading Mode (Prosumer/Consumer label), KYC status (Not submitted / Pending / Verified), Smart meter (Pending / Connected).

- Each row has a colour-coded status dot.

- Short description next to each status (e.g. "Optional but increases limits", "Connection request not approved yet").

---

### US-12.4 - Trading Preferences panel

>**As** a user, <br>
>**I want** to set my default trading preferences, <br>
>**so that** the Trading Terminal pre-fills my preferred settings automatically.

**Acceptance Criteria:**

- Fields: Default Order Type (dropdown), Default Price Mode (dropdown), Monthly Energy Limit (kWh input), Max Trade Value (RM input).

- Toggle: "Auto-recommend sell price" - suggests price based on live order book depth.

- Toggle: "Allow dispatch automation" - lets GridX optimise battery/EV usage within limits.

- Changes saved via the Trading Preferences form.

---

### US-12.5 - Integrations panel

>**As** a user, <br>
>**I want** to view and manage third-party integrations connected to my account, <br>
>**so that** I can control which external services have access to my GridX data.

**Acceptance Criteria:**

- "Integrations" panel lists 3 integration rows: Utility Smart Meter API, Email delivery, Payment rail.

- Each row shows: integration name, description/status, connection status badge (Pending approval / Connected / Not connected), and action button (Retry request / Manage / Connect).

- "Save settings" button visible at the bottom.

---

## 13. Global / Layout

### US-13.1 - Sidebar navigation

>**As** a logged-in user, <br>
>**I want** to navigate between pages using a persistent sidebar, <br>
>**so that** I can access any section of the app from anywhere.

**Acceptance Criteria:**

- Sidebar visible on all authenticated pages.

- Navigation groups: (unlabelled - GridX logo/branding), TRADING (Energy Assets, Trading Terminal, Wallet, Trade History), PROFILE (Notifications, Profile, Settings).

- Active page is highlighted in the sidebar.

- User avatar, name, and email shown at the bottom of the sidebar.

- Sidebar collapses or hides on mobile.

---

### US-13.2 - Top navigation bar

>**As** a logged-in user, <br>
>**I want** to see a persistent top bar with page title, search, and notification bell, <br>
>**so that** I can quickly search and access notifications from any page.

**Acceptance Criteria:**

- Page title and subtitle displayed in the top left of the content area.

- Global search input with placeholder "Search..." visible in the top right.

- Notification bell icon with unread badge count visible.

- User avatar and name visible in the top right (Dashboard design shows name + role).

---

### US-13.3 - Dark mode support

>**As** a user, <br>
>**I want** the web dashboard to be available in dark mode, <br>
>**so that** I can use the platform comfortably in low-light environments.

**Acceptance Criteria:**

- Dark mode is the default theme as shown in all Figma designs.

- All pages render correctly with dark background, appropriate text contrast, and correct colour coding (green for positive, red for negative, orange for solar data).

- Light mode variant is available as an alternative (white mode designs confirmed to exist).

---

### US-13.4 - Responsive layout

>**As** a user on a smaller screen, <br>
>**I want** the dashboard to remain usable on different screen sizes, <br>
>**so that** I can access my trading information on various devices.

**Acceptance Criteria:**

- Layout adapts to desktop, tablet, and mobile viewport widths.

- Sidebar collapses to a hamburger menu on mobile.

- KPI cards stack vertically on mobile.

- Charts remain readable on smaller screens.

- Trading Terminal order panel is accessible on mobile (may be stacked below the chart).

---

## Summary Table

| ID | Story | Page |
|---|---|---|
| US-1.1 | Landing page hero section | Landing |
| US-1.2 | Features section | Landing |
| US-1.3 | How it works section | Landing |
| US-1.4 | Platform features grid | Landing |
| US-1.5 | User persona section | Landing |
| US-1.6 | FAQ section | Landing |
| US-1.7 | Footer and final CTA | Landing |
| US-2.1 | Sign in form | Sign In |
| US-2.2 | Sign in marketing panel | Sign In |
| US-2.3 | Navigation to registration | Sign In |
| US-3.1 | Create account (Step 1) | Register |
| US-3.2 | Verify email (OTP) | Register |
| US-3.3 | KYC identity verification (Step 2) | Register |
| US-3.4 | Connect smart meter (Step 3) | Register |
| US-4.1 | Dashboard KPI summary cards | Dashboard |
| US-4.2 | Asset Fleet panel | Dashboard |
| US-4.3 | Active Dispatches panel | Dashboard |
| US-4.4 | Generation vs Consumption chart | Dashboard |
| US-4.5 | Trading Activity panel | Dashboard |
| US-4.6 | Recent Trades section | Dashboard |
| US-5.1 | Energy Assets stat bar | Energy Assets |
| US-5.2 | Generation/Devices tab toggle | Energy Assets |
| US-5.3 | Solar Generation Today line chart | Energy Assets |
| US-5.4 | Energy Generation bar chart | Energy Assets |
| US-5.5 | Production vs Consumption donut | Energy Assets |
| US-5.6 | Active Alerts panel | Energy Assets |
| US-5.7 | Today's Summary panel | Energy Assets |
| US-6.1 | Device cards grid | Energy Devices |
| US-6.2 | Solar Generation chart (Devices tab) | Energy Devices |
| US-6.3 | Battery & EV Status panel | Energy Devices |
| US-7.1 | Live price ticker bar | Trading Terminal |
| US-7.2 | Candlestick price chart | Trading Terminal |
| US-7.3 | Order Book | Trading Terminal |
| US-7.4 | Buy order panel | Trading Terminal |
| US-7.5 | Buy/Sell tab toggle | Trading Terminal |
| US-8.1 | Sell order panel | Trading Terminal |
| US-9.1 | Wallet summary bar | Wallet |
| US-9.2 | Revenue Analytics chart | Wallet |
| US-9.3 | Monthly Income Summary chart | Wallet |
| US-9.4 | Transaction History table | Wallet |
| US-10.1 | Trade History KPI cards | Trade History |
| US-10.2 | Trading Performance chart | Trade History |
| US-10.3 | Trade History table with filters | Trade History |
| US-11.1 | Notification summary stat cards | Notifications |
| US-11.2 | Notification Center feed | Notifications |
| US-11.3 | Notification Preferences panel | Notifications |
| US-11.4 | Delivery Channels panel | Notifications |
| US-12.1 | Personal information form | Profile |
| US-12.2 | Security panel | Profile |
| US-12.3 | Account Status panel | Profile |
| US-12.4 | Trading Preferences panel | Profile |
| US-12.5 | Integrations panel | Profile |
| US-13.1 | Sidebar navigation | Global |
| US-13.2 | Top navigation bar | Global |
| US-13.3 | Dark mode support | Global |
| US-13.4 | Responsive layout | Global |

---
