# Andar Bahar Backend

Real-time Andar Bahar game backend: **WebSocket** server + **Supabase/Postgres**.

## Features
- Register / Login with **10-digit mobile number + password**
- **₹10,000 INR sign-up bonus** auto-credited on registration (ledger entry)
- **Transaction ledger** — every signup bonus / bet / win / refund recorded with running balance
- Game API with a fixed **30s round loop**: **15s betting** → **10s result + card/coin animation** → **5s reset**
- Result rules (per official game rules): Joker card opened in center; cards dealt alternately starting **Andar**; matching card ends the round → **Andar wins**, or **TIE** when counts are equal (Andar/Bahar bets **refunded**, TIE pays **8.2x**)
- Full client integration docs — see [docs/API.md](docs/API.md)

## Setup

```bash
cd backend
npm install
```

1. **Create the Supabase tables** — run `sql/schema.sql` and `sql/functions.sql`
   in the Supabase SQL Editor **or** run the included migration script that executes
   them over the direct Postgres connection:

   ```bash
   node migrate.mjs
   ```

2. **Configure** — edit `.env`:
   - `DATABASE_URL` — Postgres connection string (used for all DB work)
   - `SUPABASE_URL` — https URL for the REST Auth API (login only)
   - `SUPABASE_PUBLISHABLE_KEY` — `sb_publishable_...` key (login only)
   - `SUPABASE_SECRET_KEY` — optional; only needed if you later use admin REST APIs
   - `JWT_SECRET` — any long random string (signs game session tokens)

## Run

```bash
npm start          # production
npm run dev        # auto-restart on file change
```

Server listens on `ws://0.0.0.0:8080`.

## Architecture note

All privileged DB work (register user, betting, ledger, settlement) goes through the
direct Postgres connection (`DATABASE_URL`). The Supabase REST API / publishable key is
used **only** for password-based login through the standard Auth endpoint, so you do not
need the secret key to run the game server.

## Tests

```bash
node test/betflow.mjs   # register -> bet -> result -> ledger/balance
node test/tietest.mjs   # verifies 8.2x tie payout + refund path
node test/listen2.mjs   # watches live round broadcasts
```

## Structure

```
backend/
  src/
    index.js      # entry point: boots engine + WS server
    config.js     # .env loader
    db.js         # Postgres pool (primary data layer)
    supabase.js   # Supabase REST client (login only)
    auth.js       # register / login / game token signing
    ledger.js     # balance + transaction ledger
    game.js       # game engine: deck, 30s timer, result, settlement
    ws.js         # WebSocket protocol handlers + broadcasts
  sql/
    schema.sql    # tables, indices, RLS
    functions.sql # create_game_user, place_bet, settle, refund (atomic)
  docs/
    API.md        # user-side integration docs
  test/           # end-to-end tests
  .env            # credentials (edit!)
```