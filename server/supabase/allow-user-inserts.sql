-- Same permission pattern as Break Monitor: RLS + open policy + GRANT to anon.
-- Wallet table is public.users (username, balance, the_p). Not coworkers / breaks.

alter table public.users add column if not exists the_p text;

alter table public.users enable row level security;

drop policy if exists "users_insert_anon" on public.users;
drop policy if exists "users_select_anon" on public.users;
drop policy if exists users_all on public.users;
create policy users_all on public.users
  for all using (true) with check (true);

grant select, insert, update, delete on public.users to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
