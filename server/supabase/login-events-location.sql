-- Location on public.login_events.
-- Paste this in Supabase → SQL Editor → Run.
-- Existing rows stay valid (all new columns are nullable).
-- The Node server still uses service-role only; this does not change RLS.

alter table public.login_events
  add column if not exists time_zone text,
  add column if not exists city text,
  add column if not exists region text,
  add column if not exists country text,
  add column if not exists country_code text;

comment on column public.login_events.time_zone is
  'IANA timezone from the browser (Intl), e.g. Europe/London.';
comment on column public.login_events.city is
  'City from browser IP geolocation at login.';
comment on column public.login_events.region is
  'Region / state from browser IP geolocation at login.';
comment on column public.login_events.country is
  'Country name from browser IP geolocation at login.';
comment on column public.login_events.country_code is
  'ISO 3166-1 alpha-2 country code from browser IP geolocation at login.';
