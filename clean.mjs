import pg from 'pg';
const { Client } = pg;
const c = new Client({
  connectionString: 'postgresql://postgres:anderbahartest@db.lzklczseueqfapxcdoce.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
await c.connect();
await c.query('create sequence if not exists public.round_seq');
await c.query('delete from public.bets');
await c.query('delete from public.game_rounds');
await c.query('delete from public.transactions');
await c.query('delete from public.profiles');
const ids = await c.query(`select id from auth.users where phone like '+91%'`);
for (const r of ids.rows) await c.query('delete from auth.users where id=$1', [r.id]);
console.log('cleaned. users deleted:', ids.rows.length);
await c.end();