-- Moving a colleague through the membership lifecycle.
--
-- HAND WRITTEN, like every contract, and the second PARTIAL port (D31 was the
-- first). `manageAgencyMembership` has six actions and this serves five:
-- `inspect`, `activate`, `suspend`, `revoke` and `change_role`.
--
-- **`provision` is not served, and the reason is not difficulty.** Its own
-- guard reads:
--
--     if (input.action === 'provision') {
--       throw new PublicError(403,
--         'Only the protected platform owner may provision memberships');
--     }
--
-- — reached for every caller who is not the protected platform owner. D14 and
-- D22 removed that tier, so the action has NO PERFORMER LEFT. This is exactly
-- `set_ai_tags` in D31: an action a port cannot serve because the only role
-- that could ever perform it no longer exists, not because the store cannot
-- express it. In this deployment a membership is created by enrollment
-- (`tools-pennsync-enroll.mjs`) or by an operator, and that is an operator
-- path rather than a caller-facing capability.
--
-- The same rule removes a slice of the five that ARE served: the original
-- refuses any caller but the platform owner when the target currently holds
-- `agency_admin` or the request asks for it, so this contract refuses that
-- too. An agency administrator manages their subordinates and cannot make or
-- unmake another administrator. Read `SUBORDINATE_ROLES` in the original: it
-- is `TENANT_ROLES` minus `agency_admin`, and it is the caller's whole scope.
--
-- **What the store models and the original could not.** The lifecycle lives in
-- `pennsync_private.membership` now — see
-- `supabase/migrations/20260920200000_membership_lifecycle.sql` for why adding
-- `pending` and `suspended` closes access rather than opening it. The
-- original's reconcile-after-write ("Provisioned membership could not be
-- reconciled", and the same after every transition) is the no-transaction
-- machinery D34 already described: it writes, reads back, and compares field
-- by field. One statement in one transaction has nothing to reconcile.
--
-- DIVERGENCES from the original, each a narrowing, each deliberate:
--
-- 1. No platform owner, so `provision` is unported and no action may touch an
--    `agency_admin`. Recorded above.
-- 2. The caller must be an active `agency_admin` of the agency they named.
--    The original requires exactly that too — a `manager` cannot manage
--    memberships even though D24 lets them open every chart.
-- 3. The target is named by Base44 user id and resolved through the authority
--    store's membership rather than by a `User` lookup plus an email match.
--    The original carries `user_email_normalized` on the membership and
--    compares it on every transition because the entity could drift; here the
--    membership references `identity_map` by key and cannot.
-- 4. `bounded_reason` is the one D33 ported from the same original family, not
--    a second copy: both originals use the identical `boundedReason`.
-- 5. **`targetCanReceiveMembership` is substituted, not reproduced.** The
--    original reads the carried `User.is_active`; this reads
--    `identity_map.enabled`. Two reasons, and the first is a defect the test
--    found rather than a preference. Reading the carried row means reading it
--    under `user_read`, whose predicate is `id in caller_roster_ids()` — and
--    that helper admits only ACTIVE memberships, so a SUSPENDED colleague's
--    profile is invisible and the check failed closed exactly when it was
--    needed: no suspended member could ever be reactivated. The second reason
--    is D23's: `is_active` on the carried row is a self-editable label, and
--    `identity_map.enabled` is this store's own authoritative flag, carrying
--    `revoked_at` and a coherence check. This is the substitution
--    `20260920160000_contract_alert.sql` made when it replaced
--    `patientBelongsToCaller` with the policies.
-- 6. A SUSPENDED agency refuses every action here, where the original refuses
--    only the enabling ones. Not a choice: `caller_tenant_role` admits a
--    membership only while its agency is `active` or `trial`, so the caller
--    has no standing at all and is refused as `FORBIDDEN` before the agency is
--    looked at. It is a narrowing and a harmless one — a suspended agency
--    already denies every capability through `caller_agencies()`, so the
--    access there is nothing to take away. The `AGENCY_UNAVAILABLE` check
--    below is kept as the second line rather than removed: it is what refuses
--    an enabling transition if that helper ever stops gating on agency status.
begin;

do $$
begin
  if to_regclass('pennsync_private.membership') is null
    or to_regprocedure('pennsync_records.bounded_reason(text)') is null then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_STORE_REQUIRED';
  end if;
  if not exists (select 1 from pg_catalog.pg_attribute
    where attrelid = 'pennsync_private.membership'::regclass
      and attname = 'last_action' and not attisdropped) then
    raise exception using errcode='42501',message='PENNSYNC_MEMBERSHIP_LIFECYCLE_REQUIRED';
  end if;
end $$;

/*
 * The caller's right to manage this agency's memberships, and the target's.
 *
 * SECURITY DEFINER and owned by the migration administrator, like
 * `care_team_target`: it reads `membership` and `agency`, which no tenant role
 * can see, and it answers only after the caller has proved an ACTIVE
 * `agency_admin` membership — so an arbitrary agency or user id cannot be used
 * as an existence oracle.
 */
create function pennsync_private.membership_target(p_agency text, p_target_user_id text)
  -- Everything `inspect` answers, so the contract needs no table read of its
  -- own. It cannot have one: `pennsync_records_owner` holds `usage` on this
  -- schema and `execute` on these functions, and no table and no other
  -- function — a contract that reached `pennsync_private.deployment_app_id()`
  -- inline failed with `permission denied for function`, which is the grant
  -- working as designed.
  returns table(membership_id text, membership_version integer, tenant_role text,
    membership_status text, base44_user_id text, agency_enabled boolean,
    identity_enabled boolean,
    activated_at timestamptz, suspended_at timestamptz, revoked_at timestamptz,
    last_action text, last_reason text)
  language plpgsql stable security definer set search_path = '' as $target$
declare v_self text;
begin
  -- `caller_tenant_role` admits only an ACTIVE membership, which is the
  -- original's `authority.status !== 'active'` check.
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_MEMBERSHIP_FORBIDDEN';
  end if;
  v_self := "pennsync_records".caller_user_id();
  -- The original's "Agency administrators cannot change their own membership".
  -- An administrator who could suspend themselves could also un-suspend
  -- themselves, and one who could revoke themselves could strand an agency.
  if v_self is not null and v_self = p_target_user_id then
    raise exception using errcode='42501', message='PENNSYNC_MEMBERSHIP_SELF';
  end if;
  return query
    select m.id::text, m.version::integer, m.tenant_role, m.status, m.base44_user_id,
      (ag.status in ('active', 'trial')), im.enabled,
      m.activated_at, m.suspended_at, m.revoked_at, m.last_action, m.last_reason
    from pennsync_private.membership m
    join pennsync_private.agency ag on ag.app_id = m.app_id and ag.id = m.agency_id
    join pennsync_private.identity_map im
      on im.app_id = m.app_id and im.auth_user_id = m.auth_user_id
     and im.base44_user_id = m.base44_user_id
    where m.app_id = pennsync_private.deployment_app_id()
      and m.agency_id = p_agency and m.base44_user_id = p_target_user_id;
end $target$;

/*
 * Apply one membership transition.
 *
 * The row is locked before it is read, so the compare-and-swap the original
 * spells out as a read, a write and a reconcile is an ordinary
 * `select … for update`.
 */
create function pennsync_private.transition_membership(
  p_membership_id text, p_action text, p_role text, p_reason text, p_expected_version integer)
  returns table(membership_status text, membership_version integer, tenant_role text,
    activated_at timestamptz, suspended_at timestamptz, revoked_at timestamptz,
    last_action text, last_reason text)
  language plpgsql security definer set search_path = '' as $transition$
declare v_row pennsync_private.membership; v_uid uuid; v_now timestamptz; v_next text;
begin
  select i.auth_user_id into v_uid from "pennsync_records".caller_identity() i;
  if v_uid is null then
    raise exception using errcode='42501', message='PENNSYNC_MEMBERSHIP_FORBIDDEN';
  end if;
  select * into v_row from pennsync_private.membership m
  where m.app_id = pennsync_private.deployment_app_id() and m.id = p_membership_id
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_MEMBERSHIP_NOT_FOUND';
  end if;
  if v_row.version is distinct from p_expected_version then
    raise exception using errcode='22023', message='PENNSYNC_MEMBERSHIP_STALE';
  end if;
  -- The original's `requireVersionCapacity`. A membership that has moved this
  -- many times is a loop somewhere, not a lifecycle.
  if v_row.version >= 10000 then
    raise exception using errcode='22023', message='PENNSYNC_MEMBERSHIP_VERSION_EXHAUSTED';
  end if;

  if p_action = 'change_role' then
    -- A revocation is terminal for a role change as it is for everything else.
    if v_row.status = 'revoked' then
      raise exception using errcode='42501', message='PENNSYNC_MEMBERSHIP_REVOKED';
    end if;
    if v_row.tenant_role = p_role then
      raise exception using errcode='22023', message='PENNSYNC_MEMBERSHIP_ROLE_UNCHANGED';
    end if;
    update pennsync_private.membership m set tenant_role = p_role,
      version = m.version + 1, last_action = 'change_role', last_reason = p_reason
    where m.app_id = v_row.app_id and m.id = v_row.id;
  else
    v_next := case p_action when 'activate' then 'active'
      when 'suspend' then 'suspended' else 'revoked' end;
    -- The original answers an action that asks for the state the row is
    -- already in by returning it unchanged, rather than refusing. A second
    -- suspension is not a second suspension.
    if v_row.status = v_next then
      return query select v_row.status, v_row.version::integer, v_row.tenant_role,
        v_row.activated_at, v_row.suspended_at, v_row.revoked_at,
        v_row.last_action, v_row.last_reason;
      return;
    end if;
    if p_action = 'activate' and v_row.status not in ('pending', 'suspended') then
      raise exception using errcode='42501', message='PENNSYNC_MEMBERSHIP_TRANSITION';
    end if;
    if p_action = 'suspend' and v_row.status <> 'active' then
      raise exception using errcode='42501', message='PENNSYNC_MEMBERSHIP_TRANSITION';
    end if;
    -- `revoke` is reachable from every state, as the original reaches it.
    v_now := clock_timestamp();
    update pennsync_private.membership m set
      status = v_next,
      version = m.version + 1,
      last_action = p_action,
      last_reason = p_reason,
      activated_at = case when p_action = 'activate' then v_now else m.activated_at end,
      suspended_at = case when p_action = 'suspend' then v_now else m.suspended_at end,
      revoked_at = case when p_action = 'revoke' then v_now else m.revoked_at end,
      revoked_by = case when p_action = 'revoke' then v_uid else m.revoked_by end
    where m.app_id = v_row.app_id and m.id = v_row.id;
  end if;

  return query select m.status, m.version::integer, m.tenant_role,
    m.activated_at, m.suspended_at, m.revoked_at, m.last_action, m.last_reason
  from pennsync_private.membership m
  where m.app_id = v_row.app_id and m.id = v_row.id;
end $transition$;

revoke all on function
  pennsync_private.membership_target(text,text),
  pennsync_private.transition_membership(text,text,text,text,integer)
  from public, anon, authenticated, service_role;
-- The same grant `claim_new_chart` makes. NEVER pair it with a blanket revoke
-- over this schema: every `pennsync_staging_*` wrapper is an invoker calling an
-- inner function granted to `authenticated`.
grant usage on schema pennsync_private to "pennsync_records_owner";
grant execute on function
  pennsync_private.membership_target(text,text),
  pennsync_private.transition_membership(text,text,text,text,integer)
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

create function "pennsync_records".membership_row(
  p_target text, p_role text, p_status text, p_version integer,
  p_activated timestamptz, p_suspended timestamptz, p_revoked timestamptz,
  p_action text, p_reason text) returns jsonb
  language sql immutable set search_path = '' as $row$
  select jsonb_build_object(
    'target_user_id', p_target,
    'tenant_role', p_role,
    'membership_status', p_status,
    'membership_version', p_version,
    'activated_at', p_activated,
    'suspended_at', p_suspended,
    'revoked_at', p_revoked,
    'last_action', p_action,
    'last_reason', p_reason)
$row$;

create function "pennsync_records".contract_membership_inspect(
  p_agency text, p_target_user_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_target record;
begin
  if p_target_user_id is null or p_target_user_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_MEMBERSHIP_SUBJECT_INVALID';
  end if;
  select * into v_target from pennsync_private.membership_target(p_agency, p_target_user_id);
  if v_target.membership_id is null then
    raise exception using errcode='42501', message='PENNSYNC_MEMBERSHIP_NOT_FOUND';
  end if;
  -- An administrator is not a performer for another administrator, so they are
  -- not shown as a subject either: the answer would only invite a transition
  -- that is refused.
  if v_target.tenant_role = 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_MEMBERSHIP_PRIVILEGED';
  end if;
  return jsonb_build_object('action', 'inspect', 'membership',
    "pennsync_records".membership_row(p_target_user_id, v_target.tenant_role,
      v_target.membership_status, v_target.membership_version, v_target.activated_at,
      v_target.suspended_at, v_target.revoked_at, v_target.last_action, v_target.last_reason));
end $contract$;

create function "pennsync_records".contract_membership_transition(
  p_agency text, p_target_user_id text, p_action text, p_tenant_role text,
  p_reason text, p_expected_version integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_target record; v_row record; v_reason text;
begin
  if p_target_user_id is null or p_target_user_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_MEMBERSHIP_SUBJECT_INVALID';
  end if;
  -- `provision` is a known action of the original that this port does not
  -- serve, and it is named rather than folded into "unknown action": a caller
  -- that asks for it is asking for something real that has no performer.
  if p_action = 'provision' then
    raise exception using errcode='42501', message='PENNSYNC_MEMBERSHIP_ACTION_UNPORTED';
  end if;
  if p_action is null or p_action not in ('activate', 'suspend', 'revoke', 'change_role') then
    raise exception using errcode='22023', message='PENNSYNC_MEMBERSHIP_ACTION_INVALID';
  end if;
  -- The role is required for a role change and refused for anything else, the
  -- way the original accepts `expected_version` only for a versioned action.
  if p_action = 'change_role' then
    if p_tenant_role is null
      or p_tenant_role not in ('manager', 'clinician', 'office_staff',
        'social_worker', 'spiritual_care') then
      raise exception using errcode='22023', message='PENNSYNC_MEMBERSHIP_ROLE_INVALID';
    end if;
  elsif p_tenant_role is not null then
    raise exception using errcode='22023', message='PENNSYNC_MEMBERSHIP_ROLE_UNEXPECTED';
  end if;
  v_reason := "pennsync_records".bounded_reason(p_reason);
  if v_reason is null then
    raise exception using errcode='22023', message='PENNSYNC_MEMBERSHIP_REASON_REQUIRED';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode='22023', message='PENNSYNC_MEMBERSHIP_VERSION_REQUIRED';
  end if;

  select * into v_target from pennsync_private.membership_target(p_agency, p_target_user_id);
  if v_target.membership_id is null then
    raise exception using errcode='42501', message='PENNSYNC_MEMBERSHIP_NOT_FOUND';
  end if;
  -- Neither the role they hold nor the role they are being given may be the
  -- administrator one: the original reserves both to the platform owner.
  if v_target.tenant_role = 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_MEMBERSHIP_PRIVILEGED';
  end if;
  -- An enabling transition needs an enabled agency and a target who can hold a
  -- membership; taking access away must work regardless of both.
  if p_action in ('activate', 'change_role') then
    if not v_target.agency_enabled then
      raise exception using errcode='42501', message='PENNSYNC_MEMBERSHIP_AGENCY_UNAVAILABLE';
    end if;
    if not v_target.identity_enabled then
      raise exception using errcode='42501', message='PENNSYNC_MEMBERSHIP_TARGET_DEACTIVATED';
    end if;
  end if;

  select * into v_row from pennsync_private.transition_membership(
    v_target.membership_id, p_action, p_tenant_role, v_reason, p_expected_version);
  return jsonb_build_object('action', p_action, 'membership',
    "pennsync_records".membership_row(p_target_user_id, v_row.tenant_role,
      v_row.membership_status, v_row.membership_version, v_row.activated_at,
      v_row.suspended_at, v_row.revoked_at, v_row.last_action, v_row.last_reason));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".membership_row(text,text,text,integer,timestamptz,timestamptz,timestamptz,text,text),
  "pennsync_records".contract_membership_inspect(text,text),
  "pennsync_records".contract_membership_transition(text,text,text,text,text,integer)
  from public, anon, authenticated, service_role;

grant execute on function
  "pennsync_records".contract_membership_inspect(text,text),
  "pennsync_records".contract_membership_transition(text,text,text,text,text,integer)
  to authenticated;

create function "public"."pennsync_contract_membership_inspect"(
  p_agency text, p_target_user_id text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_membership_inspect(p_agency, p_target_user_id)
$contract$;

create function "public"."pennsync_contract_membership_transition"(
  p_agency text, p_target_user_id text, p_action text, p_tenant_role text,
  p_reason text, p_expected_version integer) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_membership_transition(p_agency, p_target_user_id,
    p_action, p_tenant_role, p_reason, p_expected_version)
$contract$;

revoke all on function
  "public"."pennsync_contract_membership_inspect"(text,text),
  "public"."pennsync_contract_membership_transition"(text,text,text,text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_membership_inspect"(text,text),
  "public"."pennsync_contract_membership_transition"(text,text,text,text,text,integer)
  to authenticated;

commit;
