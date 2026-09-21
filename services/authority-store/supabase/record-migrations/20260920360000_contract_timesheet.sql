-- Submitting a timesheet, and reviewing one.
--
-- HAND WRITTEN, like every contract, and the largest port so far. The two
-- capabilities are one domain, as the time-off four were: a submission and the
-- decision on it.
--
-- **Almost everything an employee could claim is decided server-side, and the
-- original says why for each.** The service line and points eligibility come
-- from the payroll profile an administrator keeps, *"not chosen by the
-- employee"*. Points are computed from the visit counts times the agency's
-- configured per-type values, *"server-authoritative, so the client cannot set
-- points directly"*. Paid time off carries in from approved `TimeOffRequest`
-- rows rather than being typed. The phone reimbursement is the profile's, *"an
-- expense reimbursement (not pay/wages) applied automatically each pay
-- period"*. In daily mode the per-day rows are authoritative and the
-- client-submitted period totals are discarded. All of that is ported; the only
-- numbers a caller supplies are the buckets the original lets them supply.
--
-- **Tenancy is not ownership here either (D45).** `timesheet_read` and
-- `timesheet_update` are agency-WIDE, so "my timesheet" and "a timesheet I may
-- review" are the contract's rules, not the policies'.
--
-- DIVERGENCES from the originals, each deliberate:
--
-- 1. The gate is an active membership. The original asks
--    `user.is_approved !== true`, a self-editable field on the carried profile
--    (D23), with the built-in admin as the exception D14 and D22 removed.
-- 2. **The unscoped legacy point-config fallback goes.** The original, failing
--    to find a config for the caller's `agency_name`, adopts the newest row in
--    the deployment *"so nurses with an agency don't silently compute 0
--    points"* — which is the read side of exactly the bug D43 deleted from the
--    write side, where *"a platform admin (no agency) saving config silently
--    overwrote that agency's point math."* An agency with no point schedule now
--    computes zero points, which is the honest answer and is visible in the
--    result as `point_config_missing`.
-- 3. The service line falls back to `home_health` when there is no payroll
--    profile, and NOT to `user.service_type`: a self-editable field on the
--    carried profile cannot decide which pay schedule somebody is on.
-- 4. The approver is a member of the caller's agency whose tenant role is
--    `agency_admin` or `manager`. The original tests `role === 'admin'`,
--    `account_type`, and `is_manager === true` — three self-editable labels —
--    and then compares `agency_name` STRINGS to keep it in-tenant.
-- 5. A reviewer is an `agency_admin` or the timesheet's assigned manager, and
--    never its owner. Both originals already refuse self-review; here the
--    check is by identity rather than by two address comparisons.
-- 6. The employee notification is minted through `notification_mint` (D48), so
--    it carries the authority envelope its reader filters on. Its EMAIL half is
--    `Core.SendEmail`, which nothing brokers, so the answer says
--    `delivery_paused`.
--
-- AND ONE CORRECTION TO THIS PORT, recorded because the shape recurs (D78).
-- The duplicate-period check below was written as a lookup with `for update`,
-- which reads like a lock and is not one when the row does not exist — the trap
-- D33 wrote down about `chart_assignment` two ports earlier. Two submissions of
-- one pay period, from a retried request or a second tab, both found nothing
-- and both inserted, and payroll counted the period twice. That is the exact
-- outcome the sentence above says the check exists to prevent.
-- `timesheet_period_unique` is what holds it now, the write catches that
-- constraint BY NAME, and `record-contract-postgres.test.mjs` proves it with two
-- real connections rather than asserting it.
begin;

do $$
begin
  if to_regclass('pennsync_records.timesheet') is null
    or to_regprocedure('pennsync_private.agency_roster(text)') is null
    or to_regprocedure('pennsync_records.notification_mint(text,text,text,text,integer,'
      || 'text,text,text,text,text,text,jsonb,text)') is null then
    raise exception using errcode='42501',message='PENNSYNC_CALLER_MEMBERSHIP_REQUIRED';
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

/* The original's `toNonNegativeNumber`: non-negative, two decimal places, and
 * zero for anything that is not a finite number. */
create function "pennsync_records".timesheet_number(p_value jsonb)
  returns double precision language sql immutable set search_path = '' as $n$
  select case
    when p_value is null or jsonb_typeof(p_value) not in ('number', 'string') then 0
    when jsonb_typeof(p_value) = 'string'
      and (p_value #>> '{}') !~ '^\s*-?\d+(\.\d+)?\s*$' then 0
    else greatest(0, pg_catalog.round(((p_value #>> '{}')::numeric), 2))::double precision
  end
$n$;

/* And its ceiling, which the original checks before coercing. */
create function "pennsync_records".timesheet_number_valid(p_value jsonb)
  returns boolean language sql immutable set search_path = '' as $v$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then true
    when jsonb_typeof(p_value) = 'string' and pg_catalog.btrim(p_value #>> '{}') = '' then true
    when jsonb_typeof(p_value) = 'number' then
      (p_value #>> '{}')::numeric >= 0 and (p_value #>> '{}')::numeric <= 1000000000
    when jsonb_typeof(p_value) = 'string'
      and (p_value #>> '{}') ~ '^\s*\d+(\.\d+)?\s*$' then
      (pg_catalog.btrim(p_value #>> '{}'))::numeric <= 1000000000
    else false end
$v$;

/*
 * The original's `isAlignedPayPeriod`: two weeks Sunday through Saturday, on
 * the biweekly cycle anchored to Sun 2026-06-14, *"Kept in step with the
 * frontend's payPeriodSchedule.js so submitted periods always match the payroll
 * calendar."*
 */
create function "pennsync_records".timesheet_period_aligned(p_start date, p_end date)
  returns boolean language sql immutable set search_path = '' as $a$
  select p_start is not null and p_end is not null
    and ((p_start - date '2026-06-14') % 14) = 0
    and p_end = p_start + 13
    -- Sunday. `extract` is a SQL construct and cannot be schema-qualified.
    and extract(dow from p_start) = 0
$a$;

/*
 * The original's `intersectionBusinessDays`: weekdays shared by a time-off
 * request and the pay period.
 */
create function "pennsync_records".timesheet_business_days(
  p_start date, p_end date, p_period_start date, p_period_end date)
  returns double precision language sql immutable set search_path = '' as $b$
  select coalesce(count(*), 0)::double precision
  from generate_series(greatest(p_start, p_period_start),
    least(p_end, p_period_end), interval '1 day') as day
  where p_start is not null and p_end is not null
    and extract(dow from day) between 1 and 5
$b$;

/*
 * The original's `computePtoHours`. Only APPROVED requests of a PAID type
 * carry — *"(unpaid excluded)"* — and a half day only counts as a half when
 * the whole request sits inside the period.
 */
create function "pennsync_records".timesheet_pto_hours(
  p_agency text, p_email text, p_start date, p_end date)
  returns double precision language sql stable security definer set search_path = '' as $p$
  select coalesce(pg_catalog.round(sum(days)::numeric * 8, 2), 0)::double precision
  from (
    select greatest(0,
      case when t."half_day" is true
        and t."start_date" >= p_start and t."end_date" <= p_end
      then greatest(0.5, "pennsync_records".timesheet_business_days(
        t."start_date", t."end_date", p_start, p_end) - 0.5)
      else "pennsync_records".timesheet_business_days(
        t."start_date", t."end_date", p_start, p_end) end) as days
    from "pennsync_records"."time_off_request" t
    where t."source_app_id" = "pennsync_records".deployment_app()
      and t."agency_id" = p_agency
      and pg_catalog.lower(coalesce(t."employee_email", '')) = p_email
      and t."status" = 'approved'
      and t."request_type" in ('vacation', 'sick', 'personal', 'bereavement',
        'jury_duty', 'parental', 'other')
  ) d
$p$;

create function "pennsync_records".timesheet_row(r "pennsync_records"."timesheet")
  returns jsonb language sql stable set search_path = '' as $row$
  select jsonb_build_object(
    'id', r."id", 'agency_id', r."agency_id",
    'employee_email', r."employee_email", 'employee_name', r."employee_name",
    'service_type', r."service_type",
    'pay_period_start', r."pay_period_start", 'pay_period_end', r."pay_period_end",
    'regular_points', r."regular_points", 'visit_counts', r."visit_counts",
    'emergency_visit_points', r."emergency_visit_points",
    'regular_hours', r."regular_hours", 'overtime_hours', r."overtime_hours",
    'vacation_hours', r."vacation_hours", 'holiday_hours', r."holiday_hours",
    'on_call_hours', r."on_call_hours", 'on_call_visits', r."on_call_visits",
    'miles', r."miles", 'reimbursement', r."reimbursement",
    'auto_pto_hours', r."auto_pto_hours", 'phone_reimbursement', r."phone_reimbursement",
    'notes', r."notes", 'entry_mode', r."entry_mode", 'daily_entries', r."daily_entries",
    'manager_email', r."manager_email", 'manager_name', r."manager_name",
    'status', r."status", 'submitted_at', r."submitted_at",
    'reviewed_by', r."reviewed_by", 'reviewer_name', r."reviewer_name",
    'reviewed_at', r."reviewed_at", 'review_notes', r."review_notes")
$row$;

create function "pennsync_records".contract_timesheet_submit(
  p_agency text, p_timesheet_id text, p_sheet jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_row "pennsync_records"."timesheet"; v_role text; v_email text; v_key text;
  v_start date; v_end date; v_status text; v_service text; v_earns boolean;
  v_profile record; v_config record; v_counts jsonb := '{}'::jsonb;
  v_daily jsonb := '[]'::jsonb; v_entry jsonb; v_mode text; v_points double precision := 0;
  v_numbers jsonb := '{}'::jsonb; v_field text; v_manager record; v_manager_email text := '';
  v_manager_name text := ''; v_now timestamptz; v_id text; v_pto double precision;
  v_phone double precision := 0; v_seen text[] := array[]::text[]; v_notified integer := 0;
  v_recipient record; v_missing boolean := false; v_constraint text;
begin
  -- Divergence 1: membership, not `is_approved`.
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_TIMESHEET_AGENCY_NOT_HELD';
  end if;
  if p_sheet is null or jsonb_typeof(p_sheet) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_INVALID';
  end if;
  for v_key in select k from jsonb_object_keys(p_sheet) k loop
    if v_key not in ('pay_period_start', 'pay_period_end', 'notes', 'manager_email',
      'status', 'entry_mode', 'daily_entries', 'visit_counts',
      'regular_points', 'emergency_visit_points', 'regular_hours', 'overtime_hours',
      'vacation_hours', 'holiday_hours', 'on_call_hours', 'on_call_visits',
      'miles', 'reimbursement') then
      raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_FIELD_UNSUPPORTED';
    end if;
  end loop;
  v_email := "pennsync_records".caller_email();

  v_status := coalesce(p_sheet->>'status', 'submitted');
  if v_status not in ('draft', 'submitted') then
    raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_STATUS_INVALID';
  end if;
  v_start := "pennsync_records".time_off_date(p_sheet->>'pay_period_start');
  v_end := "pennsync_records".time_off_date(p_sheet->>'pay_period_end');
  if v_start is null or v_end is null then
    raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_PERIOD_INVALID';
  end if;
  if v_end < v_start then
    raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_PERIOD_INVALID';
  end if;
  if not "pennsync_records".timesheet_period_aligned(v_start, v_end) then
    raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_PERIOD_UNALIGNED';
  end if;

  -- Divergences 2 and 3: the payroll profile decides the service line and
  -- whether points are earned at all.
  select p."service_type" as service_type, p."earns_points" as earns_points,
    p."active" as active, p."phone_reimbursement" as phone
  into v_profile
  from "pennsync_records"."employee_payroll_profile" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."agency_id" = p_agency
    and pg_catalog.lower(coalesce(p."employee_email", '')) = v_email;
  v_service := coalesce(v_profile.service_type, 'home_health');
  if v_service not in ('home_health', 'hospice') then
    raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_SERVICE_TYPE_INVALID';
  end if;
  v_earns := v_service = 'home_health' and v_profile.earns_points is true;
  v_phone := case when v_profile.service_type is not null and v_profile.active is not false
    then coalesce(v_profile.phone, 0) else 0 end;

  -- Every numeric bucket, checked before it is coerced.
  foreach v_field in array array['regular_points', 'emergency_visit_points',
    'regular_hours', 'overtime_hours', 'vacation_hours', 'holiday_hours',
    'on_call_hours', 'on_call_visits', 'miles', 'reimbursement'] loop
    if not "pennsync_records".timesheet_number_valid(p_sheet->v_field) then
      raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_NUMBER_INVALID';
    end if;
    v_numbers := v_numbers || jsonb_build_object(v_field,
      "pennsync_records".timesheet_number(p_sheet->v_field));
  end loop;

  v_mode := case when p_sheet->>'entry_mode' = 'daily' then 'daily' else 'bulk' end;
  if v_mode = 'daily' then
    if jsonb_typeof(p_sheet->'daily_entries') <> 'array'
      or jsonb_array_length(p_sheet->'daily_entries') > 14 then
      raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_DAILY_INVALID';
    end if;
    -- In daily mode the per-day rows are authoritative: the summed buckets
    -- REPLACE whatever period totals the client sent.
    for v_field in select 'regular_hours' union all select 'overtime_hours'
      union all select 'holiday_hours' union all select 'on_call_hours'
      union all select 'on_call_visits' loop
      v_numbers := v_numbers || jsonb_build_object(v_field, 0);
    end loop;
    for v_entry in select value from jsonb_array_elements(p_sheet->'daily_entries') loop
      if jsonb_typeof(v_entry) <> 'object'
        or "pennsync_records".time_off_date(v_entry->>'date') is null
        or (v_entry->>'date')::date < v_start or (v_entry->>'date')::date > v_end then
        raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_DAILY_INVALID';
      end if;
      if (v_entry->>'date') = any(v_seen) then
        raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_DAILY_DUPLICATE';
      end if;
      v_seen := v_seen || (v_entry->>'date');
      foreach v_field in array array['regular_hours', 'overtime_hours',
        'holiday_hours', 'on_call_hours', 'on_call_visits'] loop
        if not "pennsync_records".timesheet_number_valid(v_entry->v_field) then
          raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_NUMBER_INVALID';
        end if;
        v_numbers := v_numbers || jsonb_build_object(v_field,
          ((v_numbers->>v_field)::double precision
            + "pennsync_records".timesheet_number(v_entry->v_field)));
      end loop;
      foreach v_field in array array['soc', 'roc', 'recert', 'routine', 'discharge'] loop
        if not "pennsync_records".timesheet_number_valid(v_entry->'visit_counts'->v_field) then
          raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_NUMBER_INVALID';
        end if;
        v_counts := v_counts || jsonb_build_object(v_field,
          (coalesce((v_counts->>v_field)::double precision, 0)
            + "pennsync_records".timesheet_number(v_entry->'visit_counts'->v_field)));
      end loop;
      v_daily := v_daily || jsonb_build_array(jsonb_build_object(
        'date', v_entry->>'date',
        'regular_hours', "pennsync_records".timesheet_number(v_entry->'regular_hours'),
        'overtime_hours', "pennsync_records".timesheet_number(v_entry->'overtime_hours'),
        'holiday_hours', "pennsync_records".timesheet_number(v_entry->'holiday_hours'),
        'on_call_hours', "pennsync_records".timesheet_number(v_entry->'on_call_hours'),
        'on_call_visits', "pennsync_records".timesheet_number(v_entry->'on_call_visits'),
        'visit_counts', jsonb_build_object(
          'soc', "pennsync_records".timesheet_number(v_entry->'visit_counts'->'soc'),
          'roc', "pennsync_records".timesheet_number(v_entry->'visit_counts'->'roc'),
          'recert', "pennsync_records".timesheet_number(v_entry->'visit_counts'->'recert'),
          'routine', "pennsync_records".timesheet_number(v_entry->'visit_counts'->'routine'),
          'discharge', "pennsync_records".timesheet_number(v_entry->'visit_counts'->'discharge'))));
    end loop;
  end if;

  if v_earns then
    if v_mode <> 'daily' then
      foreach v_field in array array['soc', 'roc', 'recert', 'routine', 'discharge'] loop
        v_counts := v_counts || jsonb_build_object(v_field,
          "pennsync_records".timesheet_number(p_sheet->'visit_counts'->v_field));
      end loop;
    end if;
    -- Divergence 2: this agency's schedule, and no unscoped legacy fallback.
    select c."soc_points" as soc, c."roc_points" as roc, c."recert_points" as recert,
      c."routine_points" as routine, c."discharge_points" as discharge
    into v_config
    from "pennsync_records"."visit_point_config" c
    where c."source_app_id" = "pennsync_records".deployment_app()
      and c."agency_id" = p_agency and c."active" is not false
    order by c."updated_date" desc nulls last, c."id" limit 1;
    if v_config.soc is null and v_config.roc is null and v_config.recert is null
      and v_config.routine is null and v_config.discharge is null then
      v_missing := true;
    end if;
    v_points := pg_catalog.round((
      coalesce((v_counts->>'soc')::numeric, 0) * coalesce(v_config.soc, 0)::numeric
      + coalesce((v_counts->>'roc')::numeric, 0) * coalesce(v_config.roc, 0)::numeric
      + coalesce((v_counts->>'recert')::numeric, 0) * coalesce(v_config.recert, 0)::numeric
      + coalesce((v_counts->>'routine')::numeric, 0) * coalesce(v_config.routine, 0)::numeric
      + coalesce((v_counts->>'discharge')::numeric, 0)
        * coalesce(v_config.discharge, 0)::numeric), 2)::double precision;
  end if;
  v_numbers := v_numbers || jsonb_build_object('regular_points', v_points);
  v_pto := "pennsync_records".timesheet_pto_hours(p_agency, v_email, v_start, v_end);

  -- Divergence 4: the approver is a member of this agency who may approve.
  if coalesce(p_sheet->>'manager_email', '') <> '' then
    v_manager_email := pg_catalog.lower(pg_catalog.btrim(p_sheet->>'manager_email'));
    if v_manager_email = v_email then
      raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_APPROVER_SELF';
    end if;
    select r.base44_user_id, r.tenant_role, r.expected_email,
      r.membership_id, r.membership_version
    into v_manager
    from pennsync_private.agency_roster(p_agency) r
    where r.expected_email = v_manager_email;
    if v_manager.base44_user_id is null then
      raise exception using errcode='42501', message='PENNSYNC_TIMESHEET_APPROVER_UNKNOWN';
    end if;
    if v_manager.tenant_role not in ('agency_admin', 'manager') then
      raise exception using errcode='42501', message='PENNSYNC_TIMESHEET_APPROVER_INVALID';
    end if;
    v_manager_name := v_manager.expected_email;
  end if;

  v_now := clock_timestamp();
  -- One timesheet per (employee, service line, pay period). The original's own
  -- reason: *"Prevents a duplicate row from being double-counted in payroll."*
  --
  -- This lookup gives the REFUSAL; it does not give the guarantee. `for update`
  -- locks the row it finds and locks nothing at all when there is none, so what
  -- stops two concurrent first submissions is `timesheet_period_unique` and the
  -- handler at the write below. See the note there.
  select * into v_row from "pennsync_records"."timesheet" t
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."agency_id" = p_agency
    and pg_catalog.lower(coalesce(t."employee_email", '')) = v_email
    and t."service_type" = v_service
    and t."pay_period_start" = v_start and t."pay_period_end" = v_end
    and (p_timesheet_id is null or t."id" <> p_timesheet_id)
  limit 1 for update;
  if found then
    raise exception using errcode='22023', message=
      case when v_row."status" = 'approved' then 'PENNSYNC_TIMESHEET_PERIOD_APPROVED'
      else 'PENNSYNC_TIMESHEET_PERIOD_EXISTS' end;
  end if;

  if p_timesheet_id is not null and p_timesheet_id <> '' then
    if p_timesheet_id !~ '^[A-Za-z0-9_-]{1,200}$' then
      raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_SUBJECT_INVALID';
    end if;
    select * into v_row from "pennsync_records"."timesheet" t
    where t."source_app_id" = "pennsync_records".deployment_app()
      and t."id" = p_timesheet_id and t."agency_id" = p_agency for update;
    if not found then
      raise exception using errcode='42501', message='PENNSYNC_TIMESHEET_NOT_FOUND';
    end if;
    -- Tenancy is not ownership: the update policy is agency-wide.
    if pg_catalog.lower(coalesce(v_row."employee_email", '')) <> v_email
      and pg_catalog.lower(coalesce(v_row."created_by", '')) <> v_email then
      raise exception using errcode='42501', message='PENNSYNC_TIMESHEET_FORBIDDEN';
    end if;
    if v_row."status" = 'approved' then
      raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_APPROVED_LOCKED';
    end if;
    v_id := v_row."id";
  else
    v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
    insert into "pennsync_records"."timesheet"
      ("source_app_id", "id", "agency_id", "employee_email", "created_by",
       "created_date", "updated_date")
    values ("pennsync_records".deployment_app(), v_id, p_agency, v_email, v_email,
      v_now, v_now);
  end if;

  -- THE WRITE IS GUARDED BY THE INDEX, not by the lookup above (D78).
  -- `select … for update` **locks nothing when the row does not exist** — D33
  -- wrote that down about `chart_assignment`, and this port walked into it
  -- anyway: two concurrent submissions of the same pay period both found
  -- nothing, both inserted, and payroll counted the period twice, which is the
  -- exact outcome the original says its own check exists to prevent.
  -- `timesheet_period_unique` is what actually holds; this is where its refusal
  -- becomes the answer the uncontended path already gives.
  --
  -- The period columns are set by THIS statement rather than by the skeleton
  -- insert above, so the index is reached here on both paths — creating a
  -- timesheet and moving an existing one onto another's period alike. A caught
  -- exception rolls back only as far as this block, so the skeleton row from
  -- the create path outlives the handler; the re-raise below is what takes it
  -- with the caller's transaction, and the race test commits rather than rolls
  -- back to prove there is no orphan either way.
  begin
  update "pennsync_records"."timesheet" t set
    "employee_email" = v_email, "employee_name" = v_email,
    "service_type" = v_service,
    "pay_period_start" = v_start, "pay_period_end" = v_end,
    "regular_points" = (v_numbers->>'regular_points')::double precision,
    "emergency_visit_points" = (v_numbers->>'emergency_visit_points')::double precision,
    "regular_hours" = (v_numbers->>'regular_hours')::double precision,
    "overtime_hours" = (v_numbers->>'overtime_hours')::double precision,
    "vacation_hours" = (v_numbers->>'vacation_hours')::double precision,
    "holiday_hours" = (v_numbers->>'holiday_hours')::double precision,
    "on_call_hours" = (v_numbers->>'on_call_hours')::double precision,
    "on_call_visits" = (v_numbers->>'on_call_visits')::double precision,
    "miles" = (v_numbers->>'miles')::double precision,
    "reimbursement" = (v_numbers->>'reimbursement')::double precision,
    "visit_counts" = v_counts, "entry_mode" = v_mode, "daily_entries" = v_daily,
    "auto_pto_hours" = v_pto, "phone_reimbursement" = v_phone,
    "notes" = pg_catalog.left(coalesce(p_sheet->>'notes', ''), 2000),
    "manager_email" = v_manager_email, "manager_name" = v_manager_name,
    "status" = v_status,
    "submitted_at" = case when v_status = 'submitted' then v_now else t."submitted_at" end,
    -- Editing or resubmitting clears a prior review. The original sets these to
    -- EMPTY rather than undefined, because "undefined ... JSON-omits and would
    -- leave the stale values in place".
    "reviewed_by" = null, "reviewer_name" = null, "reviewed_at" = null,
    "review_notes" = null,
    "updated_date" = v_now
  where t."source_app_id" = "pennsync_records".deployment_app() and t."id" = v_id
  returning * into v_row;
  exception when unique_violation then
    -- The constraint is read rather than assumed: any other unique violation is
    -- a different defect and is re-raised untouched.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'timesheet_period_unique' then raise; end if;
    -- Read committed takes a fresh snapshot per statement, so the winner's row
    -- is visible here and the answer is the one the lookup above would have
    -- given had it run a moment later. The predicate is that lookup's, to the
    -- letter, so a caller cannot tell a race from a duplicate and need not.
    select * into v_row from "pennsync_records"."timesheet" t
    where t."source_app_id" = "pennsync_records".deployment_app()
      and t."agency_id" = p_agency
      and pg_catalog.lower(coalesce(t."employee_email", '')) = v_email
      and t."service_type" = v_service
      and t."pay_period_start" = v_start and t."pay_period_end" = v_end
      and (p_timesheet_id is null or t."id" <> p_timesheet_id)
    limit 1;
    raise exception using errcode='22023', message=
      case when found and v_row."status" = 'approved'
        then 'PENNSYNC_TIMESHEET_PERIOD_APPROVED'
      else 'PENNSYNC_TIMESHEET_PERIOD_EXISTS' end;
  end;

  -- Divergence 6: the approvers are told, through the facility.
  if v_status = 'submitted' then
    for v_recipient in
      select r.base44_user_id, r.expected_email, r.membership_id, r.membership_version
      from pennsync_private.agency_roster(p_agency) r
      where r.expected_email <> v_email
        and (r.tenant_role = 'agency_admin'
          or (v_manager_email <> '' and r.expected_email = v_manager_email))
      order by r.expected_email
    loop
      perform "pennsync_records".notification_mint(
        p_agency, v_recipient.base44_user_id, v_recipient.expected_email,
        v_recipient.membership_id, v_recipient.membership_version,
        'Timesheet submitted',
        v_email || ' submitted a timesheet for '
          || pg_catalog.to_char(v_start, 'YYYY-MM-DD') || ' → '
          || pg_catalog.to_char(v_end, 'YYYY-MM-DD') || '.',
        'task_assigned', 'medium', '/Timesheets', 'Review timesheet',
        jsonb_build_object('timesheet_id', v_id, 'employee_email', v_email),
        'timesheet:' || v_id || ':' || pg_catalog.to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.US')
          || ':' || v_recipient.expected_email);
      v_notified := v_notified + 1;
    end loop;
  end if;

  return jsonb_build_object('success', true,
    'timesheet', "pennsync_records".timesheet_row(v_row),
    'earns_points', v_earns, 'point_config_missing', v_missing,
    'notified', v_notified, 'delivery_paused', true);
end $contract$;

create function "pennsync_records".contract_timesheet_review(
  p_agency text, p_timesheet_id text, p_decision text, p_note text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_row "pennsync_records"."timesheet"; v_role text; v_email text; v_now timestamptz;
  v_owner record; v_note text; v_id text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_TIMESHEET_AGENCY_NOT_HELD';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_DECISION_INVALID';
  end if;
  if p_timesheet_id is null or p_timesheet_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_SUBJECT_INVALID';
  end if;
  v_email := "pennsync_records".caller_email();

  select * into v_row from "pennsync_records"."timesheet" t
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."id" = p_timesheet_id and t."agency_id" = p_agency for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_TIMESHEET_NOT_FOUND';
  end if;
  -- Divergence 5: an administrator, or the sheet's own assigned approver.
  if v_role <> 'agency_admin'
    and pg_catalog.lower(coalesce(v_row."manager_email", '')) is distinct from v_email then
    raise exception using errcode='42501', message='PENNSYNC_TIMESHEET_REVIEW_FORBIDDEN';
  end if;
  -- Never your own, even as an administrator. Both originals refuse this.
  if pg_catalog.lower(coalesce(v_row."employee_email", '')) = v_email
    or pg_catalog.lower(coalesce(v_row."created_by", '')) = v_email then
    raise exception using errcode='42501', message='PENNSYNC_TIMESHEET_REVIEW_SELF';
  end if;
  if v_row."status" is distinct from 'submitted' then
    raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_NOT_AWAITING_REVIEW';
  end if;

  v_now := clock_timestamp();
  v_note := pg_catalog.left(coalesce(p_note, ''), 2000);
  update "pennsync_records"."timesheet" t set
    "status" = p_decision, "reviewed_by" = v_email, "reviewer_name" = v_email,
    "reviewed_at" = v_now, "review_notes" = v_note, "updated_date" = v_now
  where t."source_app_id" = v_row."source_app_id" and t."id" = v_row."id"
  returning * into v_row;

  -- The employee is told the outcome, through the facility (D48).
  select r.base44_user_id, r.expected_email, r.membership_id, r.membership_version
  into v_owner from pennsync_private.agency_roster(p_agency) r
  where r.expected_email = pg_catalog.lower(coalesce(v_row."employee_email", ''));
  if v_owner.base44_user_id is not null then
    v_id := "pennsync_records".notification_mint(
      p_agency, v_owner.base44_user_id, v_owner.expected_email,
      v_owner.membership_id, v_owner.membership_version,
      case when p_decision = 'approved' then 'Timesheet approved'
        else 'Timesheet needs changes' end,
      'Your timesheet for ' || pg_catalog.to_char(v_row."pay_period_start", 'YYYY-MM-DD')
        || ' → ' || pg_catalog.to_char(v_row."pay_period_end", 'YYYY-MM-DD')
        || ' was ' || p_decision
        || case when pg_catalog.btrim(v_note) <> '' then ': ' || v_note else '.' end,
      case when p_decision = 'approved' then 'info' else 'compliance_alert' end,
      'medium', '/Timesheets', 'View timesheet',
      jsonb_build_object('timesheet_id', v_row."id", 'reviewed_by', v_email),
      'timesheet-review:' || v_row."id" || ':'
        || pg_catalog.to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.US'));
  end if;

  return jsonb_build_object('success', true, 'decision', p_decision,
    'timesheet', "pennsync_records".timesheet_row(v_row),
    'notification_id', v_id, 'notified', case when v_id is null then 0 else 1 end,
    'delivery_paused', true);
end $contract$;

reset role;

revoke all on function
  "pennsync_records".timesheet_number(jsonb),
  "pennsync_records".timesheet_number_valid(jsonb),
  "pennsync_records".timesheet_period_aligned(date,date),
  "pennsync_records".timesheet_business_days(date,date,date,date),
  "pennsync_records".timesheet_pto_hours(text,text,date,date),
  "pennsync_records".timesheet_row("pennsync_records"."timesheet"),
  "pennsync_records".contract_timesheet_submit(text,text,jsonb),
  "pennsync_records".contract_timesheet_review(text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_timesheet_submit(text,text,jsonb),
  "pennsync_records".contract_timesheet_review(text,text,text,text)
  to authenticated;

create function "public"."pennsync_contract_timesheet_submit"(
  p_agency text, p_timesheet_id text, p_sheet jsonb) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_timesheet_submit(p_agency, p_timesheet_id, p_sheet)
$c$;
create function "public"."pennsync_contract_timesheet_review"(
  p_agency text, p_timesheet_id text, p_decision text, p_note text) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_timesheet_review(p_agency, p_timesheet_id,
    p_decision, p_note)
$c$;

revoke all on function
  "public"."pennsync_contract_timesheet_submit"(text,text,jsonb),
  "public"."pennsync_contract_timesheet_review"(text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_timesheet_submit"(text,text,jsonb),
  "public"."pennsync_contract_timesheet_review"(text,text,text,text)
  to authenticated;

commit;
