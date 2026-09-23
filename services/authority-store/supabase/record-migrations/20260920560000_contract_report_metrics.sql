-- The AI report's corpus, as counts rather than rows.
--
-- HAND WRITTEN, like every contract. `generateAIReport` is the last capability
-- the port queue reported as startable, and the shape it takes is D81's: the
-- document is served, and the delivery half answers the original's own paused
-- refusal. What is NEW here is that the contract returns no entity row at all.
-- The original pulls nine collections — up to 5,000 patients, 5,000 profiles,
-- 5,000 tasks, 5,000 alerts, 5,000 notes, 1,000 visits, 500 incidents, 500
-- audits — into a Deno isolate to count them, and every one of those rows is a
-- chart or a colleague. The report is counts, rates and a staff table. So the
-- counting happens here, where the policies are, and what crosses the boundary
-- is arithmetic inputs: totals, sums and group keys.
--
-- WHAT THE ORIGINAL'S SCOPE FILTER ACTUALLY DID, which is why this file exists.
-- Its own comment says the filter is there "so an agency_admin cannot pull
-- every tenant's PHI into a PDF/email". No `agency_admin` can reach it. The
-- gate is `isAdminLike`, which is `u.role === 'admin'` and nothing else, and
-- `withTrustedClaims` returns a built-in admin's profile UNTOUCHED — its first
-- line is `if (profile.role === 'admin') return profile`. So the only caller
-- the code can reach is the platform tier, and for that caller `agency_name`
-- and `account_type` are the self-editable labels D23 describes. The scope the
-- comment promises is therefore selected by the person it is meant to
-- constrain: set `account_type` to `super_admin` and the filter is skipped
-- entirely; set `agency_name` to somebody else's and it scopes to them.
--
-- That is D69's rule (read what the code can REACH, not what it appears to
-- offer) and D36's (a comment is not a permission) arriving in one place. It is
-- also the purest case of D41's derived scope: `agency_name` strings,
-- `created_by` addresses and `assigned_nurses` arrays, rebuilt by hand. The
-- port deletes all of it. Under D40 the successor to `role === 'admin'` is an
-- `agency_admin` scoped to their own agency, and the policies answer the scope
-- for the first time rather than a label the caller writes.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. **The gate is an `agency_admin`** (D40), and it is the sixth widening
--    taken under that decision. Re-read what the platform tier was
--    STRUCTURALLY preventing, as D40 requires: it was preventing nothing here,
--    because the tier chose its own scope. The narrowing that comes with the
--    widening is real — an `agency_admin` sees one agency and cannot name
--    another — and it is enforced by `caller_tenant_role`, not by a label.
-- 2. **The nine scan limits go** (D50's distinction). They exist to over-fetch
--    for a JavaScript filter; an aggregate has no tail to fall off. The window
--    ceiling STAYS and is re-applied here, because a bound a caller could
--    raise is not a bound (D71) — it is a cost control rather than a
--    disclosure one, and the reason is in `PENNSYNC_REPORT_RANGE_TOO_WIDE`.
-- 3. **The staff population is the roster** (D41), so `users.filter(u =>
--    u.role === 'user')` becomes `caller_roster(agency)`. That is the fifth
--    original whose five-thousand-row profile scan the tenancy replaces, and
--    the roster supplies the verified address the carried `user` table has no
--    column for. Note that `role === 'user'` was everybody who is not the
--    built-in admin, so the population is the agency's active members and the
--    substitution neither widens nor narrows it.
-- 4. **`full_name` is not carried and no address is substituted for it.** The
--    carried `user` table has no name column (D38), and the PDF prints
--    `nurse.name` where the original's `full_name || email` had already fallen
--    through to the address for every row Base44 stores. The service keeps that
--    fallback over the roster's address, which is the same string; this is
--    D46's case and not D69's, because there is no Email column beside it to
--    print the address twice.
-- 5. **The training figures are not counted here.** `TrainingAssignment` is
--    `hub`, and D84's `uncarried_legs` entry settles that leg by name: the
--    Support Hub's own learning reports serve it (D8). The answer says so
--    rather than reporting a zero that would read as "nobody trained".
-- 6. **Float accumulation order is PINNED.** Three of the report's averages are
--    sums of `double precision` columns divided by a row count, and float
--    addition is not associative, so an unordered `sum()` is not reproducible
--    between two runs of the same query, let alone between this store and a
--    JavaScript array. Each sum here accumulates in the original's own order —
--    `created_date` descending, which is what `.list('-created_date')` asks for
--    — with the id as the tiebreaker D25 requires. The division and its
--    `toFixed(1)` stay in the service, on the original's own expressions, so
--    the rounding is not reimplemented at all.
-- 7. **The date comparison is reproduced rather than tidied.** `visit_date` and
--    `incident_date` are `date` columns and the window bounds are instants; the
--    original compares `new Date(v.visit_date)` — UTC midnight — against a
--    bound that carries a time of day, so a visit on the first day of the
--    window is excluded unless the window starts at midnight. That is kept, and
--    the cast names UTC explicitly rather than inheriting a session TimeZone.
--
-- 8. **The staff table matches addresses case-insensitively.** The original
--    compares `v.created_by === nurse.email` exactly. The roster's address is
--    `identity_map`'s, constrained to `lower(btrim(...))`, so an exact compare
--    against a raw stored address would drop a nurse's visits from the table
--    for a difference of case in the same mailbox. This can only match more
--    rows and cannot attribute one to the wrong person.
--
-- Refusals: PENNSYNC_REPORT_AGENCY_NOT_HELD, PENNSYNC_REPORT_FORBIDDEN,
-- PENNSYNC_REPORT_RANGE_INVALID, PENNSYNC_REPORT_RANGE_TOO_WIDE.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.caller_tenant_role(text)') is null
    or to_regprocedure('pennsync_records.caller_roster(text)') is null then
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

-- A row whose chart is in the caller's agency. This replaces
-- `patientIds.has(x.patient_id)` and carries the policies with it: an
-- `agency_admin` opens every chart, so the set is the agency's, and a caller
-- who opened fewer would see fewer — the narrowing is the policies' to make,
-- not this predicate's.
create function "pennsync_records".report_chart_in_agency(p_agency text, p_patient text)
  returns boolean language sql stable set search_path = '' as $chart$
  select exists (
    select 1 from "pennsync_records"."patient" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."agency_id" = p_agency and p."id" = p_patient)
$chart$;

-- `compliance_audit` reaches tenancy through its VISIT, not its patient: its
-- own read policy is an `exists` over `visit.visit_id`. So the agency is named
-- there, and an audit naming no visit is in no tenant at all.
create function "pennsync_records".report_visit_in_agency(p_agency text, p_visit text)
  returns boolean language sql stable set search_path = '' as $visit$
  select exists (
    select 1 from "pennsync_records"."visit" v
    where v."source_app_id" = "pennsync_records".deployment_app()
      and v."agency_id" = p_agency and v."id" = p_visit)
$visit$;

create function "pennsync_records".contract_report_metrics(
    p_agency text, p_start timestamptz, p_end timestamptz)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare
  v_role text;
  v_visits_total integer; v_visits_done integer;
  v_patients_total integer; v_patients_active integer;
  v_falls integer; v_hospitalizations integer; v_med_errors integer;
  v_audits integer; v_audit_sum double precision;
  v_passed integer; v_flagged integer; v_critical integer;
  v_notes integer; v_quality_sum double precision; v_improvement_sum double precision;
  v_alerts_critical integer;
  v_tasks_total integer; v_tasks_done integer;
  v_roster jsonb; v_roster_size integer;
  v_daily jsonb; v_nurse_visits jsonb; v_nurse_notes jsonb;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_REPORT_AGENCY_NOT_HELD';
  end if;
  -- D40. The original's gate is `role === 'admin'` and nothing else; the
  -- successor is an administrator of this agency. A `manager` opens every chart
  -- and still does not get the agency's payroll-adjacent staff table, because
  -- the original never offered this capability to one.
  if v_role is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_REPORT_FORBIDDEN';
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception using errcode='22023', message='PENNSYNC_REPORT_RANGE_INVALID';
  end if;
  -- The original clamps `date_range_days` to 1..365 in JavaScript. A caller
  -- reaching the RPC directly has no such clamp, and the cost this bounds is
  -- real: the trend below emits a row per day and the PDF draws a bar for each.
  if p_end - p_start > interval '365 days' then
    raise exception using errcode='22023', message='PENNSYNC_REPORT_RANGE_TOO_WIDE';
  end if;

  select count(*)::integer,
    count(*) filter (where v."status" = 'completed')::integer
  into v_visits_total, v_visits_done
  from "pennsync_records"."visit" v
  where v."source_app_id" = "pennsync_records".deployment_app()
    and v."agency_id" = p_agency
    and "pennsync_records".report_chart_in_agency(p_agency, v."patient_id")
    and (v."visit_date"::timestamp at time zone 'UTC') >= p_start
    and (v."visit_date"::timestamp at time zone 'UTC') <= p_end;

  -- No date filter, exactly as the original: the patient census is current, not
  -- windowed, and both figures come off the same scan.
  select count(*)::integer,
    count(*) filter (where p."status" = 'active')::integer
  into v_patients_total, v_patients_active
  from "pennsync_records"."patient" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."agency_id" = p_agency;

  select count(*) filter (where i."incident_type" = 'fall')::integer,
    count(*) filter (where i."incident_type" = 'hospitalized')::integer,
    count(*) filter (where i."incident_type" = 'medication_error')::integer
  into v_falls, v_hospitalizations, v_med_errors
  from "pennsync_records"."incident" i
  where i."source_app_id" = "pennsync_records".deployment_app()
    and "pennsync_records".report_chart_in_agency(p_agency, i."patient_id")
    and (i."incident_date"::timestamp at time zone 'UTC') >= p_start
    and (i."incident_date"::timestamp at time zone 'UTC') <= p_end;

  -- `compliance_audit` has no `agency_id` and its tenant path is the VISIT —
  -- read the policy rather than assuming the patient column carries it, which
  -- is how the first draft of this contract counted zero audits. The original's
  -- `!a.patient_id || patientIds.has(a.patient_id)` is reproduced as written,
  -- and it is a LIVE branch here: an audit with no patient is still visible
  -- through its visit. The unreachable case is an audit naming no VISIT, which
  -- lands in no tenant. Contrast `patient_alert` below, whose only path IS the
  -- patient, so there the original's null branch really is dead.
  select count(*)::integer,
    sum(coalesce(a."compliance_score", 0)
      order by a."created_date" desc nulls last, a."id" desc),
    count(*) filter (where a."status" = 'passed')::integer,
    count(*) filter (where a."status" = 'flagged')::integer,
    count(*) filter (where a."status" = 'critical')::integer
  into v_audits, v_audit_sum, v_passed, v_flagged, v_critical
  from "pennsync_records"."compliance_audit" a
  where a."source_app_id" = "pennsync_records".deployment_app()
    and "pennsync_records".report_visit_in_agency(p_agency, a."visit_id")
    and (a."patient_id" is null
      or "pennsync_records".report_chart_in_agency(p_agency, a."patient_id"))
    and a."created_date" >= p_start and a."created_date" <= p_end;

  select count(*)::integer,
    sum(coalesce(n."quality_score", 0)
      order by n."created_date" desc nulls last, n."id" desc),
    sum(coalesce(n."compliance_improvement", 0)
      order by n."created_date" desc nulls last, n."id" desc)
  into v_notes, v_quality_sum, v_improvement_sum
  from "pennsync_records"."note_conversion" n
  where n."source_app_id" = "pennsync_records".deployment_app()
    and n."agency_id" = p_agency
    and (n."patient_id" is null
      or "pennsync_records".report_chart_in_agency(p_agency, n."patient_id"))
    and n."created_date" >= p_start and n."created_date" <= p_end;

  select count(*)::integer into v_alerts_critical
  from "pennsync_records"."patient_alert" al
  where al."source_app_id" = "pennsync_records".deployment_app()
    and "pennsync_records".report_chart_in_agency(p_agency, al."patient_id")
    and al."severity" = 'critical' and al."status" = 'active';

  select count(*)::integer,
    count(*) filter (where t."status" = 'completed')::integer
  into v_tasks_total, v_tasks_done
  from "pennsync_records"."task" t
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."agency_id" = p_agency
    and (t."patient_id" is null
      or "pennsync_records".report_chart_in_agency(p_agency, t."patient_id"));

  -- Per-UTC-day note counts. The service expands these into the day buckets the
  -- original's own `calculateDailyTrend` builds, rather than a second
  -- implementation of them: that function reads nothing but `created_date`, so
  -- a count is all it needs to be fed faithfully.
  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'count', d.count)
      order by d.day), '[]'::jsonb)
  into v_daily from (
    select (n."created_date" at time zone 'UTC')::date as day, count(*)::integer as count
    from "pennsync_records"."note_conversion" n
    where n."source_app_id" = "pennsync_records".deployment_app()
      and n."agency_id" = p_agency
      and (n."patient_id" is null
        or "pennsync_records".report_chart_in_agency(p_agency, n."patient_id"))
      and n."created_date" >= p_start and n."created_date" <= p_end
    group by 1) d;

  -- D41. The audited population of PEOPLE is the roster, so the original's
  -- 5,000-row profile scan and its `role === 'user'` test both go. The address
  -- is the identity map's verified one, which is what makes the two groupings
  -- below joinable at all.
  select coalesce(jsonb_agg(r.email order by r.email), '[]'::jsonb), count(*)::integer
  into v_roster, v_roster_size
  from "pennsync_records".caller_roster(p_agency) r;

  -- These two groupings are complete PARTITIONS of the rows above — a visit or
  -- a note whose address is null or belongs to nobody on the roster is grouped
  -- under '' rather than dropped. That is what lets the service rebuild an
  -- array the original's own `calculateMetrics` can be handed unmodified: the
  -- group counts sum to the totals by construction, so nothing has to be
  -- derived by subtracting one float sum from another.
  --
  -- Addresses are compared case-insensitively here where the original compares
  -- with `===`. That can only match MORE rows, never attribute one to the wrong
  -- person: `identity_map` constrains its address to `lower(btrim(...))`, so a
  -- visit stored with a capital letter is the same mailbox and the original
  -- silently dropped it from the staff table.
  select coalesce(jsonb_agg(jsonb_build_object(
      'email', g.email, 'total', g.total, 'completed', g.completed)
      order by g.email), '[]'::jsonb)
  into v_nurse_visits from (
    select coalesce(lower(btrim(v."created_by")), '') as email, count(*)::integer as total,
      count(*) filter (where v."status" = 'completed')::integer as completed
    from "pennsync_records"."visit" v
    where v."source_app_id" = "pennsync_records".deployment_app()
      and v."agency_id" = p_agency
      and "pennsync_records".report_chart_in_agency(p_agency, v."patient_id")
      and (v."visit_date"::timestamp at time zone 'UTC') >= p_start
      and (v."visit_date"::timestamp at time zone 'UTC') <= p_end
    group by 1) g;

  select coalesce(jsonb_agg(jsonb_build_object(
      'email', g.email, 'count', g.count,
      'quality_sum', g.quality_sum, 'improvement_sum', g.improvement_sum)
      order by g.email), '[]'::jsonb)
  into v_nurse_notes from (
    select coalesce(lower(btrim(n."nurse_email")), '') as email, count(*)::integer as count,
      sum(coalesce(n."quality_score", 0)
        order by n."created_date" desc nulls last, n."id" desc) as quality_sum,
      sum(coalesce(n."compliance_improvement", 0)
        order by n."created_date" desc nulls last, n."id" desc) as improvement_sum
    from "pennsync_records"."note_conversion" n
    where n."source_app_id" = "pennsync_records".deployment_app()
      and n."agency_id" = p_agency
      and (n."patient_id" is null
        or "pennsync_records".report_chart_in_agency(p_agency, n."patient_id"))
      and n."created_date" >= p_start and n."created_date" <= p_end
    group by 1) g;

  return jsonb_build_object(
    'visits_total', v_visits_total,
    'visits_completed', v_visits_done,
    'patients_total', v_patients_total,
    'patients_active', v_patients_active,
    'falls', v_falls,
    'hospitalizations', v_hospitalizations,
    'medication_errors', v_med_errors,
    'audits_total', v_audits,
    'audit_score_sum', coalesce(v_audit_sum, 0),
    'audits_passed', v_passed,
    'audits_flagged', v_flagged,
    'audits_critical', v_critical,
    'notes_total', v_notes,
    'note_quality_sum', coalesce(v_quality_sum, 0),
    'note_improvement_sum', coalesce(v_improvement_sum, 0),
    'critical_alerts', v_alerts_critical,
    'tasks_total', v_tasks_total,
    'tasks_completed', v_tasks_done,
    'roster', v_roster,
    'roster_size', v_roster_size,
    'daily_notes', v_daily,
    'nurse_visits', v_nurse_visits,
    'nurse_notes', v_nurse_notes,
    -- D84. `TrainingAssignment` is `hub`; the Support Hub's own learning
    -- reports serve this leg (D8). A zero here would read as "nobody trained".
    'training_completed', 'served_by_hub',
    'training_score', 'served_by_hub',
    'code', 'PENNSYNC_REPORT_TRAINING_LEG_ON_HUB');
end $contract$;

reset role;

revoke all on function
  "pennsync_records".report_chart_in_agency(text, text),
  "pennsync_records".report_visit_in_agency(text, text),
  "pennsync_records".contract_report_metrics(text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_report_metrics(text, timestamptz, timestamptz)
  to authenticated;

create function "public"."pennsync_contract_report_metrics"(
    p_agency text, p_start timestamptz, p_end timestamptz) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_report_metrics(p_agency, p_start, p_end)
$contract$;

revoke all on function
  "public"."pennsync_contract_report_metrics"(text, timestamptz, timestamptz)
  from public, anon, service_role;
grant execute on function
  "public"."pennsync_contract_report_metrics"(text, timestamptz, timestamptz)
  to authenticated;

commit;
