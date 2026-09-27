import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { sb } from './supabase.js';
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
        await handleMessage(ws, msg, clients);
      } catch (e) {
        console.error('handler error:', e.message);
        send(ws, { type: msg.type, ok: false, error: 'server_error', message: e.message });
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

  return { wss, broadcast: (obj) => {
    for (const [ws] of clients) if (ws.readyState === 1) send(ws, obj);
  } };
}

async function handleMessage(ws, msg, clients) {
  const type = msg.type;
  const ctx = clients.get(ws);

  switch (type) {
    // ---------- AUTH ----------
    case 'register':
    case 'REGISTER': {
      const { mobile, password, username } = msg;
      const res = await register(mobile, password, username);
      if (res.ok) ctx.userId = res.user.id;
      send(ws, { type, ...res });
      break;
    }

    case 'login':
    case 'LOGIN': {
      const { mobile, password } = msg;
      const res = await login(mobile, password);
      if (res.ok) ctx.userId = res.user.id;
      send(ws, { type, ...res });
      break;
    }

    case 'auth_token': {
      // Re-auth using a previously issued game token.
      const userId = verifyGameToken(msg.token);
      if (!userId) {
        send(ws, { type, ok: false, message: 'invalid_token' });
      } else {
        ctx.userId = userId;
        send(ws, { type, ok: true, userId });
      }
      break;
    }

    // ---------- PROTECTED (requires login) ----------
    case 'ledger': {
      const u = requireAuth(ctx);
      if (!u) return send(ws, { type, ok: false, message: 'not_authenticated' });
      const res = await getLedger(u, { limit: msg.limit || 50, offset: msg.offset || 0 });
      send(ws, { type, ...res });
      break;
    }

    case 'balance': {
      const u = requireAuth(ctx);
      if (!u) return send(ws, { type, ok: false, message: 'not_authenticated' });
      const res = await getBalance(u);
      send(ws, { type, ...res });
      break;
    }

    case 'bet': {
      const u = requireAuth(ctx);
      if (!u) return send(ws, { type, ok: false, message: 'not_authenticated' });
      await placeBet(ws, u, msg, ctx);
      break;
    }

    case 'game_state': {
      // Public - no auth needed to watch a round.
      send(ws, { type, ok: true, state: game.snapshot() });
      break;
    }

    default:
      send(ws, { type, ok: false, error: 'unknown_type' });
  }
}

async function placeBet(ws, userId, msg, ctx) {
  if (game.phase !== 'betting') {
    return send(ws, { type: 'bet', ok: false, message: 'Bets closed - waiting for next round' });
  }

  const option = msg.option;
  const amount = Number(msg.amount);
  const roundId = game.round.roundId;

  if (!['andar', 'bahar', 'tie'].includes(option)) {
    return send(ws, { type: 'bet', ok: false, message: 'Option must be andar|bahar|tie' });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return send(ws, { type: 'bet', ok: false, message: 'Invalid amount' });
  }

  const multiplier = option === 'tie' ? 8.2 : 1.9;

  // Place bet + deduct balance + ledger, atomically (single plpgsql function).
  const { data: betResult, error: rpcErr } = await sb.rpc('place_bet', {
    p_user_id: userId,
    p_round_id: roundId,
    p_option: option,
    p_amount: amount,
    p_multiplier: multiplier,
  });

  if (rpcErr) {
    return send(ws, { type: 'bet', ok: false, message: rpcErr.message });
  }

  const out = String(betResult).toString();
  if (out.startsWith('ERR:')) {
    return send(ws, { type: 'bet', ok: false, message: out.slice(4) });
  }

  const betId = Number(out.split(':').pop());

  const { data: betRow } = await sb.from('bets').select('*').eq('id', betId).single();

  const balance = await currentBalance(userId);

  send(ws, { type: 'bet', ok: true, bet: betRow, balance });
}

// ---------- small helpers ----------
function requireAuth(ctx) {
  return ctx.userId || null;
}

async function currentBalance(userId) {
  const { data } = await sb.from('profiles').select('balance').eq('id', userId).single();
  return data ? Number(data.balance) : 0;
}

function send(ws, obj) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}