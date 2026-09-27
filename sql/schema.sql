-- =============================================================
-- Andar Bahar - Supabase Schema
-- Run this in Supabase SQL Editor.
-- Tables: profiles, transactions, game_rounds, bets
-- =============================================================

-- ============ 1. PROFILES (extends auth.users) ============
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  mobile      text unique not null,
  username    text,
  balance     numeric(14,2) not null default 0,
  total_bonus numeric(14,2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============ 2. TRANSACTIONS (ledger) ============
create table if not exists public.transactions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null check (type in (
                'signup_bonus','bet_placed','bet_win','bet_loss','withdrawal','deposit','refund'
              )),
  amount      numeric(14,2) not null,           -- signed: +credit / -debit
  balance     numeric(14,2) not null,           -- balance AFTER this transaction
  ref_type    text,                              -- 'round' / 'manual' / etc
  ref_id      text,                              -- round id or external ref
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_transactions_user on public.transactions(user_id, created_at desc);
create index if not exists idx_transactions_round on public.transactions(ref_id);

-- ============ 3. GAME ROUNDS ============
create table if not exists public.game_rounds (
  id           text primary key,                -- e.g. AB-20260927-0001
  status       text not null default 'idle' check (status in (
                'idle','betting','result','reset','completed'
              )),
  joker_rank   int,                              -- 1..13
  winner       text,                             -- 'andar' | 'bahar' | 'tie'
  winning_rank int,                              -- the matching card rank
  started_at   timestamptz not null default now(),
  betting_until timestamptz,
  result_at    timestamptz,
  next_round_at timestamptz,
  completed_at timestamptz
);

-- ============ 4. BETS ============
create table if not exists public.bets (
  id           bigint generated always as identity primary key,
  round_id     text not null references public.game_rounds(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  option       text not null check (option in ('andar','bahar','tie')),
  amount       numeric(14,2) not null check (amount > 0),
  multiplier   numeric(5,2) not null,           -- andar 1.9 / bahar 1.9 / tie 8.2
  payout       numeric(14,2),                   -- null until resolved
  status       text not null default 'pending' check (status in (
                'pending','won','lost','refunded'
              )),
  created_at   timestamptz not null default now()
);

create index if not exists idx_bets_round on public.bets(round_id);
create index if not exists idx_bets_user_round on public.bets(user_id, round_id);

-- ============ 4. BETS ============
create sequence if not exists public.round_seq;

-- ============ 5. RLS (Row Level Security) ============
alter table public.profiles enable row level security;
alter table public.transactions enable row level security;
alter table public.game_rounds enable row level security;
alter table public.bets enable row level security;

-- Users can read/update their own profile only
create policy "profile read own" on public.profiles
  for select using (auth.uid() = id);
create policy "profile update own" on public.profiles
  for update using (auth.uid() = id);

-- Users can read their own transactions
create policy "tx read own" on public.transactions
  for select using (auth.uid() = user_id);

-- Rounds are public (everyone sees the same table)
create policy "rounds read all" on public.game_rounds
  for select using (true);

-- Users see their own bets; admin can insert (server uses service role)
create policy "bets read own" on public.bets
  for select using (auth.uid() = user_id);

-- ============ 6. AUTO UPDATE updated_at ============
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- ============ 7. SIGNUP BONUS FUNCTION ============
-- Defined in functions.sql (public.credit_signup_bonus) together with
-- public.create_game_user so registration + bonus + ledger happen in one
-- transaction. Run functions.sql AFTER schema.sql.