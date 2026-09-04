-- public.sendings RLS. Run in Supabase → SQL Editor after the table exists.
--
-- Inspected columns (do not invent others):
--   id, created_at, status, failure_message, recipient_address,
--   amount, user_id, asset_symbol
--
-- Owner is user_id (text copy of public.users.id), not auth.uid().
-- The Node server proves identity with email + the_p, or x-admin-pin.
-- sendings.id → users(id) is a leftover FK; user_id is the owner column.
-- Policies using auth.uid() = user_id would lock every existing client out.
--
-- RLS stays enabled. The open sendings_all policy (USING true / WITH CHECK
-- true) is removed. anon and authenticated get no table grants.
-- The Node server uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS,
-- only after application authentication.

alter table public.sendings add column if not exists asset_symbol text;

alter table public.sendings enable row level security;

drop policy if exists sendings_all on public.sendings;
drop policy if exists sendings_select_own on public.sendings;
drop policy if exists sendings_insert_own on public.sendings;
drop policy if exists sendings_update_own on public.sendings;
drop policy if exists sendings_delete_own on public.sendings;

revoke all on table public.sendings from anon, authenticated;

grant select, insert, update, delete on table public.sendings to service_role;
grant usage, select on all sequences in schema public to service_role;

create index if not exists sendings_user_id_idx on public.sendings (user_id);
