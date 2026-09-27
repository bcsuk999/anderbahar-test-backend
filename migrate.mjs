import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Client } = pg;
const url = 'postgresql://postgres:anderbahartest@db.lzklczseueqfapxcdoce.supabase.co:5432/postgres';

const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
await c.connect();

for (const file of ['sql/schema.sql', 'sql/functions.sql']) {
  console.log(`\n--- running ${file} ---`);
  const sql = readFileSync(file, 'utf8');
  try {
    await c.query(sql);
    console.log('OK');
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}

const tables = await c.query(`select tablename from pg_tables where schemaname='public' order by tablename`);
console.log('\ntables:', tables.rows.map(r => r.tablename).join(', '));

const funcs = await c.query(`select routine_name from information_schema.routines where routine_schema='public' order by routine_name`);
console.log('functions:', funcs.rows.map(r => r.routine_name).join(', '));

await c.end();