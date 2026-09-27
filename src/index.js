import { config, requireConfig } from './config.js';
import { GameEngine } from './game.js';
import { createWSServer } from './ws.js';
import { sb } from './supabase.js';

console.log('==============================================');
console.log('  Andar Bahar Backend');
console.log('==============================================');

requireConfig('supabaseUrl', 'supabasePublishableKey', 'supabaseSecretKey', 'jwtSecret');

// Quick DB connectivity check.
try {
  const { error } = await sb.from('game_rounds').select('id').limit(1);
  if (error) console.warn('  DB check warning:', error.message);
  else console.log('  Supabase connected ✔');
} catch (e) {
  console.warn('  DB check warning:', e.message);
}

// Start game engine (30s round loop: 15 betting / 10 result / 5 reset).
const game = new GameEngine();
game.start();

console.log(`  Round timer: ${config.bettingTime}s betting / ${config.resultTime}s result / ${config.resetTime}s reset`);

// Start WebSocket server.
const { wss } = createWSServer({ game });
console.log(`  WebSocket listening on ws://${config.host}:${config.port}`);
console.log('==============================================');

process.on('SIGINT', () => {
  game.stop();
  wss.close();
  process.exit(0);
});