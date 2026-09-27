-- =============================================================
-- Andar Bahar - Server-side functions (service role only)
-- =============================================================

-- Place a bet + ledger entry, atomically, with balance check.
create or replace function public.place_bet(
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
  -- Check balance and lock profile row
  select balance into v_balance from public.profiles where id = p_user_id for update;
  if v_balance is null then
    return 'ERR:user_not_found';
  end if;
  if v_balance < p_amount then
    return 'ERR:insufficient_balance';
  end if;

  -- Deduct balance
  update public.profiles set balance = balance - p_amount, updated_at = now()
  where id = p_user_id;

  -- Insert bet
  insert into public.bets (round_id, user_id, option, amount, multiplier)
  values (p_round_id, p_user_id, p_option, p_amount, p_multiplier)
  returning id into v_bet_id;

  -- Ledger
  insert into public.transactions (user_id, type, amount, balance, ref_type, ref_id, note)
  values (p_user_id, 'bet_placed', -p_amount,
          (select balance from public.profiles where id = p_user_id),
          'round', p_round_id, p_option);

  return 'OK:' || v_bet_id;
end; $$;

-- Settle one winning bet: credit payout
create or replace function public.settle_bet(
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
create or replace function public.refund_bet(p_bet_id bigint) returns void language plpgsql as $$
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