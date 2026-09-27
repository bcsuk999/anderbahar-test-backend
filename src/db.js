import pg from 'pg';
import { config, requireConfig } from './config.js';

requireConfig('databaseUrl');

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