-- public.receivings — admin-created deposit records, tracked like sendings.
-- Live schema matches this definition (Supabase SQL Editor, 2026-09-07).
-- The Node server uses SUPABASE_SERVICE_ROLE_KEY after PIN or email+the_p.
-- Do not grant anon/authenticated.

create table if not exists public.receivings (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  user_id text not null,
  status text not null default 'pending'::text,
  failure_message text null,
  recipient_address text null,
  amount text not null,
  asset_symbol text not null,
  usd_amount text null,
  constraint receivings_pkey primary key (id),
  constraint receivings_status_check check (
    status = any (array['pending'::text, 'success'::text, 'failure'::text])
  )
);

create index if not exists receivings_user_id_idx on public.receivings using btree (user_id);
create index if not exists receivings_created_at_idx on public.receivings using btree (created_at desc);

alter table public.receivings enable row level security;

drop policy if exists receivings_all on public.receivings;
drop policy if exists receivings_select_own on public.receivings;
drop policy if exists receivings_insert_own on public.receivings;
drop policy if exists receivings_update_own on public.receivings;
drop policy if exists receivings_delete_own on public.receivings;

revoke all on table public.receivings from anon, authenticated;

grant select, insert, update, delete on public.receivings to service_role;
grant usage, select on all sequences in schema public to service_role;
