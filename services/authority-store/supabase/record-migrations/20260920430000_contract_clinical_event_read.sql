-- Reading a chart's clinical events for a model to analyse.
--
-- HAND WRITTEN, like every contract. Two of them, because two capabilities
-- want different rows out of the same chart: `analyzeClinicalEvents` reviews
-- the UNVERIFIED events for gaps and contradictions, and
-- `analyzeClinicalTrends` reads the verified history plus the visits' vital
-- signs and looks for movement. Neither writes anything, so there is no
-- second contract behind the model call — D53's shape with the third step
-- absent, which is itself worth stating: a capability that only reads needs
-- only a read.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. The chart decides. Both originals read `assigned_nurses` and
--    `created_by` off the patient row and then scan five thousand `User` rows
--    to decide whether the patient is in the caller's agency (D21, D24, D41).
-- 2. **The patient half of each prompt is the `smart_note_context`
--    projection** and nothing else (D62). Both originals interpolate the name,
--    the primary diagnosis and the medication names straight out of a full
--    service-role row; the purpose discloses all three, so nothing is lost
--    and nothing beyond them can be added by accident.
-- 3. Every column that reaches a prompt is NAMED. A `select *` here would put
--    `source_text` — the raw note the event was extracted from — in front of a
--    model that was asked about a structured summary.
--
-- NOT DIVERGED, and worth saying why. The originals' page limits stay exactly
-- as they are: five thousand unverified events for the review, and a hundred
-- events and a hundred visits for the trends. These are the SDK's page rather
-- than a rule, which is the artefact D49, D50 and D59 delete — but here the
-- page bounds what goes INTO A PROMPT, and raising or lowering it would change
-- the analysis rather than just the plumbing. The ordering is theirs too:
-- newest first, with a deterministic tiebreak the SDK never promised.
begin;

do $$
begin
  if to_regclass('pennsync_records.clinical_event') is null
    or to_regprocedure('pennsync_records.patient_exact_purpose_row('
      || 'text,pennsync_records.patient)') is null then
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
 * Divergences 1 and 2: the chart, then the purpose's own gate and projection.
 * Both capabilities need exactly this, so it is one helper rather than two
 * copies that can drift.
 */
create function "pennsync_records".clinical_chart_context(p_agency text, p_patient_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $chart$
declare v_patient "pennsync_records"."patient"; v_row jsonb; v_role text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_CLINICAL_AGENCY_NOT_HELD';
  end if;
  if p_patient_id is null or p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_CLINICAL_SUBJECT_INVALID';
  end if;
  if not "pennsync_records".patient_exact_purpose_admits('smart_note_context', v_role) then
    raise exception using errcode='42501', message='PENNSYNC_CLINICAL_PURPOSE_FORBIDDEN';
  end if;
  select p.* into v_patient from "pennsync_records"."patient" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."id" = p_patient_id and p."agency_id" = p_agency;
  if v_patient."id" is null then
    raise exception using errcode='42501', message='PENNSYNC_CLINICAL_PATIENT_NOT_VISIBLE';
  end if;
  v_row := "pennsync_records".patient_exact_purpose_row('smart_note_context', v_patient);
  return jsonb_build_object(
    'id', v_row -> 'id',
    'patient_name', pg_catalog.btrim(pg_catalog.concat_ws(' ',
      v_row ->> 'first_name', v_row ->> 'last_name')),
    'primary_diagnosis', v_row -> 'primary_diagnosis',
    'current_medications', v_row -> 'current_medications');
end $chart$;

create function "pennsync_records".contract_clinical_event_review(
  p_agency text, p_patient_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_patient jsonb; v_events jsonb;
begin
  v_patient := "pennsync_records".clinical_chart_context(p_agency, p_patient_id);
  -- Divergence 3, and the original's own projection: the eight fields it maps
  -- into `eventsContext`, and no `source_text`.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e."id", 'type', e."event_type", 'title', e."event_title",
      'description', e."event_description", 'structured_data', e."structured_data",
      'event_date', e."event_date", 'severity', e."severity",
      'extraction_confidence', e."extraction_confidence")
    order by e."event_date" desc nulls last, e."id"), '[]'::jsonb)
    into v_events
  from (select c.* from "pennsync_records"."clinical_event" c
    where c."source_app_id" = "pennsync_records".deployment_app()
      and c."patient_id" = p_patient_id
      -- The original's filter: `verified: false`, which a null is not.
      and c."verified" = false
    order by c."event_date" desc nulls last, c."id" limit 5000) e;
  return jsonb_build_object('success', true, 'patient', v_patient,
    'events', v_events, 'total_events', jsonb_array_length(v_events));
end $contract$;

create function "pennsync_records".contract_clinical_trend_context(
  p_agency text, p_patient_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_patient jsonb; v_vitals jsonb; v_events jsonb;
begin
  v_patient := "pennsync_records".clinical_chart_context(p_agency, p_patient_id);
  -- The original's `visits.filter(v => v.vital_signs).map(...)`, done here so
  -- a visit with no vitals never leaves the store.
  select coalesce(jsonb_agg(jsonb_build_object('date', v."visit_date", 'vitals', v."vital_signs")
    order by v."visit_date" desc nulls last, v."id"), '[]'::jsonb) into v_vitals
  from (select t.* from "pennsync_records"."visit" t
    where t."source_app_id" = "pennsync_records".deployment_app()
      and t."patient_id" = p_patient_id
    order by t."visit_date" desc nulls last, t."id" limit 100) v
  where v."vital_signs" is not null;
  -- The three groups the original builds with `event_type?.includes(...)`, as
  -- a substring test rather than an equality one, because that is what it is.
  select coalesce(jsonb_agg(jsonb_build_object(
      'date', e."event_date", 'title', e."event_title",
      'description', e."event_description", 'severity', e."severity",
      'group', case
        when pg_catalog.strpos(coalesce(e."event_type", ''), 'medication') > 0 then 'medication'
        when pg_catalog.strpos(coalesce(e."event_type", ''), 'symptom') > 0 then 'symptom'
        when pg_catalog.strpos(coalesce(e."event_type", ''), 'lab') > 0 then 'lab'
        else 'other' end)
    order by e."event_date" desc nulls last, e."id"), '[]'::jsonb) into v_events
  from (select c.* from "pennsync_records"."clinical_event" c
    where c."source_app_id" = "pennsync_records".deployment_app()
      and c."patient_id" = p_patient_id
    order by c."event_date" desc nulls last, c."id" limit 100) e;
  return jsonb_build_object('success', true, 'patient', v_patient,
    'vitals_history', v_vitals, 'events', v_events);
end $contract$;

reset role;

revoke all on function "pennsync_records".clinical_chart_context(text,text)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_clinical_event_review(text,text)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_clinical_trend_context(text,text)
  from public, anon, authenticated, service_role;
grant execute on function "pennsync_records".contract_clinical_event_review(text,text)
  to authenticated;
grant execute on function "pennsync_records".contract_clinical_trend_context(text,text)
  to authenticated;

create function "public"."pennsync_contract_clinical_event_review"(
  p_agency text, p_patient_id text) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_clinical_event_review(p_agency, p_patient_id)
$c$;
create function "public"."pennsync_contract_clinical_trend_context"(
  p_agency text, p_patient_id text) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_clinical_trend_context(p_agency, p_patient_id)
$c$;
revoke all on function "public"."pennsync_contract_clinical_event_review"(text,text)
  from public, anon, authenticated, service_role;
revoke all on function "public"."pennsync_contract_clinical_trend_context"(text,text)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_clinical_event_review"(text,text)
  to authenticated;
grant execute on function "public"."pennsync_contract_clinical_trend_context"(text,text)
  to authenticated;

commit;
