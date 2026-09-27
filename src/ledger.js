import { pool, one, rows } from './db.js';

/**
 * GET LEDGER — player's transaction history (newest first).
 */
export async function getLedger(userId, { limit = 50, offset = 0 } = {}) {
  const data = await rows(
    `select id, type, amount, balance, ref_type, ref_id, note, created_at
       from public.transactions
      where user_id = $1
      order by created_at desc, id desc
      limit $2 offset $3`,
    [userId, Math.min(limit, 100), offset],
  );
  return { ok: true, transactions: data };
}

/**
 * GET BALANCE + available chip values.
 */
export async function getBalance(userId) {
  const profile = await one(`select balance from public.profiles where id = $1`, [userId]);
  if (!profile) return { ok: false, message: 'User not found' };
  return {
    ok: true,
    balance: Number(profile.balance),
    chipValues: [100, 500, 1000, 5000, 10000],
  };
}

/**
 * MANUAL ADD/SUBTRACT (for deposits/withdrawals later).
 */
export async function adjustBalance(userId, type, amount) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const profile = await client.query(
      `select balance from public.profiles where id = $1 for update`,
      [userId],
    );
    if (!profile.rows[0]) {
      await client.query('rollback');
      return { ok: false, message: 'User not found' };
    }
    const newBalance = Number(profile.rows[0].balance) + amount;
    if (newBalance < 0) {
      await client.query('rollback');
      return { ok: false, message: 'Insufficient balance' };
    }
    await client.query(
      `update public.profiles set balance = $1, updated_at = now() where id = $2`,
      [newBalance, userId],
    );
    await client.query(
      `insert into public.transactions (user_id, type, amount, balance, ref_type, ref_id, note)
       values ($1, $2, $3, $4, 'manual', null, 'Manual adjustment')`,
      [userId, type, amount, newBalance],
    );
    await client.query('commit');
    return { ok: true, balance: newBalance };
  } catch (e) {
    await client.query('rollback');
    return { ok: false, message: e.message };
  } finally {
    client.release();
  }
}