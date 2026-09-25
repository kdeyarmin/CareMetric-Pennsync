-- ------------------------------------------------------------------
-- Clinical library: the chart a write names, and the defaults a create
-- omits. A forward migration in D88's sense — `20260920570000_contract_
-- clinical_library.sql` is already in the ledger of every store that ran
-- it, and an edit there would reach a NEW build and nothing else.
--
-- TWO defects, both found after that migration merged.
--
-- 1. A CHART IS NOT IN THE AGENCY THAT NAMES IT. D24 asks whether the
--    caller opens every chart in an agency, or is assigned this one in
--    that agency. Neither half asks which agency the chart is actually
--    in, and `clinical_library_template`'s insert policy asks the first
--    question of the ROW's `agency_id`. So an administrator holding two
--    agencies could file a template in agency A naming agency B's
--    patient: the row lands in A, tenanted to A, referencing a chart
--    nobody in A can open, having passed every chart check. The row is
--    then readable by A and its `patient_id` is a fact about B.
--
--    `patient_education_assignment` already resolved the chart's own
--    agency, because that table carries no `agency_id` at all and the
--    missing term was visible. The table that HAS a tenancy column is
--    where it hid: the predicate looked complete. That generalises —
--    a chart id is a reference into another tenant's rows whether or
--    not the row holding it is tenanted, so the contract resolves the
--    chart in the agency the request names, always.
--
--    The check is one function now, `library_chart`, and the patient
--    education contract's own helper delegates to it rather than
--    keeping a second copy. NOT FOUND rather than FORBIDDEN, so an id
--    stays untestable across a tenant boundary.
--
-- 2. A CREATE THAT OMITS A DEFAULTED FIELD WROTE NULL. D30's generator
--    emits every column nullable with no DEFAULT — deliberately, so a
--    legacy row predating a requirement can migrate rather than be
--    refused at load — and 646 properties across the entity schemas
--    declare a default that therefore reaches no SQL. On the import
--    path that costs nothing, because a default fires only where a
--    column is OMITTED and an imported row carries its value. On a
--    CREATE it is the whole difference: Base44 wrote `is_active: true`
--    and this store wrote null, so the row exists and every screen
--    filtering on it cannot see it.
--
--    Each write contract names its own defaults, field for field from
--    its entity schema, and a root test re-derives the list from those
--    schemas rather than trusting this file. Nothing here is a fix to
--    the generator; that decision is the ladder thread's.
--
--    The ORDER is load-bearing and is why `template_type` is the case
--    to look at: it is in `ClinicalLibraryTemplate`'s `required` array
--    AND carries the default `generic`. Base44 accepts a create that
--    omits it. So the required check that shipped with the contract was
--    a NARROWING for that one field, and it stops being one only
--    because the defaults are applied BEFORE the check rather than
--    after it. A default and a requirement on the same field is not a
--    contradiction in the schema; reading them in the wrong order is.
-- ------------------------------------------------------------------

begin;

do $$
begin
  if to_regclass('pennsync_records.clinical_pathway') is null
    or to_regclass('pennsync_records.clinical_library_template') is null
    or to_regclass('pennsync_records.clinical_library_folder') is null
    or to_regclass('pennsync_records.education_material') is null
    or to_regclass('pennsync_records.patient_education_assignment') is null
    or to_regclass('pennsync_records.custom_validation_rule') is null
    or to_regclass('pennsync_records.ai_configuration') is null
    or to_regprocedure('pennsync_records.caller_email()') is null
    or to_regprocedure('pennsync_records.caller_tenant_role(text)') is null then
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

/*
 * The contracts this replaces must already exist: a `create or replace` of an
 * absent function would create one, which is how a migration applied out of
 * order leaves a contract with no chart check and no complaint.
 */
do $$
begin
  if to_regprocedure(
      'pennsync_records.contract_clinical_library_template_write(text,text,text,jsonb)') is null
    or to_regprocedure(
      'pennsync_records.contract_patient_education_write(text,text,text,jsonb)') is null
    or to_regprocedure('pennsync_records.patient_education_chart(text,text,text)') is null then
    raise exception using errcode='42501', message='PENNSYNC_CLINICAL_LIBRARY_REQUIRED';
  end if;
end $$;

set local role "pennsync_records_owner";

/**
 * The chart named by a write is in the agency the request names.
 *
 * Read under the caller's own policies: a chart they cannot open is
 * absent rather than refused, and a chart in another agency is the same
 * absence, so neither is testable for existence.
 */
create function "pennsync_records".library_chart(
  p_agency text, p_patient_id text, p_code text)
  returns void language plpgsql security definer set search_path = '' as $chart$
declare v_held boolean;
begin
  select true into v_held from "pennsync_records"."patient" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."id" = p_patient_id and p."agency_id" = p_agency;
  if not coalesce(v_held, false) then
    raise exception using errcode='42501', message=p_code || '_NOT_FOUND';
  end if;
end $chart$;

/** One definition of that check; this is now the patient-education name for it. */
create or replace function "pennsync_records".patient_education_chart(
  p_agency text, p_patient_id text, p_code text)
  returns void language plpgsql security definer set search_path = '' as $chart$
begin
  perform "pennsync_records".library_chart(p_agency, p_patient_id, p_code);
end $chart$;

/**
 * Each entity's own declared defaults, by the column names the generator
 * emits. Hand-written because there is nothing in SQL to generate from,
 * and cross-checked against the entity schemas by a test that
 * reads this function's answer rather than this comment.
 */
create function "pennsync_records".library_default_values(p_table text)
  returns jsonb language sql immutable set search_path = '' as $defaults$
  select case p_table
    when 'clinical_pathway' then (
      '{"is_active": true, "usage_count": 0}'
    )::jsonb
    when 'clinical_library_template' then (
      '{"template_type": "generic", "requires_patient_data": false, '
      '"is_active": true, "usage_count": 0, "is_agency_wide": false}'
    )::jsonb
    when 'clinical_library_folder' then (
      '{"color": "blue", "order": 0, "is_agency_wide": false}'
    )::jsonb
    when 'education_material' then (
      '{"reading_level": "middle_school", "language": "english", '
      '"is_template": true, "usage_count": 0, "is_published": true, "version": 1}'
    )::jsonb
    when 'patient_education_assignment' then (
      '{"status": "assigned", "priority": "medium"}'
    )::jsonb
    when 'custom_validation_rule' then (
      '{"severity": "error", "is_active": true}'
    )::jsonb
    when 'ai_configuration' then (
      '{"compliance_priority": "medicare", "suggestion_aggressiveness": "moderate", '
      '"is_active": true, "ai_verbosity": "balanced", '
      '"clinical_terminology": "standard", "enable_oasis_analysis": true, '
      '"enable_auto_summarization": true, "enable_compliance_checking": true, '
      '"enable_care_plan_suggestions": true, "enable_task_generation": true, '
      '"enable_proactive_suggestions": false, "auto_enhance_on_completion": false, '
      '"preferred_note_style": "narrative", "include_assessment_details": true, '
      '"include_teaching_points": true, "show_confidence_scores": false}'
    )::jsonb
    else null::jsonb end
$defaults$;

/**
 * Fill what a create omitted. A key the caller SUPPLIED is left alone,
 * including a json `null`: clearing a field is a thing a caller may
 * mean, and Base44's default fires on an absent key only.
 *
 * Returns the payload untouched for anything that is not an object, so
 * `library_write` still raises its own `_FIELDS_INVALID` rather than
 * this helper inventing a row out of a malformed request.
 */
create function "pennsync_records".library_defaults(
  p_action text, p_fields jsonb, p_table text)
  returns jsonb language plpgsql immutable set search_path = '' as $fill$
declare v_defaults jsonb;
begin
  if not coalesce(p_action = 'create', false) then return p_fields; end if;
  if p_fields is null or pg_catalog.jsonb_typeof(p_fields) <> 'object' then
    return p_fields;
  end if;
  v_defaults := "pennsync_records".library_default_values(p_table);
  if v_defaults is null then
    raise exception using errcode='22023', message='PENNSYNC_LIBRARY_DEFAULTS_UNDECLARED',
      detail=p_table;
  end if;
  return v_defaults || p_fields;
end $fill$;

create or replace function "pennsync_records".contract_clinical_pathway_write(
  p_agency text, p_action text, p_id text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
begin
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_PATHWAY_FORBIDDEN';
  end if;
  if not "pennsync_records".library_action(p_action) then
    raise exception using errcode='22023', message='PENNSYNC_PATHWAY_ACTION_INVALID';
  end if;
  if p_action <> 'create' and not "pennsync_records".library_row_id(p_id) then
    raise exception using errcode='22023', message='PENNSYNC_PATHWAY_ID_INVALID';
  end if;
  return "pennsync_records".library_write('clinical_pathway', 'agency_id', p_action,
    p_id, "pennsync_records".library_defaults(p_action, p_fields, 'clinical_pathway'),
    p_agency, 'PENNSYNC_PATHWAY', "pennsync_records".library_reserved(),
    array['pathway_name', 'condition']);
end $contract$;

create or replace function "pennsync_records".contract_clinical_library_template_write(
  p_agency text, p_action text, p_id text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_reserved text[] := "pennsync_records".library_reserved();
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_LIBRARY_TEMPLATE_AGENCY_NOT_HELD';
  end if;
  if not "pennsync_records".library_action(p_action) then
    raise exception using errcode='22023', message='PENNSYNC_LIBRARY_TEMPLATE_ACTION_INVALID';
  end if;
  if p_action = 'create' then
    -- The chart this template names, if it names one, is resolved in the
    -- agency the request names. The insert policy asks D24's question of
    -- the ROW's agency, which a two-agency caller satisfies with another
    -- agency's chart id.
    if pg_catalog.jsonb_typeof(p_fields) = 'object'
      and pg_catalog.jsonb_typeof(p_fields -> 'patient_id') = 'string' then
      perform "pennsync_records".library_chart(
        p_agency, p_fields->>'patient_id', 'PENNSYNC_LIBRARY_TEMPLATE');
    end if;
    return "pennsync_records".library_write('clinical_library_template', 'agency_id',
      p_action, p_id,
      "pennsync_records".library_defaults(p_action, p_fields, 'clinical_library_template'),
      p_agency, 'PENNSYNC_LIBRARY_TEMPLATE', v_reserved,
      array['phrase', 'category', 'template_type']);
  end if;
  if not "pennsync_records".library_row_id(p_id) then
    raise exception using errcode='22023', message='PENNSYNC_LIBRARY_TEMPLATE_ID_INVALID';
  end if;
  perform "pennsync_records".library_owned_row('clinical_library_template', p_agency, p_id,
    'PENNSYNC_LIBRARY_TEMPLATE');
  -- The chart a template names may be chosen when it is written and never
  -- moved afterwards: `patient_id` is the only column on this table that
  -- decides who may see the row.
  return "pennsync_records".library_write('clinical_library_template', 'agency_id',
    p_action, p_id, p_fields, p_agency, 'PENNSYNC_LIBRARY_TEMPLATE',
    v_reserved || array['patient_id'], array['phrase', 'category', 'template_type']);
end $contract$;

create or replace function "pennsync_records".contract_clinical_library_folder_write(
  p_agency text, p_action text, p_id text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_LIBRARY_FOLDER_AGENCY_NOT_HELD';
  end if;
  if not "pennsync_records".library_action(p_action) then
    raise exception using errcode='22023', message='PENNSYNC_LIBRARY_FOLDER_ACTION_INVALID';
  end if;
  if p_action <> 'create' then
    if not "pennsync_records".library_row_id(p_id) then
      raise exception using errcode='22023', message='PENNSYNC_LIBRARY_FOLDER_ID_INVALID';
    end if;
    perform "pennsync_records".library_owned_row('clinical_library_folder', p_agency, p_id,
      'PENNSYNC_LIBRARY_FOLDER');
  end if;
  return "pennsync_records".library_write('clinical_library_folder', 'agency_id', p_action,
    p_id, "pennsync_records".library_defaults(p_action, p_fields, 'clinical_library_folder'),
    p_agency, 'PENNSYNC_LIBRARY_FOLDER', "pennsync_records".library_reserved(),
    array['name']);
end $contract$;

create or replace function "pennsync_records".contract_education_material_write(
  p_agency text, p_action text, p_id text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
begin
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_EDUCATION_MATERIAL_FORBIDDEN';
  end if;
  if not "pennsync_records".library_action(p_action) then
    raise exception using errcode='22023',
      message='PENNSYNC_EDUCATION_MATERIAL_ACTION_INVALID';
  end if;
  if p_action <> 'create' and not "pennsync_records".library_row_id(p_id) then
    raise exception using errcode='22023', message='PENNSYNC_EDUCATION_MATERIAL_ID_INVALID';
  end if;
  return "pennsync_records".library_write('education_material', 'agency_id', p_action,
    p_id, "pennsync_records".library_defaults(p_action, p_fields, 'education_material'),
    p_agency, 'PENNSYNC_EDUCATION_MATERIAL', "pennsync_records".library_reserved(),
    array['title', 'category', 'content']);
end $contract$;

create or replace function "pennsync_records".contract_patient_education_write(
  p_agency text, p_action text, p_id text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_reserved text[] := "pennsync_records".library_reserved();
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_PATIENT_EDUCATION_AGENCY_NOT_HELD';
  end if;
  -- `coalesce`, for `library_action`'s reason: a null action is not a
  -- refusal in three-valued logic, and everything below it tests equality.
  if not coalesce(p_action in ('create', 'update'), false) then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_EDUCATION_ACTION_INVALID';
  end if;
  if p_action = 'create' then
    if p_fields is null or pg_catalog.jsonb_typeof(p_fields) <> 'object'
      or not "pennsync_records".library_row_id(p_fields->>'patient_id') then
      raise exception using errcode='22023', message='PENNSYNC_PATIENT_EDUCATION_SUBJECT_INVALID';
    end if;
    perform "pennsync_records".library_chart(
      p_agency, p_fields->>'patient_id', 'PENNSYNC_PATIENT_EDUCATION');
    return "pennsync_records".library_write('patient_education_assignment', null, p_action,
      p_id,
      "pennsync_records".library_defaults(p_action,
        "pennsync_records".library_own_assigned_by(p_fields, 'PENNSYNC_PATIENT_EDUCATION')
          || jsonb_build_object('assigned_by', "pennsync_records".caller_email()),
        'patient_education_assignment'),
      p_agency, 'PENNSYNC_PATIENT_EDUCATION', v_reserved,
      array['patient_id', 'assigned_by']);
  end if;
  if not "pennsync_records".library_row_id(p_id) then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_EDUCATION_ID_INVALID';
  end if;
  perform "pennsync_records".patient_education_row(
    p_agency, p_id, 'PENNSYNC_PATIENT_EDUCATION');
  return "pennsync_records".library_write('patient_education_assignment', null, p_action,
    p_id, p_fields, p_agency, 'PENNSYNC_PATIENT_EDUCATION',
    v_reserved || array['patient_id', 'assigned_by'],
    array['patient_id', 'assigned_by']);
end $contract$;

create or replace function "pennsync_records".contract_validation_rule_write(
  p_agency text, p_action text, p_id text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
begin
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_VALIDATION_RULE_FORBIDDEN';
  end if;
  if not "pennsync_records".library_action(p_action) then
    raise exception using errcode='22023', message='PENNSYNC_VALIDATION_RULE_ACTION_INVALID';
  end if;
  if p_action <> 'create' and not "pennsync_records".library_row_id(p_id) then
    raise exception using errcode='22023', message='PENNSYNC_VALIDATION_RULE_ID_INVALID';
  end if;
  return "pennsync_records".library_write('custom_validation_rule', 'agency_id', p_action,
    p_id, "pennsync_records".library_defaults(p_action, p_fields, 'custom_validation_rule'),
    p_agency, 'PENNSYNC_VALIDATION_RULE', "pennsync_records".library_reserved(),
    array['rule_name', 'entity_type', 'field_name', 'validation_type']);
end $contract$;

create or replace function "pennsync_records".contract_ai_configuration_save(
  p_agency text, p_scope text, p_id text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_reserved text[] := "pennsync_records".library_reserved() || array['user_email'];
  v_email text; v_claim text; v_owner text; v_found boolean;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_AI_CONFIG_AGENCY_NOT_HELD';
  end if;
  if p_scope is null or p_scope not in ('mine', 'agency') then
    raise exception using errcode='22023', message='PENNSYNC_AI_CONFIG_SCOPE_INVALID';
  end if;
  if p_scope = 'agency'
    and "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_AI_CONFIG_FORBIDDEN';
  end if;
  v_email := "pennsync_records".caller_email();
  -- `user_email` is the ownership column, so the contract decides it and a
  -- payload naming somebody else is refused. Naming YOURSELF is accepted and
  -- dropped, which is what `UserSettings` sends on every save.
  if p_fields is not null and pg_catalog.jsonb_typeof(p_fields) = 'object'
    and (p_fields ? 'user_email') then
    v_claim := pg_catalog.lower(pg_catalog.btrim(coalesce(p_fields->>'user_email', '')));
    if p_scope = 'agency' or v_claim = ''
      or v_claim is distinct from pg_catalog.lower(coalesce(v_email, '')) then
      raise exception using errcode='42501', message='PENNSYNC_AI_CONFIG_OWNER_FORBIDDEN';
    end if;
    p_fields := p_fields - 'user_email';
  end if;

  if p_id is null then
    return "pennsync_records".library_write('ai_configuration', 'agency_id', 'create',
      null,
      "pennsync_records".library_defaults('create',
        case when p_scope = 'mine'
          then coalesce(p_fields, '{}'::jsonb) || jsonb_build_object('user_email', v_email)
          else p_fields end,
        'ai_configuration'),
      p_agency, 'PENNSYNC_AI_CONFIG',
      -- The create stamps `user_email` through the merged payload, so it is
      -- not reserved against itself on this one path.
      case when p_scope = 'mine' then "pennsync_records".library_reserved() else v_reserved end,
      -- An agency-wide row is DEFINED by `user_email` being null, which is
      -- what the admin manager has always created, so the schema's own
      -- requirement holds on the personal scope only. See `library_required`.
      case when p_scope = 'mine' then array['user_email'] else array[]::text[] end);
  end if;
  if not "pennsync_records".library_row_id(p_id) then
    raise exception using errcode='22023', message='PENNSYNC_AI_CONFIG_ID_INVALID';
  end if;
  select c."user_email" is not null, c."user_email" into v_found, v_owner
  from "pennsync_records"."ai_configuration" c
  where c."source_app_id" = "pennsync_records".deployment_app()
    and c."id" = p_id and c."agency_id" = p_agency;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_AI_CONFIG_NOT_FOUND';
  end if;
  -- Scope and row must agree: a personal save may not land on an agency
  -- setting, and an agency save may not land on somebody's preferences.
  if p_scope = 'mine' then
    if pg_catalog.lower(coalesce(v_owner, ''))
      is distinct from pg_catalog.lower(coalesce(v_email, '')) then
      raise exception using errcode='42501', message='PENNSYNC_AI_CONFIG_OWNER_FORBIDDEN';
    end if;
  elsif v_owner is not null then
    raise exception using errcode='42501', message='PENNSYNC_AI_CONFIG_OWNER_FORBIDDEN';
  end if;
  return "pennsync_records".library_write('ai_configuration', 'agency_id', 'update',
    p_id, p_fields, p_agency, 'PENNSYNC_AI_CONFIG', v_reserved, array[]::text[]);
end $contract$;

reset role;

revoke all on function
  "pennsync_records".library_chart(text,text,text),
  "pennsync_records".library_default_values(text),
  "pennsync_records".library_defaults(text,jsonb,text)
  from public, anon, authenticated, service_role;

commit;
