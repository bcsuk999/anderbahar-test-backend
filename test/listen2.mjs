// Listener that also requests game_state on connect, logs all pushes.
const ws = new WebSocket('ws://127.0.0.1:8080');
let count = 0;
ws.onopen = () => {
  console.log('open, requesting state');
  ws.send(JSON.stringify({ id: 1, type: 'game_state' }));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) { console.log('reply', JSON.stringify(m).slice(0, 400)); return; }
  count++;
  console.log(`PUSH[${count}]`, JSON.stringify(m).slice(0, 400));
};
ws.onerror = (e) => console.log('error', e.message || 'ws error');
ws.onclose = () => { console.log('closed, pushes:', count); process.exit(0); };
setTimeout(() => { ws.close(); }, 60000);