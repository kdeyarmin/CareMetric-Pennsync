-- LOCAL TEST DOUBLE ONLY. Never deploy this file to Supabase.
-- This represents the minimum platform catalogs used by the recovered SQL.
-- It does not implement the Storage API, object bytes or the pg_cron worker.
do $$ begin
  if (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role'))<>3 then
    raise exception 'Dedicated test server must already provide anon, authenticated and service_role roles';
  end if;
end $$;
do $$ begin
  if exists(select 1 from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls)) then
    raise exception 'Browser test roles must not bypass row security';
  end if;
end $$;
create schema storage;
create table storage.buckets(id text primary key,name text not null,public boolean not null,
  file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null);
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated;
grant select,insert,update,delete on storage.objects to anon,authenticated;
-- An unrelated broad policy must not defeat the restrictive bucket exclusion.
create policy local_other_product_policy on storage.objects for all to anon,authenticated using(true) with check(true);
create schema cron;
create table cron.job(jobid bigint generated always as identity primary key,jobname text unique not null,schedule text not null,command text not null,active boolean not null default true);
create function cron.schedule(p_name text,p_schedule text,p_command text) returns bigint
language plpgsql set search_path='' as $$ declare id bigint; begin
 insert into cron.job(jobname,schedule,command) values(p_name,p_schedule,p_command)
 on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command
 returning jobid into id; return id;
end $$;
-- Reproduce the historical server grants explicitly in the test fixture only.
alter default privileges in schema public grant all on tables to service_role;
create function public.pennsync_integration_local_test_double() returns boolean language sql set search_path='' as $$select true$$;
