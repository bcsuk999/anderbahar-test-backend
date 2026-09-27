// Targeted test: place a TIE bet + ANDAR bet each round until a tie occurs.
const WS_URL = 'ws://127.0.0.1:8080';
const mobile = '9' + String(Math.floor(1000000000 + Math.random() * 8999999999)).slice(1, 10);

const ws = new WebSocket(WS_URL);
let seq = 0;
const pending = new Map();
let lastState = null;
let placedThisRound = new Set();

function send(type, payload = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, type, ...payload }));
  return new Promise((resolve) => {
    pending.set(id, resolve);
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ timeout: true }); } }, 15000);
  });
}

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.type === 'round_started' || msg.type === 'result' || msg.type === 'reset') {
    lastState = msg;
    console.log(`  [push:${msg.type}] round=${msg.roundNumber} winner=${msg.winner ?? '-'} joker=${msg.joker ?? '-'}`);
    if (msg.type === 'round_started') placedThisRound = new Set();
  }
};

async function run() {
  try {
    let r = await send('register', { mobile, password: 'pass123', username: 'TieTester' });
    console.log('register ok:', r.ok, 'balance:', r.user.balance);
    if (!r.ok) { finish(); return; }

    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      if (lastState && lastState.type === 'round_started' && !placedThisRound.has(lastState.roundNumber)) {
        placedThisRound.add(lastState.roundNumber);
        const bet1 = await send('bet', { option: 'tie', amount: 500 });
        const bet2 = await send('bet', { option: 'andar', amount: 500 });
        console.log(`round ${lastState.roundNumber}: tie-bet ok=${bet1.ok} andar-bet ok=${bet2.ok} (${bet1.ok && bet2.ok ? 'accepted' : ``})`);
      }
      if (lastState && lastState.type === 'result') {
        await new Promise((res) => setTimeout(res, 1500));
        const bal = await send('balance');
        const ledger = await send('ledger', { limit: 4 });
        console.log(`   RESULT: winner=${lastState.winner} | balance=${bal.balance}`);
        console.log('   LEDGER:', JSON.stringify((ledger.transactions || []).map(t => `${t.type}:${t.amount}`)));
        placedThisRound = new Set();
        lastState = null;
      }
      await new Promise((res) => setTimeout(res, 500));
    }
    finish();
  } catch (e) {
    console.error('test error', e);
    finish();
  }
}

function finish() { ws.close(); console.log('\ntest complete'); process.exit(0); }
ws.onopen = () => run();
ws.onerror = (e) => { console.error('ws error'); finish(); };
ws.onclose = () => finish();
setTimeout(finish, 130000);