import { sb } from './supabase.js';

/**
 * GET LEDGER
 * Returns the user's transaction history (newest first) with balance.
 */
export async function getLedger(userId, { limit = 50, offset = 0 } = {}) {
  const { data, error } = await sb
    .from('transactions')
    .select('id, type, amount, balance, ref_type, ref_id, note, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return { ok: false, message: error.message };
  return { ok: true, transactions: data };
}

/**
 * GET BALANCE reasons — returns current balance + available chip values.
 */
export async function getBalance(userId) {
  const { data, error } = await sb
    .from('profiles')
    .select('balance')
    .eq('id', userId)
    .single();

  if (error) return { ok: false, message: error.message };
  return {
    ok: true,
    balance: Number(data.balance),
    chipValues: [100, 500, 1000, 5000, 10000],
  };
}

/**
 * MANUAL ADD/SUBTRACT (admin/server only) - kept for deposits/withdrawals later.
 */
export async function adjustBalance(userId, type, amount) {
  const { data: profile } = await sb
    .from('profiles')
    .select('balance')
    .eq('id', userId)
    .single();

  if (!profile) return { ok: false, message: 'User not found' };

  const newBalance = Number(profile.balance) + amount;
  if (newBalance < 0) return { ok: false, message: 'Insufficient balance' };

  const { error: upErr } = await sb
    .from('profiles')
    .update({ balance: newBalance })
    .eq('id', userId);

  if (upErr) return { ok: false, message: upErr.message };

  const { error: txErr } = await sb.from('transactions').insert({
    user_id: userId,
    type,
    amount,
    balance: newBalance,
    ref_type: 'manual',
    note: 'Manual adjustment',
  });

  if (txErr) return { ok: false, message: txErr.message };
  return { ok: true, balance: newBalance };
}