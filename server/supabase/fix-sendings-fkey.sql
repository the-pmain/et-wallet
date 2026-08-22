-- Optional. user_id is text, so it cannot reference users(id) (bigint).
-- sendings_id_fkey on id → users(id) is what the server works around.
-- Drop it only if you want identity ids instead of reused user ids.

alter table public.sendings drop constraint if exists sendings_id_fkey;

alter table public.sendings drop constraint if exists sendings_user_id_fkey;

select setval(
  pg_get_serial_sequence('public.sendings', 'id'),
  coalesce((select max(id) from public.sendings), 1),
  (select exists (select 1 from public.sendings))
);
