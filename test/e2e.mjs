// End-to-end API test over WebSocket against the running server.
const WS_URL = 'ws://127.0.0.1:8080';
const mobile = '9' + String(Math.floor(1000000000 + Math.random() * 8999999999)).slice(1, 10);

const ws = new WebSocket(WS_URL);
let seq = 0;
const pending = new Map();
const pushes = [];
let done = false;

function send(type, payload = {}) {
  const id = ++seq;
  const msg = { id, type, ...payload };
  ws.send(JSON.stringify(msg));
  return new Promise((resolve) => {
    pending.set(id, resolve);
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); resolve({ timeout: true }); }
    }, 10000);
  });
}

const log = (label, obj) => console.log(label, JSON.stringify(obj));

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (['round_started', 'result', 'reset'].includes(msg.type)) {
    pushes.push(msg);
    console.log(`  [push] ${msg.type} round=${msg.roundNumber} phase=${msg.phase} rem=${msg.remainingSeconds}s` +
      (msg.winner ? ` winner=${msg.winner} joker=${msg.joker} deal=${(msg.dealtCards||[]).join(',')}` : ''));
  }
};

async function run() {
  try {
    console.log('connected. mobile =', mobile);
    console.log('\n1) REGISTER');
    let r = await send('register', { mobile, password: 'pass123', username: 'Tester' });
    log('  ->', r);
    if (!r.ok) { finish(); return; }

    console.log('\n2) BALANCE (expect 10000)');
    r = await send('balance');
    log('  ->', r);

    console.log('\n3) LEDGER (expect signup_bonus)');
    r = await send('ledger', { limit: 5 });
    log('  ->', r);

    console.log('\n4) GAME STATE');
    r = await send('game_state');
    log('  ->', r);

    // wait for a betting phase to place a bet
    const waitForBetting = (await new Promise((res) => {
      const iv = setInterval(() => {
        const s = pushes[pushes.length - 1];
        if (s && s.phase === 'betting') { clearInterval(iv); res(true); }
      }, 300);
      setTimeout(() => { clearInterval(iv); res(false); }, 20000);
    }));

    console.log('\n5) BET (andar 1000) — betting phase?', waitForBetting);
    r = await send('bet', { option: 'andar', amount: 1000 });
    log('  ->', r);

    console.log('\n6) RELOGIN');
    r = await send('login', { mobile, password: 'pass123' });
    log('  ->', r);

    console.log('\n7) BAD LOGIN');
    r = await send('login', { mobile, password: 'wrong' });
    log('  ->', r);

    console.log('\n8) DUPLICATE REGISTER');
    r = await send('register', { mobile, password: 'pass123' });
    log('  ->', r);

    console.log('\n9) UNAUTH BALANCE (new conn) -> skip, wait for result/reset...');
    await sendsleep(25000);
    console.log('   pushes received:', pushes.length);
    finish();
  } catch (e) {
    console.error('test error', e);
    finish();
  }
}

function sendsleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function finish() {
  if (done) return;
  done = true;
  ws.close();
  console.log('\ntest complete');
  process.exit(0);
}

ws.onopen = () => { run().then(() => {}); };
ws.onerror = (e) => { console.error('ws error', e.message || e); finish(); };
ws.onclose = () => finish();

setTimeout(finish, 70000);