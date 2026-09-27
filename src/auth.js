import { sb } from './supabase.js';
import { config } from './config.js';

const MOBILE_RE = /^[6-9]\d{9}$/;

export function validateMobile(mobile) {
  return typeof mobile === 'string' && MOBILE_RE.test(mobile.trim());
}

export function validatePassword(pass) {
  return typeof pass === 'string' && pass.length >= 6;
}

/**
 * REGISTER
 * Creates a Supabase auth user keyed by the 10-digit mobile as the phone.
 * Credits the signup bonus + writes the ledger (via plpgsql function).
 * Returns { ok, user, token }.
 */
export async function register(mobile, password, username) {
  if (!validateMobile(mobile)) {
    return { ok: false, message: 'Mobile must be a valid 10-digit Indian number (6-9xxxxxxxxx)' };
  }
  if (!validatePassword(password)) {
    return { ok: false, message: 'Password must be at least 6 characters' };
  }

  const phone = '+91' + mobile.trim();

  const { data, error } = await sb.auth.admin.createUser({
    phone,
    phone_confirm: true,
    password,
    email_confirm: true,
  });

  if (error) {
    if (error.message && error.message.toLowerCase().includes('already')) {
      return { ok: false, message: 'This mobile number is already registered' };
    }
    return { ok: false, message: error.message };
  }

  const userId = data.user.id;

  // Credit 10000 INR signup bonus + ledger, atomically server-side.
  const { error: fnErr } = await sb.rpc('credit_signup_bonus', {
    p_user_id: userId,
    p_mobile: mobile.trim(),
    p_bonus: config.signupBonus,
  });

  if (fnErr) {
    console.error('signup bonus credit failed:', fnErr.message);
  }

  const { data: profile } = await sb
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  const tokenAuth = await sb.auth.admin.generateLink({
    type: 'magiclink',
    phone,
  });

  // Issue a game token: we sign the user id ourselves for WebSocket auth.
  const token = signGameToken(userId);

  return {
    ok: true,
    token,
    user: {
      id: userId,
      mobile: mobile.trim(),
      username: profile?.username || username || 'Player',
      balance: Number(profile?.balance ?? config.signupBonus),
      signupBonus: config.signupBonus,
    },
  };
}

/**
 * LOGIN
 * Signs in via Supabase phone + password (we set support_phone=true for password auth on register).
 */
export async function login(mobile, password) {
  if (!validateMobile(mobile)) {
    return { ok: false, message: 'Mobile must be a valid 10-digit Indian number' };
  }
  if (!password) {
    return { ok: false, message: 'Password is required' };
  }

  const phone = '+91' + mobile.trim();

  const { data, error } = await sbPublic.auth.signInWithPassword({
    phone,
    password,
  });

  if (error) {
    return { ok: false, message: 'Invalid mobile number or password' };
  }

  const userId = data.user.id;

  const { data: profile } = await sb
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  const token = signGameToken(userId);

  return {
    ok: true,
    token,
    user: {
      id: userId,
      mobile: mobile.trim(),
      username: profile?.username || 'Player',
      balance: Number(profile?.balance ?? 0),
    },
  };
}

// ---- Minimal game token signing (HS256) --------------------
import { createHmac } from 'node:crypto';

function b64url(data) {
  return Buffer.from(data).toString('base64url');
}

function signGameToken(userId, ttlMs = 7 * 24 * 3600 * 1000) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Date.now();
  const payload = { sub: userId, iat: Math.floor(now / 1000), exp: Math.floor((now + ttlMs) / 1000) };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', config.jwtSecret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

export function verifyGameToken(token) {
  try {
    const [h, p, sig] = token.split('.');
    const expected = createHmac('sha256', config.jwtSecret).update(`${h}.${p}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (payload.exp * 1000 < Date.now()) return null;
    return payload.sub;
  } catch {
    return null;
  }
}