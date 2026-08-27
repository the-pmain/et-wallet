-- Email manager reads Cloudflare (GraphQL activity log + KV), not Postgres.
drop table if exists public.emails cascade;
