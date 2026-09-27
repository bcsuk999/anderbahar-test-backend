import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { pool } from './db.js';
import { register, login, verifyGameToken } from './auth.js';
import { getLedger, getBalance } from './ledger.js';

/** Create and start the WebSocket server, wiring message handlers to the game engine. */
export function createWSServer({ game }) {
  const wss = new WebSocketServer({ host: config.host, port: config.port });
  const clients = new Map(); // ws -> { userId }

  wss.on('connection', (ws) => {
    clients.set(ws, { userId: null });

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, { ok: false, error: 'invalid_json' });
        return;
      }

      try {
        await handleMessage(ws, msg, clients, game);
      } catch (e) {
        console.error('handler error:', e.message);
        send(ws, { id: msg.id, type: msg.type, ok: false, error: 'server_error', message: e.message });
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });

    send(ws, { ok: true, type: 'connected', service: 'andar-bahar' });
  });

  // Push game state broadcasts to every connected client.
  game.on('broadcast', (payload) => {
    for (const [ws] of clients) {
      if (ws.readyState === 1) send(ws, payload);
    }
  });

  return {
    wss,
    broadcast: (obj) => {
      for (const [ws] of clients) if (ws.readyState === 1) send(ws, obj);
    },
  };
}

async function handleMessage(ws, msg, clients, game) {
  const type = msg.type;
  const id = msg.id;
  const ctx = clients.get(ws);
  const respond = (obj) => send(ws, { id, ...obj });

  switch (type) {
    // ---------- AUTH ----------
    case 'register':
    case 'REGISTER': {
      const { mobile, password, username } = msg;
      const res = await register(mobile, password, username);
      if (res.ok) ctx.userId = res.user.id;
      respond({ type, ...res });
      break;
    }

    case 'login':
    case 'LOGIN': {
      const { mobile, password } = msg;
      const res = await login(mobile, password);
      if (res.ok) ctx.userId = res.user.id;
      respond({ type, ...res });
      break;
    }

    case 'auth_token': {
      const userId = verifyGameToken(msg.token);
      if (!userId) {
        respond({ type, ok: false, message: 'invalid_token' });
      } else {
        ctx.userId = userId;
        respond({ type, ok: true, userId });
      }
      break;
    }

    // ---------- PROTECTED ----------
    case 'ledger': {
      const u = requireAuth(ctx);
      if (!u) return respond({ type, ok: false, message: 'not_authenticated' });
      const res = await getLedger(u, { limit: msg.limit || 50, offset: msg.offset || 0 });
      respond({ type, ...res });
      break;
    }

    case 'balance': {
      const u = requireAuth(ctx);
      if (!u) return respond({ type, ok: false, message: 'not_authenticated' });
      const res = await getBalance(u);
      respond({ type, ...res });
      break;
    }

    case 'bet': {
      const u = requireAuth(ctx);
      if (!u) return respond({ type, ok: false, message: 'not_authenticated' });
      await placeBet(ws, u, msg, respond, game);
      break;
    }

    case 'game_state': {
      respond({ type, ok: true, state: game.snapshot() });
      break;
    }

    default:
      respond({ type, ok: false, error: 'unknown_type' });
  }
}

async function placeBet(ws, userId, msg, respond, game) {
  if (game.phase !== 'betting') {
    return respond({ type: 'bet', ok: false, message: 'Bets closed - waiting for next round' });
  }

  const option = msg.option;
  const amount = Number(msg.amount);
  const roundId = game.round.roundId;

  if (!['andar', 'bahar', 'tie'].includes(option)) {
    return respond({ type: 'bet', ok: false, message: 'Option must be andar|bahar|tie' });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return respond({ type: 'bet', ok: false, message: 'Invalid amount' });
  }

  const multiplier = option === 'tie' ? 8.2 : 1.9;

  try {
    const { rows: r } = await pool.query(
      `select public.place_bet_sql($1, $2, $3, $4, $5) as out`,
      [userId, roundId, option, amount, multiplier],
    );
    const out = String(r[0]?.out ?? '');
    if (out.startsWith('ERR:')) {
      return respond({ type: 'bet', ok: false, message: out.slice(4) });
    }
    const betId = Number(out.split(':').pop());

    const { rows } = await pool.query(
      `select id, round_id, option, amount, multiplier, status from public.bets where id = $1`,
      [betId],
    );

    const { rows: bal } = await pool.query(
      `select balance from public.profiles where id = $1`,
      [userId],
    );

    respond({
      type: 'bet',
      ok: true,
      bet: rows[0],
      balance: bal[0] ? Number(bal[0].balance) : 0,
    });
  } catch (e) {
    respond({ type: 'bet', ok: false, message: e.message });
  }
}

function requireAuth(ctx) {
  return ctx.userId || null;
}

function send(ws, obj) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}