-- The chart export's read: one patient, their recent visits and their recent
-- incidents, in the exact columns that reach a model's prompt.
--
-- HAND WRITTEN, like every contract. Three things about the original are worth
-- knowing before reading this one.
--
-- **Its whole authorization is the three things D21, D22 and D24 removed.** It
-- admits a caller who is
--
--   - `normalizeProtectedEmail(patient.created_by) === callerEmail` — an
--     address on a carried row, which is the derived scope D41 and D43 delete;
--   - in `patient.assigned_nurses` — which `listAuthorizedPatients` says in
--     its OWN header is not authority, and which the D24 backfill refuses to
--     read for a reason that applies exactly here: the address stays on the
--     patient row after an assignment is suspended, so reading it resurrects
--     access somebody revoked;
--   - `isProtectedSuperAdmin(user)` — the `SUPER_ADMIN_EMAIL` platform tier.
--
-- So there is no gate here at all beyond the chart. `patient_read`,
-- `visit_read` and `incident_read` already narrow to the care team (D24), an
-- `office_staff` member opens no chart and is refused by the read, and an
-- `agency_admin` or `manager` opens every chart in their agency. That is
-- narrower than the original in the direction that matters — a revoked nurse
-- whose address is still on the row no longer qualifies — and wider in the
-- direction D24 already decided.
--
-- **Every column that reaches the prompt is NAMED**, which is D64's rule and
-- matters more here than anywhere: this projection is the widest in the
-- application. It carries the patient's home address, telephone, electronic
-- address, physician's contact details and emergency contact alongside the
-- clinical record, because the original's prompt does. `select *` would have
-- meant a column added to `patient` reaching a model because somebody
-- regenerated a migration.
--
-- **The counts are of what was READ; the prompt shows ten.** The original
-- fetches up to 100 visits and 100 incidents, prints `RECENT VISITS (n)` with
-- the full count, and then lists `slice(0, 10)`. Both halves are the
-- original's and both are kept: the count is a fact about the chart and the
-- list is a sample.
--
-- Note also what the original does NOT do, despite its name: it renders no
-- PDF. It asks a model for formatted text and answers with the text. That is
-- the same reading D64 made of `analyzeAndGenerateClinicalTasks`, whose name
-- says generate and which creates nothing.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.caller_tenant_role(text)') is null
    or to_regprocedure('pennsync_records.caller_opens_every_chart(text)') is null then
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

-- The twenty-two patient columns the prompt interpolates, named one by one.
-- Four of them are JSON objects the prompt reaches INTO — `baseline_vitals`,
-- `functional_status`, `social_history`, `advance_directives` — and they
-- travel whole because the service formats them; the fields it reads are
-- asserted in the parity test against the original's own template.
create function "pennsync_records".chart_export_patient(p "pennsync_records"."patient")
  returns jsonb language sql immutable set search_path = '' as $row$
  select jsonb_build_object(
    'id', p."id",
    'first_name', p."first_name",
    'middle_name', p."middle_name",
    'last_name', p."last_name",
    'date_of_birth', p."date_of_birth",
    'medical_record_number', p."medical_record_number",
    'address', p."address",
    'phone', p."phone",
    'email', p."email",
    'physician_name', p."physician_name",
    'physician_phone', p."physician_phone",
    'physician_email', p."physician_email",
    'emergency_contact_name', p."emergency_contact_name",
    'emergency_contact_phone', p."emergency_contact_phone",
    'emergency_contact_relationship', p."emergency_contact_relationship",
    'primary_diagnosis', p."primary_diagnosis",
    'secondary_diagnoses', p."secondary_diagnoses",
    'allergies', p."allergies",
    'past_medical_history', p."past_medical_history",
    'baseline_vitals', p."baseline_vitals",
    'functional_status', p."functional_status",
    'social_history', p."social_history",
    'advance_directives', p."advance_directives")
$row$;

create function "pennsync_records".contract_chart_export_context(
  p_agency text, p_patient_id text,
  p_include_visits boolean default true, p_include_incidents boolean default true)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_role text; v_patient "pennsync_records"."patient"; v_visits jsonb; v_incidents jsonb;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_CHART_EXPORT_AGENCY_NOT_HELD';
  end if;
  if p_patient_id is null or p_patient_id = '' or pg_catalog.length(p_patient_id) > 200 then
    raise exception using errcode='22023', message='PENNSYNC_CHART_EXPORT_SUBJECT_INVALID';
  end if;

  -- The policies decide the chart. A caller who does not open it sees no row,
  -- which is the same answer a patient who does not exist gets — so this says
  -- nothing about whether the id is real.
  select * into v_patient from "pennsync_records"."patient" t
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."id" = p_patient_id and t."agency_id" = p_agency;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_CHART_EXPORT_PATIENT_NOT_VISIBLE';
  end if;

  -- `includeVisits` and `includeIncidents` are the caller's, as they are in
  -- the original, and they are BOOLEANS there for a stated reason: they reach
  -- a privileged audit record, so an object or a string could put arbitrary
  -- data into it. The parameter types enforce that here rather than a guard.
  if coalesce(p_include_visits, true) then
    select coalesce(jsonb_agg(jsonb_build_object(
        'visit_date', v."visit_date", 'visit_type', v."visit_type")
      order by v."visit_date" desc nulls last, v."id" desc), '[]'::jsonb)
    into v_visits from (
      select t."visit_date", t."visit_type", t."id" from "pennsync_records"."visit" t
      where t."source_app_id" = "pennsync_records".deployment_app()
        and t."patient_id" = p_patient_id and t."agency_id" = p_agency
      order by t."visit_date" desc nulls last, t."id" desc
      limit 100) v;
  else
    v_visits := '[]'::jsonb;
  end if;

  if coalesce(p_include_incidents, true) then
    select coalesce(jsonb_agg(jsonb_build_object(
        'incident_date', i."incident_date", 'incident_type', i."incident_type",
        'severity', i."severity")
      order by i."incident_date" desc nulls last, i."id" desc), '[]'::jsonb)
    into v_incidents from (
      select t."incident_date", t."incident_type", t."severity", t."id"
      from "pennsync_records"."incident" t
      where t."source_app_id" = "pennsync_records".deployment_app()
        and t."patient_id" = p_patient_id
      order by t."incident_date" desc nulls last, t."id" desc
      limit 100) i;
  else
    v_incidents := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'patient', "pennsync_records".chart_export_patient(v_patient),
    'visits', v_visits,
    'incidents', v_incidents);
end $contract$;

reset role;

revoke all on function
  "pennsync_records".chart_export_patient("pennsync_records"."patient"),
  "pennsync_records".contract_chart_export_context(text,text,boolean,boolean)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_chart_export_context(text,text,boolean,boolean)
  to authenticated;

create function "public"."pennsync_contract_chart_export_context"(
  p_agency text, p_patient_id text,
  p_include_visits boolean default true, p_include_incidents boolean default true)
  returns jsonb language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_chart_export_context(
    p_agency, p_patient_id, p_include_visits, p_include_incidents)
$contract$;

revoke all on function
  "public"."pennsync_contract_chart_export_context"(text,text,boolean,boolean)
  from public, anon, service_role;
grant execute on function
  "public"."pennsync_contract_chart_export_context"(text,text,boolean,boolean)
  to authenticated;

commit;
