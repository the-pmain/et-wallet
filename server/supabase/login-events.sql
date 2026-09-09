-- public.login_events — one row per successful app login (POST /v1/users/auth).
-- The Node server uses SUPABASE_SERVICE_ROLE_KEY after email+the_p or x-admin-pin.
-- Do not grant anon/authenticated.
-- user_id is a text copy of public.users.id (bigint). No FK: same as sendings/receivings.

create table if not exists public.login_events (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  user_id text not null,
  time_zone text,
  city text,
  region text,
  country text,
  country_code text,
  constraint login_events_pkey primary key (id)
);

create index if not exists login_events_user_id_idx
  on public.login_events using btree (user_id);

create index if not exists login_events_created_at_idx
  on public.login_events using btree (created_at desc);

create index if not exists login_events_user_id_created_at_idx
  on public.login_events using btree (user_id, created_at desc);

alter table public.login_events enable row level security;

drop policy if exists login_events_all on public.login_events;
drop policy if exists login_events_select_own on public.login_events;
drop policy if exists login_events_insert_own on public.login_events;
drop policy if exists login_events_update_own on public.login_events;
drop policy if exists login_events_delete_own on public.login_events;

revoke all on table public.login_events from anon, authenticated;

grant select, insert, update, delete on public.login_events to service_role;
grant usage, select on all sequences in schema public to service_role;
