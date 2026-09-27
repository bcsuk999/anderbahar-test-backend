// Listens for broadcasts for ~35s and prints every message.
const ws = new WebSocket('ws://127.0.0.1:8080');
let count = 0;
ws.onopen = () => console.log('open');
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) { console.log('reply', m.type, m.ok ? 'ok' : (m.message || 'err')); return; }
  count++;
  console.log(`PUSH[${count}]`, JSON.stringify(m).slice(0, 300));
};
ws.onerror = (e) => console.log('error', e.message || 'ws error');
ws.onclose = () => console.log('closed, pushes:', count);
setTimeout(() => { ws.close(); }, 35000);