-- Writes for three reference tables whose READS already ship.
--
-- `20260920570000_contract_reference_reads.sql` gave `on_call_shift`,
-- `library_document` and `document_template` a list each, and nothing else. So
-- three screens can look and not act: the on-call rota renders a month and
-- cannot assign it, the template inventory lists templates and cannot edit one,
-- and the clinical library lists documents and cannot retire one. This is the
-- other half.
--
-- **The gate is D40's, for all three, and it is the whole decision here.** Every
-- one of the three entity schemas gates `create`, `update` and `delete` on
-- `{"user_condition": {"role": "admin"}}` — the built-in platform tier D14 and
-- D22 removed — and D40's standing successor is an `agency_admin` scoped to
-- their own agency. Nothing else about these capabilities is a judgement.
--
-- **Read that gate off the SCHEMA and not off the screen.** Two of the three
-- screens re-state it in the browser (`isAdminLike` in `OnCallSchedule.jsx` and
-- `TemplateManagement.jsx`), and `TemplateLibrary.jsx` — which creates, updates
-- and deletes `library_document` — has NO client-side gate at all. Its writes
-- are refused by Base44's RLS and by nothing else. A port that took its gate
-- from the screen would have found none and shipped these writes open to every
-- member of the agency, which is a widening nobody decided. The absence is
-- invisible in a diff of the screen; it is only visible in the entity schema.
--
-- **`LibraryDocument.create` is NOT ported, and this is the fifth partial port's
-- shape** (after D31, D35, D36, D59, D73 and D81). Its own schema makes
-- `file_url` REQUIRED, that column holds a Base44 storage locator on a carried
-- row, and the read beside it projects the column THROUGH
-- `pennsync_private.resolve_file_locator` (D77) — which answers null until the
-- file copy has run. So a create contract here could only write a row whose
-- read answers null: a document that uploads successfully and cannot be opened.
-- `file_url` is therefore refused BY NAME rather than dropped (D39), which makes
-- the create refuse loudly instead of succeeding into that state.
--
-- Measured rather than reasoned about: the call site's FIRST statement is
-- `base44.integrations.Core.UploadFile`, and on the independent path
-- `integrations` is a refusing namespace — driving it through the adapter
-- answers `STAGING_OPERATION_UNAVAILABLE` before the entity write is reached.
-- So that site cannot complete today whatever this file does. When the copy has
-- run and the browser can upload, the create belongs here and the refusal goes.
--
-- **`document_template.is_system_template` is RESERVED.** The table's policies
-- refuse an insert, update or delete where it is true, and its read admits a
-- system template to EVERY agency — so it is the one column on these three
-- tables where tenancy is not ownership (D36, D45). A caller who could set it
-- would publish their own row to every other agency, and one who could clear it
-- would take a shared template private. Neither is a write an agency admin has
-- ever been able to make, so it is reserved rather than gated.
--
-- The three saves take `p_id` null for a create and an id for an update, which
-- is `contract_pdf_template_save`'s shape and the reason these are one file: the
-- three screens' create-or-update mutations are one mutation each.

begin;

do $$
begin
  if to_regprocedure('pennsync_records.caller_tenant_role(text)') is null
    or to_regprocedure('pennsync_records.operational_check_fields(jsonb,text[],text[],text)') is null then
    raise exception using errcode='42501',message='PENNSYNC_REFERENCE_WRITES_REQUIRE_RECORD_STORE';
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

create function "pennsync_records".reference_write_role(p_agency text) returns void
  language plpgsql stable set search_path = '' as $role$
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_REFERENCE_AGENCY_NOT_HELD';
  end if;
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_REFERENCE_FORBIDDEN';
  end if;
end $role$;

-- ---------------------------------------------------------------------------
-- OnCallShift
-- ---------------------------------------------------------------------------

create function "pennsync_records".on_call_writable() returns text[]
  language sql immutable set search_path = '' as $writable$
  select array['shift_date', 'coverage_type', 'holiday_name', 'start_label',
    'end_label', 'assigned_user_email', 'assigned_user_name', 'notes']
$writable$;

create function "pennsync_records".on_call_reserved() returns text[]
  language sql immutable set search_path = '' as $reserved$
  select array['id', 'agency_id', 'created_by', 'created_date', 'updated_date']
$reserved$;

-- Named columns, matching `contract_on_call_shift_list`'s projection exactly so
-- a screen that reads a row and writes it back sees one shape (D64).
create function "pennsync_records".on_call_projected(p_row "pennsync_records"."on_call_shift")
  returns jsonb language sql immutable set search_path = '' as $projected$
  select jsonb_build_object(
    'id', p_row."id",
    'created_date', p_row."created_date",
    'updated_date', p_row."updated_date",
    'created_by', p_row."created_by",
    'shift_date', p_row."shift_date",
    'coverage_type', p_row."coverage_type",
    'holiday_name', p_row."holiday_name",
    'start_label', p_row."start_label",
    'end_label', p_row."end_label",
    'assigned_user_email', p_row."assigned_user_email",
    'assigned_user_name', p_row."assigned_user_name",
    'notes', p_row."notes",
    'agency_id', p_row."agency_id")
$projected$;

create function "pennsync_records".contract_on_call_shift_save(
    p_agency text, p_id text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_existing "pennsync_records"."on_call_shift"; v_row "pennsync_records"."on_call_shift";
  v_assignments text; v_written integer; v_now timestamptz;
begin
  perform "pennsync_records".reference_write_role(p_agency);
  perform "pennsync_records".operational_check_fields(p_fields,
    "pennsync_records".on_call_writable(), "pennsync_records".on_call_reserved(),
    'PENNSYNC_ON_CALL');
  perform "pennsync_records".operational_check_required(p_fields,
    array['shift_date', 'coverage_type'], array['DATE', 'COVERAGE'],
    'PENNSYNC_ON_CALL', p_id is null);
  v_now := clock_timestamp();

  if p_id is null then
    -- `jsonb_populate_record` is where a value of the wrong type is caught: the
    -- name check above answers about KEYS only, and a string where the date
    -- belongs would otherwise reach the insert as an error the HTTP boundary
    -- cannot classify.
    begin
      v_row := jsonb_populate_record(v_row, p_fields);
    exception when others then
      raise exception using errcode='22023', message='PENNSYNC_ON_CALL_FIELD_INVALID';
    end;
    v_row."source_app_id" := "pennsync_records".deployment_app();
    v_row."id" := "pennsync_records".operational_new_id();
    v_row."agency_id" := p_agency;
    v_row."created_by" := "pennsync_records".caller_email();
    v_row."created_date" := v_now;
    v_row."updated_date" := v_now;
    begin
      insert into "pennsync_records"."on_call_shift" select (v_row).* returning * into v_row;
    exception when check_violation then
      raise exception using errcode='22023', message='PENNSYNC_ON_CALL_FIELD_INVALID';
    end;
    return jsonb_build_object('created', true,
      'shift', "pennsync_records".on_call_projected(v_row));
  end if;

  if p_id = '' then
    raise exception using errcode='22023', message='PENNSYNC_ON_CALL_ID_INVALID';
  end if;
  -- The agency is named here as well as in the role check, because
  -- `caller_agencies()` returns every agency the caller holds (D51).
  select * into v_existing from "pennsync_records"."on_call_shift" s
  where s."source_app_id" = "pennsync_records".deployment_app()
    and s."id" = p_id and s."agency_id" = p_agency
  for update;
  if not found then
    raise exception using errcode='22023', message='PENNSYNC_ON_CALL_NOT_FOUND';
  end if;
  begin
    v_row := jsonb_populate_record(v_existing, p_fields);
  exception when others then
    raise exception using errcode='22023', message='PENNSYNC_ON_CALL_FIELD_INVALID';
  end;
  v_row."updated_date" := v_now;
  -- The set list is built from the keys the CALLER supplied, never from a list
  -- of this contract's own: a hand-kept list would let a field added to
  -- `on_call_writable` validate and then silently not be written.
  v_assignments := (select pg_catalog.string_agg(
    pg_catalog.format('%I = ($1).%I', k, k), ', ' order by k)
    from jsonb_object_keys(p_fields) k);
  begin
    execute pg_catalog.format(
      'update "pennsync_records"."on_call_shift" as s set %s,'
      || ' "updated_date" = ($1)."updated_date"'
      || ' where s."source_app_id" = $2 and s."id" = $3 and s."agency_id" = $4',
      v_assignments)
      using v_row, "pennsync_records".deployment_app(), p_id, p_agency;
    get diagnostics v_written = row_count;
  exception when check_violation then
    raise exception using errcode='22023', message='PENNSYNC_ON_CALL_FIELD_INVALID';
  end;
  if v_written <> 1 then
    raise exception using errcode='22023', message='PENNSYNC_ON_CALL_NOT_FOUND';
  end if;
  select * into v_row from "pennsync_records"."on_call_shift" s
  where s."source_app_id" = "pennsync_records".deployment_app() and s."id" = p_id;
  return jsonb_build_object('created', false,
    'shift', "pennsync_records".on_call_projected(v_row));
end $contract$;

create function "pennsync_records".contract_on_call_shift_delete(p_agency text, p_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_deleted integer;
begin
  perform "pennsync_records".reference_write_role(p_agency);
  if p_id is null or p_id = '' then
    raise exception using errcode='22023', message='PENNSYNC_ON_CALL_ID_INVALID';
  end if;
  delete from "pennsync_records"."on_call_shift" s
  where s."source_app_id" = "pennsync_records".deployment_app()
    and s."id" = p_id and s."agency_id" = p_agency;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception using errcode='22023', message='PENNSYNC_ON_CALL_NOT_FOUND';
  end if;
  return jsonb_build_object('deleted', true, 'id', p_id);
end $contract$;

-- ---------------------------------------------------------------------------
-- LibraryDocument — update and delete only
-- ---------------------------------------------------------------------------

-- `file_url` is absent from the writable set DELIBERATELY, and its absence is
-- the whole of the partial port. `operational_check_fields` refuses an unknown
-- key by name, so a caller sending it gets `PENNSYNC_LIBRARY_FIELD_UNKNOWN`
-- rather than a row nobody can open. The header says why and
-- `contract-reference-writes.test.mjs` asserts the refusal, so the day the file
-- copy runs, the test is what has to change with it.
create function "pennsync_records".lib_doc_writable() returns text[]
  language sql immutable set search_path = '' as $writable$
  select array['title', 'description', 'category', 'file_type', 'is_active', 'tags']
$writable$;

create function "pennsync_records".lib_doc_reserved() returns text[]
  language sql immutable set search_path = '' as $reserved$
  select array['id', 'agency_id', 'created_by', 'created_date', 'updated_date']
$reserved$;

-- `file_url` goes out RESOLVED and never raw, exactly as the list beside it
-- does (D77): an owned `cmfile:` handle passes through and a legacy Base44 URL
-- becomes null, because handing a caller a locator into the storage we are
-- leaving would have the browser fetch Base44.
create function "pennsync_records".lib_doc_projected(p_row "pennsync_records"."library_document")
  returns jsonb language sql stable set search_path = '' as $projected$
  select jsonb_build_object(
    'id', p_row."id",
    'created_date', p_row."created_date",
    'updated_date', p_row."updated_date",
    'created_by', p_row."created_by",
    'title', p_row."title",
    'description', p_row."description",
    'category', p_row."category",
    'file_url', "pennsync_private".resolve_file_locator(p_row."file_url"),
    'file_type', p_row."file_type",
    'is_active', p_row."is_active",
    'tags', p_row."tags",
    'agency_id', p_row."agency_id")
$projected$;

-- No create. The entity requires `file_url`, which this contract refuses, so a
-- create could never be satisfied — emitting one that always refuses would read
-- as a capability rather than as the file layer's absence.
create function "pennsync_records".contract_library_document_update(
    p_agency text, p_id text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_existing "pennsync_records"."library_document"; v_row "pennsync_records"."library_document";
  v_assignments text; v_written integer;
begin
  perform "pennsync_records".reference_write_role(p_agency);
  perform "pennsync_records".operational_check_fields(p_fields,
    "pennsync_records".lib_doc_writable(), "pennsync_records".lib_doc_reserved(),
    'PENNSYNC_LIBRARY');
  if p_id is null or p_id = '' then
    raise exception using errcode='22023', message='PENNSYNC_LIBRARY_ID_INVALID';
  end if;
  select * into v_existing from "pennsync_records"."library_document" d
  where d."source_app_id" = "pennsync_records".deployment_app()
    and d."id" = p_id and d."agency_id" = p_agency
  for update;
  if not found then
    raise exception using errcode='22023', message='PENNSYNC_LIBRARY_NOT_FOUND';
  end if;
  begin
    v_row := jsonb_populate_record(v_existing, p_fields);
  exception when others then
    raise exception using errcode='22023', message='PENNSYNC_LIBRARY_FIELD_INVALID';
  end;
  v_row."updated_date" := clock_timestamp();
  v_assignments := (select pg_catalog.string_agg(
    pg_catalog.format('%I = ($1).%I', k, k), ', ' order by k)
    from jsonb_object_keys(p_fields) k);
  begin
    execute pg_catalog.format(
      'update "pennsync_records"."library_document" as d set %s,'
      || ' "updated_date" = ($1)."updated_date"'
      || ' where d."source_app_id" = $2 and d."id" = $3 and d."agency_id" = $4',
      v_assignments)
      using v_row, "pennsync_records".deployment_app(), p_id, p_agency;
    get diagnostics v_written = row_count;
  exception when check_violation then
    raise exception using errcode='22023', message='PENNSYNC_LIBRARY_FIELD_INVALID';
  end;
  if v_written <> 1 then
    raise exception using errcode='22023', message='PENNSYNC_LIBRARY_NOT_FOUND';
  end if;
  select * into v_row from "pennsync_records"."library_document" d
  where d."source_app_id" = "pennsync_records".deployment_app() and d."id" = p_id;
  return jsonb_build_object('updated', true,
    'document', "pennsync_records".lib_doc_projected(v_row));
end $contract$;

create function "pennsync_records".contract_library_document_delete(p_agency text, p_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_deleted integer;
begin
  perform "pennsync_records".reference_write_role(p_agency);
  if p_id is null or p_id = '' then
    raise exception using errcode='22023', message='PENNSYNC_LIBRARY_ID_INVALID';
  end if;
  -- The delete is HARD, as the original's is: `library_document` has an
  -- `is_active` column, but the screen's delete removes the row and its toggle
  -- is a separate control, so retiring the row instead would be a change.
  delete from "pennsync_records"."library_document" d
  where d."source_app_id" = "pennsync_records".deployment_app()
    and d."id" = p_id and d."agency_id" = p_agency;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception using errcode='22023', message='PENNSYNC_LIBRARY_NOT_FOUND';
  end if;
  return jsonb_build_object('deleted', true, 'id', p_id);
end $contract$;

-- ---------------------------------------------------------------------------
-- DocumentTemplate
-- ---------------------------------------------------------------------------

-- `is_system_template` is reserved and not merely ungated: the table's insert,
-- update and delete policies all refuse a row where it is true, and its READ
-- admits such a row to every agency. Setting it publishes your template to the
-- whole deployment; clearing it takes a shared one private. Neither is a write
-- this capability ever had.
create function "pennsync_records".doc_template_writable() returns text[]
  language sql immutable set search_path = '' as $writable$
  select array['template_name', 'name', 'description', 'category', 'visit_type',
    'content', 'placeholders', 'required_elements', 'tags',
    'linked_education_ids', 'related_diagnoses', 'is_public', 'usage_count',
    'ai_generated', 'generation_prompt', 'auto_suggest_materials']
$writable$;

create function "pennsync_records".doc_template_reserved() returns text[]
  language sql immutable set search_path = '' as $reserved$
  select array['id', 'agency_id', 'created_by', 'created_date', 'updated_date',
    'is_system_template']
$reserved$;

-- The record store is GENERATED and emits no column default, so a create
-- through a contract writes null where the entity schema wrote `false`, `0` or
-- `true`. These are the four defaults `DocumentTemplate.jsonc` declares over
-- this contract's own writable set, and the suite reads that file rather than
-- trusting this object (D12).
create function "pennsync_records".doc_template_defaults() returns jsonb
  language sql immutable set search_path = '' as $defaults$
  select jsonb_build_object(
    'is_public', false, 'usage_count', 0,
    'ai_generated', false, 'auto_suggest_materials', true)
$defaults$;

create function "pennsync_records".doc_template_projected(
    p_row "pennsync_records"."document_template")
  returns jsonb language sql immutable set search_path = '' as $projected$
  select jsonb_build_object(
    'id', p_row."id",
    'created_date', p_row."created_date",
    'updated_date', p_row."updated_date",
    'created_by', p_row."created_by",
    'template_name', p_row."template_name",
    'name', p_row."name",
    'description', p_row."description",
    'category', p_row."category",
    'visit_type', p_row."visit_type",
    'content', p_row."content",
    'placeholders', p_row."placeholders",
    'required_elements', p_row."required_elements",
    'tags', p_row."tags",
    'linked_education_ids', p_row."linked_education_ids",
    'related_diagnoses', p_row."related_diagnoses",
    'is_system_template', p_row."is_system_template",
    'is_public', p_row."is_public",
    'usage_count', p_row."usage_count",
    'ai_generated', p_row."ai_generated",
    'generation_prompt', p_row."generation_prompt",
    'auto_suggest_materials', p_row."auto_suggest_materials",
    'agency_id', p_row."agency_id")
$projected$;

create function "pennsync_records".contract_document_template_save(
    p_agency text, p_id text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_existing "pennsync_records"."document_template"; v_row "pennsync_records"."document_template";
  v_assignments text; v_written integer; v_now timestamptz;
begin
  perform "pennsync_records".reference_write_role(p_agency);
  perform "pennsync_records".operational_check_fields(p_fields,
    "pennsync_records".doc_template_writable(),
    "pennsync_records".doc_template_reserved(), 'PENNSYNC_DOC_TEMPLATE');
  perform "pennsync_records".operational_check_required(p_fields,
    array['template_name', 'category', 'content'],
    array['NAME', 'CATEGORY', 'CONTENT'], 'PENNSYNC_DOC_TEMPLATE', p_id is null);
  v_now := clock_timestamp();

  if p_id is null then
    begin
      -- Schema defaults first, the caller's payload over them: an absent key
      -- takes the default, a key the caller sent keeps what they sent.
      v_row := jsonb_populate_record(v_row,
        "pennsync_records".doc_template_defaults() || p_fields);
    exception when others then
      raise exception using errcode='22023', message='PENNSYNC_DOC_TEMPLATE_FIELD_INVALID';
    end;
    v_row."source_app_id" := "pennsync_records".deployment_app();
    v_row."id" := "pennsync_records".operational_new_id();
    v_row."agency_id" := p_agency;
    v_row."created_by" := "pennsync_records".caller_email();
    v_row."created_date" := v_now;
    v_row."updated_date" := v_now;
    -- Never inherited from a payload and never null: the insert policy refuses
    -- a true, and a null would read as one the policy admits by accident.
    v_row."is_system_template" := false;
    begin
      insert into "pennsync_records"."document_template" select (v_row).* returning * into v_row;
    exception when check_violation then
      raise exception using errcode='22023', message='PENNSYNC_DOC_TEMPLATE_FIELD_INVALID';
    end;
    return jsonb_build_object('created', true,
      'template', "pennsync_records".doc_template_projected(v_row));
  end if;

  if p_id = '' then
    raise exception using errcode='22023', message='PENNSYNC_DOC_TEMPLATE_ID_INVALID';
  end if;
  -- `is_system_template is not true` is the policies' own predicate, restated
  -- in the lookup so a caller editing a system template gets this contract's
  -- NOT_FOUND rather than a zero-row update they cannot interpret. A system
  -- template is readable by every agency, so it WOULD be found without it.
  select * into v_existing from "pennsync_records"."document_template" t
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."id" = p_id and t."agency_id" = p_agency
    and t."is_system_template" is not true
  for update;
  if not found then
    raise exception using errcode='22023', message='PENNSYNC_DOC_TEMPLATE_NOT_FOUND';
  end if;
  begin
    v_row := jsonb_populate_record(v_existing, p_fields);
  exception when others then
    raise exception using errcode='22023', message='PENNSYNC_DOC_TEMPLATE_FIELD_INVALID';
  end;
  v_row."updated_date" := v_now;
  v_assignments := (select pg_catalog.string_agg(
    pg_catalog.format('%I = ($1).%I', k, k), ', ' order by k)
    from jsonb_object_keys(p_fields) k);
  begin
    execute pg_catalog.format(
      'update "pennsync_records"."document_template" as t set %s,'
      || ' "updated_date" = ($1)."updated_date"'
      || ' where t."source_app_id" = $2 and t."id" = $3 and t."agency_id" = $4'
      || ' and t."is_system_template" is not true',
      v_assignments)
      using v_row, "pennsync_records".deployment_app(), p_id, p_agency;
    get diagnostics v_written = row_count;
  exception when check_violation then
    raise exception using errcode='22023', message='PENNSYNC_DOC_TEMPLATE_FIELD_INVALID';
  end;
  if v_written <> 1 then
    raise exception using errcode='22023', message='PENNSYNC_DOC_TEMPLATE_NOT_FOUND';
  end if;
  select * into v_row from "pennsync_records"."document_template" t
  where t."source_app_id" = "pennsync_records".deployment_app() and t."id" = p_id;
  return jsonb_build_object('created', false,
    'template', "pennsync_records".doc_template_projected(v_row));
end $contract$;

create function "pennsync_records".contract_document_template_delete(p_agency text, p_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_deleted integer;
begin
  perform "pennsync_records".reference_write_role(p_agency);
  if p_id is null or p_id = '' then
    raise exception using errcode='22023', message='PENNSYNC_DOC_TEMPLATE_ID_INVALID';
  end if;
  delete from "pennsync_records"."document_template" t
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."id" = p_id and t."agency_id" = p_agency
    and t."is_system_template" is not true;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception using errcode='22023', message='PENNSYNC_DOC_TEMPLATE_NOT_FOUND';
  end if;
  return jsonb_build_object('deleted', true, 'id', p_id);
end $contract$;

reset role;

-- The helpers are the record owner's alone: `reference_write_role` is the
-- authority question without the write that gives it a purpose, and the field
-- lists, defaults and projections are this file's internals rather than
-- capabilities.
revoke all on function
  "pennsync_records".reference_write_role(text),
  "pennsync_records".on_call_writable(),
  "pennsync_records".on_call_reserved(),
  "pennsync_records".on_call_projected("pennsync_records"."on_call_shift"),
  "pennsync_records".lib_doc_writable(),
  "pennsync_records".lib_doc_reserved(),
  "pennsync_records".lib_doc_projected("pennsync_records"."library_document"),
  "pennsync_records".doc_template_writable(),
  "pennsync_records".doc_template_reserved(),
  "pennsync_records".doc_template_defaults(),
  "pennsync_records".doc_template_projected("pennsync_records"."document_template"),
  "pennsync_records".contract_on_call_shift_save(text,text,jsonb),
  "pennsync_records".contract_on_call_shift_delete(text,text),
  "pennsync_records".contract_library_document_update(text,text,jsonb),
  "pennsync_records".contract_library_document_delete(text,text),
  "pennsync_records".contract_document_template_save(text,text,jsonb),
  "pennsync_records".contract_document_template_delete(text,text)
  from public, anon, authenticated, service_role;

grant execute on function
  "pennsync_records".contract_on_call_shift_save(text,text,jsonb),
  "pennsync_records".contract_on_call_shift_delete(text,text),
  "pennsync_records".contract_library_document_update(text,text,jsonb),
  "pennsync_records".contract_library_document_delete(text,text),
  "pennsync_records".contract_document_template_save(text,text,jsonb),
  "pennsync_records".contract_document_template_delete(text,text)
  to authenticated;

create function "public"."pennsync_contract_on_call_shift_save"(p_agency text, p_id text, p_fields jsonb)
  returns jsonb language sql security invoker set search_path = '' as $w$
  select "pennsync_records".contract_on_call_shift_save(p_agency, p_id, p_fields) $w$;
create function "public"."pennsync_contract_on_call_shift_delete"(p_agency text, p_id text)
  returns jsonb language sql security invoker set search_path = '' as $w$
  select "pennsync_records".contract_on_call_shift_delete(p_agency, p_id) $w$;
create function "public"."pennsync_contract_library_document_update"(p_agency text, p_id text, p_fields jsonb)
  returns jsonb language sql security invoker set search_path = '' as $w$
  select "pennsync_records".contract_library_document_update(p_agency, p_id, p_fields) $w$;
create function "public"."pennsync_contract_library_document_delete"(p_agency text, p_id text)
  returns jsonb language sql security invoker set search_path = '' as $w$
  select "pennsync_records".contract_library_document_delete(p_agency, p_id) $w$;
create function "public"."pennsync_contract_document_template_save"(p_agency text, p_id text, p_fields jsonb)
  returns jsonb language sql security invoker set search_path = '' as $w$
  select "pennsync_records".contract_document_template_save(p_agency, p_id, p_fields) $w$;
create function "public"."pennsync_contract_document_template_delete"(p_agency text, p_id text)
  returns jsonb language sql security invoker set search_path = '' as $w$
  select "pennsync_records".contract_document_template_delete(p_agency, p_id) $w$;

-- A wrapper is `security invoker`, so it is the grant on IT that decides who
-- may reach the contract at all -- and PostgreSQL grants EXECUTE to PUBLIC on
-- every new function. Revoking on the inner functions above reads like the
-- whole job and is not: an anonymous caller never reaches a locked inner
-- function to be refused, it reaches the wrapper. This exact omission shipped
-- on `20260920690000` and was caught by `service-rpc-signatures.test.mjs`
-- asking `has_function_privilege('anon', ...)` of every name the service calls.
revoke all on function
  "public"."pennsync_contract_on_call_shift_save"(text,text,jsonb),
  "public"."pennsync_contract_on_call_shift_delete"(text,text),
  "public"."pennsync_contract_library_document_update"(text,text,jsonb),
  "public"."pennsync_contract_library_document_delete"(text,text),
  "public"."pennsync_contract_document_template_save"(text,text,jsonb),
  "public"."pennsync_contract_document_template_delete"(text,text)
  from public, anon, service_role;

grant execute on function
  "public"."pennsync_contract_on_call_shift_save"(text,text,jsonb),
  "public"."pennsync_contract_on_call_shift_delete"(text,text),
  "public"."pennsync_contract_library_document_update"(text,text,jsonb),
  "public"."pennsync_contract_library_document_delete"(text,text),
  "public"."pennsync_contract_document_template_save"(text,text,jsonb),
  "public"."pennsync_contract_document_template_delete"(text,text)
  to authenticated;

commit;
