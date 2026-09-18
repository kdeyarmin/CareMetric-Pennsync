-- LOCAL TEST DOUBLE ONLY. Loaded solely into a new in-memory PGlite database.
-- Never deploy this file or write synthetic rows to a real Supabase auth schema.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema auth;
create table auth.users (
  id uuid primary key, email text, email_confirmed_at timestamptz,
  banned_until timestamptz, deleted_at timestamptz, is_anonymous boolean not null default false
);
create table auth.sessions (
  id uuid primary key, user_id uuid references auth.users(id), not_after timestamptz,
  created_at timestamptz not null default clock_timestamp(), aal text default 'aal1'
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.jwt(),auth.uid() to authenticated;
-- Marker prevents using fixture files against a hosted database by accident.
create function auth.pennsync_local_test_double() returns boolean language sql as $$ select true $$;
