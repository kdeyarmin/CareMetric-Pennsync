-- The dashboard's five collections, in one statement each and one round trip.
--
-- HAND WRITTEN, like every contract. This is the capability that was PARKED,
-- and it is worth saying why and what unparked it: the original returns five
-- WHOLE entity rows — `patients`, `visits`, `incidents`,
-- `recentCompletedVisits`, `carePlans` — with no projection at all, and D64
-- requires every disclosed column to be named. Two of those entities have no
-- extracted read purpose to name them from, so the note against this port read
-- "inventing two field lists is a decision, not a transcription."
--
-- It is not an invention if it is MEASURED. The field set below is read from
-- the dashboard's own consumers — `todayPriorities.js`, `coreWorkQueues.js`,
-- `RealTimePatientAlerts.jsx` and `SmartRouteOptimizer.jsx` — and its test
-- re-derives it from those files, so a widget that starts reading a new column
-- fails the build instead of silently receiving `undefined`. That is the same
-- shape as D57's arithmetic parity and D70's template scan: read what the code
-- does rather than assert what somebody remembers.
--
-- WHAT THE MEASUREMENT FOUND, which is the reason this file is worth reading.
-- Four of the fields those widgets read exist in NEITHER the record store nor
-- the Base44 entity schemas:
--
--   * `patient.risk_level` and `patient.hospitalization_risk`. The "N
--     high-risk patients to review" priority is computed from them and from a
--     `riskLevel` spelling that is also absent, so **that priority can never
--     fire** — in Base44 today, not only here.
--   * `visit.note_id`. The "N completed visits need notes" priority is
--     `visit.status === 'completed' && !visit.note_id`, and with the field
--     always undefined the negation is always true — so it **over-reports**,
--     counting every completed visit rather than the undocumented ones.
--   * `patient.full_name` and `patient.name`, the two fallbacks in
--     `patientName()`. Neither exists; the first and last name always answer.
--
-- None of the four is invented here. The projection carries what the store
-- holds, the behaviour is unchanged, and the defects are recorded rather than
-- papered over — which is what D45 and D51 did with the notification envelope.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. **`patientBelongsToCaller` goes**, exactly as it does in D70. It is
--    `patient.created_by` plus `patient.assigned_nurses` — D41's derived scope
--    and the addresses D24's backfill refuses to read because they resurrect
--    revoked access — and `patient_read` already answers it.
-- 2. **The cross-tenant branch goes.** `isProtectedSuperAdmin` is the
--    `SUPER_ADMIN_EMAIL` tier D14 and D22 removed. What it was for at tenant
--    scope is D24's: an `agency_admin` or `manager` opens every chart in their
--    agency, so they get the agency-wide dashboard through the policies.
-- 3. **The scan limits go and the answer limits stay** (D50's distinction).
--    `PATIENT_SCAN_LIMIT`, `VISIT_SCAN_LIMIT`, `INCIDENT_SCAN_LIMIT`,
--    `COMPLETED_VISIT_SCAN_LIMIT` and `CARE_PLAN_SCAN_LIMIT` exist to over-fetch
--    so a JavaScript filter can re-check what a service-role query returned —
--    the "treat the backend filter as an optimization, not an authorization
--    boundary" compensation. The policies are the boundary here. The five
--    display caps are the capability and are kept.
-- 4. **`today` is the agency's wall clock**, which the original's own
--    `todayEastern()` is: a visit at 9pm in New York on the 18th is today, not
--    tomorrow because UTC has turned over.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.caller_tenant_role(text)') is null
    or to_regprocedure('pennsync_records.agency_today()') is null then
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

-- Nine columns, each one read by a named widget. `address` is here because the
-- route optimizer plots a visit to it; `risk_level` and `hospitalization_risk`
-- are NOT, because no such column exists anywhere in this product.
create function "pennsync_records".dashboard_patient(p "pennsync_records"."patient")
  returns jsonb language sql immutable set search_path = '' as $row$
  select jsonb_build_object(
    'id', p."id",
    'first_name', p."first_name",
    'last_name', p."last_name",
    'status', p."status",
    'primary_diagnosis', p."primary_diagnosis",
    'address', p."address",
    'updated_date', p."updated_date")
$row$;

-- Six columns. `note_id` is absent for the reason the header gives: it exists
-- nowhere, and the priority that reads it has been over-reporting since it was
-- written.
create function "pennsync_records".dashboard_visit(v "pennsync_records"."visit")
  returns jsonb language sql immutable set search_path = '' as $row$
  select jsonb_build_object(
    'id', v."id",
    'patient_id', v."patient_id",
    'status', v."status",
    'visit_date', v."visit_date",
    'visit_time', v."visit_time",
    'visit_type', v."visit_type")
$row$;

create function "pennsync_records".dashboard_incident(i "pennsync_records"."incident")
  returns jsonb language sql immutable set search_path = '' as $row$
  select jsonb_build_object(
    'id', i."id",
    'patient_id', i."patient_id",
    'status', i."status",
    'incident_date', i."incident_date",
    'incident_name', i."incident_name",
    'incident_type', i."incident_type")
$row$;

create function "pennsync_records".dashboard_care_plan(c "pennsync_records"."care_plan")
  returns jsonb language sql immutable set search_path = '' as $row$
  select jsonb_build_object(
    'id', c."id",
    'patient_id', c."patient_id",
    'status', c."status",
    'target_date', c."target_date",
    'problem', c."problem")
$row$;

create function "pennsync_records".contract_dashboard(p_agency text)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare
  v_role text; v_today date; v_ids text[];
  v_patients jsonb; v_visits jsonb; v_incidents jsonb;
  v_completed jsonb; v_plans jsonb;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_DASHBOARD_AGENCY_NOT_HELD';
  end if;
  v_today := "pennsync_records".agency_today();

  -- The patients are the dashboard's scope: every other collection is keyed to
  -- the ids this one returns, exactly as the original keys its to
  -- `patients.map(p => p.id)`. Which patients those are is the policies'
  -- answer — the care team's charts for a clinician, the agency for an
  -- `agency_admin` or `manager`, and none for `office_staff`.
  with page as (
    select t as entry, t."updated_date" as updated_date, t."id" as id
    from "pennsync_records"."patient" t
    where t."source_app_id" = "pennsync_records".deployment_app()
      and t."agency_id" = p_agency and t."status" = 'active'
    order by t."updated_date" desc nulls last, t."id" desc
    limit 100
  )
  select coalesce(jsonb_agg("pennsync_records".dashboard_patient(page.entry)
      order by page.updated_date desc nulls last, page.id desc), '[]'::jsonb),
    coalesce(pg_catalog.array_agg(page.id), '{}'::text[])
  into v_patients, v_ids from page;

  if pg_catalog.array_length(v_ids, 1) is null then
    return jsonb_build_object('patients', '[]'::jsonb, 'visits', '[]'::jsonb,
      'incidents', '[]'::jsonb, 'recent_completed_visits', '[]'::jsonb,
      'care_plans', '[]'::jsonb, 'today', v_today);
  end if;

  select coalesce(jsonb_agg("pennsync_records".dashboard_visit(v.entry)
      order by v.visit_time desc nulls last, v.id desc), '[]'::jsonb)
  into v_visits from (
    select t as entry, t."visit_time" as visit_time, t."id" as id
    from "pennsync_records"."visit" t
    where t."source_app_id" = "pennsync_records".deployment_app()
      and t."agency_id" = p_agency and t."patient_id" = any(v_ids)
      and t."visit_date" = v_today
    order by t."visit_time" desc nulls last, t."id" desc
    limit 500) v;

  select coalesce(jsonb_agg("pennsync_records".dashboard_incident(i.entry)
      order by i.incident_date desc nulls last, i.id desc), '[]'::jsonb)
  into v_incidents from (
    select t as entry, t."incident_date" as incident_date, t."id" as id
    from "pennsync_records"."incident" t
    where t."source_app_id" = "pennsync_records".deployment_app()
      and t."patient_id" = any(v_ids)
    order by t."incident_date" desc nulls last, t."id" desc
    limit 20) i;

  select coalesce(jsonb_agg("pennsync_records".dashboard_visit(v.entry)
      order by v.visit_date desc nulls last, v.id desc), '[]'::jsonb)
  into v_completed from (
    select t as entry, t."visit_date" as visit_date, t."id" as id
    from "pennsync_records"."visit" t
    where t."source_app_id" = "pennsync_records".deployment_app()
      and t."agency_id" = p_agency and t."patient_id" = any(v_ids)
      and t."status" = 'completed'
    order by t."visit_date" desc nulls last, t."id" desc
    limit 500) v;

  select coalesce(jsonb_agg("pennsync_records".dashboard_care_plan(c.entry)
      order by c.updated_date desc nulls last, c.id desc), '[]'::jsonb)
  into v_plans from (
    select t as entry, t."updated_date" as updated_date, t."id" as id
    from "pennsync_records"."care_plan" t
    where t."source_app_id" = "pennsync_records".deployment_app()
      and t."patient_id" = any(v_ids) and t."status" = 'active'
    order by t."updated_date" desc nulls last, t."id" desc
    limit 200) c;

  return jsonb_build_object('patients', v_patients, 'visits', v_visits,
    'incidents', v_incidents, 'recent_completed_visits', v_completed,
    'care_plans', v_plans, 'today', v_today);
end $contract$;

reset role;

revoke all on function
  "pennsync_records".dashboard_patient("pennsync_records"."patient"),
  "pennsync_records".dashboard_visit("pennsync_records"."visit"),
  "pennsync_records".dashboard_incident("pennsync_records"."incident"),
  "pennsync_records".dashboard_care_plan("pennsync_records"."care_plan"),
  "pennsync_records".contract_dashboard(text)
  from public, anon, authenticated, service_role;
grant execute on function "pennsync_records".contract_dashboard(text) to authenticated;

create function "public"."pennsync_contract_dashboard"(p_agency text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_dashboard(p_agency)
$contract$;

revoke all on function "public"."pennsync_contract_dashboard"(text)
  from public, anon, service_role;
grant execute on function "public"."pennsync_contract_dashboard"(text) to authenticated;

commit;
