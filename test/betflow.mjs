// Full flow: register -> bet during betting phase -> wait for result -> check ledger/balance.
const WS_URL = 'ws://127.0.0.1:8080';
const mobile = '9' + String(Math.floor(1000000000 + Math.random() * 8999999999)).slice(1, 10);

const ws = new WebSocket(WS_URL);
let seq = 0;
const pending = new Map();
const log = (label, obj) => console.log(label, JSON.stringify(obj));

function send(type, payload = {}) {
  const id = ++seq;
  const msg = { id, type, ...payload };
  ws.send(JSON.stringify(msg));
  return new Promise((resolve) => {
    pending.set(id, resolve);
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ timeout: true }); } }, 15000);
  });
}

let lastState = null;

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.type === 'round_started' || msg.type === 'result' || msg.type === 'reset') {
    lastState = msg;
    console.log(`  [push:${msg.type}] round=${msg.roundNumber} phase=${msg.phase} rem=${msg.remainingSeconds}s winner=${msg.winner ?? '-'} joker=${msg.joker ?? '-'}`);
  }
};

async function run() {
  try {
    console.log('mobile =', mobile);
    let r = await send('register', { mobile, password: 'pass123', username: 'BetTester' });
    log('1) register ->', r);
    if (!r.ok) { finish(); return; }

    // wait for next betting phase
    console.log('2) waiting for betting phase (up to 35s)...');
    const betting = await new Promise((res) => {
      const iv = setInterval(() => {
        if (lastState && lastState.type === 'round_started' && lastState.phase === 'betting') { clearInterval(iv); res(true); }
      }, 300);
      setTimeout(() => { clearInterval(iv); res(false); }, 35000);
    });
    console.log('   got betting phase =', betting);

    r = await send('bet', { option: 'bahar', amount: 1000 });
    log('3) bet bahar 1000 ->', r);

    if (r.ok) {
      r = await send('balance');
      log('4) balance after bet (expect 9000) ->', r);
    }

    console.log('5) waiting for result + settlement (up to 30s)...');
    await new Promise((res) => setTimeout(res, 26000));

    r = await send('ledger', { limit: 5 });
    log('6) ledger ->', JSON.stringify(r.transactions, null, 0));

    r = await send('balance');
    log('7) balance after settlement ->', r);

    finish();
  } catch (e) {
    console.error('test error', e);
    finish();
  }
}

function finish() { ws.close(); console.log('\ntest complete'); process.exit(0); }
ws.onopen = () => { run().then(() => {}); };
ws.onerror = (e) => { console.error('ws error', e.message || 'ws error'); finish(); };
ws.onclose = () => finish();
setTimeout(finish, 80000);