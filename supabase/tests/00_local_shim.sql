-- LOCAL TEST ONLY — not applied to Supabase.
--
-- Supabase provides the auth schema, the anon / authenticated / service_role
-- roles, and auth.uid(). This recreates just enough of them to run the
-- migrations and the policy tests against a plain Postgres instance.

create schema if not exists auth;

create table auth.users (
  id                  uuid primary key default gen_random_uuid(),
  phone               text unique,
  email               text unique,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- Matches Supabase's implementation: the signed-in user id comes from the JWT,
-- which PostgREST exposes as a session setting.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema public, auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- Supabase configures these as default privileges; mirror them so tables
-- created by the migrations are reachable by the API roles.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

-- Helper used by the tests to act as a given signed-in user.
create or replace function auth.login_as(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

grant execute on function auth.login_as(uuid) to anon, authenticated, service_role;
