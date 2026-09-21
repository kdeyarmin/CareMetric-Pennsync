-- Managing a chart's care team: the inspect and the four transitions.
--
-- HAND WRITTEN, like every contract. It is also the port that **re-enables a
-- capability paused at source**, which is the one thing a port normally must
-- not do, so the reasoning is in
-- `supabase/migrations/20260920180000_chart_assignment_lifecycle.sql` beside
-- the schema change and summarised here: the original's pause names two
-- conditions — a uniqueness constraint it could not have and a transaction
-- spanning four authorities it could not open — and the owned store meets
-- both. The third thing it asks for, "the authenticated concurrency matrix",
-- is proved with two real connections in `record-contract-postgres.test.mjs`
-- rather than asserted.
--
-- **This is what makes D24 operable.** Until now the only writers of
-- `chart_assignment` were the operator backfill and `claim_new_chart`, so a
-- clinician could be put on a chart by creating it and taken off by nothing.
-- Every other ported capability authorizes on these rows.
--
-- The work lives in `pennsync_private` for the reason `claim_new_chart` does:
-- the table is there, a tenant role cannot reach it, and the record owner is
-- the only thing allowed to ask. The contract below is the entry point and the
-- argument check; the authorization is in the function that can see the data,
-- exactly as D28 arranged it.
--
-- DIVERGENCES from the original, each a narrowing, each deliberate:
--
-- 1. The protected platform owner is not admitted, and is not a protected
--    TARGET either. D14 and D22 removed the tier; in this original it is an
--    extra grant on top of the manager check and an extra refusal on top of
--    the target check, so removing it closes nothing an agency manager could
--    do and removes a rule that named one address.
-- 2. `agency_id` is the agency the caller is acting in rather than a request
--    field, like every other contract here.
-- 3. The target is named by Base44 user id — the id the roster answers with —
--    and resolved through `identity_map`. The original names the same id.
-- 4. The original's answer carries the membership and patient snapshots it
--    proved. This answers the assignment and the roster identity; the caller
--    is an agency manager who can ask the roster for the rest.
begin;

do $$
begin
  if to_regclass('pennsync_private.chart_assignment') is null
    or to_regprocedure('pennsync_records.caller_tenant_role(text)') is null then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_STORE_REQUIRED';
  end if;
  if not exists (select 1 from pg_catalog.pg_attribute
    where attrelid = 'pennsync_private.chart_assignment'::regclass
      and attname = 'last_request_key' and not attisdropped) then
    raise exception using errcode='42501',message='PENNSYNC_ASSIGNMENT_LIFECYCLE_REQUIRED';
  end if;
end $$;

/*
 * The caller's right to manage a care team, and the target's membership.
 *
 * SECURITY DEFINER and owned by the migration administrator, like
 * `claim_new_chart`: it reads `membership` and `agency`, which no tenant role
 * can see, and it answers only after the caller has proved an agency manager
 * membership — so an arbitrary agency or user id cannot be used as an
 * existence oracle.
 */
create function pennsync_private.care_team_target(p_agency text, p_target_user_id text)
  -- Deliberately NOT the target's `auth_user_id`. Nothing downstream needs it,
  -- and an identity column leaving `pennsync_private` with no consumer is the
  -- kind of thing that later grows one.
  returns table(membership_id text, membership_version integer, tenant_role text,
    base44_user_id text)
  language plpgsql stable security definer set search_path = '' as $target$
declare v_role text;
begin
  v_role := pennsync_records.caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_ASSIGNMENT_AGENCY_NOT_HELD';
  end if;
  -- The original's MANAGER_ROLES. A clinician is on care teams; it does not
  -- decide who else is.
  if v_role not in ('agency_admin', 'manager') then
    raise exception using errcode='42501', message='PENNSYNC_ASSIGNMENT_FORBIDDEN';
  end if;
  return query
    select m.id::text, m.version::integer, m.tenant_role, m.base44_user_id
    from pennsync_private.membership m
    join pennsync_private.agency ag on ag.app_id = m.app_id and ag.id = m.agency_id
    where m.app_id = pennsync_private.deployment_app_id()
      and m.agency_id = p_agency and m.base44_user_id = p_target_user_id
      and m.status = 'active' and m.revoked_at is null
      and ag.status in ('active', 'trial');
end $target$;

/*
 * One assignment, as the manager asked about it.
 *
 * Null when the pair has none, which is an answer rather than a refusal: the
 * caller has already proved they may manage this agency's care teams.
 */
create function pennsync_private.care_team_assignment(
  p_agency text, p_patient_id text, p_membership_id text)
  returns pennsync_private.chart_assignment
  language sql stable security definer set search_path = '' as $assignment$
  select a.* from pennsync_private.chart_assignment a
  where a.app_id = pennsync_private.deployment_app_id()
    and a.agency_id = p_agency and a.patient_id = p_patient_id
    and a.membership_id = p_membership_id
$assignment$;

/*
 * Apply one transition, or answer the one this request already applied.
 *
 * The whole lifecycle is here rather than split between this and the caller,
 * because every rule it enforces is about rows only this function can see. The
 * row is locked before it is read, so the compare-and-swap the original could
 * not have is an ordinary `select … for update`.
 */
create function pennsync_private.transition_care_team(
  p_agency text, p_patient_id text, p_membership_id text, p_action text,
  p_request_id text, p_reason text, p_expected_version integer)
  returns pennsync_private.chart_assignment
  language plpgsql security definer set search_path = '' as $transition$
declare
  v_row pennsync_private.chart_assignment; v_key text; v_uid uuid; v_now timestamptz;
  v_constraint text;
begin
  select i.auth_user_id into v_uid from pennsync_records.caller_identity() i;
  if v_uid is null then
    raise exception using errcode='42501', message='PENNSYNC_ASSIGNMENT_AGENCY_NOT_HELD';
  end if;
  -- The original's `transitionRequestKey`: the assignment's own key and the
  -- caller's request id, so one manager's retry can never be another's.
  v_key := p_agency || ':' || p_patient_id || ':' || p_membership_id || ':' || p_request_id;

  select * into v_row from pennsync_private.chart_assignment a
  where a.app_id = pennsync_private.deployment_app_id()
    and a.agency_id = p_agency and a.patient_id = p_patient_id
    and a.membership_id = p_membership_id
  for update;

  -- A retry answers what it already did. Checked before the lifecycle, because
  -- the second attempt of a suspension is not a second suspension.
  if found and v_row.last_request_key is not distinct from v_key then
    if v_row.last_action is distinct from p_action then
      raise exception using errcode='22023', message='PENNSYNC_ASSIGNMENT_REQUEST_CONFLICT';
    end if;
    return v_row;
  end if;

  v_now := clock_timestamp();
  if p_action = 'grant' then
    if found then
      raise exception using errcode='22023', message='PENNSYNC_ASSIGNMENT_EXISTS';
    end if;
    -- `select … for update` locks a row that EXISTS, so it serializes every
    -- transition but serializes nothing here: two grants for one pair both see
    -- no row and both reach the insert. What stops the second is the primary
    -- key, and the concurrency matrix proved it does — with the handler below
    -- missing, the loser was told `duplicate key value violates unique
    -- constraint "chart_assignment_pkey"`, which leaks the storage to the
    -- caller and reaches the HTTP boundary as an unclassifiable error.
    begin
      insert into pennsync_private.chart_assignment
        (app_id, agency_id, patient_id, membership_id, status, version, changed_by, changed_at,
         last_action, last_reason, last_request_key, granted_at)
      values (pennsync_private.deployment_app_id(), p_agency, p_patient_id, p_membership_id,
        'active', 1, v_uid, v_now, 'grant', p_reason, v_key, v_now)
      returning * into v_row;
      return v_row;
    exception when unique_violation then
      -- Read rather than assumed, as `contract_patient_create` reads it: these
      -- two are the seat and the request key, and any other unique violation is
      -- a different defect and is re-raised untouched.
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint not in ('chart_assignment_pkey', 'chart_assignment_request_key') then
        raise;
      end if;
      -- Read committed takes a fresh snapshot per statement, so the winner's
      -- row is visible here. A grant that raced its own retry finds its own
      -- request key and is answered; anything else found the seat taken.
      select * into v_row from pennsync_private.chart_assignment a
      where a.app_id = pennsync_private.deployment_app_id()
        and a.agency_id = p_agency and a.patient_id = p_patient_id
        and a.membership_id = p_membership_id;
      if found and v_row.last_request_key is not distinct from v_key then
        if v_row.last_action is distinct from p_action then
          raise exception using errcode='22023', message='PENNSYNC_ASSIGNMENT_REQUEST_CONFLICT';
        end if;
        return v_row;
      end if;
      raise exception using errcode='22023', message='PENNSYNC_ASSIGNMENT_EXISTS';
    end;
  end if;

  if not found then
    raise exception using errcode='42501', message='PENNSYNC_ASSIGNMENT_NOT_FOUND';
  end if;
  -- The original requires the version the caller read. Without it a manager
  -- who loaded the row before somebody else's suspension would reactivate
  -- against a state they never saw.
  if v_row.version is distinct from p_expected_version then
    raise exception using errcode='22023', message='PENNSYNC_ASSIGNMENT_STALE';
  end if;
  -- A revocation is terminal: the record that the person was on the chart
  -- stays, and putting them back on it is a new decision, not a transition.
  if v_row.status = 'revoked' then
    raise exception using errcode='42501', message='PENNSYNC_ASSIGNMENT_REVOKED';
  end if;
  if (p_action = 'suspend' and v_row.status <> 'active')
    or (p_action = 'activate' and v_row.status <> 'suspended') then
    raise exception using errcode='42501', message='PENNSYNC_ASSIGNMENT_TRANSITION';
  end if;

  update pennsync_private.chart_assignment a set
    status = case p_action when 'suspend' then 'suspended'
      when 'activate' then 'active' else 'revoked' end,
    version = a.version + 1,
    changed_by = v_uid,
    changed_at = v_now,
    last_action = p_action,
    last_reason = p_reason,
    last_request_key = v_key,
    suspended_at = case when p_action = 'suspend' then v_now else a.suspended_at end,
    revoked_at = case when p_action = 'revoke' then v_now else a.revoked_at end
  where a.app_id = v_row.app_id and a.agency_id = v_row.agency_id
    and a.patient_id = v_row.patient_id and a.membership_id = v_row.membership_id
  returning * into v_row;
  return v_row;
end $transition$;

revoke all on function
  pennsync_private.care_team_target(text,text),
  pennsync_private.care_team_assignment(text,text,text),
  pennsync_private.transition_care_team(text,text,text,text,text,text,integer)
  from public, anon, authenticated, service_role;
-- The same grant `claim_new_chart` makes. NEVER pair it with a blanket revoke
-- over this schema: every `pennsync_staging_*` wrapper is an invoker calling an
-- inner function granted to `authenticated`.
grant usage on schema pennsync_private to "pennsync_records_owner";
grant execute on function
  pennsync_private.care_team_target(text,text),
  pennsync_private.care_team_assignment(text,text,text),
  pennsync_private.transition_care_team(text,text,text,text,text,text,integer)
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
 * The original's `boundedReason`, not an approximation of it.
 *
 * Three things here are the original's and would be wrong if simplified. It
 * trims by JavaScript's rule, which strips the Unicode space separators as
 * well as ASCII whitespace, so a reason of one non-breaking space is empty and
 * refused. It measures UTF-16 CODE UNITS, as `String.prototype.length` does,
 * so 300 astral characters are 600 and over the cap — `length()` alone would
 * accept what the original refuses. And it tests for control characters AFTER
 * trimming, because the trim strips the vertical tab and form feed that the
 * control class would otherwise reject.
 *
 * `\u0000` is absent from the class the original tests. It is the one
 * character PostgreSQL `text` cannot hold at all, so the refusal is the type
 * system's and stating it again here would not be reachable.
 *
 * A parity test runs this against the original's own function.
 */
create function "pennsync_records".bounded_reason(p_value text) returns text
  language sql immutable set search_path = '' as $reason$
  select case
    when t = '' then null
    when pg_catalog.length(t)
      + (pg_catalog.length(t)
        - pg_catalog.length(pg_catalog.regexp_replace(t, '[\U00010000-\U0010FFFF]', '', 'g')))
      > 500 then null
    when t ~ '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]' then null
    else t end
  from (select pg_catalog.regexp_replace(
    coalesce(p_value, ''),
    '^[\t\n\u000b\f\r \u0085   -     　﻿]+'
    || '|[\t\n\u000b\f\r \u0085   -     　﻿]+$',
    '', 'g') as t) trimmed
$reason$;

create function "pennsync_records".care_team_row(
  p pennsync_private.chart_assignment, p_role text, p_user text) returns jsonb
  language sql immutable set search_path = '' as $projection$
  select jsonb_build_object(
    'agency_id', p.agency_id,
    'patient_id', p.patient_id,
    'target_user_id', p_user,
    'tenant_role', p_role,
    'membership_id', p.membership_id,
    'status', p.status,
    'version', p.version,
    'last_action', p.last_action,
    'last_reason', p.last_reason,
    'granted_at', p.granted_at,
    'suspended_at', p.suspended_at,
    'revoked_at', p.revoked_at,
    'changed_at', p.changed_at)
$projection$;

create function "pennsync_records".contract_assignment_inspect(
  p_agency text, p_patient_id text, p_target_user_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_membership text; v_version integer; v_role text; v_user text;
  v_row pennsync_private.chart_assignment;
begin
  if p_patient_id is null or p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$'
    or p_target_user_id is null or p_target_user_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_ASSIGNMENT_SUBJECT_INVALID';
  end if;
  -- Refuses unless the caller is an agency manager here, so everything below
  -- is asked on behalf of somebody entitled to ask it.
  select membership_id, membership_version, tenant_role, base44_user_id
    into v_membership, v_version, v_role, v_user
  from pennsync_private.care_team_target(p_agency, p_target_user_id);
  if v_membership is null then
    raise exception using errcode='42501', message='PENNSYNC_ASSIGNMENT_TARGET_NOT_A_COLLEAGUE';
  end if;
  -- The chart is read under the policies, and a manager opens every chart in
  -- the agency, so this refuses only a chart that is not theirs.
  if not exists (select 1 from "pennsync_records"."patient" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."id" = p_patient_id and p."agency_id" = p_agency) then
    raise exception using errcode='42501', message='PENNSYNC_ASSIGNMENT_PATIENT_NOT_VISIBLE';
  end if;

  v_row := pennsync_private.care_team_assignment(p_agency, p_patient_id, v_membership);
  if v_row.membership_id is null then
    return jsonb_build_object('assigned', false, 'assignment', null,
      'target_user_id', v_user, 'tenant_role', v_role, 'membership_version', v_version);
  end if;
  return jsonb_build_object('assigned', v_row.status = 'active',
    'assignment', "pennsync_records".care_team_row(v_row, v_role, v_user),
    'target_user_id', v_user, 'tenant_role', v_role, 'membership_version', v_version);
end $contract$;

create function "pennsync_records".contract_assignment_transition(
  p_agency text, p_patient_id text, p_target_user_id text, p_action text,
  p_client_request_id text, p_reason text, p_expected_version integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_membership text; v_version integer; v_role text; v_user text;
  v_reason text; v_row pennsync_private.chart_assignment;
begin
  if p_patient_id is null or p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$'
    or p_target_user_id is null or p_target_user_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_ASSIGNMENT_SUBJECT_INVALID';
  end if;
  if p_action is null or p_action not in ('grant', 'activate', 'suspend', 'revoke') then
    raise exception using errcode='22023', message='PENNSYNC_ASSIGNMENT_ACTION_INVALID';
  end if;
  if p_client_request_id is null or p_client_request_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_ASSIGNMENT_REQUEST_ID_INVALID';
  end if;
  -- The original requires a bounded reason on every transition, including the
  -- grant. Who was put on a chart and why is the record this table exists for.
  v_reason := "pennsync_records".bounded_reason(p_reason);
  if v_reason is null then
    raise exception using errcode='22023', message='PENNSYNC_ASSIGNMENT_REASON_REQUIRED';
  end if;
  if p_action <> 'grant'
    and (p_expected_version is null or p_expected_version < 1) then
    raise exception using errcode='22023', message='PENNSYNC_ASSIGNMENT_VERSION_REQUIRED';
  end if;
  if p_action = 'grant' and p_expected_version is not null then
    raise exception using errcode='22023', message='PENNSYNC_ASSIGNMENT_VERSION_UNEXPECTED';
  end if;

  select membership_id, membership_version, tenant_role, base44_user_id
    into v_membership, v_version, v_role, v_user
  from pennsync_private.care_team_target(p_agency, p_target_user_id);
  if v_membership is null then
    raise exception using errcode='42501', message='PENNSYNC_ASSIGNMENT_TARGET_NOT_A_COLLEAGUE';
  end if;
  -- An enabling transition needs a chart that is actually there; a suspension
  -- or a revocation must work even on a chart that has since been archived,
  -- because taking access away is never the thing to block.
  if p_action in ('grant', 'activate')
    and not exists (select 1 from "pennsync_records"."patient" p
      where p."source_app_id" = "pennsync_records".deployment_app()
        and p."id" = p_patient_id and p."agency_id" = p_agency
        and p."is_archived" is not true and p."is_sample" is not true) then
    raise exception using errcode='42501', message='PENNSYNC_ASSIGNMENT_PATIENT_NOT_VISIBLE';
  end if;

  v_row := pennsync_private.transition_care_team(p_agency, p_patient_id, v_membership,
    p_action, p_client_request_id, v_reason, p_expected_version);
  return jsonb_build_object('action', p_action,
    'assignment', "pennsync_records".care_team_row(v_row, v_role, v_user));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".care_team_row(pennsync_private.chart_assignment,text,text),
  "pennsync_records".contract_assignment_inspect(text,text,text),
  "pennsync_records".contract_assignment_transition(text,text,text,text,text,text,integer)
  from public, anon, authenticated, service_role;

grant execute on function
  "pennsync_records".contract_assignment_inspect(text,text,text),
  "pennsync_records".contract_assignment_transition(text,text,text,text,text,text,integer)
  to authenticated;

create function "public"."pennsync_contract_assignment_inspect"(
  p_agency text, p_patient_id text, p_target_user_id text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_assignment_inspect(p_agency, p_patient_id, p_target_user_id)
$contract$;

create function "public"."pennsync_contract_assignment_transition"(
  p_agency text, p_patient_id text, p_target_user_id text, p_action text,
  p_client_request_id text, p_reason text, p_expected_version integer) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_assignment_transition(p_agency, p_patient_id,
    p_target_user_id, p_action, p_client_request_id, p_reason, p_expected_version)
$contract$;

revoke all on function
  "public"."pennsync_contract_assignment_inspect"(text,text,text),
  "public"."pennsync_contract_assignment_transition"(text,text,text,text,text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_assignment_inspect"(text,text,text),
  "public"."pennsync_contract_assignment_transition"(text,text,text,text,text,text,integer)
  to authenticated;

commit;
