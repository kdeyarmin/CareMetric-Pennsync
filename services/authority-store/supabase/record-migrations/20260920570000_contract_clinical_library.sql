-- The clinical library, patient education and per-agency configuration.
--
-- HAND WRITTEN, like every contract. Fourteen capabilities over seven
-- entities the frontend reaches DIRECTLY — `ClinicalPathway`,
-- `ClinicalLibraryTemplate`, `ClinicalLibraryFolder`, `EducationMaterial`,
-- `PatientEducationAssignment`, `CustomValidationRule` and `AIConfiguration`.
-- There is no Base44 backend function behind any of them, so this is the
-- first batch with no original module to port and no parity to pin.
--
-- **What stands in for an original is each entity's own `rls` block**, which
-- is the only authorization Base44 ever expressed for these rows, and it is
-- quoted per contract below. Three shapes appear in it and each gets a
-- different answer here:
--
-- * `{read,create,update,delete: false}` — `ClinicalPathway` and
--   `PatientEducationAssignment`. In Base44 that means no client may touch the
--   rows at all, so there is no client rule to reproduce and no `role ===
--   'admin'` gate for D40 to succeed. The gate each one gets is stated in its
--   own header as a DECISION, taken narrow.
-- * A branch of `{ user_condition: { role: 'admin' } }` — every other entity.
--   That is the platform tier D14 and D22 removed, and D40 is the standing
--   answer: the successor is an `agency_admin` scoped to their own agency.
-- * A per-row ownership branch — `created_by` on the two library entities,
--   `data.user_email` on `AIConfiguration`. Those are KEPT. D36 and D45 both
--   say why: the policies put a row in the caller's agency, which is not the
--   same as it being theirs, and every one of these tables' policies is
--   agency-WIDE. A port that trusted them would let anybody in the agency
--   edit anybody else's phrases and read anybody else's preferences.
--
-- Three rules the batch follows throughout, and one finding it records.
--
-- **The writable set is the table's own columns less the reserved ones**, read
-- out of the catalog rather than kept as a list here. These are entity CRUD
-- capabilities: Base44 let a client write the whole row, so the only narrowing
-- a port may make is to the columns that decide identity and tenancy —
-- `source_app_id`, `id`, `agency_id`, `created_date`, `updated_date` and
-- `created_by`. A hand-kept allowlist would be a second copy of the table and
-- would drift in the one direction nothing measures (D82's lesson about the
-- profile allowlist, arriving from the other side). An unknown key is REFUSED
-- rather than filtered, which is D39's rule: a silent filter is what keeps a
-- misspelled field from ever being noticed.
--
-- **A tenancy-bearing column may be named on create and never on update.**
-- `clinical_library_template.patient_id` and
-- `patient_education_assignment.patient_id` are how a caller picks the chart a
-- row belongs to, and the policies check the value they write, so naming one
-- on create is the capability. Moving a row to a different chart afterwards is
-- not an edit anybody meant, and it is the one edit that changes who may see
-- the row, so it is reserved on update.
--
-- **`created_by` is accepted only as self-assertion.** Four of the call sites
-- send `created_by: currentUser.email` in the payload. The contract stamps it
-- from `caller_email()` regardless, and a payload naming a DIFFERENT address
-- is refused by name rather than ignored — the shape D2's broker family uses
-- for tenancy, relaxed exactly as far as "you may say you are yourself".
--
-- **A create supplies what the entity's schema declares REQUIRED.** The
-- generated store makes every entity column nullable — that is D30's
-- generator and not this contract's to change — so without a check here a
-- create with no `pathway_name` inserts cleanly and the row is one the Base44
-- schema would not have accepted. `library_required` takes the list per call
-- site rather than reading a table, because the one divergence has to be
-- visible where it happens: `AIConfiguration` requires `user_email`, and an
-- agency-wide row is DEFINED by that column being null, which is what
-- `AIConfigurationManager.jsx` has always created. So the requirement holds on
-- the personal scope and not the agency one, and that row diverges from its
-- own schema — recorded rather than fixed, because closing it is a product
-- decision about what an agency-wide setting is keyed on.
--
-- The finding: `src/pages/UserSettings.jsx` says in a comment that
-- `AIConfiguration` "is RLS-scoped to the current user's own records
-- (created_by)" and that it "has no user_email field". Both are wrong — the
-- schema's `rls.read` is `data.user_email == {{user.email}}` and `user_email`
-- is a column — and the screen then writes `user_email` anyway, so it works.
-- Recorded rather than relied on: the ownership predicate below is the
-- schema's, not the comment's.
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

set local role "pennsync_records_owner";

/*
 * The mechanics, shared by all fourteen and holding NO authorization at all.
 *
 * These take a table name, which is the shape the broker family takes and the
 * shape D16 keeps away from these entities — so the difference is worth
 * stating rather than leaving to be noticed. A broker is a public entry point
 * that decides for itself which table a CALLER named. These are private: they
 * are granted to `pennsync_records_owner` alone, have no `public` wrapper, and
 * the table name reaching them is a literal written into one of the fourteen
 * named contracts below. Every decision about who may ask is in those, and a
 * test drives each one to prove it reaches only its own table.
 */

/** The columns a caller may name, read from the catalog rather than listed. */
create function "pennsync_records".library_fields(
  p_table text, p_payload jsonb, p_reserved text[], p_code text)
  returns text[] language plpgsql stable set search_path = '' as $fields$
declare v_keys text[]; v_key text;
begin
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode='22023', message=p_code || '_FIELDS_INVALID';
  end if;
  v_keys := (select pg_catalog.array_agg(k order by k) from pg_catalog.jsonb_object_keys(p_payload) k);
  if v_keys is null then
    raise exception using errcode='22023', message=p_code || '_FIELDS_EMPTY';
  end if;
  foreach v_key in array v_keys loop
    if v_key = any (p_reserved) then
      raise exception using errcode='22023', message=p_code || '_FIELD_RESERVED';
    end if;
    if not exists (select 1 from information_schema.columns c
      where c.table_schema = 'pennsync_records' and c.table_name = p_table
        and c.column_name = v_key) then
      raise exception using errcode='22023', message=p_code || '_FIELD_UNKNOWN';
    end if;
  end loop;
  return v_keys;
end $fields$;

/*
 * `created_by`, taken out of the payload once it has been proved to be the
 * caller's own address. A payload that names somebody else is refused; one
 * that names the caller is dropped, because the contract stamps it anyway.
 */
create function "pennsync_records".library_own_created_by(p_payload jsonb, p_code text)
  returns jsonb language plpgsql stable set search_path = '' as $own$
declare v_claim text;
begin
  if p_payload is null or not (p_payload ? 'created_by') then return p_payload; end if;
  v_claim := pg_catalog.lower(pg_catalog.btrim(coalesce(p_payload->>'created_by', '')));
  if v_claim = '' or v_claim is distinct from pg_catalog.lower("pennsync_records".caller_email()) then
    raise exception using errcode='42501', message=p_code || '_CREATED_BY_FORBIDDEN';
  end if;
  return p_payload - 'created_by';
end $own$;

/** One page of a catalog, and whether the page is the whole of it. */
/*
 * `assigned_by`, accepted only as self-assertion, exactly as `created_by` is.
 *
 * The contract stamps the caller's address regardless; this refuses a payload
 * naming somebody ELSE rather than silently overwriting it, so a screen that
 * believed it was assigning on a colleague's behalf hears about it.
 */
create function "pennsync_records".library_own_assigned_by(p_payload jsonb, p_code text)
  returns jsonb language plpgsql stable set search_path = '' as $own$
declare v_claim text;
begin
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
    or not (p_payload ? 'assigned_by') then
    return coalesce(p_payload, '{}'::jsonb);
  end if;
  v_claim := pg_catalog.lower(pg_catalog.btrim(coalesce(p_payload->>'assigned_by', '')));
  if v_claim = ''
    or v_claim is distinct from pg_catalog.lower(coalesce("pennsync_records".caller_email(), '')) then
    raise exception using errcode='42501', message=p_code || '_ASSIGNED_BY_FORBIDDEN';
  end if;
  return p_payload - 'assigned_by';
end $own$;

create function "pennsync_records".library_page_size(p_limit integer) returns integer
  language sql immutable set search_path = '' as $page$
  select least(greatest(coalesce(p_limit, 1000), 1), 1000)
$page$;

/*
 * A page and whether it is the whole set.
 *
 * Each read below selects one row more than the page size, and this cuts the
 * extra one back off. `complete` is what makes a ceiling honest: a screen
 * asking for five thousand rows of a catalog that holds forty is not being
 * short-changed, and a screen that really has more than a page has to be told
 * rather than handed a truncated list that looks whole.
 */
create function "pennsync_records".library_answer(p_rows jsonb, p_limit integer)
  returns jsonb language sql immutable set search_path = '' as $answer$
  select jsonb_build_object(
    'entries', case when pg_catalog.jsonb_array_length(p_rows) > v.size
      then (select coalesce(pg_catalog.jsonb_agg(e order by o), '[]'::jsonb)
        from pg_catalog.jsonb_array_elements(p_rows) with ordinality as x(e, o)
        where o <= v.size)
      else p_rows end,
    'complete', pg_catalog.jsonb_array_length(p_rows) <= v.size)
  from (select "pennsync_records".library_page_size(p_limit) as size) v
$answer$;

/*
 * The write.
 *
 * `p_table` is a literal from one of the fourteen named contracts, never a
 * caller's string, and this function holds no authorization: the caller has
 * already been gated, and the table's policies decide the row. `p_tenant`
 * names the agency column, or is null for the one table whose tenancy is the
 * chart it points at (`patient_education_assignment` has no `agency_id` — the
 * `patient` row it names carries it).
 *
 * The insert writes EVERY column of the table from the merged payload, so a
 * field the caller did not name is null rather than whatever a previous row
 * held. The update's set list is built from the keys the caller supplied
 * rather than from a column list kept here, for D82's reason: a list would be
 * a second copy of the table, and a column added to the store would validate
 * and then silently not be written.
 */
/*
 * The fields each entity's own schema declares REQUIRED, checked on a create.
 *
 * The generated store makes every entity column nullable — that is D30's
 * generator, not this contract's to change — so a create with no
 * `pathway_name` inserts cleanly and the row is one the Base44 schema would
 * not have accepted. The list is passed in per capability rather than read
 * from a table here, because two of the seven diverge and the divergence has
 * to be visible at the call site:
 *
 *   - `ai_configuration` requires `user_email`, which is the OWNERSHIP column
 *     the contract decides. On the personal scope it is stamped and the check
 *     holds; on the agency scope an agency-wide row is DEFINED by that column
 *     being null, which is what `AIConfigurationManager.jsx` has always
 *     created, so nothing is required there and the row diverges from its own
 *     schema. Recorded rather than fixed: closing it is a product decision
 *     about what an agency-wide setting is keyed on.
 *   - Everything the CONTRACT supplies — `id`, `created_by`, the tenancy
 *     column — is checked against the MERGED payload, so a required field the
 *     contract stamps counts as supplied.
 *
 * A json null counts as absent, because `{"condition": null}` is the same
 * empty column as omitting it.
 */
create function "pennsync_records".library_required(
  p_payload jsonb, p_required text[], p_code text)
  returns void language plpgsql immutable set search_path = '' as $required$
declare v_key text;
begin
  foreach v_key in array coalesce(p_required, array[]::text[]) loop
    if not (p_payload ? v_key)
      or pg_catalog.jsonb_typeof(p_payload -> v_key) = 'null' then
      raise exception using errcode='22023',
        message=p_code || '_FIELD_REQUIRED', detail=v_key;
    end if;
  end loop;
end $required$;

create function "pennsync_records".library_write(
  p_table text, p_tenant text, p_action text, p_id text, p_fields jsonb,
  p_agency text, p_code text, p_reserved text[], p_required text[])
  returns jsonb language plpgsql security definer set search_path = '' as $write$
declare
  v_fields jsonb; v_merged jsonb; v_now timestamptz := clock_timestamp();
  v_id text; v_email text; v_assignments text; v_written integer; v_answer jsonb;
begin
  -- A row the POLICIES refuse comes back as `new row violates row-level
  -- security policy`, which the HTTP boundary cannot classify — D33's rule
  -- about the raw duplicate-key error, in the other direction. The two
  -- tables that reach tenancy through a chart are where this fires: writing
  -- against a patient the caller does not open is a refusal, and it is
  -- reported as one.
  begin
  if p_action = 'delete' then
    execute pg_catalog.format(
      'delete from "pennsync_records".%I t where t."source_app_id" = $1 and t."id" = $2'
      || ' and (%s) returning pg_catalog.to_jsonb(t) - ''source_app_id''', p_table,
      case when p_tenant is null then '$3 is not null'
        else pg_catalog.format('t.%I = $3', p_tenant) end)
      into v_answer using "pennsync_records".deployment_app(), p_id, p_agency;
    if v_answer is null then
      raise exception using errcode='42501', message=p_code || '_NOT_FOUND';
    end if;
    return jsonb_build_object('deleted', true, 'row', v_answer);
  end if;

  if p_fields is null or pg_catalog.jsonb_typeof(p_fields) <> 'object' then
    raise exception using errcode='22023', message=p_code || '_FIELDS_INVALID';
  end if;
  v_fields := "pennsync_records".library_own_created_by(p_fields, p_code);
  -- The self-assertion above may have emptied the payload, and an update that
  -- names nothing is not a request. On a create it is: a row of defaults.
  if p_action = 'update' and v_fields = '{}'::jsonb then
    raise exception using errcode='22023', message=p_code || '_FIELDS_EMPTY';
  end if;
  perform "pennsync_records".library_fields(p_table, v_fields, p_reserved, p_code);
  v_email := "pennsync_records".caller_email();

  if p_action = 'create' then
    v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
    v_merged := v_fields || jsonb_build_object(
      'source_app_id', "pennsync_records".deployment_app(), 'id', v_id,
      'created_by', v_email, 'created_date', v_now, 'updated_date', v_now);
    if p_tenant is not null then
      v_merged := v_merged || jsonb_build_object(p_tenant, p_agency);
    end if;
    -- After the merge, so a required field the contract stamps counts.
    perform "pennsync_records".library_required(v_merged, p_required, p_code);
    execute pg_catalog.format(
      'insert into "pennsync_records".%I as t select * from'
      || ' pg_catalog.jsonb_populate_record(null::"pennsync_records".%I, $1)'
      || ' returning pg_catalog.to_jsonb(t) - ''source_app_id''',
      p_table, p_table)
      into v_answer using v_merged;
    return jsonb_build_object('created', true, 'row', v_answer);
  end if;

  v_merged := v_fields || jsonb_build_object('updated_date', v_now);
  -- The values come from a FROM-clause `jsonb_populate_record` rather than
  -- from a plpgsql variable, because a `record` variable passed as a parameter
  -- loses its type and `($1).phrase` then raises `could not identify column`.
  -- `contract_patient_update` can declare a typed row variable; a body over a
  -- table name cannot.
  v_assignments := (select pg_catalog.string_agg(
    pg_catalog.format('%I = v.%I', k, k), ', ' order by k)
    from pg_catalog.jsonb_object_keys(v_merged) k);
  execute pg_catalog.format(
    'update "pennsync_records".%I as t set %s'
    || ' from pg_catalog.jsonb_populate_record(null::"pennsync_records".%I, $1) as v'
    || ' where t."source_app_id" = $2 and t."id" = $3'
    || ' and (%s) returning pg_catalog.to_jsonb(t) - ''source_app_id''',
    p_table, v_assignments, p_table,
    case when p_tenant is null then '$4 is not null'
      else pg_catalog.format('t.%I = $4', p_tenant) end)
    into v_answer using v_merged, "pennsync_records".deployment_app(), p_id, p_agency;
  -- `execute` does not set `found`; only `get diagnostics` sees its row count.
  get diagnostics v_written = row_count;
  if v_written <> 1 then
    raise exception using errcode='42501', message=p_code || '_NOT_FOUND';
  end if;
  return jsonb_build_object('updated', true, 'row', v_answer);
  exception
    when insufficient_privilege then
      if pg_catalog.substr(coalesce(sqlerrm, ''), 1, 8) = 'PENNSYNC' then raise; end if;
      raise exception using errcode='42501', message=p_code || '_FORBIDDEN';
    -- A value the column's own CHECK refuses is an ordinary bad request. Left
    -- raw it reaches the HTTP boundary as an undeclared message, which
    -- `contractCapability` reports as a 503 CONTRACT_REFUSED — a caller's
    -- typo read as a record-store outage. The column is carried in the detail
    -- so the answer says which field, and the value never is.
    when check_violation or invalid_text_representation or datetime_field_overflow then
      raise exception using errcode='22023', message=p_code || '_FIELD_VALUE_INVALID',
        detail=coalesce(pg_catalog.substr(coalesce(sqlerrm, ''), 1, 200), '');
  end;
end $write$;

/** Every write contract refuses these, and a tenancy column joins them on update. */
create function "pennsync_records".library_reserved() returns text[]
  language sql immutable set search_path = '' as $reserved$
  select array['source_app_id', 'id', 'agency_id', 'created_date', 'updated_date', 'created_by']
$reserved$;

/** The row id a caller may name. The same shape every contract here accepts. */
create function "pennsync_records".library_row_id(p_id text) returns boolean
  language sql immutable set search_path = '' as $rid$
  select p_id is not null and p_id ~ '^[A-Za-z0-9_-]{1,200}$'
$rid$;

/*
 * create, update or delete, and nothing else.
 *
 * `coalesce(..., false)` is load-bearing rather than tidy. The HTTP boundary
 * permits an omitted key, so `p_action` arrives null; `null in (...)` is NULL,
 * `not NULL` is NULL, and `if NULL then raise` does not fire. The guard read
 * as a refusal and was not one: every later branch tested `p_action = 'create'`
 * and `= 'delete'`, both NULL, so a request naming only an id and some fields
 * fell through to the UPDATE and silently mutated the row. A three-valued
 * guard that answers NULL is not a guard.
 */
create function "pennsync_records".library_action(p_action text) returns boolean
  language sql immutable set search_path = '' as $act$
  select coalesce(p_action in ('create', 'update', 'delete'), false)
$act$;

/* ------------------------------------------------------------------ *
 * ClinicalPathway.
 *
 * Its `rls` block is `{read, create, update, delete: false}`, so Base44 gave
 * a client nothing and there is no rule to reproduce — which means the gate
 * here is a DECISION rather than a port, and it is taken narrow in both
 * directions for reasons that differ.
 *
 * The READ is open to any member of the agency. A pathway is the agency's
 * clinical playbook and two of its four call sites are a clinician's
 * (`AIPathwayRecommender`, `ClinicalPathwayTrigger`); a gate that kept
 * clinicians out would leave the capability serving nobody it is for.
 *
 * The WRITE is `agency_admin` only. `ClinicalPathwayManager` is the one screen
 * that writes, the rows are the agency's standard of care, and where the
 * original gave no client the write at all, the narrowest gate that still
 * serves the screen is the one to take. Widening it later is a product
 * decision with a record; starting wide is not recoverable.
 * ------------------------------------------------------------------ */
create function "pennsync_records".contract_clinical_pathway_list(
  p_agency text, p_active_only boolean, p_limit integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_size integer := "pennsync_records".library_page_size(p_limit); v_rows jsonb;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_PATHWAY_AGENCY_NOT_HELD';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) - 'source_app_id'
    order by t."created_date" desc nulls last, t."id" desc), '[]'::jsonb) into v_rows
  from (select * from "pennsync_records"."clinical_pathway" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."agency_id" = p_agency
      and (not coalesce(p_active_only, false) or coalesce(p."is_active", false))
    order by p."created_date" desc nulls last, p."id" desc limit v_size + 1) t;
  return "pennsync_records".library_answer(v_rows, p_limit);
end $contract$;

create function "pennsync_records".contract_clinical_pathway_write(
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
    p_id, p_fields, p_agency, 'PENNSYNC_PATHWAY', "pennsync_records".library_reserved(),
    array['pathway_name', 'condition']);
end $contract$;

/* ------------------------------------------------------------------ *
 * ClinicalLibraryTemplate and ClinicalLibraryFolder.
 *
 * One `rls` block between them, and it is a real per-row ownership rule:
 * read is `is_agency_wide OR created_by = {{user.email}} OR role admin`, and
 * create, update and delete are `created_by = {{user.email}} OR role admin`.
 * D40 succeeds the admin branch with an `agency_admin`; the `created_by`
 * branch is KEPT, because the table's policies are agency-WIDE and trusting
 * them would let anybody in the agency rewrite anybody else's phrases (D36's
 * rule, and D45's).
 *
 * `created_by` is compared against `caller_email()` — `identity_map`'s
 * verified address — rather than against a carried profile field, which is
 * D23's rule and the one `contract_policy_acknowledge` already follows.
 *
 * **`resolveClinicalPhrase` (D62) reads this table more widely than these do,
 * and that is not a contradiction.** It is the successor of a Base44 BACKEND
 * function, which ran with a service role the `rls` block never applied to;
 * these are the successors of the CLIENT calls the block governed. Read which
 * side of that line a capability is on before treating one as the precedent
 * for the other.
 *
 * The orderings are the call sites' own: templates by `-usage_count`
 * (`fetchAllClinicalTemplates`, `TopTemplatesWidget`), folders by `order`
 * ascending (`ClinicalLibraryManager`). `p_offset` exists because the template
 * pager already walks pages with a skip.
 * ------------------------------------------------------------------ */
create function "pennsync_records".library_owner_visible(p_agency text) returns boolean
  language sql stable set search_path = '' as $vis$
  select "pennsync_records".caller_tenant_role(p_agency) = 'agency_admin'
$vis$;

create function "pennsync_records".contract_clinical_library_template_list(
  p_agency text, p_limit integer, p_offset integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_size integer := "pennsync_records".library_page_size(p_limit);
  v_skip integer; v_rows jsonb; v_email text; v_all boolean;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_LIBRARY_TEMPLATE_AGENCY_NOT_HELD';
  end if;
  v_skip := coalesce(p_offset, 0);
  if v_skip < 0 or v_skip > 100000 then
    raise exception using errcode='22023', message='PENNSYNC_LIBRARY_TEMPLATE_OFFSET_INVALID';
  end if;
  v_email := "pennsync_records".caller_email();
  v_all := "pennsync_records".library_owner_visible(p_agency);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) - 'source_app_id'
    order by t."usage_count" desc nulls last, t."id" desc), '[]'::jsonb) into v_rows
  from (select * from "pennsync_records"."clinical_library_template" c
    where c."source_app_id" = "pennsync_records".deployment_app()
      and c."agency_id" = p_agency
      and (v_all or coalesce(c."is_agency_wide", false)
        or pg_catalog.lower(coalesce(c."created_by", '')) = pg_catalog.lower(coalesce(v_email, '')))
    order by c."usage_count" desc nulls last, c."id" desc
    limit v_size + 1 offset v_skip) t;
  return "pennsync_records".library_answer(v_rows, p_limit);
end $contract$;

create function "pennsync_records".contract_clinical_library_folder_list(
  p_agency text, p_limit integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_size integer := "pennsync_records".library_page_size(p_limit);
  v_rows jsonb; v_email text; v_all boolean;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_LIBRARY_FOLDER_AGENCY_NOT_HELD';
  end if;
  v_email := "pennsync_records".caller_email();
  v_all := "pennsync_records".library_owner_visible(p_agency);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) - 'source_app_id'
    order by t."order" asc nulls last, t."id" asc), '[]'::jsonb) into v_rows
  from (select * from "pennsync_records"."clinical_library_folder" f
    where f."source_app_id" = "pennsync_records".deployment_app()
      and f."agency_id" = p_agency
      and (v_all or coalesce(f."is_agency_wide", false)
        or pg_catalog.lower(coalesce(f."created_by", '')) = pg_catalog.lower(coalesce(v_email, '')))
    order by f."order" asc nulls last, f."id" asc limit v_size + 1) t;
  return "pennsync_records".library_answer(v_rows, p_limit);
end $contract$;

/*
 * The ownership gate both library writes share: the caller authored the row,
 * or is the agency's administrator. The row is read under the policies first,
 * so a row in another agency is NOT FOUND rather than FORBIDDEN — an id must
 * not be testable for existence across a tenant boundary.
 */
create function "pennsync_records".library_owned_row(
  p_table text, p_agency text, p_id text, p_code text)
  returns void language plpgsql security definer set search_path = '' as $owned$
declare v_created_by text; v_read integer;
begin
  execute pg_catalog.format(
    'select t."created_by" from "pennsync_records".%I t where t."source_app_id" = $1'
    || ' and t."id" = $2 and t."agency_id" = $3', p_table)
    into v_created_by using "pennsync_records".deployment_app(), p_id, p_agency;
  -- `execute` does NOT set `found`; only `get diagnostics` sees its row count.
  -- The first draft of this read `if not found` and refused every row,
  -- including the administrator's own — the trap `contract_patient_update`
  -- writes down about its own `update`, in a `select`.
  get diagnostics v_read = row_count;
  if v_read <> 1 then
    raise exception using errcode='42501', message=p_code || '_NOT_FOUND';
  end if;
  if not "pennsync_records".library_owner_visible(p_agency)
    and pg_catalog.lower(coalesce(v_created_by, ''))
      is distinct from pg_catalog.lower(coalesce("pennsync_records".caller_email(), '')) then
    raise exception using errcode='42501', message=p_code || '_FORBIDDEN';
  end if;
end $owned$;

create function "pennsync_records".contract_clinical_library_template_write(
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
    return "pennsync_records".library_write('clinical_library_template', 'agency_id',
      p_action, p_id, p_fields, p_agency, 'PENNSYNC_LIBRARY_TEMPLATE', v_reserved,
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

create function "pennsync_records".contract_clinical_library_folder_write(
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
    p_id, p_fields, p_agency, 'PENNSYNC_LIBRARY_FOLDER', "pennsync_records".library_reserved(),
    array['name']);
end $contract$;

/* ------------------------------------------------------------------ *
 * EducationMaterial.
 *
 * `rls.read` is `is_published OR role admin`; create, update and delete are
 * `role admin` alone. So the read splits — a published material is the
 * agency's catalogue and any member may read it, an unpublished draft is not
 * — and every write is D40's `agency_admin`.
 *
 * `PersonalizedMaterialSender` bumps `usage_count` and `last_used_date` on a
 * material it has just sent, inside a `try` whose own comment says the bump is
 * "denied by RLS" for a clinician and must not turn a recorded send into an
 * error. That behaviour is preserved rather than fixed: a clinician's bump is
 * refused here too, and the screen already swallows it.
 * ------------------------------------------------------------------ */
create function "pennsync_records".contract_education_material_list(
  p_agency text, p_published_only boolean, p_limit integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_size integer := "pennsync_records".library_page_size(p_limit);
  v_rows jsonb; v_all boolean;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_EDUCATION_MATERIAL_AGENCY_NOT_HELD';
  end if;
  v_all := "pennsync_records".library_owner_visible(p_agency);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) - 'source_app_id'
    order by t."last_used_date" desc nulls last, t."id" desc), '[]'::jsonb) into v_rows
  from (select * from "pennsync_records"."education_material" m
    where m."source_app_id" = "pennsync_records".deployment_app()
      and m."agency_id" = p_agency
      and (coalesce(m."is_published", false)
        or (v_all and not coalesce(p_published_only, false)))
    order by m."last_used_date" desc nulls last, m."id" desc limit v_size + 1) t;
  return "pennsync_records".library_answer(v_rows, p_limit);
end $contract$;

create function "pennsync_records".contract_education_material_write(
  p_agency text, p_action text, p_id text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
begin
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_EDUCATION_MATERIAL_FORBIDDEN';
  end if;
  if not "pennsync_records".library_action(p_action) then
    raise exception using errcode='22023', message='PENNSYNC_EDUCATION_MATERIAL_ACTION_INVALID';
  end if;
  if p_action <> 'create' and not "pennsync_records".library_row_id(p_id) then
    raise exception using errcode='22023', message='PENNSYNC_EDUCATION_MATERIAL_ID_INVALID';
  end if;
  return "pennsync_records".library_write('education_material', 'agency_id', p_action,
    p_id, p_fields, p_agency, 'PENNSYNC_EDUCATION_MATERIAL',
    "pennsync_records".library_reserved(), array['title', 'category', 'content']);
end $contract$;

/* ------------------------------------------------------------------ *
 * PatientEducationAssignment.
 *
 * `{read, create, update, delete: false}`, so again no client rule — but here
 * the answer needs no decision at all, because the table has NO `agency_id`
 * and its policies reach tenancy through the `patient` row it names: every one
 * of them requires that row to exist, to be in an agency the caller holds, and
 * to be a chart D24 opens for them. That is the whole of the authorization,
 * and a role gate on top would only subtract members of the care team the
 * capability exists for. `office_staff` open no chart, so the policies already
 * refuse them without this contract saying so.
 *
 * A consequence worth naming: a row whose `patient_id` names no `patient` row
 * is invisible to everyone, this contract included. So `p_patient_id` is
 * REQUIRED on the list and on a create, and there is no way to write a row
 * into no chart.
 *
 * `delete` is refused BY NAME. No call site performs one — `EducationTracker`
 * dismisses an assignment by moving its `status`, which is what the enum's
 * `dismissed` is for — and a record of what a patient was taught is not a row
 * a screen removes. If that changes it is a product decision with a record,
 * which is D31's rule for an action a port does not serve.
 * ------------------------------------------------------------------ */
/*
 * The chart named by a patient-education row is in the agency the request
 * names, and the row an id points at is too.
 *
 * `patient_education_assignment` carries no `agency_id` — its tenancy is the
 * chart — so `library_write` has no tenancy column to compare and its
 * predicate degenerates to "a tenant was supplied". The POLICIES then admit
 * every agency the caller holds, which is D51's trap: `caller_agencies()` is
 * plural, and a caller who works for two agencies could file a row against
 * agency B's chart on a request whose envelope names A. The list read already
 * joins the chart for exactly this reason; the write half did not, and the
 * business API's invariant is that every request is scoped to the tenant it
 * names. Raised as NOT FOUND rather than forbidden, so an id is not testable
 * for existence across a tenant boundary (`library_owned_row`'s rule).
 */
create function "pennsync_records".patient_education_chart(
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

create function "pennsync_records".patient_education_row(
  p_agency text, p_id text, p_code text)
  returns void language plpgsql security definer set search_path = '' as $row$
declare v_patient text;
begin
  select a."patient_id" into v_patient
  from "pennsync_records"."patient_education_assignment" a
  where a."source_app_id" = "pennsync_records".deployment_app() and a."id" = p_id;
  if v_patient is null then
    raise exception using errcode='42501', message=p_code || '_NOT_FOUND';
  end if;
  perform "pennsync_records".patient_education_chart(p_agency, v_patient, p_code);
end $row$;

create function "pennsync_records".contract_patient_education_list(
  p_agency text, p_patient_id text, p_limit integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_size integer := "pennsync_records".library_page_size(p_limit); v_rows jsonb;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_PATIENT_EDUCATION_AGENCY_NOT_HELD';
  end if;
  if not "pennsync_records".library_row_id(p_patient_id) then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_EDUCATION_SUBJECT_INVALID';
  end if;
  -- The agency is named in this contract's own predicate as well as in the
  -- policy, because `caller_agencies()` returns every agency the caller holds
  -- and the row itself carries none. D51's trap, in the table next door.
  --
  -- The write half of this contract had exactly this missing until a review
  -- found it, and the reason it survived is worth more than the fix: the
  -- shared fixtures give each identity ONE membership, and with one
  -- membership the policies refuse a cross-agency call whatever the contract
  -- does. So an assertion that the contract binds the tenant passed with the
  -- binding deleted. Sabotage proves an assertion bites; it does not prove
  -- the FIXTURE can express the violation. The suite now builds a caller
  -- holding two agencies, and neutralises each binding on its own as well as
  -- together, because all-at-once trips on the first and says nothing about
  -- the rest.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) - 'source_app_id'
    order by t."assigned_date" desc nulls last, t."id" desc), '[]'::jsonb) into v_rows
  from (select a.* from "pennsync_records"."patient_education_assignment" a
    join "pennsync_records"."patient" p
      on p."source_app_id" = a."source_app_id" and p."id" = a."patient_id"
    where a."source_app_id" = "pennsync_records".deployment_app()
      and a."patient_id" = p_patient_id and p."agency_id" = p_agency
    order by a."assigned_date" desc nulls last, a."id" desc limit v_size + 1) t;
  return "pennsync_records".library_answer(v_rows, p_limit);
end $contract$;

create function "pennsync_records".contract_patient_education_write(
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
    -- `patient_id` is how the chart is chosen, and the insert policy checks
    -- the value written, so a caller can only file against a chart they open.
    if p_fields is null or pg_catalog.jsonb_typeof(p_fields) <> 'object'
      or not "pennsync_records".library_row_id(p_fields->>'patient_id') then
      raise exception using errcode='22023', message='PENNSYNC_PATIENT_EDUCATION_SUBJECT_INVALID';
    end if;
    perform "pennsync_records".patient_education_chart(
      p_agency, p_fields->>'patient_id', 'PENNSYNC_PATIENT_EDUCATION');
    -- `assigned_by` says who assigned the education, so it is the caller's
    -- identity and not a field. `created_by`'s self-assertion rule applies
    -- for the same reason it applies there, and the contract stamps it: the
    -- sole call site already sends the current user's own address, and
    -- without this any member who opens the chart could attribute a teaching
    -- record to a colleague.
    return "pennsync_records".library_write('patient_education_assignment', null, p_action,
      p_id,
      "pennsync_records".library_own_assigned_by(p_fields, 'PENNSYNC_PATIENT_EDUCATION')
        || jsonb_build_object('assigned_by', "pennsync_records".caller_email()),
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
    -- Reserved on update for `created_by`'s reason: who assigned the
    -- education is settled when it is assigned.
    v_reserved || array['patient_id', 'assigned_by'],
    array['patient_id', 'assigned_by']);
end $contract$;

/* ------------------------------------------------------------------ *
 * CustomValidationRule.
 *
 * `role admin` on all four operations and nothing else, so D40 answers the
 * whole entity: an `agency_admin` scoped to their own agency, on the read as
 * well as on the writes. `CustomValidationRuleManager` is the only screen.
 * ------------------------------------------------------------------ */
create function "pennsync_records".contract_validation_rule_list(
  p_agency text, p_limit integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_size integer := "pennsync_records".library_page_size(p_limit); v_rows jsonb;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_VALIDATION_RULE_FORBIDDEN';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) - 'source_app_id'
    order by t."created_date" desc nulls last, t."id" desc), '[]'::jsonb) into v_rows
  from (select * from "pennsync_records"."custom_validation_rule" r
    where r."source_app_id" = "pennsync_records".deployment_app()
      and r."agency_id" = p_agency
    order by r."created_date" desc nulls last, r."id" desc limit v_size + 1) t;
  return "pennsync_records".library_answer(v_rows, p_limit);
end $contract$;

create function "pennsync_records".contract_validation_rule_write(
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
    p_id, p_fields, p_agency, 'PENNSYNC_VALIDATION_RULE',
    "pennsync_records".library_reserved(),
    array['rule_name', 'entity_type', 'field_name', 'validation_type']);
end $contract$;

/* ------------------------------------------------------------------ *
 * AIConfiguration — ONE table doing two unrelated jobs, and the split is the
 * whole of this contract.
 *
 * `rls` is `data.user_email == {{user.email}} OR role admin` on all four
 * operations. The two screens over it mean different things by a row:
 *
 * * `src/pages/UserSettings.jsx` writes ONE PERSON'S preferences, keyed by
 *   `user_email`, and reads them back with `filter({})` trusting the row rule
 *   to scope it.
 * * `src/components/admin/AIConfigurationManager.jsx` writes the AGENCY'S
 *   settings, keyed by `setting_name`, `setting_category` and `value`, with no
 *   `user_email` at all — so under the original only the platform tier could
 *   ever read or write them.
 *
 * `p_scope` is that split, made explicit. `mine` is the caller's own rows and
 * needs no role at all; `agency` is D40's `agency_admin` succeeding the
 * platform tier.
 *
 * **`agency` shows only rows with no `user_email`, which is a NARROWING and is
 * deliberate.** The platform owner the original admitted was remote from the
 * agency; an `agency_admin` is a colleague sitting next to the person whose
 * preferences these are, and D44's rule is to read what the platform tier was
 * structurally preventing rather than only what it permitted. An agency's
 * settings are the administrator's business. A nurse's verbosity preference is
 * not, and no screen asks for it.
 *
 * The ownership predicate is the contract's own, because `ai_configuration`'s
 * policies are agency-WIDE — the second half of D45's rule, and the reason
 * `library_owned_row` above is not reused here: ownership on this table is
 * `user_email`, not `created_by`.
 *
 * **The save is a find-or-create and is still racy, exactly as the original
 * is.** Two concurrent first saves by one person both find nothing and both
 * insert. `select … for update` locks nothing when the row does not exist
 * (D33), so what would actually serialize it is a unique index — and
 * `AIConfiguration`'s schema claims no uniqueness, so D30 emits none and there
 * is no constraint to catch by name. That is D44's `client_request_id`
 * verbatim: the original's shape is ported as the original has it, and adding
 * the key is a change to `DECLARED_UNIQUE` or `CONTRACT_UNIQUE` in
 * `tools-entity-schema-plan.mjs` with a reason, which is a different change
 * from this one. Recorded rather than papered over with a lock that cannot
 * bite.
 * ------------------------------------------------------------------ */
create function "pennsync_records".contract_ai_configuration_read(
  p_agency text, p_scope text, p_limit integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_size integer := "pennsync_records".library_page_size(p_limit);
  v_rows jsonb; v_email text;
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
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) - 'source_app_id'
    order by t."id" asc), '[]'::jsonb) into v_rows
  from (select * from "pennsync_records"."ai_configuration" c
    where c."source_app_id" = "pennsync_records".deployment_app()
      and c."agency_id" = p_agency
      and case when p_scope = 'mine'
        then pg_catalog.lower(coalesce(c."user_email", ''))
          = pg_catalog.lower(coalesce(v_email, ''))
        else c."user_email" is null end
    order by c."id" asc limit v_size + 1) t;
  return "pennsync_records".library_answer(v_rows, p_limit);
end $contract$;

create function "pennsync_records".contract_ai_configuration_save(
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
      case when p_scope = 'mine'
        then coalesce(p_fields, '{}'::jsonb) || jsonb_build_object('user_email', v_email)
        else p_fields end,
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
  "pennsync_records".library_fields(text,jsonb,text[],text),
  "pennsync_records".library_own_created_by(jsonb,text),
  "pennsync_records".library_own_assigned_by(jsonb,text),
  "pennsync_records".patient_education_chart(text,text,text),
  "pennsync_records".patient_education_row(text,text,text),
  "pennsync_records".library_page_size(integer),
  "pennsync_records".library_answer(jsonb,integer),
  "pennsync_records".library_write(text,text,text,text,jsonb,text,text,text[],text[]),
  "pennsync_records".library_required(jsonb,text[],text),
  "pennsync_records".library_reserved(),
  "pennsync_records".library_row_id(text),
  "pennsync_records".library_action(text),
  "pennsync_records".library_owner_visible(text),
  "pennsync_records".library_owned_row(text,text,text,text),
  "pennsync_records".contract_clinical_pathway_list(text,boolean,integer),
  "pennsync_records".contract_clinical_pathway_write(text,text,text,jsonb),
  "pennsync_records".contract_clinical_library_template_list(text,integer,integer),
  "pennsync_records".contract_clinical_library_template_write(text,text,text,jsonb),
  "pennsync_records".contract_clinical_library_folder_list(text,integer),
  "pennsync_records".contract_clinical_library_folder_write(text,text,text,jsonb),
  "pennsync_records".contract_education_material_list(text,boolean,integer),
  "pennsync_records".contract_education_material_write(text,text,text,jsonb),
  "pennsync_records".contract_patient_education_list(text,text,integer),
  "pennsync_records".contract_patient_education_write(text,text,text,jsonb),
  "pennsync_records".contract_validation_rule_list(text,integer),
  "pennsync_records".contract_validation_rule_write(text,text,text,jsonb),
  "pennsync_records".contract_ai_configuration_read(text,text,integer),
  "pennsync_records".contract_ai_configuration_save(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_clinical_pathway_list(text,boolean,integer),
  "pennsync_records".contract_clinical_pathway_write(text,text,text,jsonb),
  "pennsync_records".contract_clinical_library_template_list(text,integer,integer),
  "pennsync_records".contract_clinical_library_template_write(text,text,text,jsonb),
  "pennsync_records".contract_clinical_library_folder_list(text,integer),
  "pennsync_records".contract_clinical_library_folder_write(text,text,text,jsonb),
  "pennsync_records".contract_education_material_list(text,boolean,integer),
  "pennsync_records".contract_education_material_write(text,text,text,jsonb),
  "pennsync_records".contract_patient_education_list(text,text,integer),
  "pennsync_records".contract_patient_education_write(text,text,text,jsonb),
  "pennsync_records".contract_validation_rule_list(text,integer),
  "pennsync_records".contract_validation_rule_write(text,text,text,jsonb),
  "pennsync_records".contract_ai_configuration_read(text,text,integer),
  "pennsync_records".contract_ai_configuration_save(text,text,text,jsonb)
  to authenticated;

create function "public"."pennsync_contract_clinical_pathway_list"(p_agency text, p_active_only boolean, p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_clinical_pathway_list(p_agency, p_active_only, p_limit)
$contract$;
revoke all on function "public"."pennsync_contract_clinical_pathway_list"(text,boolean,integer)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_clinical_pathway_list"(text,boolean,integer) to authenticated;

create function "public"."pennsync_contract_clinical_pathway_write"(p_agency text, p_action text, p_id text, p_fields jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_clinical_pathway_write(p_agency, p_action, p_id, p_fields)
$contract$;
revoke all on function "public"."pennsync_contract_clinical_pathway_write"(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_clinical_pathway_write"(text,text,text,jsonb) to authenticated;

create function "public"."pennsync_contract_clinical_library_template_list"(p_agency text, p_limit integer, p_offset integer) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_clinical_library_template_list(p_agency, p_limit, p_offset)
$contract$;
revoke all on function "public"."pennsync_contract_clinical_library_template_list"(text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_clinical_library_template_list"(text,integer,integer) to authenticated;

create function "public"."pennsync_contract_clinical_library_template_write"(p_agency text, p_action text, p_id text, p_fields jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_clinical_library_template_write(p_agency, p_action, p_id, p_fields)
$contract$;
revoke all on function "public"."pennsync_contract_clinical_library_template_write"(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_clinical_library_template_write"(text,text,text,jsonb) to authenticated;

create function "public"."pennsync_contract_clinical_library_folder_list"(p_agency text, p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_clinical_library_folder_list(p_agency, p_limit)
$contract$;
revoke all on function "public"."pennsync_contract_clinical_library_folder_list"(text,integer)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_clinical_library_folder_list"(text,integer) to authenticated;

create function "public"."pennsync_contract_clinical_library_folder_write"(p_agency text, p_action text, p_id text, p_fields jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_clinical_library_folder_write(p_agency, p_action, p_id, p_fields)
$contract$;
revoke all on function "public"."pennsync_contract_clinical_library_folder_write"(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_clinical_library_folder_write"(text,text,text,jsonb) to authenticated;

create function "public"."pennsync_contract_education_material_list"(p_agency text, p_published_only boolean, p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_education_material_list(p_agency, p_published_only, p_limit)
$contract$;
revoke all on function "public"."pennsync_contract_education_material_list"(text,boolean,integer)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_education_material_list"(text,boolean,integer) to authenticated;

create function "public"."pennsync_contract_education_material_write"(p_agency text, p_action text, p_id text, p_fields jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_education_material_write(p_agency, p_action, p_id, p_fields)
$contract$;
revoke all on function "public"."pennsync_contract_education_material_write"(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_education_material_write"(text,text,text,jsonb) to authenticated;

create function "public"."pennsync_contract_patient_education_list"(p_agency text, p_patient_id text, p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_patient_education_list(p_agency, p_patient_id, p_limit)
$contract$;
revoke all on function "public"."pennsync_contract_patient_education_list"(text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_patient_education_list"(text,text,integer) to authenticated;

create function "public"."pennsync_contract_patient_education_write"(p_agency text, p_action text, p_id text, p_fields jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_patient_education_write(p_agency, p_action, p_id, p_fields)
$contract$;
revoke all on function "public"."pennsync_contract_patient_education_write"(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_patient_education_write"(text,text,text,jsonb) to authenticated;

create function "public"."pennsync_contract_validation_rule_list"(p_agency text, p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_validation_rule_list(p_agency, p_limit)
$contract$;
revoke all on function "public"."pennsync_contract_validation_rule_list"(text,integer)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_validation_rule_list"(text,integer) to authenticated;

create function "public"."pennsync_contract_validation_rule_write"(p_agency text, p_action text, p_id text, p_fields jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_validation_rule_write(p_agency, p_action, p_id, p_fields)
$contract$;
revoke all on function "public"."pennsync_contract_validation_rule_write"(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_validation_rule_write"(text,text,text,jsonb) to authenticated;

create function "public"."pennsync_contract_ai_configuration_read"(p_agency text, p_scope text, p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_ai_configuration_read(p_agency, p_scope, p_limit)
$contract$;
revoke all on function "public"."pennsync_contract_ai_configuration_read"(text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_ai_configuration_read"(text,text,integer) to authenticated;

create function "public"."pennsync_contract_ai_configuration_save"(p_agency text, p_scope text, p_id text, p_fields jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_ai_configuration_save(p_agency, p_scope, p_id, p_fields)
$contract$;
revoke all on function "public"."pennsync_contract_ai_configuration_save"(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_ai_configuration_save"(text,text,text,jsonb) to authenticated;

commit;
