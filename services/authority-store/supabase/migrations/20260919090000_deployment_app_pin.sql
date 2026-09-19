-- The app namespace stops being a staging literal and becomes a per-deployment pin.
--
-- Until now the store pinned one app id in two independent places: the domain
-- `pennsync_private.staging_app`, whose CHECK admitted exactly the staging app
-- and which types every app-scoped column, and a literal comparison inside
-- `pennsync_private.actor()`, which every read path calls. Nothing could be
-- enrolled for production without moving both, so Phase 1 could not start.
--
-- Widening a literal into a set would let one database hold rows for several
-- apps, which is exactly what must never happen: the hosted staging project must
-- keep refusing production identifiers after this lands. So the literal becomes
-- a pin instead of a set. Each database records, once, which single app it
-- serves; the domain and `actor()` both read that pin rather than a constant.
-- The migration text is identical in every deployment, and what differs is one
-- row of data that cannot be edited afterwards.
--
-- Scope: this opens enrollment (identity_map, agency, membership, assignment) to
-- a production deployment. It does NOT open this store to production PHI. The
-- synthetic-shape constraints -- `agency.name like 'Synthetic %'`,
-- `patient.display_name like 'Synthetic %'`, `patient.synthetic` -- are untouched
-- and still refuse real names in every deployment. Relaxing those is a separate,
-- separately reviewed migration.
begin;
-- Same requirement as the first migration: FORCE RLS with no allowing policy
-- binds ordinary table owners too, so this must run as the trusted migration
-- administrator. Never open a policy to compensate for an unsuitable role.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED';
  end if;
end $$;

-- Every app id this codebase knows about. Membership here is a code decision,
-- reviewed in this file; it is not what admits a row. The legacy app
-- 68ee80d98929370f9e8f2932 is deliberately absent: it is retired, and leaving it
-- out means no deployment can ever be pinned to it, not even by mistake.
create table pennsync_private.known_app (
  app_id text primary key check (app_id ~ '^[a-f0-9]{24}$'),
  label text not null unique check (label in ('staging','production'))
);
insert into pennsync_private.known_app (app_id, label) values
  ('6a9881683dc68a0bd54f1ef7','staging'),
  ('694ec16e72e01b60d22f7cbf','production');

-- Which one this database serves. One row, written once, never changed. The
-- primary key admits a single row; the triggers below refuse every later edit.
-- `source` records whether an operator chose the pin or it defaulted, so an
-- auditor reading a production database can tell deliberate from accidental.
create table pennsync_private.deployment (
  singleton boolean primary key default true check (singleton),
  app_id text not null references pennsync_private.known_app(app_id),
  source text not null check (source in ('setting','default')),
  pinned_at timestamptz not null default clock_timestamp()
);

-- The pin comes from `pennsync.deployment_app_id`, set on the database before
-- migrations run. Unset defaults to staging, which is the restrictive outcome:
-- a production database whose operator forgot the setting refuses every
-- production write rather than silently accepting one. An unrecognised value
-- fails the migration outright, so a typo cannot produce an uncontained store.
do $$
declare
  v_requested text := nullif(btrim(coalesce(current_setting('pennsync.deployment_app_id', true), '')), '');
  v_app text := coalesce(v_requested, '6a9881683dc68a0bd54f1ef7');
begin
  if not exists (select 1 from pennsync_private.known_app k where k.app_id = v_app) then
    raise exception using errcode='22023', message='PENNSYNC_UNKNOWN_DEPLOYMENT_APP';
  end if;
  insert into pennsync_private.deployment (app_id, source)
    values (v_app, case when v_requested is null then 'default' else 'setting' end);
end $$;

create function pennsync_private.protect_deployment() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode='23514',message='PENNSYNC_IMMUTABLE_DEPLOYMENT';
end $$;
create trigger deployment_pin_immutable before update or delete on pennsync_private.deployment
for each row execute function pennsync_private.protect_deployment();
create trigger deployment_pin_untruncatable before truncate on pennsync_private.deployment
for each statement execute function pennsync_private.protect_deployment();

alter table pennsync_private.known_app enable row level security;
alter table pennsync_private.known_app force row level security;
alter table pennsync_private.deployment enable row level security;
alter table pennsync_private.deployment force row level security;
revoke all on pennsync_private.known_app,pennsync_private.deployment
  from public,anon,authenticated,service_role;

-- What the domain's CHECK delegates to. Deliberately not IMMUTABLE: it reads the
-- pin. That is sound only because the pin is written once and the triggers above
-- refuse every change, so for a given input this returns the same answer for the
-- life of the database. Being STABLE rather than IMMUTABLE also stops the planner
-- from folding the coercion of a constant away before the check runs.
create function pennsync_private.app_admitted(p_app_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from pennsync_private.deployment d where d.app_id = p_app_id)
$$;
revoke all on function pennsync_private.app_admitted(text) from public,anon,authenticated;
-- `authenticated` needs this only because a domain coercion is evaluated as the
-- current user, and the RLS backstop is exercised by a direct insert in the
-- tests. It discloses nothing new: `actor()` already tells any authenticated
-- caller whether the app id it supplied is the one this database serves. `anon`
-- is left without it, and without USAGE on the schema in any case.
grant execute on function pennsync_private.app_admitted(text) to authenticated;

-- Which kind of deployment this is. Read only from `actor()`, so it stays
-- revoked from every application role.
create function pennsync_private.deployment_label() returns text
language sql stable security definer set search_path = '' as $$
  select k.label from pennsync_private.deployment d
    join pennsync_private.known_app k on k.app_id = d.app_id
$$;
revoke all on function pennsync_private.deployment_label() from public,anon,authenticated;

-- `staging_app` would be a lie the moment a production deployment exists.
-- Renaming it is free -- the 18 columns that carry it depend on the type by OID --
-- and it stops a future reader from assuming the store is staging-only.
alter domain pennsync_private.staging_app rename to deployment_app;
do $$
declare v_name text;
begin
  select c.conname into strict v_name from pg_catalog.pg_constraint c
    where c.contypid = 'pennsync_private.deployment_app'::regtype;
  execute format('alter domain pennsync_private.deployment_app drop constraint %I', v_name);
end $$;
alter domain pennsync_private.deployment_app
  add constraint deployment_app_is_pinned check (pennsync_private.app_admitted(value));

-- The entry gate moves off the literal too. Both layers must agree, and now they
-- agree by construction: they read the same pin. The body below is the first
-- migration's `actor()` with the app check changed and one guard added;
-- CREATE OR REPLACE keeps its existing grants.
--
-- That guard is the honest limit of this change. Every response this RPC surface
-- builds states `staging: true` and `synthetic: true` in its contract, and those
-- claims are only true in the staging deployment. Admitting production for
-- storage does not make them true, and relabelling eighteen response builders
-- here would claim a port that has not happened: the payloads are still the
-- staging slice's synthetic projections. So storage is admitted for production
-- and this surface is not, until each contract is revised with its own review.
-- An operator enrollment tool writes identity, agency and membership rows
-- directly as the migration administrator and does not pass through here.
create or replace function pennsync_private.actor(p_app_id text,p_write boolean)
returns pennsync_private.identity_map
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid; v_sid uuid; v_jwt jsonb; v_email text; v_session timestamptz;
  v_identity pennsync_private.identity_map;
begin
  if not pennsync_private.app_admitted(p_app_id) then
    raise exception using errcode='22023',message='PENNSYNC_APP_NOT_ADMITTED';
  end if;
  if pennsync_private.deployment_label() <> 'staging' then
    raise exception using errcode='42501',message='PENNSYNC_STAGING_RPC_SURFACE_ONLY';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='25001',message='PENNSYNC_READ_COMMITTED_REQUIRED';
  end if;
  if p_write then perform pg_catalog.pg_advisory_xact_lock(168344,20260918);
  else perform pg_catalog.pg_advisory_xact_lock_shared(168344,20260918); end if;
  v_uid := auth.uid(); v_jwt := auth.jwt();
  if current_setting('role',true) is distinct from 'authenticated'
    or v_uid is null or v_jwt->>'role' is distinct from 'authenticated'
    or coalesce(v_jwt->>'session_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or coalesce(v_jwt->>'exp','') !~ '^[0-9]{1,12}$' then
    raise exception using errcode='28000',message='PENNSYNC_SESSION_REQUIRED';
  end if;
  if (v_jwt->>'exp')::bigint <= extract(epoch from clock_timestamp()) then
    raise exception using errcode='28000',message='PENNSYNC_SESSION_EXPIRED';
  end if;
  v_sid := (v_jwt->>'session_id')::uuid;
  select lower(u.email) into v_email from auth.users u
    where u.id=v_uid and u.deleted_at is null and u.email_confirmed_at is not null
      and u.email_confirmed_at <= clock_timestamp() and u.is_anonymous is false
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
    for share;
  if not found or v_email is null then
    raise exception using errcode='28000',message='PENNSYNC_IDENTITY_INACTIVE';
  end if;
  select s.created_at into v_session from auth.sessions s
    where s.id=v_sid and s.user_id=v_uid
      and s.created_at <= clock_timestamp()
      and s.created_at > clock_timestamp() - interval '12 hours'
      and (s.not_after is null or s.not_after > clock_timestamp())
    for share;
  if not found then
    raise exception using errcode='28000',message='PENNSYNC_SESSION_INACTIVE';
  end if;
  select * into v_identity from pennsync_private.identity_map i
    where i.app_id=p_app_id and i.auth_user_id=v_uid
      and i.enabled and i.revoked_at is null and i.expected_email=v_email
      and i.verified_at <= clock_timestamp()
    for share;
  if not found then
    raise exception using errcode='42501',message='PENNSYNC_IDENTITY_UNMAPPED';
  end if;
  return v_identity;
end $$;
commit;
