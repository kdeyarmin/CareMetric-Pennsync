-- Distributing a policy version to an agency's roster.
--
-- HAND WRITTEN, like every contract, and the SEVENTH partial port (after D31,
-- D35, D36, D59, D73 and D81). It is the DISTRIBUTION half of the policy
-- pair whose acknowledgement half is D36; the two share an entity and nothing
-- else, and each declares its own refusals.
--
-- ## Who may ask, established by DRIVING the original rather than reading it
--
-- The original's gate is
-- `role === 'admin' || account_type === 'agency_admin' || account_type === 'super_admin'`,
-- which is D69's shape, so it was driven through the module's own
-- `withTrustedClaims` helper before anything was decided. What passes:
--
--   * the built-in `role === 'admin'`, with no membership at all;
--   * a caller whose CANONICAL membership says `agency_admin`, whatever they
--     claimed in their profile.
--
-- Nothing else. `account_type === 'super_admin'` is DEAD: the helper strips a
-- claimed `super_admin` to `'user'` and its tenant branch only ever writes
-- `'agency_admin'` or that stripped value, so the only caller who can still
-- carry it is one who returned early on `role === 'admin'` — and that caller
-- already passed on the first test. Porting it would port dead code.
--
-- So the successor is `agency_admin`, and — unlike D36's `list` and D40's five
-- — **this is not a widening**. The agency administrator was already a live,
-- membership-backed performer here. What is NOT carried is the platform tier
-- D14 and D22 removed, and D44's question ("what was that tier structurally
-- preventing?") has a sharp answer in this module: the original applies its
-- own agency filter only when `me.agency_name` is set, and a built-in admin
-- carries no `agency_name`, so for that caller the filter is skipped and the
-- policy is distributed to EVERY TENANT IN THE DEPLOYMENT. That reach is the
-- thing being dropped, and dropping it is the point.
--
-- ## Three cohort filters have no column, and are refused BY NAME
--
-- The original narrows its cohort with `filters.role`, `filters.department`,
-- `filters.business_line` and `filters.location`. The carried `user` table has
-- NO `department`, `business_line`, `location` or `job_title` column — only
-- `credential_type` and the self-editable `role`. So:
--
--   * `department`, `business_line` and `location` cannot be evaluated at all;
--   * `role` is matched upstream against `u.job_title || u.credential_type ||
--     u.role`, and with `job_title` absent the same request would select a
--     DIFFERENT set of people here than the administrator saw when they chose
--     it.
--
-- All four are refused by name, following D44: a field with no carried column
-- is refused rather than dropped. Dropping them would be worse here than in
-- most places, because a dropped narrowing does not fail — it distributes a
-- compliance assignment to MORE people than were asked for, including people
-- the administrator deliberately excluded, and every one of them is then
-- overdue on a policy nobody meant to give them. `user_emails` is served and
-- is exact, and an unfiltered call is served and means the whole roster.
--
-- ## What the store answers that the original reconstructed
--
-- `User.list('-created_date', 5000)` filtered by `u.agency_name === me.agency_name`
-- is D41's and D43's derived scope in its WRITING form, over an entity whose
-- own schema calls `agency_name` a self-editable label (D23). It is deleted:
-- `pennsync_private.agency_roster` is the authoritative population, and it
-- carries the verified address AND the membership envelope the notification
-- needs, so one query replaces the scan, the `is_approved` check, the
-- `role !== 'admin'` exclusion and the address lookup.
--
-- The carried `user` table has no `full_name` (D38), so `user_name` and the
-- trail's actor are only ever the address. That is not a shortening: it is
-- what this store holds.
--
-- ## The key, and what it replaces
--
-- The original's header claims it is "idempotent within a version on
-- (policy_id, policy_version, user_id)" and the schema never got that
-- constraint, so it emulates one: prefetch every existing row for the version,
-- hold them in a set, create, re-read, keep the oldest and DELETE its own
-- duplicate. Its own comment admits the hole -- "Concurrent distributes can
-- still race the prefetch->create gap". D78 enumerates the key, D30's emitter
-- writes the index, and this catches `unique_violation` for
-- `policy_acknowledgment_distribution_unique` BY NAME and re-raises anything
-- else. A row that is already assigned is counted as skipped, which is what
-- the caller actually wants to know. The re-read, the ordering and the
-- compensating delete all go: they are compensations for not having the key,
-- and the delete could itself lose the surviving row.
--
-- `failed` and `failures` go with them. The original reports them because each
-- create stands alone and a mid-loop failure leaves a half-distributed policy;
-- here the whole distribution is one transaction, so there is no partial state
-- to report. D68's rule: what the compensation compensated for is gone.
begin;

do $$
begin
  if to_regclass('pennsync_records.policy_acknowledgment') is null
    or to_regclass('pennsync_records.policy_library') is null
    or to_regprocedure('pennsync_records.caller_email()') is null
    or to_regprocedure('pennsync_records.caller_tenant_role(text)') is null
    or to_regprocedure('pennsync_private.agency_roster(text)') is null
    or to_regprocedure('pennsync_records.notification_mint(text,text,text,text,integer,'
      || 'text,text,text,text,text,text,jsonb,text)') is null
    or to_regprocedure('pennsync_records.contract_activity_append(text,text,text,text,jsonb)') is null
  then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_STORE_REQUIRED';
  end if;
end $$;

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
 * A due date the caller supplied, as a date or not at all.
 *
 * Taken as TEXT and parsed here for D38's reason: a `date` parameter makes
 * PostgreSQL reject an impossible day at the call boundary, where the error is
 * a raw cast failure the HTTP layer cannot classify. Parsing it means
 * `2026-02-31` is refused by name like every other bad input.
 */
create function "pennsync_records".policy_due_date(p_due_date text)
  returns date language plpgsql immutable set search_path = '' as $due$
declare v_due date;
begin
  if p_due_date is null or btrim(p_due_date) = '' then return null; end if;
  begin
    v_due := p_due_date::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023', message='PENNSYNC_POLICY_DUE_DATE_INVALID';
  end;
  return v_due;
end $due$;

create function "pennsync_records".contract_policy_distribute(
  p_agency text, p_policy_id text, p_due_date text, p_user_emails jsonb, p_filters jsonb)
  returns jsonb language plpgsql volatile security definer set search_path = '' as $contract$
declare
  v_role text; v_actor text; v_now timestamptz := now(); v_due date;
  v_policy record; v_version text; v_member record;
  v_wanted text[]; v_filter text;
  v_created integer := 0; v_skipped integer := 0; v_candidates integer := 0;
  v_notified integer := 0;
  v_constraint text; v_id text; v_assigned boolean;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_POLICY_AGENCY_NOT_HELD';
  end if;
  -- The whole gate. See the header: the other two branches of the original are
  -- the removed platform tier and dead code respectively.
  if v_role <> 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_POLICY_DISTRIBUTE_FORBIDDEN';
  end if;
  v_actor := "pennsync_records".caller_email();
  if v_actor is null then
    raise exception using errcode='42501', message='PENNSYNC_POLICY_CALLER_UNKNOWN';
  end if;

  if p_policy_id is null or btrim(p_policy_id) = '' then
    raise exception using errcode='22023', message='PENNSYNC_POLICY_ID_REQUIRED';
  end if;
  v_due := "pennsync_records".policy_due_date(p_due_date);

  -- An EMPTY array is not an empty cohort, it is the absence of an explicit
  -- one, and getting that wrong would refuse every unfiltered distribution the
  -- product makes: `PolicyAcknowledgmentManager.jsx` sends all four keys on
  -- every call and passes `userEmails: []` for the whole-roster button. The
  -- original destructures `userEmails = []` and branches on
  -- `userEmails.length > 0`, so this reads an empty list the same way. D58's
  -- rule: check the call site before deciding what a request shape means.
  if p_user_emails is not null and jsonb_typeof(p_user_emails) <> 'null' then
    if jsonb_typeof(p_user_emails) <> 'array' then
      raise exception using errcode='22023', message='PENNSYNC_POLICY_USER_EMAILS_INVALID';
    end if;
    select array_agg(lower(btrim(value))) into v_wanted
    from jsonb_array_elements_text(p_user_emails) as t(value)
    where jsonb_typeof(to_jsonb(value)) = 'string' and btrim(value) <> '';
    -- A list of blanks, or of numbers, is a request that named nobody and
    -- meant to name somebody. An `[]` is not that.
    if jsonb_array_length(p_user_emails) > 0
      and (v_wanted is null or array_length(v_wanted, 1) is null) then
      raise exception using errcode='22023', message='PENNSYNC_POLICY_USER_EMAILS_INVALID';
    end if;
  end if;

  -- Refused by name rather than ignored. A narrowing that silently does not
  -- apply distributes to more people than were asked for.
  --
  -- The SHAPE is checked whatever else the request says, because an unknown
  -- key is a malformed request either way — that part is a narrowing, since
  -- the original ignores a key it does not know. The unported filters are
  -- refused only where the ORIGINAL would have consulted them, which is the
  -- `else` of its `userEmails.length > 0` branch: a request that names people
  -- explicitly never had its filters applied in Base44 either, so refusing it
  -- here would be this port inventing a rule rather than keeping one.
  if p_filters is not null and jsonb_typeof(p_filters) <> 'null' then
    if jsonb_typeof(p_filters) <> 'object' then
      raise exception using errcode='22023', message='PENNSYNC_POLICY_FILTERS_INVALID';
    end if;
    for v_filter in select key from jsonb_each(p_filters) loop
      -- 'all' is the original's own "no filter" sentinel, so a request that
      -- narrows nothing is served rather than refused for naming the key.
      if coalesce(p_filters ->> v_filter, 'all') = 'all' then continue; end if;
      if v_filter in ('role', 'department', 'business_line', 'location') then
        if v_wanted is null then
          raise exception using errcode='42501',
            message='PENNSYNC_POLICY_FILTER_UNPORTED:' || v_filter;
        end if;
        continue;
      end if;
      raise exception using errcode='22023', message='PENNSYNC_POLICY_FILTERS_INVALID';
    end loop;
  end if;

  -- The policies answer tenancy; this names the agency anyway because
  -- `caller_agencies()` returns every agency the caller holds (D51's trap).
  select l."id", l."title", l."policy_number", l."doc_url", l."version"
    into v_policy
  from "pennsync_records"."policy_library" l
  where l."source_app_id" = "pennsync_records".deployment_app()
    and l."id" = p_policy_id and l."agency_id" = p_agency;
  if not found then
    raise exception using errcode='42704', message='PENNSYNC_POLICY_NOT_FOUND';
  end if;
  -- The original's `policy.version || '1'`, which is what the rows carry.
  v_version := coalesce(nullif(v_policy."version", ''), '1');

  for v_member in
    select r.base44_user_id, r.expected_email, r.membership_id, r.membership_version
    from pennsync_private.agency_roster(p_agency) r
    where v_wanted is null or r.expected_email = any(v_wanted)
    order by r.expected_email
  loop
    v_candidates := v_candidates + 1;
    v_id := gen_random_uuid()::text;
    v_assigned := true;
    begin
      insert into "pennsync_records"."policy_acknowledgment" (
        "source_app_id", "id", "created_date", "updated_date", "created_by",
        "policy_id", "policy_title", "policy_number", "policy_version", "doc_url",
        "user_id", "user_name", "distributed_by", "assigned_date", "due_date",
        "status", "acknowledged", "agency_id")
      values (
        "pennsync_records".deployment_app(), v_id, v_now, v_now, v_actor,
        v_policy."id", v_policy."title", coalesce(v_policy."policy_number", ''),
        v_version, coalesce(v_policy."doc_url", ''),
        v_member.expected_email, v_member.expected_email, v_actor, v_now, v_due,
        'assigned', false, p_agency);
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- By NAME, and re-raise anything else: another unique violation on this
      -- table is not this one, and swallowing it would report a distribution
      -- that did not happen (D30, D78).
      if v_constraint is distinct from 'policy_acknowledgment_distribution_unique' then
        raise;
      end if;
      v_assigned := false;
      v_skipped := v_skipped + 1;
    end;
    if v_assigned then
      v_created := v_created + 1;
      -- Through the facility, never inlined: inlining it is how D45's defect
      -- happened, and D48 made it the only thing that writes a notification.
      --
      -- TWO enforcements that can disagree, which is D51's shape from the
      -- other side. `policy_acknowledgment_distribution_unique` decides
      -- whether the person is ASSIGNED, and an assignment row can be deleted;
      -- `notification_dedupe_key_unique` decides whether they have already
      -- been TOLD, and a notification row is not deleted by any of that. So a
      -- redistribution after an assignment was cleared writes a real new
      -- assignment and must not write a second copy of a message the person
      -- may not have read yet. The index wins, as it does in D51, the
      -- `unique_violation` is caught BY NAME so any other one still raises,
      -- and the difference is REPORTED rather than hidden (D54): `notified` is
      -- below `distributed` exactly when this fired.
      begin
        perform "pennsync_records".notification_mint(
          p_agency, v_member.base44_user_id, v_member.expected_email,
          v_member.membership_id, v_member.membership_version,
          'Policy acknowledgment required',
          'Please review and acknowledge "' || v_policy."title" || '" (v' || v_version || ')'
            || case when v_due is null then '' else ' by ' || to_char(v_due, 'MM/DD/YYYY') end
            || '.',
          'compliance_alert', 'high',
          '/LearningCenter?tab=policies', 'Review policy',
          jsonb_build_object('policy_id', v_policy."id", 'policy_version', v_version),
          'policy:' || v_policy."id" || ':' || v_version || ':' || v_member.expected_email);
        v_notified := v_notified + 1;
      exception when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'notification_dedupe_key_unique' then
          raise;
        end if;
      end;
    end if;
  end loop;

  -- The original's TrainingAuditLog row, which D84 settles onto D25's trail:
  -- one fire-and-forget summary after the loop, of exactly this shape. No
  -- `audit_recorded` field, because this is one transaction and the two halves
  -- cannot disagree (D37).
  -- `other`, which is what `invitation_resent` uses and what the kind is in
  -- the list for. `activity_audit_subject_kind_allowed` is a fixed enumeration
  -- in a migration every deployment has applied, so naming a policy there
  -- would be a forward migration against a SHARED facility (D88) to say what
  -- `subject_id` plus `policy_title` already say.
  perform "pennsync_records".contract_activity_append(
    p_agency, 'policy_distributed', 'other', v_policy."id",
    jsonb_build_object('policy_title', v_policy."title", 'policy_version', v_version,
      'distributed', v_created, 'skipped', v_skipped, 'candidates', v_candidates,
      'notified', v_notified));

  return jsonb_build_object('success', true, 'policy_version', v_version,
    'distributed', v_created, 'skipped', v_skipped, 'candidates', v_candidates,
    'notified', v_notified);
end $contract$;

reset role;

revoke all on function
  "pennsync_records".policy_due_date(text),
  "pennsync_records".contract_policy_distribute(text,text,text,jsonb,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_policy_distribute(text,text,text,jsonb,jsonb) to authenticated;

create function "public"."pennsync_contract_policy_distribute"(
  p_agency text, p_policy_id text, p_due_date text, p_user_emails jsonb, p_filters jsonb)
  returns jsonb language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_policy_distribute(
    p_agency, p_policy_id, p_due_date, p_user_emails, p_filters)
$contract$;

revoke all on function "public"."pennsync_contract_policy_distribute"(text,text,text,jsonb,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_policy_distribute"(text,text,text,jsonb,jsonb)
  to authenticated;

commit;
