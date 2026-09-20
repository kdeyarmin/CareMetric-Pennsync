-- The time-off domain: submit, cancel, review, and the approved list.
--
-- HAND WRITTEN, like every contract. Four Base44 capabilities over one carried
-- table, and the first port where the SAME authorization question is answered
-- four different ways in the originals — which is why they are one file.
--
-- **Every one of the four decides who may act by reading the carried `User`
-- row, and D23 says that row decides nothing.** `submitTimeOffRequest` checks
-- `user.is_approved`, an approver's `is_manager` and `account_type`, and
-- compares `agency_name` strings. `cancelTimeOffRequest` builds an
-- `isAdminLike` from `role` and `account_type` and then re-reads the
-- employee's `agency_name`. `reviewTimeOffRequest` does the same and adds
-- `manager_email === user.email`. `getApprovedTimeOff` collects every `User`
-- whose `agency_name` matches and filters the requests by their addresses.
-- All five of those fields are self-editable labels the entity schema itself
-- describes as such.
--
-- Here the authority store answers all of it. Membership decides who is in an
-- agency, `caller_tenant_role` decides what they are, and the table's own
-- policy (`agency_id in caller_agencies()`) decides which rows exist —
-- so the "collect the agency's users and filter by email" step of the list
-- capability disappears entirely rather than being reimplemented.
--
-- DIVERGENCES from the originals, each a narrowing, each deliberate:
--
-- 1. **No outbound delivery.** Three of the four send an approver or employee
--    email, behind `OUTBOUND_DELIVERY_RELEASE=enabled-v1`. That gate does not
--    refuse the request; it skips the send and reports `delivery_paused`. The
--    contracts do the record work and the handlers report `delivery_paused`
--    exactly as the originals do when the gate is closed, because outbound
--    delivery is the integration runtime's — deployed, and paused. A caller
--    migrating sees a shape it already handles.
-- 2. **No platform tier.** `super_admin` and the built-in `role === 'admin'`
--    are D14's and D22's, so an `agency_admin` is the widest reviewer and the
--    cross-agency branches close.
-- 3. **An approver must be an `agency_admin` or `manager` of the SAME agency**,
--    proved through membership rather than through `is_manager` plus a string
--    comparison of `agency_name`. This is the substitution, not a new rule:
--    the original is trying to ask exactly this.
-- 4. `reason` and `coverage` are truncated at 2000 as the original truncates
--    them, rather than refused. Their content is the employee's own words and
--    a refusal would lose the request.
-- 5. **`employee_name`, `manager_name` and `reviewer_name` are addresses.**
--    All three originals write `user.full_name || user.email`, and the carried
--    `User` table HAS NO `full_name` COLUMN — `contract_roster` projects no
--    name either, for the same reason. So the fallback is the only branch that
--    can ever run. Recorded rather than silently collapsed, because a reader
--    comparing the two would otherwise look for the name and not find where it
--    went.
begin;

do $$
begin
  if to_regclass('pennsync_records.time_off_request') is null
    or to_regprocedure('pennsync_records.caller_tenant_role(text)') is null then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_STORE_REQUIRED';
  end if;
end $$;

/*
 * One colleague of the caller's agency, by address.
 *
 * SECURITY DEFINER and owned by the migration administrator: it reads
 * `membership` and `identity_map`, which no tenant role can see. It answers
 * only about an agency the CALLER already holds a membership in — which the
 * roster already discloses — and it resolves by the VERIFIED address rather
 * than by the carried profile's `email`, which is self-editable.
 */
create function pennsync_private.agency_colleague(p_agency text, p_email text)
  returns table(base44_user_id text, tenant_role text, expected_email text)
  language plpgsql stable security definer set search_path = '' as $colleague$
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_AGENCY_NOT_HELD';
  end if;
  return query
    select m.base44_user_id, m.tenant_role, im.expected_email
    from pennsync_private.membership m
    join pennsync_private.agency ag on ag.app_id = m.app_id and ag.id = m.agency_id
    join pennsync_private.identity_map im
      on im.app_id = m.app_id and im.auth_user_id = m.auth_user_id
     and im.base44_user_id = m.base44_user_id
    where m.app_id = pennsync_private.deployment_app_id()
      and m.agency_id = p_agency and m.status = 'active'
      and ag.status in ('active', 'trial')
      and im.enabled and im.revoked_at is null
      and im.expected_email = pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
end $colleague$;

revoke all on function pennsync_private.agency_colleague(text,text)
  from public, anon, authenticated, service_role;
-- The same grant `claim_new_chart` makes. NEVER pair it with a blanket revoke
-- over this schema: every `pennsync_staging_*` wrapper is an invoker calling an
-- inner function granted to `authenticated`.
grant usage on schema pennsync_private to "pennsync_records_owner";
grant execute on function pennsync_private.agency_colleague(text,text)
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
 * A calendar date the caller named, or null.
 *
 * Parsed rather than taken as a `date` parameter, so an impossible day is a
 * NAMED refusal instead of a raw cast error from PostgREST. The original
 * rejects `2026-02-31` explicitly because JavaScript would roll it forward to
 * March; PostgreSQL refuses it outright, and this turns that into the same
 * answer the original gives.
 */
create function "pennsync_records".time_off_date(p_value text) returns date
  language plpgsql immutable set search_path = '' as $date$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  begin
    return p_value::date;
  exception when others then return null;
  end;
end $date$;

/*
 * The original's `totalRequestedDays`, which is business days Monday to Friday
 * with half a day taken off the total and never below half a day.
 */
create function "pennsync_records".time_off_days(p_start date, p_end date, p_half boolean)
  returns double precision language sql immutable set search_path = '' as $days$
  select case
    when business = 0 then 0::double precision
    when p_half then greatest(0.5, business - 0.5)
    else business::double precision end
  from (select count(*)::double precision as business
    from pg_catalog.generate_series(p_start, p_end, interval '1 day') d
    -- `extract` is a SQL construct rather than a `pg_catalog` function, so it
    -- cannot be schema-qualified the way the calls around it are.
    where extract(isodow from d) < 6) counted
$days$;

/** What every capability here answers with. No reviewer note on a list. */
create function "pennsync_records".time_off_row(r "pennsync_records"."time_off_request")
  returns jsonb language sql stable set search_path = '' as $row$
  select jsonb_build_object(
    'id', r."id",
    'employee_email', r."employee_email",
    'employee_name', r."employee_name",
    'manager_email', r."manager_email",
    'manager_name', r."manager_name",
    'request_type', r."request_type",
    'start_date', r."start_date",
    'end_date', r."end_date",
    'half_day', r."half_day",
    'total_days', r."total_days",
    'reason', r."reason",
    'coverage', r."coverage",
    'status', r."status",
    'reviewed_by', r."reviewed_by",
    'reviewer_name', r."reviewer_name",
    'reviewed_at', r."reviewed_at",
    'review_notes', r."review_notes")
$row$;

create function "pennsync_records".contract_time_off_submit(
  p_agency text, p_request_type text, p_start text, p_end text, p_half_day boolean,
  p_reason text, p_coverage text, p_manager_email text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_start date; v_end date; v_email text; v_id text; v_now timestamptz;
  -- Plain variables rather than a record: with no approver named, a record is
  -- never assigned and reading a field of it raises "record is not assigned
  -- yet" — which is the far more common path, since the approver is optional.
  v_manager_email text; v_manager_role text;
  v_row "pennsync_records"."time_off_request";
begin
  -- Membership IS approval. The original asks `user.is_approved`, which
  -- `withTrustedClaims` derives from exactly one active membership.
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_AGENCY_NOT_HELD';
  end if;
  if p_request_type is null or p_request_type not in ('vacation', 'sick', 'personal',
    'bereavement', 'jury_duty', 'parental', 'unpaid', 'other') then
    raise exception using errcode='22023', message='PENNSYNC_TIME_OFF_TYPE_INVALID';
  end if;
  v_start := "pennsync_records".time_off_date(p_start);
  v_end := "pennsync_records".time_off_date(p_end);
  if v_start is null or v_end is null then
    raise exception using errcode='22023', message='PENNSYNC_TIME_OFF_DATE_INVALID';
  end if;
  if v_end < v_start then
    raise exception using errcode='22023', message='PENNSYNC_TIME_OFF_RANGE_INVALID';
  end if;
  -- The original's own bound: a request longer than a year is a mistake.
  if p_half_day is null or (v_end - v_start) + 1 > 366 then
    raise exception using errcode='22023', message='PENNSYNC_TIME_OFF_RANGE_INVALID';
  end if;
  v_email := "pennsync_records".caller_email();
  if v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_AGENCY_NOT_HELD';
  end if;

  if p_manager_email is not null and pg_catalog.btrim(p_manager_email) <> '' then
    -- Never yourself: an approver who is the requester is self-approval.
    if pg_catalog.lower(pg_catalog.btrim(p_manager_email)) = pg_catalog.lower(v_email) then
      raise exception using errcode='22023', message='PENNSYNC_TIME_OFF_APPROVER_SELF';
    end if;
    select c.expected_email, c.tenant_role into v_manager_email, v_manager_role
    from pennsync_private.agency_colleague(p_agency, p_manager_email) c;
    if v_manager_email is null then
      raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_APPROVER_UNKNOWN';
    end if;
    -- The substitution: the original asks `is_manager` or an admin
    -- `account_type` on a self-editable row and then compares `agency_name`
    -- strings. Membership answers both at once.
    if v_manager_role not in ('agency_admin', 'manager') then
      raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_APPROVER_INVALID';
    end if;
  end if;

  v_now := clock_timestamp();
  v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
  insert into "pennsync_records"."time_off_request"
    ("source_app_id", "id", "agency_id", "employee_email", "employee_name",
     "manager_email", "manager_name", "request_type", "start_date", "end_date",
     "half_day", "total_days", "reason", "coverage", "status", "created_by",
     "created_date", "updated_date")
  values ("pennsync_records".deployment_app(), v_id, p_agency, v_email,
    -- Divergence 5: the carried profile has no name column, so this is the
    -- address, which is what the original falls back to anyway.
    v_email,
    v_manager_email, v_manager_email, p_request_type, v_start, v_end,
    p_half_day, "pennsync_records".time_off_days(v_start, v_end, p_half_day),
    pg_catalog.left(coalesce(p_reason, ''), 2000),
    pg_catalog.left(coalesce(p_coverage, ''), 2000),
    'pending', v_email, v_now, v_now)
  returning * into v_row;
  return jsonb_build_object('success', true, 'request',
    "pennsync_records".time_off_row(v_row));
end $contract$;

create function "pennsync_records".contract_time_off_cancel(
  p_agency text, p_request_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_row "pennsync_records"."time_off_request"; v_email text; v_role text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_AGENCY_NOT_HELD';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_TIME_OFF_SUBJECT_INVALID';
  end if;
  v_email := "pennsync_records".caller_email();
  -- Read under the policies, which already scope this to the caller's agency,
  -- so the original's "re-read the employee and compare agency_name" step has
  -- nothing left to do.
  select * into v_row from "pennsync_records"."time_off_request" r
  where r."source_app_id" = "pennsync_records".deployment_app()
    and r."id" = p_request_id and r."agency_id" = p_agency
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_NOT_FOUND';
  end if;
  -- Yours, or an administrator's to cancel. Tenancy is not ownership here
  -- (D36), so the ownership half is the contract's.
  if not (pg_catalog.lower(coalesce(v_row."employee_email", '')) = pg_catalog.lower(v_email)
      or pg_catalog.lower(coalesce(v_row."created_by", '')) = pg_catalog.lower(v_email)
      or v_role = 'agency_admin') then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_FORBIDDEN';
  end if;
  if v_row."status" is distinct from 'pending' and v_row."status" is distinct from 'approved' then
    raise exception using errcode='22023', message='PENNSYNC_TIME_OFF_TRANSITION';
  end if;
  update "pennsync_records"."time_off_request" r
    set "status" = 'cancelled', "updated_date" = clock_timestamp()
  where r."source_app_id" = v_row."source_app_id" and r."id" = v_row."id"
  returning * into v_row;
  return jsonb_build_object('success', true, 'request',
    "pennsync_records".time_off_row(v_row));
end $contract$;

create function "pennsync_records".contract_time_off_review(
  p_agency text, p_request_id text, p_decision text, p_note text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_row "pennsync_records"."time_off_request"; v_email text; v_role text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_AGENCY_NOT_HELD';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_TIME_OFF_SUBJECT_INVALID';
  end if;
  if p_decision is null or p_decision not in ('approved', 'denied') then
    raise exception using errcode='22023', message='PENNSYNC_TIME_OFF_DECISION_INVALID';
  end if;
  v_email := "pennsync_records".caller_email();
  select * into v_row from "pennsync_records"."time_off_request" r
  where r."source_app_id" = "pennsync_records".deployment_app()
    and r."id" = p_request_id and r."agency_id" = p_agency
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_NOT_FOUND';
  end if;
  -- An `agency_admin`, or the manager this request actually named. A `manager`
  -- who was not named does not review it — the original's `isAssignedManager`
  -- is an address match on the request, not a role.
  if not (v_role = 'agency_admin'
      or (coalesce(v_row."manager_email", '') <> ''
        and pg_catalog.lower(v_row."manager_email") = pg_catalog.lower(v_email))) then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_FORBIDDEN';
  end if;
  -- Never your own, whatever your role. An administrator who could approve
  -- their own leave is the whole reason this check exists.
  if pg_catalog.lower(coalesce(v_row."employee_email", '')) = pg_catalog.lower(v_email)
    or pg_catalog.lower(coalesce(v_row."created_by", '')) = pg_catalog.lower(v_email) then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_SELF';
  end if;
  if v_row."status" is distinct from 'pending' then
    raise exception using errcode='22023', message='PENNSYNC_TIME_OFF_TRANSITION';
  end if;
  update "pennsync_records"."time_off_request" r set
    "status" = p_decision,
    "reviewed_by" = v_email,
    "reviewer_name" = v_email, -- divergence 5: no carried name column exists
    "reviewed_at" = clock_timestamp(),
    "review_notes" = pg_catalog.left(coalesce(p_note, ''), 2000),
    "updated_date" = clock_timestamp()
  where r."source_app_id" = v_row."source_app_id" and r."id" = v_row."id"
  returning * into v_row;
  return jsonb_build_object('success', true, 'request',
    "pennsync_records".time_off_row(v_row));
end $contract$;

/*
 * Approved leave, for scheduling.
 *
 * The original collects every `User` whose `agency_name` matches the caller's
 * and filters the requests by those addresses. The policy does that here, so
 * the step is gone rather than reimplemented.
 */
create function "pennsync_records".contract_time_off_approved(p_agency text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_rows jsonb;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_AGENCY_NOT_HELD';
  end if;
  select coalesce(jsonb_agg("pennsync_records".time_off_row(r)
    order by r."start_date", r."id"), '[]'::jsonb) into v_rows
  from (select * from "pennsync_records"."time_off_request" r
    where r."source_app_id" = "pennsync_records".deployment_app()
      and r."agency_id" = p_agency and r."status" = 'approved'
    order by r."start_date", r."id" limit 2000) r;
  return jsonb_build_object('requests', v_rows);
end $contract$;

reset role;

revoke all on function
  "pennsync_records".time_off_date(text),
  "pennsync_records".time_off_days(date,date,boolean),
  "pennsync_records".time_off_row("pennsync_records"."time_off_request"),
  "pennsync_records".contract_time_off_submit(text,text,text,text,boolean,text,text,text),
  "pennsync_records".contract_time_off_cancel(text,text),
  "pennsync_records".contract_time_off_review(text,text,text,text),
  "pennsync_records".contract_time_off_approved(text)
  from public, anon, authenticated, service_role;

grant execute on function
  "pennsync_records".contract_time_off_submit(text,text,text,text,boolean,text,text,text),
  "pennsync_records".contract_time_off_cancel(text,text),
  "pennsync_records".contract_time_off_review(text,text,text,text),
  "pennsync_records".contract_time_off_approved(text)
  to authenticated;

create function "public"."pennsync_contract_time_off_submit"(
  p_agency text, p_request_type text, p_start text, p_end text, p_half_day boolean,
  p_reason text, p_coverage text, p_manager_email text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_time_off_submit(p_agency, p_request_type, p_start,
    p_end, p_half_day, p_reason, p_coverage, p_manager_email)
$contract$;

create function "public"."pennsync_contract_time_off_cancel"(
  p_agency text, p_request_id text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_time_off_cancel(p_agency, p_request_id)
$contract$;

create function "public"."pennsync_contract_time_off_review"(
  p_agency text, p_request_id text, p_decision text, p_note text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_time_off_review(p_agency, p_request_id, p_decision, p_note)
$contract$;

create function "public"."pennsync_contract_time_off_approved"(p_agency text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_time_off_approved(p_agency)
$contract$;

revoke all on function
  "public"."pennsync_contract_time_off_submit"(text,text,text,text,boolean,text,text,text),
  "public"."pennsync_contract_time_off_cancel"(text,text),
  "public"."pennsync_contract_time_off_review"(text,text,text,text),
  "public"."pennsync_contract_time_off_approved"(text)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_time_off_submit"(text,text,text,text,boolean,text,text,text),
  "public"."pennsync_contract_time_off_cancel"(text,text),
  "public"."pennsync_contract_time_off_review"(text,text,text,text),
  "public"."pennsync_contract_time_off_approved"(text)
  to authenticated;

commit;
