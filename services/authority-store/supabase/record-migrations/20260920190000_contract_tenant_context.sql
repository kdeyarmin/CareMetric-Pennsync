-- Which agency the caller is acting in, and which they could choose.
--
-- HAND WRITTEN, like every contract. This pair — `listMyTenantMemberships`
-- and `getMyTenantContext` — is the first port whose originals read NOTHING
-- the record store owns: they read `AgencyMembership` and `Agency`, and the
-- authority store already carries the membership model natively. The port
-- queue counted them `records_schema` because they touch entities; what they
-- actually needed was a contract over `pennsync_private.membership`.
--
-- **Most of both originals is machinery for not having a transaction.** Each
-- one loads the memberships, does its work, loads them AGAIN, compares the two
-- snapshots with `JSON.stringify` and refuses with "Tenant membership changed
-- during request" if they differ — then does the same for the agency, then
-- re-reads the caller and compares that too. Three double-reads and three
-- comparison helpers, in two files. Here the whole thing is one statement in
-- one transaction, so there is no interval to be torn: the snapshot a contract
-- reads IS the snapshot it answers from. Deleting that machinery is not
-- shortening the port, it is porting what the machinery was standing in for.
--
-- The same goes for `validateMemberships`, the forty-line integrity check both
-- originals run over every row they read. Every property it re-derives —
-- a known tenant role, a known status, a version of at least one, a revocation
-- that carries its timestamp and nothing else carrying one, `membership_key`
-- equal to `agency_id:user_id` — is a CHECK constraint or a generated column
-- on `pennsync_private.membership` here. A Base44 entity is re-validated per
-- read because any service-role writer could have corrupted it; a table with
-- the constraint cannot hold the bad row in the first place. The test asserts
-- the constraints exist rather than trusting this paragraph, so removing one
-- fails the suite instead of quietly re-opening the gap.
--
-- **What this is NOT duplicating, and how that was established.** The
-- authority store already exposes `pennsync_staging_memberships(app_id)` and
-- `pennsync_staging_context(app_id, agency_id)`, both granted to
-- `authenticated`, and `resolveAuthority` already calls the second one on
-- EVERY request the business API serves — so `actor` carries the membership
-- id, version, tenant role and agency before a handler runs. Reading the names
-- would have suggested this contract is redundant. Reading the bodies shows
-- the one difference that matters: the staging pair projects
-- `pennsync_private.agency.name`, a column constrained `like 'Synthetic %'`
-- because that table holds this deployment's own synthetic tenants, and it
-- labels its own answer `staging: true, synthetic: true`. An agency's real
-- name is `agency_name` on the CARRIED row, which is what both originals
-- project and what this contract projects. The staging pair also has no
-- optimistic binding and bounds at 50 rather than the originals' 25.
--
-- The consequence for where these live: they are PRE-TENANT capabilities in
-- Base44, and the business API's one invariant is that every request names the
-- agency it acts in. So the bootstrap — a caller who holds no agency yet
-- asking which they hold — stays on the authority store's own RPC, and these
-- two serve a caller who is already inside one agency and wants the full
-- context for it or the list to switch from. `getMyTenantContext` therefore
-- takes its agency from the envelope rather than from a parameter of its own.
--
-- DIVERGENCES from the originals, each a narrowing, each deliberate:
--
-- 1. No platform owner. Both originals answer a caller with no membership at
--    all with `tenant_role: 'platform_owner'`, `is_platform_owner: true` and a
--    context over any agency they name. D14 and D22 removed the tier, so that
--    branch is gone and a caller with no active membership is refused. The
--    answer carries no `is_platform_owner` field: a field that is always false
--    invites a client to test it.
-- 2. The agency must be enabled in the authority store AND carried and enabled
--    in the record store. The originals could only see the carried row, which
--    is what they gate on; this store also owns whether the tenant is enabled,
--    and `care_team_target` already gates on it. Requiring both refuses more
--    than either alone.
-- 3. The optimistic binding is all-or-nothing. The originals parse
--    `expected_membership_id` and `expected_membership_version` as one object;
--    naming one without the other is refused here rather than ignored.
-- 4. The active-membership bound is the originals' 25, not the staging
--    surface's 50. `contract_tenant_context` keeps the auto-select branch for a
--    caller who holds exactly one agency because it is the correct answer in
--    SQL, but nothing in this service reaches it: the envelope always names
--    one.
begin;

do $$
begin
  if to_regclass('pennsync_private.membership') is null
    or to_regprocedure('pennsync_records.caller_tenant_role(text)') is null then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_STORE_REQUIRED';
  end if;
end $$;

/*
 * The caller's own active memberships, newest state, agency order.
 *
 * SECURITY DEFINER and owned by the migration administrator, like
 * `care_team_target`: `membership` and `agency` are this store's own rows and
 * the record owner holds no table in `pennsync_private`. It answers about the
 * CALLER and nobody else, so it takes no user argument — there is no id a
 * caller could name here to ask about somebody else.
 */
create function pennsync_private.caller_tenant_memberships()
  returns table(membership_id text, membership_key text, membership_version integer,
    agency_id text, tenant_role text, agency_enabled boolean)
  language sql stable security definer set search_path = '' as $memberships$
  select m.id::text, m.membership_key, m.version::integer, m.agency_id::text, m.tenant_role,
    (ag.status in ('active', 'trial'))
  from "pennsync_records".caller_identity() i
  join pennsync_private.membership m
    on m.app_id = i.app_id and m.auth_user_id = i.auth_user_id
  join pennsync_private.agency ag on ag.app_id = m.app_id and ag.id = m.agency_id
  -- `status = 'active'` is the whole selectability rule. The table's own check
  -- constraint already ties a revocation to its timestamp, so testing
  -- `revoked_at` again would be testing the constraint rather than the row.
  where m.status = 'active'
  order by m.agency_id
$memberships$;

revoke all on function pennsync_private.caller_tenant_memberships()
  from public, anon, authenticated, service_role;
-- The same grant `claim_new_chart` makes. NEVER pair it with a blanket revoke
-- over this schema: every `pennsync_staging_*` wrapper is an invoker calling an
-- inner function granted to `authenticated`.
grant usage on schema pennsync_private to "pennsync_records_owner";
grant execute on function pennsync_private.caller_tenant_memberships()
  to "pennsync_records_owner";

do $$
declare v_admin text := current_user;
begin
  if exists (select 1 from pg_catalog.pg_roles
    where rolname = 'pennsync_records_owner' and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_OWNER_MUST_NOT_BYPASS_RLS';
  end if;
  begin
    execute format('grant %I to current_user with set true', 'pennsync_records_owner');
  exception
    when syntax_error then execute format('grant %I to current_user', 'pennsync_records_owner');
    when others then null; -- already held, or not ours to grant; proven below
  end;
  begin
    execute format('set role %I', 'pennsync_records_owner');
    execute format('set role %I', v_admin);
  exception when others then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_OWNER_NOT_ASSUMABLE';
  end;
end $$;

set local role "pennsync_records_owner";

/*
 * One agency as the originals show it, or null.
 *
 * The carried row, not the authority store's: `pennsync_private.agency.name`
 * is constrained `like 'Synthetic %'` because that table holds this staging
 * deployment's own tenants, while `agency_name` on the carried row is the
 * agency's real name and is what both originals project. Read under the
 * policies, and `agency_read` is already `id in caller_agencies()`, so this
 * adds no tenant predicate of its own.
 */
create function "pennsync_records".tenant_agency(p_agency text) returns jsonb
  language sql stable set search_path = '' as $agency$
  select jsonb_build_object('id', a."id", 'name', a."agency_name", 'status', a."status")
  from "pennsync_records"."agency" a
  where a."source_app_id" = "pennsync_records".deployment_app()
    and a."id" = p_agency
    and a."agency_name" is not null
    and a."status" in ('active', 'trial')
$agency$;

/*
 * One membership as the originals project it.
 *
 * `membership_status` is the literal `'active'` in both originals, because
 * both project only active memberships. It is kept rather than dropped: a
 * client reading the field would otherwise see it disappear.
 */
create function "pennsync_records".tenant_membership_row(
  p_membership_id text, p_membership_key text, p_version integer,
  p_agency_id text, p_role text, p_agency jsonb) returns jsonb
  language sql immutable set search_path = '' as $row$
  select jsonb_build_object(
    'membership_id', p_membership_id,
    'membership_key', p_membership_key,
    'membership_version', p_version,
    'agency_id', p_agency_id,
    'tenant_role', p_role,
    'membership_status', 'active',
    'agency', p_agency)
$row$;

create function "pennsync_records".contract_tenant_memberships()
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_rows jsonb := '[]'::jsonb; v_agency jsonb; v_count integer := 0; v_email text;
  v_row record;
begin
  v_email := "pennsync_records".caller_email();
  if v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_TENANT_NOT_IDENTIFIED';
  end if;
  for v_row in select * from pennsync_private.caller_tenant_memberships() loop
    v_count := v_count + 1;
    -- The originals' MAX_ACTIVE_MEMBERSHIPS. A selector is a list a person
    -- picks from, and one that long is a data problem rather than a choice.
    if v_count > 25 then
      raise exception using errcode='22023', message='PENNSYNC_TENANT_MEMBERSHIPS_EXCEEDED';
    end if;
    if not v_row.agency_enabled then
      raise exception using errcode='42501', message='PENNSYNC_TENANT_AGENCY_UNAVAILABLE';
    end if;
    v_agency := "pennsync_records".tenant_agency(v_row.agency_id);
    -- The original refuses the WHOLE list when one agency is unavailable
    -- rather than omitting that row, and this keeps that: omitting it would
    -- let the caller carry on in their other agencies, which is more than the
    -- original allows, not less.
    if v_agency is null then
      raise exception using errcode='42501', message='PENNSYNC_TENANT_AGENCY_UNAVAILABLE';
    end if;
    v_rows := v_rows || jsonb_build_array("pennsync_records".tenant_membership_row(
      v_row.membership_id, v_row.membership_key, v_row.membership_version,
      v_row.agency_id, v_row.tenant_role, v_agency));
  end loop;
  return jsonb_build_object(
    'subject', jsonb_build_object(
      'user_id', "pennsync_records".caller_user_id(), 'user_email', v_email),
    'memberships', v_rows);
end $contract$;

create function "pennsync_records".contract_tenant_context(
  p_agency text, p_expected_membership_id text, p_expected_membership_version integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_agency jsonb; v_count integer; v_email text; v_row record;
begin
  if p_agency is not null and p_agency !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_TENANT_SUBJECT_INVALID';
  end if;
  -- All or nothing: the originals parse the two binding fields as one object,
  -- so half of it is a client bug rather than an absent binding.
  if (p_expected_membership_id is null) <> (p_expected_membership_version is null) then
    raise exception using errcode='22023', message='PENNSYNC_TENANT_BINDING_INCOMPLETE';
  end if;
  if p_expected_membership_id is not null
    and p_expected_membership_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_TENANT_SUBJECT_INVALID';
  end if;
  if p_expected_membership_version is not null and p_expected_membership_version < 1 then
    raise exception using errcode='22023', message='PENNSYNC_TENANT_VERSION_INVALID';
  end if;
  v_email := "pennsync_records".caller_email();
  if v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_TENANT_NOT_IDENTIFIED';
  end if;

  select count(*)::integer into v_count from pennsync_private.caller_tenant_memberships();
  if v_count = 0 then
    raise exception using errcode='42501', message='PENNSYNC_TENANT_NO_MEMBERSHIP';
  end if;
  if v_count > 25 then
    raise exception using errcode='22023', message='PENNSYNC_TENANT_MEMBERSHIPS_EXCEEDED';
  end if;
  -- One membership selects itself; more than one is a choice the caller has to
  -- make, and guessing it would put them in an agency they did not name.
  if v_count > 1 and p_agency is null then
    raise exception using errcode='22023', message='PENNSYNC_TENANT_AGENCY_REQUIRED';
  end if;
  select * into v_row from pennsync_private.caller_tenant_memberships() m
  where p_agency is null or m.agency_id = p_agency;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_TENANT_AGENCY_NOT_HELD';
  end if;

  -- The originals' optimistic read binding: the caller says which membership
  -- their selector was showing, and a context is refused rather than answered
  -- against a membership that moved under them.
  if p_expected_membership_id is not null
    and (v_row.membership_id is distinct from p_expected_membership_id
      or v_row.membership_version is distinct from p_expected_membership_version) then
    raise exception using errcode='22023', message='PENNSYNC_TENANT_MEMBERSHIP_CHANGED';
  end if;
  if not v_row.agency_enabled then
    raise exception using errcode='42501', message='PENNSYNC_TENANT_AGENCY_UNAVAILABLE';
  end if;
  v_agency := "pennsync_records".tenant_agency(v_row.agency_id);
  if v_agency is null then
    raise exception using errcode='42501', message='PENNSYNC_TENANT_AGENCY_UNAVAILABLE';
  end if;

  return jsonb_build_object('tenant_context',
    "pennsync_records".tenant_membership_row(
      v_row.membership_id, v_row.membership_key, v_row.membership_version,
      v_row.agency_id, v_row.tenant_role, v_agency)
    || jsonb_build_object(
      'user_id', "pennsync_records".caller_user_id(), 'user_email', v_email));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".tenant_agency(text),
  "pennsync_records".tenant_membership_row(text,text,integer,text,text,jsonb),
  "pennsync_records".contract_tenant_memberships(),
  "pennsync_records".contract_tenant_context(text,text,integer)
  from public, anon, authenticated, service_role;

grant execute on function
  "pennsync_records".contract_tenant_memberships(),
  "pennsync_records".contract_tenant_context(text,text,integer)
  to authenticated;

create function "public"."pennsync_contract_tenant_memberships"() returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_tenant_memberships()
$contract$;

create function "public"."pennsync_contract_tenant_context"(
  p_agency text, p_expected_membership_id text, p_expected_membership_version integer)
  returns jsonb language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_tenant_context(
    p_agency, p_expected_membership_id, p_expected_membership_version)
$contract$;

revoke all on function
  "public"."pennsync_contract_tenant_memberships"(),
  "public"."pennsync_contract_tenant_context"(text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_tenant_memberships"(),
  "public"."pennsync_contract_tenant_context"(text,text,integer)
  to authenticated;

commit;
