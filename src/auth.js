import { createHmac } from 'node:crypto';
import { pool, one } from './db.js';
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
 * Creates the user directly in Postgres (auth.users + profiles + ledger),
 * credits the signup bonus atomically via public.create_game_user.
 */
export async function register(mobile, password, username) {
  if (!validateMobile(mobile)) {
    return { ok: false, message: 'Mobile must be a valid 10-digit Indian number (6-9xxxxxxxxx)' };
  }
  if (!validatePassword(password)) {
    return { ok: false, message: 'Password must be at least 6 characters' };
  }

  const m = mobile.trim();
  const u = username?.trim() || `Player${m.slice(-4)}`;

  try {
    const { rows: r } = await pool.query(
      `select public.create_game_user($1, $2, $3, $4) as user_id`,
      [m, password, config.signupBonus, u],
    );
    const userId = r[0]?.user_id;

    const profile = await getUserProfile(userId);

    return {
      ok: true,
      token: signGameToken(userId),
      user: {
        id: userId,
        mobile: m,
        username: u,
        balance: Number(profile.balance),
        signupBonus: config.signupBonus,
      },
    };
  } catch (e) {
    const code = e.message?.match(/^([A-Z_]+)/)?.[1];
    const map = {
      INVALID_MOBILE: 'Mobile must be a valid 10-digit Indian number (6-9xxxxxxxxx)',
      WEAK_PASSWORD: 'Password must be at least 6 characters',
      MOBILE_ALREADY_REGISTERED: 'This mobile number is already registered',
    };
    return { ok: false, message: map[code] || e.message };
  }
}

/**
 * LOGIN
 * Verifies phone + bcrypt password directly against auth.users.
 * (Same hashing as Supabase Auth, but no SMS/dashboard config needed.)
 */
export async function login(mobile, password) {
  if (!validateMobile(mobile)) {
    return { ok: false, message: 'Mobile must be a valid 10-digit Indian number' };
  }
  if (!password) {
    return { ok: false, message: 'Password is required' };
  }

  const phone = '+91' + mobile.trim();

  const user = await one(
    `select u.id, u.phone,
            u.encrypted_password = crypt($2, u.encrypted_password) as pass_ok,
            p.username, p.balance
       from auth.users u
       left join public.profiles p on p.id = u.id
      where u.phone = $1 and u.deleted_at is null
        and u.created_at is not null`,
    [phone, password],
  );

  if (!user || !user.pass_ok) {
    return { ok: false, message: 'Invalid mobile number or password' };
  }

  return {
    ok: true,
    token: signGameToken(user.id),
    user: {
      id: user.id,
      mobile: mobile.trim(),
      username: user.username || `Player${mobile.trim().slice(-4)}`,
      balance: Number(user.balance ?? 0),
    },
  };
}

// ---- helpers -----
export async function getUserProfile(userId, mobile) {
  const p = await one(`select * from public.profiles where id = $1`, [userId]);
  if (!p && mobile) {
    return {
      id: userId,
      mobile,
      username: `Player${mobile.slice(-4)}`,
      balance: 0,
    };
  }
  return p;
}

// ---- Minimal game token signing (HS256) --------------------
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