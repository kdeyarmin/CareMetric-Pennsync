-- Expanding a clinical phrase from the agency's template library.
--
-- HAND WRITTEN, like every contract. Two of them: a resolve that decides WHICH
-- template answers a phrase and what of the patient may go into the prompt,
-- and a use that records the count. The model call sits between them, so this
-- is D53's order with a read contract in front, the shape D58 established.
--
-- **This capability is why D61 exists.** `clinical_library_template`'s only
-- tenant path was its OPTIONAL `patient_id`, so every generic and every
-- agency-wide template — which is nearly all of them — was in no tenant and
-- readable by nobody. D61 gave the table its own `agency_id`, and D24 still
-- narrows a patient-bound template to the chart it names. Those two policies
-- are now the whole of the template scoping, which is what lets this contract
-- delete both of the original's reconstructions of it.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. **Both `User.list('-created_date', 5000)` scans are gone.** The original
--    runs one to decide whether a patient is in the caller's agency and
--    another to decide whether an agency-wide template was authored there,
--    each rebuilding "which of these are mine" from `agency_name` strings. The
--    policies answer both — the fifth original in this migration whose scope
--    reconstruction the tenancy replaces (D41, D42, D43, D44).
-- 2. The chart decides who may read a patient-bound template and who may have
--    a patient's fields in a prompt, replacing `assigned_nurses`,
--    `created_by` and `account_type` (D21, D24).
-- 3. **`patient_data_fields` selects from what `smart_note_context` already
--    discloses, and nothing else.** The original interpolates whatever columns
--    a template row names into the prompt, so a template could put a field in
--    front of a caller that no read purpose would give them. The purpose's own
--    projection is the ceiling here, its own role gate is the gate, and a
--    field outside it is REFUSED BY NAME in the answer rather than silently
--    dropped — a template that quietly stopped including a field would read as
--    a model that ignored it.
-- 4. `platform_wide` is gone. The original lets a `super_admin` or a bare
--    `role: 'admin'` use any agency's agency-wide template; D14 and D22
--    removed that tier and no agency's library is another's.
-- 5. The phrase is normalised with `bounded_reason`, which is the trim
--    JavaScript performs — the Unicode space separators included — rather than
--    the ASCII one `btrim` performs.
--
-- NOT DIVERGED. A patient-bound template wins over a generic one; an
-- agency-wide template loses to one the caller authored only by coming second
-- in the same scan; `usage_count` is incremented on a template that answers
-- and not on a generic AI expansion; and an inactive template answers nothing.
begin;

do $$
begin
  if to_regclass('pennsync_records.clinical_library_template') is null
    or to_regprocedure('pennsync_records.bounded_reason(text)') is null
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

/* The purpose whose projection is the ceiling on what a template may ask for. */
create function "pennsync_records".clinical_phrase_purpose()
  returns text language sql immutable set search_path = '' as $p$ select 'smart_note_context' $p$;

create function "pennsync_records".contract_clinical_phrase_resolve(
  p_agency text, p_phrase text, p_patient_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_role text; v_phrase text; v_template record; v_patient "pennsync_records"."patient";
  v_row jsonb; v_context text := ''; v_allowed jsonb; v_field text;
  v_refused text[] := '{}'; v_used text[] := '{}'; v_name text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_PHRASE_AGENCY_NOT_HELD';
  end if;
  -- Divergence 5: the trim JavaScript performs, and the original's `toLowerCase`.
  v_phrase := pg_catalog.lower("pennsync_records".bounded_reason(p_phrase));
  if v_phrase is null or v_phrase = '' then
    raise exception using errcode='22023', message='PENNSYNC_PHRASE_REQUIRED';
  end if;
  if p_patient_id is not null and p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_PHRASE_SUBJECT_INVALID';
  end if;

  -- Divergences 1, 2 and 4: the policies decide which templates exist for this
  -- caller. A patient-bound one wins, and the caller can only see it if they
  -- open that chart.
  select t."id", t."template_type", t."expanded_text", t."ai_prompt_instructions",
    t."patient_data_fields", t."patient_id", t."is_agency_wide", t."usage_count",
    t."phrase", t."category"
    into v_template
  from "pennsync_records"."clinical_library_template" t
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."agency_id" = p_agency and t."phrase" = v_phrase
    and coalesce(t."is_active", false)
    and (t."patient_id" is null
      or (p_patient_id is not null and t."patient_id" = p_patient_id))
  order by
    -- A patient-bound template first, then one the caller authored, then an
    -- agency-wide one: the original's `patientBound || templates.find(...)`.
    (t."patient_id" is null),
    (t."created_by" is distinct from "pennsync_records".caller_email()),
    t."id"
  limit 1;

  if v_template."id" is null then
    return jsonb_build_object('success', true, 'template', null,
      'patient', null, 'context', null, 'refused_fields', '[]'::jsonb);
  end if;

  if v_template."template_type" = 'patient_specific' then
    if p_patient_id is null then
      raise exception using errcode='22023', message='PENNSYNC_PHRASE_SUBJECT_REQUIRED';
    end if;
    -- Divergence 3: the purpose's own role gate, and then its own projection.
    if not "pennsync_records".patient_exact_purpose_admits(
      "pennsync_records".clinical_phrase_purpose(), v_role) then
      raise exception using errcode='42501', message='PENNSYNC_PHRASE_PURPOSE_FORBIDDEN';
    end if;
    select p.* into v_patient from "pennsync_records"."patient" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."id" = p_patient_id and p."agency_id" = p_agency;
    if v_patient."id" is null then
      raise exception using errcode='42501', message='PENNSYNC_PHRASE_PATIENT_NOT_VISIBLE';
    end if;
    v_allowed := "pennsync_records".patient_exact_purpose_row(
      "pennsync_records".clinical_phrase_purpose(), v_patient);
    v_name := pg_catalog.btrim(pg_catalog.concat_ws(' ',
      v_patient."first_name", v_patient."last_name"));
    if jsonb_typeof(v_template."patient_data_fields") = 'array' then
      for v_field in
        select value #>> '{}' from jsonb_array_elements(v_template."patient_data_fields")
        where jsonb_typeof(value) = 'string'
      loop
        if not (v_allowed ? v_field) then
          -- Divergence 3: named in the answer, never quietly dropped.
          if not (v_field = any(v_refused)) then v_refused := v_refused || v_field; end if;
        elsif (v_allowed -> v_field) is not null
          and jsonb_typeof(v_allowed -> v_field) <> 'null' then
          -- The original's `${field}: ${JSON.stringify(value)}\n`.
          v_context := v_context || v_field || ': ' || (v_allowed -> v_field)::text
            || pg_catalog.chr(10);
          v_used := v_used || v_field;
        end if;
      end loop;
    end if;
  end if;

  return jsonb_build_object('success', true,
    'template', jsonb_build_object(
      'id', v_template."id", 'phrase', v_template."phrase",
      'category', v_template."category",
      'template_type', v_template."template_type",
      'expanded_text', v_template."expanded_text",
      'ai_prompt_instructions', v_template."ai_prompt_instructions",
      'patient_data_fields', coalesce(v_template."patient_data_fields", '[]'::jsonb),
      'patient_id', v_template."patient_id",
      'is_agency_wide', coalesce(v_template."is_agency_wide", false),
      'usage_count', coalesce(v_template."usage_count", 0)),
    'patient', case when v_patient."id" is null then null
      else jsonb_build_object('id', v_patient."id", 'name', v_name) end,
    'context', case when v_context = '' then null else v_context end,
    'context_fields', to_jsonb(v_used),
    'refused_fields', to_jsonb(v_refused));
end $contract$;

create function "pennsync_records".contract_clinical_phrase_used(
  p_agency text, p_template_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_count double precision;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_PHRASE_AGENCY_NOT_HELD';
  end if;
  if p_template_id is null or p_template_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_PHRASE_SUBJECT_INVALID';
  end if;
  -- The original's `usage_count: (template.usage_count || 0) + 1`, computed in
  -- the statement rather than from a snapshot the caller carried back.
  update "pennsync_records"."clinical_library_template" t
    set "usage_count" = coalesce(t."usage_count", 0) + 1, "updated_date" = clock_timestamp()
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."id" = p_template_id and t."agency_id" = p_agency
  returning t."usage_count" into v_count;
  if v_count is null then
    raise exception using errcode='42501', message='PENNSYNC_PHRASE_TEMPLATE_NOT_FOUND';
  end if;
  return jsonb_build_object('success', true, 'template_id', p_template_id,
    'usage_count', v_count);
end $contract$;

reset role;

revoke all on function "pennsync_records".clinical_phrase_purpose()
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_clinical_phrase_resolve(text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_clinical_phrase_used(text,text)
  from public, anon, authenticated, service_role;
grant execute on function "pennsync_records".contract_clinical_phrase_resolve(text,text,text)
  to authenticated;
grant execute on function "pennsync_records".contract_clinical_phrase_used(text,text)
  to authenticated;

create function "public"."pennsync_contract_clinical_phrase_resolve"(
  p_agency text, p_phrase text, p_patient_id text) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_clinical_phrase_resolve(p_agency, p_phrase, p_patient_id)
$c$;
create function "public"."pennsync_contract_clinical_phrase_used"(
  p_agency text, p_template_id text) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_clinical_phrase_used(p_agency, p_template_id)
$c$;
revoke all on function "public"."pennsync_contract_clinical_phrase_resolve"(text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function "public"."pennsync_contract_clinical_phrase_used"(text,text)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_clinical_phrase_resolve"(text,text,text)
  to authenticated;
grant execute on function "public"."pennsync_contract_clinical_phrase_used"(text,text)
  to authenticated;

commit;
