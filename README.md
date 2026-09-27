# Andar Bahar Backend

Real-time Andar Bahar game backend: **WebSocket** server + **Supabase** (auth, ledger, rounds, bets).

## Features
- Register / Login with **10-digit mobile number + password** (Supabase Auth, phone + "+91")
- **₹10,000 INR sign-up bonus** auto-credited on registration (ledger entry)
- **Transaction ledger** — every bet/win/bonus recorded with running balance
- Game API with a fixed **30s round loop**: **15s betting** → **10s result + card/coin animation** → **5s reset**
- Fully documented for client integration — see [docs/API.md](docs/API.md)

## Setup

```bash
cd backend
npm install
```

1. **Create the Supabase tables** — open `sql/schema.sql` and run it in the Supabase SQL Editor.
2. **Create the server functions** — run `sql/functions.sql` in the SQL Editor too.
3. **Configure keys** — edit `.env`:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY` (service/secret key)
   - `SUPABASE_JWKS_URL`
   - `JWT_SECRET` (any long random string for game tokens)

> Your secret key is masked in `.env` (`sb_secret_dJ2-FPLACEHOLDER`) — replace it with the real value from Supabase Dashboard → Settings → API Keys.

## Run

```bash
npm start          # production
npm run dev        # auto-restart on file change
```

Server starts on `ws://0.0.0.0:8080`.

## Structure

```
backend/
  src/
    index.js      # entry point, boots engine + WS server
    config.js     # env loader / config
    supabase.js   # Supabase clients (service + public)
    auth.js       # register / login / token signing
    ledger.js     # balance + transaction ledger
    game.js       # game engine: deck, timer, result, settle
    ws.js         # WebSocket protocol handlers
  sql/
    schema.sql    # tables, indices, RLS, bonus function
    functions.sql # place_bet / settle_bet / refund_bet (atomic)
  docs/
    API.md        # user-side integration docs
  .env            # credentials (edit!)
```