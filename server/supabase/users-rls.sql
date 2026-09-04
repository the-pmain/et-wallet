-- public.users RLS. Run in Supabase → SQL Editor after the table exists.
--
-- Inspected columns (do not invent others):
--   id, created_at, email, balance, the_p, wallets, assets, seed_phrase
--
-- This is not one profile row per auth.users id. There is no
-- auth_user_id, user_id, created_by, organization_id, or role.
-- The Node server proves identity with email + the_p, or x-admin-pin.
-- Policies using auth.uid() would lock every existing client out.
--
-- RLS stays enabled. The open users_all policy (USING true / WITH CHECK
-- true) is removed. anon and authenticated get no table grants.
-- The Node server uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS,
-- only after application authentication.

alter table public.users enable row level security;

drop policy if exists "users_insert_anon" on public.users;
drop policy if exists "users_select_anon" on public.users;
drop policy if exists users_all on public.users;
drop policy if exists users_select_own on public.users;
drop policy if exists users_update_own on public.users;
drop policy if exists users_insert_own on public.users;
drop policy if exists users_delete_own on public.users;

revoke all on table public.users from anon, authenticated;

grant select, insert, update, delete on table public.users to service_role;
grant usage, select on all sequences in schema public to service_role;
