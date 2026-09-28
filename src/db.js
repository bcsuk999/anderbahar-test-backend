import pg from 'pg';
import dns from 'node:dns';
import { config, requireConfig } from './config.js';

requireConfig('databaseUrl');

// Force IPv4 DNS resolution FIRST. Render/Railway often lack IPv6 routes, and
// Node's dns.lookup may otherwise return the IPv6 address first (ENETUNREACH
// at connect). Must be set before any connection attempt.
dns.setDefaultResultOrder('ipv4first');

// Direct Postgres pool — the primary database layer for this backend.
// (Connection string from Supabase Dashboard -> Connect -> Session pooler / direct.)
// `family: 4` forces IPv4 — some hosts (Render/Railway) lack IPv6 routing and
// Node would otherwise try the IPv6 address first and fail with ENETUNREACH.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
  family: 4,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

// Surface every connection failure with the resolved address + code, so Render
// logs show the exact reason (ENETUNREACH, ETIMEDOUT, auth, SSL...) and host.
pool.on('error', (err) => {
  console.error('  [pool] idle client error:', err.message, err.code ?? '');
});
pool.on('connect', () => console.log('  [pool] connected to Postgres'));

/** Run a query. */
export function q(text, params) {
  return pool.query(text, params);
}

/** Run a query and return rows. */
export async function rows(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

/** Run a query returning a single row or null. */
export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}