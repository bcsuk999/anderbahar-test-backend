import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually (no extra dependency needed)
const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx === -1) continue;
    const key = t.slice(0, idx).trim();
    const value = t.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

export const config = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
  jwksUrl: process.env.SUPABASE_JWKS_URL,
  databaseUrl: process.env.DATABASE_URL,
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  bettingTime: Number(process.env.BETTING_TIME || 15),
  resultTime: Number(process.env.RESULT_TIME || 10),
  resetTime: Number(process.env.RESET_TIME || 5),
  signupBonus: Number(process.env.SIGNUP_BONUS || 10000),
  jwtSecret: process.env.JWT_SECRET || 'change-this',
};

export function requireConfig(...keys) {
  for (const k of keys) {
    const v = config[k];
    if (!v || (typeof v === 'string' && v.includes('PLACEHOLDER'))) {
      throw new Error(`Missing required env: ${k} (check backend/.env)`);
    }
  }
}

// Print which env vars are present (values masked) so Render logs reveal
// exactly what the server sees on startup.
export function logEnvStatus() {
  const mask = (v) => (v == null ? 'UNSET' : v.includes('PLACEHOLDER') ? 'PLACEHOLDER' : 'SET');
  console.log('  ENV status:');
  console.log(`    DATABASE_URL           ${mask(config.databaseUrl)}   ${config.databaseUrl ? config.databaseUrl.replace(/\/\/.*@/, '//***:***@') : ''}`);
  console.log(`    JWT_SECRET             ${mask(config.jwtSecret)}`);
  console.log(`    SUPABASE_URL           ${mask(config.supabaseUrl)}`);
  console.log(`    SUPABASE_PUBLISHABLE_KEY ${mask(config.supabasePublishableKey)}`);
  console.log(`    PORT/HOST              ${config.port}/${config.host}`);
  console.log(`    timers                 bet=${config.bettingTime}s res=${config.resultTime}s reset=${config.resetTime}s`);
}