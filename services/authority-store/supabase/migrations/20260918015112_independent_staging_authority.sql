-- Staging-only independent authority. No production or existing public tables are touched.
-- The API schema must expose public only, never pennsync_private.
begin;
-- FORCE RLS with no allowing policy also binds ordinary table owners. This
-- migration must be owned by the trusted database migration administrator;
-- never compensate for an unsuitable deployment role by opening a policy.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED';
  end if;
end $$;
create schema pennsync_private;
revoke all on schema pennsync_private from public, anon, authenticated;
grant usage on schema pennsync_private to authenticated;

create domain pennsync_private.identifier as text
  check (value ~ '^[A-Za-z0-9_-]{1,128}$');
create domain pennsync_private.staging_app as text
  check (value = '6a9881683dc68a0bd54f1ef7');
create domain pennsync_private.revision as bigint
  check (value between 1 and 9007199254740991);

create table pennsync_private.identity_map (
  app_id pennsync_private.staging_app not null,
  auth_user_id uuid not null references auth.users(id),
  base44_user_id text not null check (base44_user_id ~ '^[a-f0-9]{24}$'
    and base44_user_id <> '6a98816d3dc68a0bd54f1ef8'),
  expected_email text not null check (length(expected_email) between 3 and 254
    and expected_email = lower(btrim(expected_email)) and expected_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  source_evidence_sha256 text not null check (source_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz not null,
  enabled boolean not null default true,
  revoked_at timestamptz,
  version pennsync_private.revision not null default 1,
  primary key (app_id, auth_user_id),
  unique (app_id, base44_user_id),
  unique (app_id, expected_email),
  unique (app_id, auth_user_id, base44_user_id),
  check ((enabled and revoked_at is null) or (not enabled and revoked_at is not null))
);
create table pennsync_private.agency (
  app_id pennsync_private.staging_app not null,
  id pennsync_private.identifier not null,
  name text not null check (name like 'Synthetic %' and length(name) <= 120),
  status text not null check (status in ('active','trial','suspended')),
  version pennsync_private.revision not null default 1,
  primary key (app_id,id)
);
create table pennsync_private.membership (
  app_id pennsync_private.staging_app not null,
  id pennsync_private.identifier not null,
  agency_id pennsync_private.identifier not null,
  auth_user_id uuid not null,
  base44_user_id text not null,
  membership_key text generated always as (agency_id::text || ':' || base44_user_id) stored,
  tenant_role text not null check (tenant_role in
    ('agency_admin','manager','clinician','office_staff','social_worker','spiritual_care')),
  status text not null check (status in ('active','revoked')),
  version pennsync_private.revision not null default 1,
  revoked_at timestamptz,
  revoked_by uuid,
  primary key (app_id,id),
  unique (app_id,agency_id,auth_user_id),
  unique (app_id,membership_key),
  unique (app_id,agency_id,id),
  foreign key (app_id,agency_id) references pennsync_private.agency(app_id,id),
  foreign key (app_id,auth_user_id,base44_user_id)
    references pennsync_private.identity_map(app_id,auth_user_id,base44_user_id),
  check ((status='active' and revoked_at is null and revoked_by is null)
    or (status='revoked' and revoked_at is not null and revoked_by is not null))
);
create table pennsync_private.patient (
  app_id pennsync_private.staging_app not null,
  id pennsync_private.identifier not null,
  agency_id pennsync_private.identifier not null,
  display_name text not null check (display_name like 'Synthetic %' and length(display_name) <= 120),
  synthetic boolean not null default true check (synthetic),
  version pennsync_private.revision not null default 1,
  primary key (app_id,id),
  unique (app_id,agency_id,id),
  foreign key (app_id,agency_id) references pennsync_private.agency(app_id,id)
);
create table pennsync_private.assignment (
  app_id pennsync_private.staging_app not null,
  agency_id pennsync_private.identifier not null,
  patient_id pennsync_private.identifier not null,
  membership_id pennsync_private.identifier not null,
  status text not null check (status in ('active','revoked')),
  version pennsync_private.revision not null default 1,
  changed_by uuid not null,
  changed_at timestamptz not null default clock_timestamp(),
  primary key (app_id,patient_id,membership_id),
  foreign key (app_id,agency_id,patient_id) references pennsync_private.patient(app_id,agency_id,id),
  foreign key (app_id,agency_id,membership_id) references pennsync_private.membership(app_id,agency_id,id)
);
create table pennsync_private.mutation_receipt (
  app_id pennsync_private.staging_app not null,
  actor_id uuid not null,
  request_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload)='object' and octet_length(payload::text) <= 4096),
  result jsonb not null check (jsonb_typeof(result)='object' and octet_length(result::text) <= 4096),
  created_at timestamptz not null default clock_timestamp(),
  primary key (app_id,actor_id,request_id),
  foreign key (app_id,actor_id) references pennsync_private.identity_map(app_id,auth_user_id)
);

-- Identity provenance is immutable. Disabling it is terminal in this first slice.
create function pennsync_private.protect_identity() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (new.app_id,new.auth_user_id,new.base44_user_id,new.expected_email,
      new.source_evidence_sha256,new.verified_at) is distinct from
     (old.app_id,old.auth_user_id,old.base44_user_id,old.expected_email,
      old.source_evidence_sha256,old.verified_at)
     or not old.enabled or new.enabled or new.revoked_at is null
     or new.version <> old.version + 1 then
    raise exception using errcode='23514',message='PENNSYNC_IMMUTABLE_IDENTITY';
  end if;
  return new;
end $$;
create trigger identity_provenance before update on pennsync_private.identity_map
for each row execute function pennsync_private.protect_identity();

-- No direct browser CRUD, even if a later table grant is accidentally added.
alter table pennsync_private.identity_map enable row level security;
alter table pennsync_private.identity_map force row level security;
alter table pennsync_private.agency enable row level security;
alter table pennsync_private.agency force row level security;
alter table pennsync_private.membership enable row level security;
alter table pennsync_private.membership force row level security;
alter table pennsync_private.patient enable row level security;
alter table pennsync_private.patient force row level security;
alter table pennsync_private.assignment enable row level security;
alter table pennsync_private.assignment force row level security;
alter table pennsync_private.mutation_receipt enable row level security;
alter table pennsync_private.mutation_receipt force row level security;
revoke all on all tables in schema pennsync_private from public,anon,authenticated;

-- Every entry uses the same canonical order: app advisory lock, native user,
-- native session, identity, agency, actor membership, target/patient, assignment,
-- receipt. The app-wide lock is intentionally conservative for staging.
-- Current user/session FOR SHARE locks prevent native revoke/delete from
-- committing before this transaction ends. This does not lock whole Auth tables.
create function pennsync_private.actor(p_app_id text,p_write boolean)
returns pennsync_private.identity_map
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid; v_sid uuid; v_jwt jsonb; v_email text; v_session timestamptz;
  v_identity pennsync_private.identity_map;
begin
  if p_app_id is distinct from '6a9881683dc68a0bd54f1ef7' then
    raise exception using errcode='22023',message='PENNSYNC_STAGING_ONLY';
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

create function pennsync_private.context_value(p_identity pennsync_private.identity_map,p_agency_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_membership pennsync_private.membership; v_agency pennsync_private.agency;
begin
  if p_agency_id is null or p_agency_id !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception using errcode='22023',message='PENNSYNC_INVALID_AGENCY';
  end if;
  select * into v_agency from pennsync_private.agency a
    where a.app_id=p_identity.app_id and a.id=p_agency_id and a.status in ('active','trial') for share;
  if not found then raise exception using errcode='42501',message='PENNSYNC_TENANT_DENIED'; end if;
  select * into v_membership from pennsync_private.membership m
    where m.app_id=p_identity.app_id and m.agency_id=p_agency_id
      and m.auth_user_id=p_identity.auth_user_id and m.base44_user_id=p_identity.base44_user_id
      and m.status='active' for share;
  if not found then raise exception using errcode='42501',message='PENNSYNC_TENANT_DENIED'; end if;
  return jsonb_build_object('contract','cm.pennsync.authority.staging.v1','staging',true,'synthetic',true,
    'app_id',p_identity.app_id,'user_id',p_identity.base44_user_id,'user_email',p_identity.expected_email,
    'auth_user_id',p_identity.auth_user_id,'identity_version',p_identity.version,
    'is_platform_owner',false,'agency_id',v_agency.id,'membership_id',v_membership.id,
    'membership_key',v_membership.membership_key,'membership_version',v_membership.version,
    'tenant_role',v_membership.tenant_role,'membership_status',v_membership.status,
    'agency',jsonb_build_object('id',v_agency.id,'name',v_agency.name,'status',v_agency.status));
end $$;

create function pennsync_private.context(p_app_id text,p_agency_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_identity pennsync_private.identity_map;
begin
  v_identity:=pennsync_private.actor(p_app_id,false);
  return pennsync_private.context_value(v_identity,p_agency_id);
end $$;

create function pennsync_private.memberships(p_app_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_identity pennsync_private.identity_map; v_rows jsonb := '[]'; v_agency text; v_count integer:=0;
begin
  v_identity:=pennsync_private.actor(p_app_id,false);
  for v_agency in select m.agency_id from pennsync_private.membership m
    join pennsync_private.agency a on a.app_id=m.app_id and a.id=m.agency_id
    where m.app_id=p_app_id and m.auth_user_id=v_identity.auth_user_id
      and m.status='active' and a.status in ('active','trial') order by m.agency_id limit 51 loop
    v_count:=v_count+1;
    if v_count>50 then raise exception using errcode='54000',message='PENNSYNC_MEMBERSHIP_LIMIT'; end if;
    v_rows:=v_rows || jsonb_build_array(pennsync_private.context_value(v_identity,v_agency));
  end loop;
  return jsonb_build_object('contract','cm.pennsync.authority.staging.v1','staging',true,'synthetic',true,
    'app_id',p_app_id,'user_id',v_identity.base44_user_id,'user_email',v_identity.expected_email,
    'auth_user_id',v_identity.auth_user_id,'memberships',v_rows);
end $$;

create function pennsync_private.visible_patient(p_app_id text,p_agency_id text,p_patient_id text,p_context jsonb)
returns boolean language sql security invoker set search_path = '' as $$
  select exists(select 1 from pennsync_private.patient p
    where p.app_id=p_app_id and p.agency_id=p_agency_id and p.id=p_patient_id and p.synthetic
    and ((p_context->>'tenant_role')='agency_admin' or
      ((p_context->>'tenant_role')='clinician' and exists(select 1 from pennsync_private.assignment a
        where a.app_id=p_app_id and a.agency_id=p_agency_id and a.patient_id=p.id
          and a.membership_id=p_context->>'membership_id' and a.status='active'))));
$$;

create function pennsync_private.patients(p_app_id text,p_agency_id text,p_limit integer,p_after_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_identity pennsync_private.identity_map; v_context jsonb; v_rows jsonb; v_next text;
begin
  v_identity:=pennsync_private.actor(p_app_id,false);
  v_context:=pennsync_private.context_value(v_identity,p_agency_id);
  if v_context->>'tenant_role' not in ('agency_admin','clinician') then
    raise exception using errcode='42501',message='PENNSYNC_ROSTER_ROLE_DENIED';
  end if;
  if p_limit is null or p_limit<1 or p_limit>100 or (p_after_id is not null
    and (p_after_id !~ '^[A-Za-z0-9_-]{1,128}$' or not pennsync_private.visible_patient(p_app_id,p_agency_id,p_after_id,v_context))) then
    raise exception using errcode='22023',message='PENNSYNC_INVALID_PAGE';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'agency_id',q.agency_id,
      'display_name',q.display_name,'version',q.version,'synthetic',q.synthetic) order by q.id),'[]')
    into v_rows from (select p.* from pennsync_private.patient p
      where p.app_id=p_app_id and p.agency_id=p_agency_id and (p_after_id is null or p.id>p_after_id)
        and pennsync_private.visible_patient(p_app_id,p_agency_id,p.id,v_context)
      order by p.id limit p_limit+1) q;
  if jsonb_array_length(v_rows)>p_limit then
    v_rows:=v_rows - p_limit; v_next:=v_rows->(p_limit-1)->>'id';
  end if;
  return jsonb_build_object('contract','cm.pennsync.authority.staging.v1','staging',true,'synthetic',true,
    'app_id',p_app_id,'auth_user_id',v_identity.auth_user_id,
    'context',v_context,'items',v_rows,'next_cursor',v_next);
end $$;

create function pennsync_private.patient(p_app_id text,p_agency_id text,p_patient_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_identity pennsync_private.identity_map; v_context jsonb; v_result jsonb;
begin
  v_identity:=pennsync_private.actor(p_app_id,false);
  v_context:=pennsync_private.context_value(v_identity,p_agency_id);
  if p_patient_id is null or p_patient_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or not pennsync_private.visible_patient(p_app_id,p_agency_id,p_patient_id,v_context) then
    raise exception using errcode='42501',message='PENNSYNC_PATIENT_DENIED';
  end if;
  select jsonb_build_object('id',p.id,'agency_id',p.agency_id,'display_name',p.display_name,
    'version',p.version,'synthetic',p.synthetic) into v_result from pennsync_private.patient p
    where p.app_id=p_app_id and p.agency_id=p_agency_id and p.id=p_patient_id;
  return jsonb_build_object('contract','cm.pennsync.authority.staging.v1','staging',true,'synthetic',true,
    'app_id',p_app_id,'auth_user_id',v_identity.auth_user_id,'context',v_context,'patient',v_result);
end $$;

-- Narrow mutation engine: assignment grant/revoke or clinician-membership revoke.
-- Replays revalidate the actor, exact payload and current target/result versions.
-- A changed outcome never returns a stale historical receipt as current authority.
create function pennsync_private.mutate(p_app_id text,p_agency_id text,p_patient_id text,
  p_target_membership_id text,p_action text,p_expected_actor_version bigint,
  p_expected_target_version bigint,p_expected_assignment_version bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_identity pennsync_private.identity_map; v_context jsonb; v_target pennsync_private.membership;
  v_assignment pennsync_private.assignment; v_receipt pennsync_private.mutation_receipt;
  v_payload jsonb; v_result jsonb; v_exists boolean; v_patient boolean; v_target_active boolean;
begin
  v_identity:=pennsync_private.actor(p_app_id,true);
  v_context:=pennsync_private.context_value(v_identity,p_agency_id);
  if v_context->>'tenant_role' <> 'agency_admin' then
    raise exception using errcode='42501',message='PENNSYNC_ADMIN_REQUIRED';
  end if;
  if p_request_id is null or p_expected_actor_version is null
    or p_expected_target_version is null or p_expected_target_version<1
    or p_expected_target_version>9007199254740991
    or p_target_membership_id is null or p_target_membership_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or p_action is null or p_action not in ('grant_assignment','revoke_assignment','revoke_membership')
    or (p_action='revoke_membership' and (p_patient_id is not null or p_expected_assignment_version is not null))
    or (p_action<>'revoke_membership' and (p_patient_id is null or p_patient_id !~ '^[A-Za-z0-9_-]{1,128}$'
      or p_expected_assignment_version is null or p_expected_assignment_version<0
      or p_expected_assignment_version>=9007199254740991)) then
    raise exception using errcode='22023',message='PENNSYNC_INVALID_MUTATION';
  end if;
  if (v_context->>'membership_version')::bigint<>p_expected_actor_version then
    raise exception using errcode='PT409',message='PENNSYNC_ACTOR_VERSION_CHANGED';
  end if;
  select * into v_target from pennsync_private.membership m where m.app_id=p_app_id
    and m.agency_id=p_agency_id and m.id=p_target_membership_id for update;
  if not found or v_target.tenant_role<>'clinician' or v_target.auth_user_id=v_identity.auth_user_id then
    raise exception using errcode='42501',message='PENNSYNC_TARGET_DENIED';
  end if;
  v_payload:=jsonb_build_object('contract','cm.pennsync.authority.staging.v1','app_id',p_app_id,
    'agency_id',p_agency_id,'patient_id',p_patient_id,'target_membership_id',p_target_membership_id,
    'action',p_action,'expected_actor_version',p_expected_actor_version,
    'expected_target_version',p_expected_target_version,'expected_assignment_version',p_expected_assignment_version,
    'identity_version',v_identity.version);
  if p_action<>'revoke_membership' then
    select p.synthetic into v_patient from pennsync_private.patient p
      where p.app_id=p_app_id and p.agency_id=p_agency_id and p.id=p_patient_id for share;
    if not found or not v_patient then raise exception using errcode='42501',message='PENNSYNC_PATIENT_DENIED'; end if;
    select * into v_assignment from pennsync_private.assignment a where a.app_id=p_app_id
      and a.agency_id=p_agency_id and a.patient_id=p_patient_id and a.membership_id=p_target_membership_id for update;
    v_exists:=found;
  end if;
  if p_action='grant_assignment' then
    select true into v_target_active from pennsync_private.identity_map i
      join auth.users u on u.id=i.auth_user_id where i.app_id=p_app_id
        and i.auth_user_id=v_target.auth_user_id and i.enabled and i.revoked_at is null
        and i.verified_at<=clock_timestamp() and lower(u.email)=i.expected_email
        and u.deleted_at is null and u.email_confirmed_at is not null
        and u.email_confirmed_at<=clock_timestamp() and u.is_anonymous is false
        and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of i,u;
    if not found or not v_target_active then
      raise exception using errcode='42501',message='PENNSYNC_TARGET_INACTIVE';
    end if;
  end if;
  select * into v_receipt from pennsync_private.mutation_receipt r
    where r.app_id=p_app_id and r.actor_id=v_identity.auth_user_id and r.request_id=p_request_id;
  if found then
    if v_receipt.payload<>v_payload then
      raise exception using errcode='23505',message='PENNSYNC_IDEMPOTENCY_CONFLICT';
    end if;
    if p_action='revoke_membership' then
      if v_target.status<>'revoked' or v_target.version<>(v_receipt.result->>'membership_version')::bigint then
        raise exception using errcode='PT409',message='PENNSYNC_REPLAY_STATE_CHANGED';
      end if;
    elsif v_target.status<>'active' or v_target.version<>p_expected_target_version
      or not v_exists or v_assignment.version<>(v_receipt.result->>'assignment_version')::bigint
      or v_assignment.status<>v_receipt.result->>'assignment_status' then
      raise exception using errcode='PT409',message='PENNSYNC_REPLAY_STATE_CHANGED';
    end if;
    return v_receipt.result || jsonb_build_object('replayed',true);
  end if;
  if v_target.status<>'active' or v_target.version<>p_expected_target_version
    or v_target.version>=9007199254740991 then
    raise exception using errcode='PT409',message='PENNSYNC_TARGET_VERSION_CHANGED';
  end if;
  if p_action='revoke_membership' then
    update pennsync_private.membership set status='revoked',version=version+1,
      revoked_at=clock_timestamp(),revoked_by=v_identity.auth_user_id
      where app_id=p_app_id and id=p_target_membership_id;
    update pennsync_private.assignment set status='revoked',version=version+1,
      changed_by=v_identity.auth_user_id,changed_at=clock_timestamp()
      where app_id=p_app_id and agency_id=p_agency_id and membership_id=p_target_membership_id and status='active';
    v_result:=jsonb_build_object('membership_id',p_target_membership_id,
      'membership_version',v_target.version+1,'membership_status','revoked');
  else
    if (v_exists and v_assignment.version<>p_expected_assignment_version)
      or (not v_exists and p_expected_assignment_version<>0)
      or (p_action='revoke_assignment' and not v_exists) then
      raise exception using errcode='PT409',message='PENNSYNC_ASSIGNMENT_VERSION_CHANGED';
    end if;
    if v_exists then
      update pennsync_private.assignment set status=case when p_action='grant_assignment' then 'active' else 'revoked' end,
        version=version+1,changed_by=v_identity.auth_user_id,changed_at=clock_timestamp()
        where app_id=p_app_id and patient_id=p_patient_id and membership_id=p_target_membership_id
        returning * into v_assignment;
    else
      insert into pennsync_private.assignment(app_id,agency_id,patient_id,membership_id,status,changed_by)
        values(p_app_id,p_agency_id,p_patient_id,p_target_membership_id,'active',v_identity.auth_user_id)
        returning * into v_assignment;
    end if;
    v_result:=jsonb_build_object('patient_id',p_patient_id,'membership_id',p_target_membership_id,
      'membership_version',v_target.version,'assignment_version',v_assignment.version,'assignment_status',v_assignment.status);
  end if;
  v_result:=v_result || jsonb_build_object('contract','cm.pennsync.authority.staging.v1','staging',true,
    'synthetic',true,'app_id',p_app_id,'auth_user_id',v_identity.auth_user_id,
    'agency_id',p_agency_id,'action',p_action,'request_id',p_request_id,'replayed',false);
  insert into pennsync_private.mutation_receipt(app_id,actor_id,request_id,payload,result)
    values(p_app_id,v_identity.auth_user_id,p_request_id,v_payload,v_result);
  return v_result;
end $$;

create function pennsync_private.change_assignment(p_app_id text,p_agency_id text,p_patient_id text,
  p_target_membership_id text,p_action text,p_expected_actor_version bigint,
  p_expected_target_version bigint,p_expected_assignment_version bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_action is null or p_action not in ('grant','revoke') then
    raise exception using errcode='22023',message='PENNSYNC_INVALID_ACTION';
  end if;
  return pennsync_private.mutate(p_app_id,p_agency_id,p_patient_id,p_target_membership_id,
    case when p_action='grant' then 'grant_assignment' else 'revoke_assignment' end,
    p_expected_actor_version,p_expected_target_version,p_expected_assignment_version,p_request_id);
end $$;
create function pennsync_private.revoke_membership(p_app_id text,p_agency_id text,p_target_membership_id text,
  p_expected_actor_version bigint,p_expected_target_version bigint,p_request_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select pennsync_private.mutate(p_app_id,p_agency_id,null,p_target_membership_id,'revoke_membership',
    p_expected_actor_version,p_expected_target_version,null,p_request_id);
$$;

-- Only invoker wrappers live in exposed public. No service-role token can bypass
-- the private actor checks: a current real user/session is still mandatory.
create function public.pennsync_staging_context(p_app_id text,p_agency_id text) returns jsonb
language sql security invoker set search_path = '' as $$ select pennsync_private.context(p_app_id,p_agency_id) $$;
create function public.pennsync_staging_memberships(p_app_id text) returns jsonb
language sql security invoker set search_path = '' as $$ select pennsync_private.memberships(p_app_id) $$;
create function public.pennsync_staging_patients(p_app_id text,p_agency_id text,p_limit integer default 50,p_after_id text default null) returns jsonb
language sql security invoker set search_path = '' as $$ select pennsync_private.patients(p_app_id,p_agency_id,p_limit,p_after_id) $$;
create function public.pennsync_staging_patient(p_app_id text,p_agency_id text,p_patient_id text) returns jsonb
language sql security invoker set search_path = '' as $$ select pennsync_private.patient(p_app_id,p_agency_id,p_patient_id) $$;
create function public.pennsync_staging_assignment(p_app_id text,p_agency_id text,p_patient_id text,
  p_target_membership_id text,p_action text,p_expected_actor_version bigint,p_expected_target_version bigint,
  p_expected_assignment_version bigint,p_request_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  select pennsync_private.change_assignment(p_app_id,p_agency_id,p_patient_id,p_target_membership_id,p_action,
    p_expected_actor_version,p_expected_target_version,p_expected_assignment_version,p_request_id) $$;
create function public.pennsync_staging_revoke_membership(p_app_id text,p_agency_id text,p_target_membership_id text,
  p_expected_actor_version bigint,p_expected_target_version bigint,p_request_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  select pennsync_private.revoke_membership(p_app_id,p_agency_id,p_target_membership_id,
    p_expected_actor_version,p_expected_target_version,p_request_id) $$;

revoke all on all functions in schema pennsync_private from public,anon,authenticated;
grant execute on function pennsync_private.context(text,text), pennsync_private.memberships(text),
  pennsync_private.patients(text,text,integer,text),pennsync_private.patient(text,text,text),
  pennsync_private.change_assignment(text,text,text,text,text,bigint,bigint,bigint,uuid),
  pennsync_private.revoke_membership(text,text,text,bigint,bigint,uuid) to authenticated;
revoke all on function public.pennsync_staging_context(text,text),public.pennsync_staging_memberships(text),
  public.pennsync_staging_patients(text,text,integer,text),public.pennsync_staging_patient(text,text,text),
  public.pennsync_staging_assignment(text,text,text,text,text,bigint,bigint,bigint,uuid),
  public.pennsync_staging_revoke_membership(text,text,text,bigint,bigint,uuid) from public,anon,authenticated;
grant execute on function public.pennsync_staging_context(text,text),public.pennsync_staging_memberships(text),
  public.pennsync_staging_patients(text,text,integer,text),public.pennsync_staging_patient(text,text,text),
  public.pennsync_staging_assignment(text,text,text,text,text,bigint,bigint,bigint,uuid),
  public.pennsync_staging_revoke_membership(text,text,text,bigint,bigint,uuid) to authenticated;
commit;
