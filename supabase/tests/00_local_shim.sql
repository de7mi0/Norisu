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

-- ---------------------------------------------------------------------------
-- Storage, enough of it to test the policies that guard salon photographs
-- ---------------------------------------------------------------------------
--
-- Supabase provides a `storage` schema with `buckets` and `objects`, and the
-- helpers a policy uses to reason about a path. Photographs are the first thing
-- here to need them, and the rules that matter — an owner may write only inside
-- their own salon's folder — are ordinary row-level security on storage.objects.
-- So they are worth asserting rather than hoping, and that means mirroring just
-- enough of the real thing.
--
-- Deliberately minimal: no size accounting, no image transformation, none of
-- the columns the real table has that no policy of ours reads. This exists to
-- make `(storage.foldername(name))[1]` mean the same thing here as it does in
-- production, and nothing else. Never applied to Supabase.

create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text not null references storage.buckets (id) on delete cascade,
  -- The full path inside the bucket, e.g. "<salon id>/cover/abc.jpg".
  name       text not null,
  owner      uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata   jsonb,
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;

-- The path split Supabase's own helpers perform. foldername() is every segment
-- *except* the file, which is what makes [1] the salon id in our layout.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)];
$$;

create or replace function storage.filename(name text)
returns text
language sql
immutable
as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)];
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;
grant execute on function storage.foldername(text), storage.filename(text)
  to anon, authenticated, service_role;
