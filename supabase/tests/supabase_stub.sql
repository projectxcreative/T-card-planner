-- Just enough of Supabase to run the migrations against a plain Postgres:
-- the anon/authenticated roles, auth.users, auth.uid() and storage.objects.
-- Used only by supabase/tests/run.sh; a real Supabase project has all of this.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- Supabase reads the signed-in user from the request's JWT claims.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null
);
alter table storage.objects enable row level security;

grant usage on schema public, auth, storage to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant all on storage.objects to authenticated;

-- Supabase's defaults: the API roles get table rights, and RLS does the rest.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
