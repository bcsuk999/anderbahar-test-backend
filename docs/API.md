# Andar Bahar — User Side API Documentation

Real-time game backend over **WebSocket** with **Supabase** storage and auth.

```
Server URL: ws://<your-server-host>:8080
Protocol:   JSON messages over WebSocket (single connection)
```

Round timer (fixed, 30 seconds total per round):

| Phase     | Duration | Description                                      |
|-----------|----------|--------------------------------------------------|
| `betting` | 15s      | Players place bets on Andar / Bahar / Tie        |
| `result`  | 10s      | Cards dealt, Joker + match revealed, coins/anim  |
| `reset`   | 5s       | Table cleared, next round prepared               |

Pay-out multipliers:
- **Andar** → 1.9x
- **Bahar** → 1.9x
- **Tie**   → 8.2x

---

## Table of Contents

1. [Connection](#1-connection)
2. [Register](#2-register)
3. [Login](#3-login)
4. [Balance](#4-balance)
5. [Ledger (transactions)](#5-ledger-transactions)
6. [Subscribe to game state](#6-subscribe-to-game-state)
7. [Place a bet](#7-place-a-bet)
8. [Server-pushed events](#8-server-pushed-events)
9. [Error format](#9-error-format)
10. [Example round flow](#10-example-round-flow)

---

## 1. Connection

Open a WebSocket connection:

```js
const ws = new WebSocket('ws://your-server-host:8080');
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

Server replies immediately:

```json
{
  "ok": true,
  "type": "connected",
  "service": "andar-bahar"
}
```

The same WebSocket is used for **auth**, **data**, and **live game push**. No separate
authentication header needed — the server keeps your session per-connection.

---

## 2. Register

Create an account with a **10-digit mobile number** and password. After success, **₹10,000
sign-up bonus is auto-credited** to the player's wallet.

Send:

```json
{
  "type": "register",
  "mobile": "9876543210",
  "password": "secret123",
  "username": "Raju"
}
```

Response:

```json
{
  "type": "register",
  "ok": true,
  "token": "<session-token>",
  "user": {
    "id": "uuid",
    "mobile": "9876543210",
    "username": "Raju",
    "balance": 10000,
    "signupBonus": 10000
  }
}
```

Notes:
- `mobile` — must be a valid Indian 10-digit number (starts with 6–9).
- `password` — min 6 characters.
- `token` — keep it, you can re-authenticate with it later (see `auth_token`).
- Balance starts at **₹10,000** (sign-up bonus).

---

## 3. Login

Send:

```json
{
  "type": "login",
  "mobile": "9876543210",
  "password": "secret123"
}
```

Response:

```json
{
  "type": "login",
  "ok": true,
  "token": "<session-token>",
  "user": {
    "id": "uuid",
    "mobile": "9876543210",
    "username": "Raju",
    "balance": 12450
  }
}
```

Error: `{ "ok": false, "message": "Invalid mobile number or password" }`

### Re-authenticate with token (optional)

```json
{ "type": "auth_token", "token": "<token>" }
```

```json
{ "type": "auth_token", "ok": true, "userId": "uuid" }
```

---

## 4. Balance

Get the player's current wallet balance and available chip values.

Send:

```json
{ "type": "balance" }
```

Response:

```json
{
  "type": "balance",
  "ok": true,
  "balance": 12450,
  "chipValues": [100, 500, 1000, 5000, 10000]
}
```

---

## 5. Ledger (transactions)

Player's transaction history — deposits, sign-up bonus, bets placed, winnings, refunds.
Newest first.

Send:

```json
{
  "type": "ledger",
  "limit": 25,
  "offset": 0
}
```

Response:

```json
{
  "type": "ledger",
  "ok": true,
  "transactions": [
    {
      "id": 104,
      "type": "bet_win",
      "amount": 1900,
      "balance": 12450,
      "ref_type": "round",
      "ref_id": "AB-20260927-0007",
      "note": "win",
      "created_at": "2026-09-27T16:20:11.817Z"
    },
    {
      "id": 103,
      "type": "bet_placed",
      "amount": -1000,
      "balance": 10550,
      "ref_type": "round",
      "ref_id": "AB-20260927-0007",
      "note": "andar",
      "created_at": "2026-09-27T16:19:40.102Z"
    },
    {
      "id": 1,
      "type": "signup_bonus",
      "amount": 10000,
      "balance": 10000,
      "ref_type": "manual",
      "note": "Welcome bonus",
      "created_at": "..."
    }
  ]
}
```

`type` values: `signup_bonus`, `bet_placed`, `bet_win`, `bet_loss`, `withdrawal`, `deposit`, `refund`.
`amount` is signed — positive = credit, negative = debit. `balance` is the balance *after* the transaction.

---

## 6. Subscribe to game state

Request the current table snapshot (no auth required for viewing):

Send:

```json
{ "type": "game_state" }
```

Response:

```json
{
  "type": "game_state",
  "ok": true,
  "state": {
    "service": "andar-bahar",
    "type": "state",
    "roundId": "AB-20260927-0007",
    "roundNumber": 7,
    "phase": "betting",
    "phaseSeconds": 30,
    "remainingSeconds": 12,
    "bettingTime": 15,
    "resultTime": 10,
    "resetTime": 5,
    "joker": null,
    "winner": null,
    "winningRank": null,
    "dealtCards": [],
    "andarCards": 0,
    "baharCards": 0,
    "serverTime": "2026-09-27T16:19:44.000Z",
    "nextRoundAt": null
  }
}
```

Also use this on reconnect to re-sync the clock.

---

## 7. Place a bet

Only allowed during the `betting` phase (first 15s of the round).

Send:

```json
{
  "type": "bet",
  "option": "andar",
  "amount": 1000
}
```

`option`: `"andar"` | `"bahar"` | `"tie"`.

Success response:

```json
{
  "type": "bet",
  "ok": true,
  "bet": {
    "id": 5122,
    "roundId": "AB-20260927-0007",
    "option": "andar",
    "amount": 1000,
    "multiplier": 1.9,
    "status": "pending"
  },
  "balance": 10550
}
```

Errors:
- `{ "ok": false, "message": "Bets closed - waiting for next round" }` — phase is not `betting`.
- `{ "ok": false, "message": "insufficient_balance" }`.
- Bet amount is deducted immediately from the wallet; credited back with winnings on resolution.

---

## 8. Server-pushed events

During each round the server pushes state automatically. No need to poll `game_state`.

### `round_started` — betting phase begins

```json
{
  "type": "round_started",
  "roundId": "AB-20260927-0007",
  "roundNumber": 7,
  "phase": "betting",
  "remainingSeconds": 15,
  "bettingTime": 15,
  "resultTime": 10,
  "resetTime": 5,
  "joker": null,
  "serverTime": "2026-09-27T16:19:30.000Z"
}
```

### `result` — round resolved

```json
{
  "type": "result",
  "roundId": "AB-20260927-0007",
  "phase": "result",
  "joker": "7S",
  "winner": "andar",
  "winningRank": "7",
  "dealtCards": ["7S", "3H", "KD", "9S", "JC", "7C", "4S", "7D"],
  "andarCards": 8,
  "baharCards": 0,
  "remainingSeconds": 10,
  "serverTime": "2026-09-27T16:19:45.000Z"
}
```

The client should run the 10s **result/animation phase** here — reveal joker, deal cards
one by one (Andar ↔ Bahar alternating), show winning side + coin animation.

### `reset` — table clearing

```json
{
  "type": "reset",
  "roundId": "AB-20260927-0007",
  "phase": "reset",
  "remainingSeconds": 5,
  "nextRoundAt": "2026-09-27T16:20:20.000Z",
  "serverTime": "2026-09-27T16:19:55.000Z"
}
```

After 5s the server broadcasts the next `round_started`. The loop repeats forever.

### `bet_placed` — (used for multi-player table view)

```json
{
  "type": "bet_placed",
  "roundId": "AB-20260927-0007",
  "userId": "uuid",
  "option": "andar",
  "amount": 500
}
```

---

## 9. Error format

Every error is a JSON object with `ok: false`:

```json
{ "type": "bet", "ok": false, "message": "Bets closed - waiting for next round" }
```

`type` → `"invalid_json"` if the raw frame is not valid JSON, `"unknown_type"` if the
`type` field is unrecognized, `"not_authenticated"` for protected messages without login.

---

## 10. Example round flow

```
ws connect                     → { type: "connected" }
ws send  login                 → { type: "login", ok, token, user{balance} }
          { type: "game_state" }  → current phase/timer
(server) push round_started    → { type: "round_started", phase:"betting", remaining:15 }
ws send  { type:"bet", option:"bahar", amount:1000 } → { type:"bet", ok, balance }
(server) push result           → { type:"result", joker:"7S", winner:"bahar", dealtCards:[...] }
          client plays 10s result animation (cards + coins)
(server) push reset            → { type:"reset", remaining:5 }
          client clears table
(server) push round_started    → next round begins (loop forever)
```

---

## Quick reference

| Send type        | Requires login | Reply                                         |
|------------------|----------------|-----------------------------------------------|
| `register`       | no             | bonus credited + token + profile              |
| `login`          | no             | token + profile                               |
| `auth_token`     | no             | userId                                        |
| `balance`        | yes            | balance + chipValues                          |
| `ledger`         | yes            | transaction history                           |
| `bet`            | yes            | bet confirmation + new balance                |
| `game_state`     | no             | full table state snapshot                     |

## Environment variables

Copy `.env` values from the Supabase dashboard. Required keys:

```
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_JWKS_URL=https://.../auth/v1/.well-known/jwks.json
JWT_SECRET=<random long string>
```