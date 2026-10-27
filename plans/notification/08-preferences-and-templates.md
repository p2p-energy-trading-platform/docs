---
connie-title: Notification Service - Preferences and Templates
---

# Preferences and Templates

## 1. Categories

Users manage preferences per **category**, not per notification type. This keeps the settings screen short and understandable.

| Category | Types | Can be turned off? |
|---|---|---|
| `security` | `account.*` | **No.** Mandatory transactional messages |
| `trading` | `trade.*`, `order.*` | Yes |
| `device_alerts` | `device.*` | Yes |
| `market_alerts` | `grid.fee_changed`, future price alerts | Yes |
| `product_news` | Future announcements | Yes, and **off by default** (opt-in) |

## 2. Default channel matrix

| Category | In-app | Push | Email |
|---|---|---|---|
| `security` | on (locked) | on (locked) | on (locked) |
| `trading` | on | on | off |
| `device_alerts` | on | on | on |
| `market_alerts` | on | off | off |
| `product_news` | off | off | off |

Exceptions defined per type in code:

- `order.placed`: in-app only (the user just did it).
- `order.partially_filled`: no email even if trading email is on (too frequent).

Defaults live in code (`src/features/preferences/defaults.ts`). The database stores only user overrides.

## 3. Effective preference rule

```text
channel enabled for (user, type) =
    type.mandatory
    OR (
        user override for (category, channel) exists ? override.enabled : default(category, channel)
    )
    AND channel allowed for type
```

Extra checks at delivery time (not preference, but can still skip a channel):

- Push: user has at least one active token, and not in quiet hours (non-security).
- Email: address is verified and not suppressed.

## 4. Settings screen (web and mobile)

```text
Notifications

                        In-app   Push   Email
Account & security        ✓       ✓      ✓     (always on)
Trades & orders           ✓       ✓      ☐
Smart meter alerts        ✓       ✓      ✓
Market & grid updates     ✓       ☐      ☐
News & updates            ☐       ☐      ☐

Quiet hours (push)       [ 22:00 ] to [ 07:00 ]
Time zone                [ Asia/Dubai ]
```

If the OS push permission is denied, the Push column shows "Turn on notifications in phone settings" with a link to the OS settings.

## 5. Templates

### Structure

```text
src/templates/
├── registry.ts
├── format.ts
├── types/
│   ├── trade-sold.ts
│   ├── trade-bought.ts
│   ├── order-filled.ts
│   └── ...
└── email/
    ├── layout.tsx
    ├── trade-sold.tsx
    └── ...
```

### Template definition

```ts
export const tradeSold = defineNotificationType({
  type: 'trade.sold',
  category: 'trading',
  priority: 50,
  push: { ttlSeconds: 3600, channelId: 'trading', groupKey: (d) => `order:${d.sellOrderId}` },
  schema: z.object({
    tradeId: z.string(),
    sellOrderId: z.string(),
    quantityWh: z.number(),
    priceFilsPerKwh: z.number(),
  }),
  inApp: (d, f) => ({
    title: 'Energy sold',
    body: `You sold ${f.energy(d.quantityWh)} at ${f.pricePerKwh(d.priceFilsPerKwh)}`,
    actionUrl: `/trades/${d.tradeId}`,
  }),
  push: (d, f) => ({
    title: 'Energy sold',
    body: `${f.energy(d.quantityWh)} sold at ${f.pricePerKwh(d.priceFilsPerKwh)}`,
    url: `gridx://trades/${d.tradeId}`,
  }),
  email: { subject: (d, f) => `You sold ${f.energy(d.quantityWh)}`, component: TradeSoldEmail },
});
```

Rules:

- Each type has a **zod schema** for its data. Bad data fails in tests, not in production.
- Formatting uses `Intl.NumberFormat` and `Intl.DateTimeFormat` with the user's locale and time zone. Never hard-code currency symbols or date formats.
- Text is written in English first. Strings are kept in the template files so they can move to i18n message files (e.g. Arabic) later without changing handlers.
- Every type must have a unit test that renders all channels with sample data.
