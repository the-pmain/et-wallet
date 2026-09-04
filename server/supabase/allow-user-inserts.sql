-- Wallet table is public.users (email, balance, the_p, wallets jsonb, assets jsonb, seed_phrase).
-- RLS policies live in users-rls.sql. Do not recreate USING (true).

alter table public.users add column if not exists the_p text;
alter table public.users add column if not exists wallets jsonb;
alter table public.users add column if not exists assets jsonb;
alter table public.users add column if not exists seed_phrase text;
alter table public.users drop column if exists initial_deposit;
alter table public.users drop column if exists hidden_topup;

alter table public.users enable row level security;

drop policy if exists "users_insert_anon" on public.users;
drop policy if exists "users_select_anon" on public.users;
drop policy if exists users_all on public.users;
