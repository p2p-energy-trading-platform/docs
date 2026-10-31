---
connie-title: Billing Service - gRPC API Contract
---

# 03 – gRPC API Contract

Proto files should be created in `protobuf` repo under package `billing.v1`.

## Conventions

- All amounts: `int64` minor units. All IDs: UUID strings.
- Every mutating RPC carries an `idempotency_key` (or a natural unique ID like `order_id` / `trade_id`).
- Errors use gRPC status codes + a typed `ErrorInfo` reason (see bottom).
- Deadlines are mandatory on callers (suggest 2s for reserve, 3s for settle).


**NOTE**: All pagination types are just examples in this protobuf definitions. Actual pagination must be confirmed in our private group. Ask mani or keeththi before assuming incorrect stuff. Also check what is on the frontend demo ui too.

## OrderBillingService (caller: Order Management only)

```proto
service OrderBillingService {
  // Lock credits for a buy order. Idempotent on order_id.
  rpc ReserveCredits(ReserveCreditsRequest) returns (ReserveCreditsResponse);
  // Change the locked amount (order amended / price improved).
  rpc AdjustReservation(AdjustReservationRequest) returns (AdjustReservationResponse);
  // Release whatever is left (order cancelled / expired / fully filled).
  rpc ReleaseReservation(ReleaseReservationRequest) returns (ReleaseReservationResponse);
  // Settle one matched trade. Idempotent on trade_id.
  rpc SettleTrade(SettleTradeRequest) returns (SettleTradeResponse);
  // Optional later: settle many trades from one matching round in one DB tx.
  rpc SettleTrades(SettleTradesRequest) returns (SettleTradesResponse);
}

enum OrderType { ORDER_TYPE_UNSPECIFIED = 0; LIMIT = 1; MARKET = 2; }

message ReserveCreditsRequest {
  string user_id = 1;
  string order_id = 2;           // idempotency key
  OrderType order_type = 3;
  int64  qty_wh = 4;             // order quantity
  // LIMIT:  the order's limit price.
  // MARKET: the price collar, i.e. the worst price the buyer accepts. REQUIRED, set by OMS.
  // The matching engine must never fill the order above this price.
  int64  max_price_per_kwh = 5;
  // Billing computes amount = trade value at max_price + buyer fee (locked rate) + rounding buffer.
  // OMS does not compute money.
  google.protobuf.Timestamp expires_at = 6;   // optional safety-net expiry
}

message ReserveCreditsResponse {
  string hold_id = 1;
  int64  reserved_amount = 2;
  int64  available_after = 3;
}

message AdjustReservationRequest {
  string order_id = 1;
  string idempotency_key = 2;
  int64  new_qty_wh = 3;              // remaining quantity after amendment
  int64  new_max_price_per_kwh = 4;
}

message ReleaseReservationRequest {
  string order_id = 1;
  string reason = 2;             // CANCELLED | EXPIRED | FILLED | REJECTED
}
message ReleaseReservationResponse {
  int64 released_amount = 1;     // 0 if already released (idempotent)
}

message SettleTradeRequest {
  string trade_id = 1;           // idempotency key
  string buy_order_id = 2;
  string sell_order_id = 3;
  string buyer_user_id = 4;
  string seller_user_id = 5;
  int64  qty_wh = 6;
  int64  price_per_kwh = 7;      // execution price
  bool   buy_order_final = 8;    // true: release leftover hold in same tx
  google.protobuf.Timestamp executed_at = 9;
}
message SettleTradeResponse {
  string settlement_id = 1;
  int64  trade_value = 2;
  int64  buyer_fee = 3;
  int64  seller_fee = 4;
  int64  buyer_released_remainder = 5;
  bool   already_settled = 6;    // true on idempotent replay
}
```

Notes:
- **Billing computes all money** (value, fee, reservation size) from qty and price, so OMS can't drift from billing's rounding rules.
- `SettleTrade` takes `trade_id` as the idempotency key and returns the original result on replay.
- Billing rejects a fill whose `price_per_kwh` exceeds the hold's `max_price_per_kwh` (`PRICE_EXCEEDS_RESERVATION`). This is the safety net for market buys.
- Sell orders (limit or market) need **no reservation**: the seller fee is deducted from proceeds. OMS only calls `ReserveCredits` for buys.
- If you later add sell-side reservations (e.g. seller fee must be prepaid), add `ReserveCredits` for sell orders without changing the shape.

## WalletService (caller: API Gateway only)

```proto
service WalletService {
  rpc GetWallet(GetWalletRequest) returns (Wallet);
  rpc ListTransactions(ListTransactionsRequest) returns (ListTransactionsResponse); // cursor pagination

  rpc CreateDepositIntent(CreateDepositIntentRequest) returns (DepositIntent);
  // Gateway relays the Stripe webhook: raw body bytes + headers (incl. Stripe-Signature), untouched.
  // Billing verifies the signature with the endpoint secret.
  rpc ConfirmDeposit(ConfirmDepositRequest) returns (ConfirmDepositResponse);
  rpc GetDeposit(GetDepositRequest) returns (DepositIntent);

  rpc RequestWithdrawal(RequestWithdrawalRequest) returns (Withdrawal);
  rpc CancelWithdrawal(CancelWithdrawalRequest) returns (Withdrawal);
  rpc ListWithdrawals(ListWithdrawalsRequest) returns (ListWithdrawalsResponse);
}

message Wallet {
  string wallet_id = 1;
  string user_id = 2;
  int64  available = 3;
  int64  reserved = 4;
  int64  total = 5;
  string status = 6;
  google.protobuf.Timestamp updated_at = 7;
}

message CreateDepositIntentRequest {
  string idempotency_key = 1;    // client-generated; also used as the Stripe Idempotency-Key base
  int64  amount = 2;             // credits wanted (minor units)
  string success_url = 3;        // gateway must validate against an allowlist
  string cancel_url = 4;
}
message DepositIntent {
  string deposit_id = 1;
  string status = 2;
  string checkout_url = 3;       // Stripe-hosted Checkout page; frontend redirects here
  int64  amount = 4;
  string charge_currency = 5;
  int64  charge_amount = 6;
  google.protobuf.Timestamp expires_at = 7;
}
message ConfirmDepositRequest {
  bytes raw_body = 1;                 // exact bytes received from Stripe; never re-serialised
  map<string, string> headers = 2;    // must include Stripe-Signature
}
```

## AdminBillingService (caller: API Gateway, admin role only)

**NOTE**: There is no plan or confirmation that we will definitely build admin service. It is just a nice to have if we have enough time.

```proto
service AdminBillingService {
  rpc ApproveWithdrawal(ApproveWithdrawalRequest) returns (Withdrawal);
  rpc RejectWithdrawal(RejectWithdrawalRequest) returns (Withdrawal);
  rpc MarkWithdrawalPaid(MarkWithdrawalPaidRequest) returns (Withdrawal);
  rpc SetFeeConfig(SetFeeConfigRequest) returns (FeeConfig);
  rpc GetPlatformRevenue(GetPlatformRevenueRequest) returns (PlatformRevenue);
  rpc FreezeWallet(FreezeWalletRequest) returns (Wallet);
}
```
The gateway must verify the admin role from the JWT and billing additionally requires `x-user-role: admin` metadata and logs `reviewed_by`.

## Error reasons

| gRPC code | Reason | When |
|---|---|---|
| `FAILED_PRECONDITION` | `INSUFFICIENT_FUNDS` | Reserve/withdraw exceeds available |
| `FAILED_PRECONDITION` | `WALLET_FROZEN` | Wallet not ACTIVE |
| `NOT_FOUND` | `HOLD_NOT_FOUND` | Adjust/release/settle with unknown order |
| `FAILED_PRECONDITION` | `HOLD_INSUFFICIENT_REMAINING` | Settle needs more than hold remaining |
| `ALREADY_EXISTS` | `IDEMPOTENCY_CONFLICT` | Same key, different payload |
| `INVALID_ARGUMENT` | `BAD_AMOUNT` | Non-positive qty/price, overflow |
| `INVALID_ARGUMENT` | `MARKET_ORDER_NEEDS_COLLAR` | Market buy without `max_price_per_kwh` |
| `FAILED_PRECONDITION` | `PRICE_EXCEEDS_RESERVATION` | Fill price above the hold's max price |
| `INVALID_ARGUMENT` | `WEBHOOK_SIGNATURE_INVALID` | Bad or stale `Stripe-Signature` |
| `PERMISSION_DENIED` | `CALLER_NOT_ALLOWED` | Allowlist violation |
| `ABORTED` | `RETRYABLE_CONTENTION` | Serialization failure / deadlock after retries |
| `UNAVAILABLE` | n/a | DB down; callers retry with backoff |

**Replay semantics:** a retried request with the same key and same payload returns the original success response, never an error.