import dns from 'node:dns';
import { config, requireConfig } from './config.js';
import { GameEngine } from './game.js';
import { createWSServer } from './ws.js';
import { pool } from './db.js';

// Force IPv4 DNS resolution FIRST. Render/Railway often lack IPv6 routes, and
// Node may otherwise pick the IPv6 address (ENETUNREACH) before IPv4.
dns.setDefaultResultOrder('ipv4first');

console.log('==============================================');
console.log('  Andar Bahar Backend');
console.log('==============================================');

requireConfig('databaseUrl');

// Quick DB connectivity check.
try {
  const r = await pool.query('select 1 as ok');
  if (r.rows[0].ok === 1) console.log('  Postgres connected ✓');
} catch (e) {
  console.warn('  Postgres connection warning:', e.message);
  process.exit(1);
}

// Start game engine (30s round loop: 15 betting / 10 result / 5 reset).
const game = new GameEngine();
game.start();

console.log(`  Round timer: ${config.bettingTime}s betting / ${config.resultTime}s result / ${config.resetTime}s reset`);
console.log(`  Signup bonus: ₹${config.signupBonus}`);

// Start WebSocket server.
const { wss } = createWSServer({ game });
console.log(`  WebSocket listening on ws://${config.host}:${config.port}`);
console.log('==============================================');

process.on('SIGINT', () => {
  game.stop();
  wss.close();
  pool.end();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});