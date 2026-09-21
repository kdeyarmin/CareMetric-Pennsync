-- The data-quality audit: which records are missing the fields that matter.
--
-- HAND WRITTEN, like every contract, and the second port made under D40 — an
-- `agency_admin` scoped to their own agency is the successor to the built-in
-- `role === 'admin'` this original refuses everyone else for.
--
-- **Its entire scoping block disappears.** The original fetches every active
-- patient, every user, every completed visit and every credential in the
-- deployment, and then rebuilds "which of these are mine" in JavaScript:
--
--   * it filters users by `u.agency_name === user.agency_name`,
--   * collects their addresses into `agencyEmails`,
--   * keeps a patient whose `created_by` is one of those addresses OR whose
--     `assigned_nurses` array contains one,
--   * keeps a visit whose `patient_id` survived that,
--   * and keeps a credential matched by `agency_name` or `employee_email`.
--
-- Every one of those is a representation this migration has already thrown
-- out: `agency_name` is the self-editable label D23 refuses, and
-- `assigned_nurses` is the stale-address care team D21 and D24 replaced. Here
-- all four tables are agency-tenanted by their own policies, so the rows a
-- caller can see ARE the agency's, and the block has nothing left to do.
--
-- The original's own comment says the filter was rewritten once already,
-- because keeping `super_admin` accounts "surfaced platform-staff profiles in
-- every agency's user_issues" and "any patient created by a super_admin
-- counted as in-agency for EVERY tenant and their name + gaps leaked
-- cross-agency." That is the shape of bug a derived scope produces and a
-- policy cannot.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. The gate is `agency_admin` (D40), and the `super_admin` branch closes
--    with the tier. Nothing here can read another agency's rows even if the
--    contract asked, because the policies answer first.
-- 2. The audited population of PEOPLE is the roster — the authority store's
--    membership joined to the carried profile — rather than every `User` row
--    whose `agency_name` string matches. `caller_roster` also supplies the
--    verified address, which the carried table has no column for.
-- 3. No `full_name`: the carried `User` table has no such column (D38), so a
--    person is identified by the address the roster verifies.
-- 4. The row caps are the original's `.slice(0, 50)` per section, applied in
--    SQL so the work is bounded in the database rather than after the fetch.
begin;

do $$
begin
  if to_regclass('pennsync_records.personnel_credential') is null
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

/*
 * The first `n` elements of a JSON array, which is the original's
 * `.slice(0, 50)`. PostgreSQL has no slice for `jsonb`, and doing it with
 * `LIMIT` inside the aggregate would bound the SCAN rather than the answer —
 * the summary counts above are over everything, so only the listing is capped.
 */
create function "pennsync_records".jsonb_head(p_value jsonb, p_limit integer)
  returns jsonb language sql immutable set search_path = '' as $head$
  select coalesce(jsonb_agg(element order by ordinality), '[]'::jsonb)
  from (
    select element, ordinality
    from jsonb_array_elements(coalesce(p_value, '[]'::jsonb))
      with ordinality as t(element, ordinality)
    order by ordinality
    limit p_limit) capped
$head$;

/*
 * The original's completeness rule for one section: how many of the fields it
 * calls critical are present, as a whole-number percentage.
 */
create function "pennsync_records".quality_score(p_missing integer, p_total integer)
  returns integer language sql immutable set search_path = '' as $score$
  select case when p_total = 0 then 100
    else pg_catalog.round(((p_total - p_missing)::numeric / p_total) * 100)::integer end
$score$;

/*
 * A percentage that survives an empty population.
 *
 * The original added this because a tenant with no patients, users or
 * completed visits emitted the string "NaN" into the dashboard.
 */
create function "pennsync_records".quality_pct(p_count bigint, p_total bigint)
  returns text language sql immutable set search_path = '' as $pct$
  select pg_catalog.to_char(
    case when p_total > 0 then (p_count::numeric / p_total) * 100 else 0 end, 'FM990.0')
$pct$;

/*
 * Whether a JSON value counts as missing.
 *
 * The original's own note: an empty object or array is TRUTHY in JavaScript,
 * so a bare `!v` counted `vital_signs: {}` as complete and inflated the score.
 */
create function "pennsync_records".quality_json_missing(p_value jsonb)
  returns boolean language sql immutable set search_path = '' as $missing$
  select p_value is null
    or jsonb_typeof(p_value) in ('null')
    or (jsonb_typeof(p_value) = 'object' and p_value = '{}'::jsonb)
    or (jsonb_typeof(p_value) = 'array' and jsonb_array_length(p_value) = 0)
$missing$;

create function "pennsync_records".contract_data_quality_audit(p_agency text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_patients jsonb; v_users jsonb; v_visits jsonb; v_credentials jsonb;
  v_patient_total bigint; v_user_total bigint; v_visit_total bigint;
  v_patient_bad bigint; v_user_bad bigint; v_visit_bad bigint; v_no_creds bigint;
  v_patient_crit bigint; v_user_crit bigint; v_visit_crit bigint;
begin
  -- D40's gate. The original refuses everyone but the built-in admin.
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_QUALITY_FORBIDDEN';
  end if;

  -- Patients. No agency predicate and no `created_by`/`assigned_nurses`
  -- reconstruction: the policy already scopes these to the agency, and D24
  -- opens every chart to an `agency_admin`.
  with scanned as (
    select p."id", p."first_name", p."last_name",
      array_remove(array[
        case when coalesce(p."emergency_contact_name", '') = '' then 'emergency_contact_name' end,
        case when coalesce(p."emergency_contact_phone", '') = '' then 'emergency_contact_phone' end,
        case when coalesce(p."physician_name", '') = '' then 'physician_name' end,
        case when coalesce(p."phone", '') = '' then 'phone' end,
        case when p."date_of_birth" is null then 'date_of_birth' end], null) as missing
    from "pennsync_records"."patient" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."agency_id" = p_agency and p."status" = 'active')
  select count(*), count(*) filter (where cardinality(missing) > 0),
    count(*) filter (where cardinality(missing) >= 3),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', "id",
      'name', pg_catalog.btrim(coalesce("first_name", '') || ' ' || coalesce("last_name", '')),
      'missing_fields', to_jsonb(missing),
      'completeness_score', "pennsync_records".quality_score(cardinality(missing), 5),
      'critical', cardinality(missing) >= 3)
      order by cardinality(missing) desc, "id") filter (where cardinality(missing) > 0), '[]'::jsonb)
    into v_patient_total, v_patient_bad, v_patient_crit, v_patients
  from scanned;

  -- People. The ROSTER, not every `User` row whose `agency_name` matches, and
  -- the address comes from the authority store rather than the carried row.
  with scanned as (
    select r.user_id, r.email,
      array_remove(array[
        case when coalesce(u."phone", '') = '' then 'phone' end,
        case when coalesce(u."care_scope", '') = '' then 'care_scope' end,
        case when coalesce(u."credential_type", '') = '' then 'credential_type' end], null) as missing,
      (select count(*) from "pennsync_records"."personnel_credential" c
        where c."source_app_id" = "pennsync_records".deployment_app()
          and c."agency_id" = p_agency
          and pg_catalog.lower(coalesce(c."user_id", '')) = pg_catalog.lower(r.email)) as credentials
    from "pennsync_records".caller_roster(p_agency) r
    left join "pennsync_records"."user" u
      on u."source_app_id" = "pennsync_records".deployment_app() and u."id" = r.user_id
    where r.is_active)
  select count(*), count(*) filter (where cardinality(missing) > 0),
    count(*) filter (where cardinality(missing) >= 2),
    count(*) filter (where credentials = 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'email', email, 'missing_fields', to_jsonb(missing),
      'completeness_score', "pennsync_records".quality_score(cardinality(missing), 3),
      'critical', cardinality(missing) >= 2)
      order by cardinality(missing) desc, email) filter (where cardinality(missing) > 0), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'email', email, 'has_credentials', false, 'credential_count', 0, 'needs_upload', true)
      order by email) filter (where credentials = 0), '[]'::jsonb)
    into v_user_total, v_user_bad, v_user_crit, v_no_creds, v_users, v_credentials
  from scanned;

  -- Completed visits. `nurse_notes` counts as missing below a hundred
  -- characters, which is the original's rule rather than emptiness.
  with scanned as (
    select v."id", v."visit_date", v."patient_id",
      array_remove(array[
        case when pg_catalog.length(coalesce(v."nurse_notes", '')) < 100 then 'nurse_notes' end,
        case when coalesce(v."homebound_justification", '') = '' then 'homebound_justification' end,
        case when "pennsync_records".quality_json_missing(v."vital_signs") then 'vital_signs' end],
        null) as missing
    from "pennsync_records"."visit" v
    where v."source_app_id" = "pennsync_records".deployment_app()
      and v."agency_id" = p_agency and v."status" = 'completed')
  select count(*), count(*) filter (where cardinality(missing) > 0),
    count(*) filter (where 'homebound_justification' = any(missing)),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', "id", 'visit_date', "visit_date", 'patient_id', "patient_id",
      'missing_fields', to_jsonb(missing),
      'completeness_score', "pennsync_records".quality_score(cardinality(missing), 3),
      'critical', 'homebound_justification' = any(missing))
      order by cardinality(missing) desc, "id") filter (where cardinality(missing) > 0), '[]'::jsonb)
    into v_visit_total, v_visit_bad, v_visit_crit, v_visits
  from scanned;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'total_patients', v_patient_total,
      'patients_with_issues', v_patient_bad,
      'patient_completeness', "pennsync_records".quality_pct(v_patient_total - v_patient_bad, v_patient_total),
      'total_users', v_user_total,
      'users_with_issues', v_user_bad,
      'user_completeness', "pennsync_records".quality_pct(v_user_total - v_user_bad, v_user_total),
      'total_visits', v_visit_total,
      'visits_with_issues', v_visit_bad,
      'visit_completeness', "pennsync_records".quality_pct(v_visit_total - v_visit_bad, v_visit_total),
      'users_without_credentials', v_no_creds,
      'credential_coverage', "pennsync_records".quality_pct(v_user_total - v_no_creds, v_user_total),
      'critical_patient_issues', v_patient_crit,
      'critical_user_issues', v_user_crit,
      'critical_visit_issues', v_visit_crit),
    -- The original's `.slice(0, 50)` per section.
    'patient_issues', "pennsync_records".jsonb_head(v_patients, 50),
    'user_issues', "pennsync_records".jsonb_head(v_users, 50),
    'visit_issues', "pennsync_records".jsonb_head(v_visits, 50),
    'credential_coverage', "pennsync_records".jsonb_head(v_credentials, 50),
    'audit_date', clock_timestamp());
end $contract$;

reset role;

revoke all on function
  "pennsync_records".jsonb_head(jsonb,integer),
  "pennsync_records".quality_score(integer,integer),
  "pennsync_records".quality_pct(bigint,bigint),
  "pennsync_records".quality_json_missing(jsonb),
  "pennsync_records".contract_data_quality_audit(text)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_data_quality_audit(text) to authenticated;

create function "public"."pennsync_contract_data_quality_audit"(p_agency text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_data_quality_audit(p_agency)
$contract$;

revoke all on function "public"."pennsync_contract_data_quality_audit"(text)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_data_quality_audit"(text)
  to authenticated;

commit;
