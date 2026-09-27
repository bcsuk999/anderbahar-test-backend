-- =============================================================
-- Andar Bahar - Server-side functions (Postgres, database-level)
-- =============================================================

create extension if not exists pgcrypto;

-- Create a game user directly in auth.users (no SMS OTP needed).
-- Password is stored as bcrypt so Supabase Auth can verify it on login.
-- Credited signup bonus + ledger inside the same transaction.
create or replace function public.create_game_user(
  p_mobile text,
  p_password text,
  p_bonus numeric,
  p_username text default null
) returns uuid language plpgsql as $$
declare
  v_user_id uuid;
  v_phone  text;
begin
  -- validate 10-digit mobile
  if p_mobile !~ '^[6-9][0-9]{9}$' then
    raise exception 'INVALID_MOBILE';
  end if;
  if length(p_password) < 6 then
    raise exception 'WEAK_PASSWORD';
  end if;

  v_phone := '+91' || p_mobile;

  -- unique phone
  if exists (select 1 from auth.users where phone = v_phone) then
    raise exception 'MOBILE_ALREADY_REGISTERED';
  end if;

  v_user_id := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role, encrypted_password,
    email_confirmed_at, phone, phone_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, created_at, updated_at,
    is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
    crypt(p_password, gen_salt('bf', 10)),
    now(), v_phone, now(),
    '', '', '', '',
    jsonb_build_object('provider', 'phone', 'providers', array['phone']),
    jsonb_build_object('username', coalesce(p_username, 'Player' || right(p_mobile, 4))),
    false, now(), now(),
    false, false
  );

  -- profile + signup bonus + ledger
  perform public.credit_signup_bonus(v_user_id, p_mobile, p_bonus, p_username);

  return v_user_id;
exception
  when others then
    raise;
end; $$;

-- Replace credit_signup_bonus to accept username (drop old first)
drop function if exists public.credit_signup_bonus(uuid, text, numeric);
create or replace function public.credit_signup_bonus(
  p_user_id uuid,
  p_mobile text,
  p_bonus numeric,
  p_username text default null
) returns void language plpgsql as $$
declare
  v_balance numeric;
begin
  insert into public.profiles (id, mobile, username, balance, total_bonus)
  values (p_user_id, p_mobile, coalesce(p_username, 'Player' || right(p_mobile, 4)), p_bonus, p_bonus);

  select balance into v_balance from public.profiles where id = p_user_id;

  insert into public.transactions (user_id, type, amount, balance, ref_type, note)
  values (p_user_id, 'signup_bonus', p_bonus, v_balance, 'manual', 'Welcome bonus');
end; $$;

-- Place a bet + ledger entry, atomically, with balance check.
create or replace function public.place_bet_sql(
  p_user_id uuid,
  p_round_id text,
  p_option text,
  p_amount numeric,
  p_multiplier numeric
) returns text language plpgsql as $$
declare
  v_balance numeric;
  v_bet_id bigint;
begin
  select balance into v_balance from public.profiles where id = p_user_id for update;
  if v_balance is null then
    return 'ERR:user_not_found';
  end if;
  if v_balance < p_amount then
    return 'ERR:insufficient_balance';
  end if;

  update public.profiles set balance = balance - p_amount, updated_at = now()
  where id = p_user_id;

  insert into public.bets (round_id, user_id, option, amount, multiplier)
  values (p_round_id, p_user_id, p_option, p_amount, p_multiplier)
  returning id into v_bet_id;

  insert into public.transactions (user_id, type, amount, balance, ref_type, ref_id, note)
  values (p_user_id, 'bet_placed', -p_amount,
          (select balance from public.profiles where id = p_user_id),
          'round', p_round_id, p_option);

  return 'OK:' || v_bet_id;
end; $$;

-- Settle one winning bet: credit payout
create or replace function public.settle_bet_sql(
  p_bet_id bigint,
  p_status text,
  p_payout numeric
) returns void language plpgsql as $$
declare
  v_user uuid;
  v_round text;
begin
  select user_id, round_id into v_user, v_round from public.bets where id = p_bet_id;

  update public.bets set status = p_status, payout = p_payout where id = p_bet_id;

  if p_status = 'won' and p_payout > 0 then
    update public.profiles set balance = balance + p_payout, updated_at = now()
    where id = v_user;

    insert into public.transactions (user_id, type, amount, balance, ref_type, ref_id, note)
    values (v_user, 'bet_win', p_payout,
            (select balance from public.profiles where id = v_user),
            'round', v_round, 'win');
  end if;
end; $$;

-- Refund a bet (e.g. round cancelled)
create or replace function public.refund_bet_sql(p_bet_id bigint) returns void language plpgsql as $$
declare
  v_user uuid;
  v_round text;
  v_amount numeric;
begin
  select user_id, round_id, amount into v_user, v_round, v_amount
  from public.bets where id = p_bet_id and status = 'pending';

  if v_user is null then
    return;
  end if;

  update public.bets set status = 'refunded' where id = p_bet_id;
  update public.profiles set balance = balance + v_amount, updated_at = now()
  where id = v_user;

  insert into public.transactions (user_id, type, amount, balance, ref_type, ref_id, note)
  values (v_user, 'refund', v_amount,
          (select balance from public.profiles where id = v_user),
          'round', v_round, 'refund');
end; $$;