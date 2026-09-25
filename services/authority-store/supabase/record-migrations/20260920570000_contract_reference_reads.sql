-- The seven reference and configuration reads the frontend performs directly.
--
-- Every contract before this one replaced a Base44 FUNCTION. These replace
-- something else: `base44.entities.Physician.list(...)` and six like it, called
-- from the SPA through the platform SDK with Base44's own row-level security
-- deciding what came back. There is no original handler to read, so what is
-- ported is the CALL — its filter, its order and its row bound, taken from the
-- call site — and what is decided here is the authorization Base44 was doing
-- for us.
--
-- Three things about that are worth stating once, because twelve more of these
-- follow in the batches beside this one.
--
-- 1. **The policies do tenancy; the contract does the role.** Each of these
--    tables already has `<table>_read` restricting to `caller_agencies()`, and
--    none of them carries a `patient_id`, so D24's chart narrowing does not
--    reach them and they are agency-wide by design. A contract that restated
--    the tenant predicate would be a second copy to keep in agreement with the
--    first (D41, D43). What the policies cannot say is which ROLE may ask, and
--    for a read of agency reference data the answer is any member — these are
--    the physician directory, the document templates, the on-call rota and the
--    published Medicare rules, which everybody who opens the app needs. So the
--    gate is membership, and membership alone. Where that is wrong it is wrong
--    in the safe direction: `caller_tenant_role` returning null is a refusal
--    rather than an empty list, because an empty list would tell a caller that
--    an agency they do not hold exists and is empty.
--
-- 2. **Two of these tables are GLOBAL and have no write path at all.**
--    `medicare_compliance_rule` and `medicare_guideline` carry no `agency_id`
--    and have exactly ONE policy each, a read: they are D83 reference data,
--    published by the regulator and identical for every agency, written by
--    migration and never at run time. The SPA calls `.create` and `.update` on
--    them from two admin screens; the store refuses those writes and always
--    did, whatever this migration says. That is a decision already taken in
--    SQL, so no write contract is written for them here and none should be
--    added later without changing D83 first.
--
-- 3. **Every column is named, and the two locators are different things.**
--    D64's rule. `library_document` and `document_template` grow columns as the
--    product does, and a contract returning the row would disclose the next one
--    by default — a first draft of this file did exactly that for four of the
--    seven, under a header already claiming otherwise, which is why the rule is
--    stated here and checked in the suite rather than trusted.
--
--    `medicare_guideline.url` is projected as it stands: the tenant decision
--    records it under `external_locators`, and it addresses the regulator's own
--    website rather than our storage, so it is not the disclosure D71 refuses.
--    `library_document.file_url` is the opposite — a Base44 storage locator on
--    a carried row — so it is projected THROUGH `resolve_file_locator` (D77),
--    which the record owner alone may call. Until the file copy has run that
--    answers null, and null is the point: handing a caller the Base44 URL it
--    asked us to replace would have the browser fetch the platform we are
--    leaving. The screen shows a document it cannot open yet, loudly, rather
--    than one that quietly still comes from Base44.
--
-- The row bounds are the contracts' own and no caller can raise them (D71).
-- They are NOT above every bound a call site asks for: seven of these calls pass
-- `ALL_ROWS`, which is 5,000, and the ceilings here are 2,000, 500 and 100. That
-- is deliberate and the gap is handled where it can be handled honestly. Each
-- contract orders IN SQL, so a page it returns is a true top-N and truncating it
-- to the caller's own smaller bound loses nothing. What would be a lie is
-- answering "everything" with "the first 2,000 of it", so the browser asks for
-- one row more than it wants, capped at the ceiling, and refuses with
-- `STAGING_ENTITY_PAGE_INCOMPLETE` if the ceiling comes back full
-- (`independentEntityRoutes.js`). A screen then shows an error instead of a
-- truncated list it would present as the whole set.

begin;

do $$
begin
  if to_regprocedure('pennsync_records.caller_tenant_role(text)') is null then
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

-- One membership check, written once. Every contract below opens with it, and a
-- helper keeps the refusal identical rather than seven times similar.
create function "pennsync_records".reference_read_role(p_agency text)
  returns text language plpgsql stable security definer set search_path = '' as $helper$
declare v_role text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_CONTRACT_AGENCY_NOT_HELD';
  end if;
  return v_role;
end $helper$;

-- The row bound, clamped where the caller cannot reach it. A limit a caller
-- could raise is not a bound (D71).
create function "pennsync_records".reference_read_limit(p_limit integer, p_ceiling integer)
  returns integer language sql immutable set search_path = '' as $helper$
  select least(greatest(coalesce(p_limit, 100), 1), p_ceiling)
$helper$;

-- The published Conditions of Participation rules. Seven call sites, all of
-- them `list(undefined, ALL_ROWS)` — no order asked for, everything wanted —
-- so this orders by the reference a reader would look up and then by id, which
-- is a total order and therefore a stable page.
create function "pennsync_records".contract_medicare_compliance_rule_list(
  p_agency text, p_limit integer)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_rows jsonb;
begin
  perform "pennsync_records".reference_read_role(p_agency);
  select coalesce(jsonb_agg(page.row order by page.ordinal), '[]'::jsonb) into v_rows
  from (
    select row_number() over (order by r."cop_reference" nulls last, r."id") as ordinal,
      jsonb_build_object(
        'id', r."id",
        'rule_name', r."rule_name",
        'cop_reference', r."cop_reference",
        'category', r."category",
        'description', r."description",
        'required_elements', r."required_elements",
        'applies_to_visit_types', r."applies_to_visit_types",
        'severity', r."severity",
        'validation_criteria', r."validation_criteria",
        'examples_compliant', r."examples_compliant",
        'examples_non_compliant', r."examples_non_compliant",
        'pennsylvania_specific', r."pennsylvania_specific",
        'service_line', r."service_line",
        'remediation_guidance', r."remediation_guidance",
        'keywords', r."keywords",
        'is_active', r."is_active",
        'effective_date', r."effective_date",
        'last_updated', r."last_updated",
        'created_date', r."created_date",
        'updated_date', r."updated_date") as row
    from "pennsync_records"."medicare_compliance_rule" r
    order by r."cop_reference" nulls last, r."id"
    limit "pennsync_records".reference_read_limit(p_limit, 2000)
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

-- The CMS manual guidance. One call site, which asks for the active rows newest
-- fetched first. `url` is projected: the tenant decision records it as an
-- external locator, addressing the regulator's site rather than our storage.
create function "pennsync_records".contract_medicare_guideline_list(
  p_agency text, p_limit integer, p_active boolean)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_rows jsonb;
begin
  perform "pennsync_records".reference_read_role(p_agency);
  select coalesce(jsonb_agg(page.row order by page.ordinal), '[]'::jsonb) into v_rows
  from (
    select row_number() over (order by g."last_fetched_date" desc nulls last, g."id" desc) as ordinal,
      jsonb_build_object(
        'id', g."id",
        'title', g."title",
        'url', g."url",
        'content_markdown', g."content_markdown",
        'summary', g."summary",
        'category', g."category",
        'subcategory', g."subcategory",
        'effective_date', g."effective_date",
        'last_updated_date', g."last_updated_date",
        'last_fetched_date', g."last_fetched_date",
        'keywords', g."keywords",
        'related_diagnoses', g."related_diagnoses",
        'applies_to_visit_types', g."applies_to_visit_types",
        'is_active', g."is_active",
        'cms_manual_chapter', g."cms_manual_chapter",
        'regulatory_citation', g."regulatory_citation",
        'created_date', g."created_date",
        'updated_date', g."updated_date") as row
    from "pennsync_records"."medicare_guideline" g
    -- Null is "no preference", which is the absent filter rather than a third
    -- state: the one call site always asks for the active rows. Compared with
    -- `=` rather than `is`, which takes only a literal, so a row whose flag was
    -- never set is not active — which is what an unset flag means here.
    where p_active is null or g."is_active" = p_active
    order by g."last_fetched_date" desc nulls last, g."id" desc
    limit "pennsync_records".reference_read_limit(p_limit, 2000)
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

-- The referral-source directory. Three call sites and three DIFFERENT orders,
-- so the order is a named parameter checked against a fixed set rather than a
-- string the caller composes: an order built from caller text is an injection
-- surface and, in a `stable` body, not one this can validate cheaply.
create function "pennsync_records".contract_physician_list(
  p_agency text, p_limit integer, p_order text, p_active boolean)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_rows jsonb;
begin
  perform "pennsync_records".reference_read_role(p_agency);
  if p_order is null or p_order not in ('recent', 'name', 'referrals') then
    raise exception using errcode='22023', message='PENNSYNC_CONTRACT_ORDER_INVALID';
  end if;
  select coalesce(jsonb_agg(page.row order by page.ordinal), '[]'::jsonb) into v_rows
  from (
    select row_number() over (order by
        case when p_order = 'recent' then p."created_date" end desc nulls last,
        case when p_order = 'referrals' then p."referral_count" end desc nulls last,
        case when p_order = 'name' then p."full_name" end asc nulls last,
        p."id") as ordinal,
      jsonb_build_object(
        'id', p."id",
        'full_name', p."full_name",
        'credentials', p."credentials",
        'provider_type', p."provider_type",
        'specialty', p."specialty",
        'subspecialty', p."subspecialty",
        'practice_name', p."practice_name",
        'company', p."company",
        'top_unit', p."top_unit",
        'parent_unit', p."parent_unit",
        'sub_unit', p."sub_unit",
        'office_address', p."office_address",
        'office_city', p."office_city",
        'office_state', p."office_state",
        'office_zip', p."office_zip",
        'phone_number', p."phone_number",
        'fax_number', p."fax_number",
        'email', p."email",
        'npi_number', p."npi_number",
        'state_license', p."state_license",
        'accepts_home_health', p."accepts_home_health",
        'accepts_hospice', p."accepts_hospice",
        'preferred_contact_method', p."preferred_contact_method",
        'office_hours', p."office_hours",
        'notes', p."notes",
        'tags', p."tags",
        'is_active', p."is_active",
        'last_referral_date', p."last_referral_date",
        'referral_count', p."referral_count",
        'created_date', p."created_date",
        'updated_date', p."updated_date") as row
    from "pennsync_records"."physician" p
    where p."agency_id" = p_agency
      and (p_active is null or p."is_active" = p_active)
    order by
      case when p_order = 'recent' then p."created_date" end desc nulls last,
      case when p_order = 'referrals' then p."referral_count" end desc nulls last,
      case when p_order = 'name' then p."full_name" end asc nulls last,
      p."id"
    limit "pennsync_records".reference_read_limit(p_limit, 2000)
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

-- The document templates. Both call sites ask for the newest first. This is the
-- one read here with NO tenant predicate of its own, and the reason is the
-- policy's second branch: `document_template_read` admits an agency's own rows
-- OR any row whose `is_system_template` is true, whatever agency owns it. A
-- system template is not an untenanted row — `agency_id` is `not null` on this
-- table, so a first draft of this comment had the mechanism wrong — it is a
-- FLAGGED row, and the flag is what publishes it. So restating `agency_id =
-- p_agency` here would hide every system template from every agency but the one
-- that happens to hold it, and system templates are most of what these screens
-- show. The policy says it; the contract does not say it again.
create function "pennsync_records".contract_document_template_list(
  p_agency text, p_limit integer)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_rows jsonb;
begin
  perform "pennsync_records".reference_read_role(p_agency);
  select coalesce(jsonb_agg(page.row order by page.ordinal), '[]'::jsonb) into v_rows
  from (
    select row_number() over (order by t."created_date" desc nulls last, t."id" desc) as ordinal,
      jsonb_build_object(
        'id', t."id",
        'created_date', t."created_date",
        'updated_date', t."updated_date",
        'created_by', t."created_by",
        'template_name', t."template_name",
        'name', t."name",
        'description', t."description",
        'category', t."category",
        'visit_type', t."visit_type",
        'content', t."content",
        'placeholders', t."placeholders",
        'required_elements', t."required_elements",
        'tags', t."tags",
        'linked_education_ids', t."linked_education_ids",
        'related_diagnoses', t."related_diagnoses",
        'is_system_template', t."is_system_template",
        'is_public', t."is_public",
        'usage_count', t."usage_count",
        'ai_generated', t."ai_generated",
        'generation_prompt', t."generation_prompt",
        'auto_suggest_materials', t."auto_suggest_materials",
        'agency_id', t."agency_id") as row
    from "pennsync_records"."document_template" t
    order by t."created_date" desc nulls last, t."id" desc
    limit "pennsync_records".reference_read_limit(p_limit, 500)
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

-- The clinical library's documents. One call site, newest first.
create function "pennsync_records".contract_library_document_list(
  p_agency text, p_limit integer)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_rows jsonb;
begin
  perform "pennsync_records".reference_read_role(p_agency);
  select coalesce(jsonb_agg(page.row order by page.ordinal), '[]'::jsonb) into v_rows
  from (
    select row_number() over (order by d."created_date" desc nulls last, d."id" desc) as ordinal,
      jsonb_build_object(
        'id', d."id",
        'created_date', d."created_date",
        'updated_date', d."updated_date",
        'created_by', d."created_by",
        'title', d."title",
        'description', d."description",
        'category', d."category",
        'file_url', "pennsync_private".resolve_file_locator(d."file_url"),
        'file_type', d."file_type",
        'is_active', d."is_active",
        'tags', d."tags",
        'agency_id', d."agency_id") as row
    from "pennsync_records"."library_document" d
    where d."agency_id" = p_agency
    order by d."created_date" desc nulls last, d."id" desc
    limit "pennsync_records".reference_read_limit(p_limit, 500)
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

-- The on-call rota for one window. The call site asks a date RANGE, which the
-- generic family has no predicate for and which belongs in SQL rather than in
-- the browser: a month of shifts is the whole point of the screen and filtering
-- a page client-side could not prove it held the month.
create function "pennsync_records".contract_on_call_shift_list(
  p_agency text, p_limit integer, p_from text, p_to text)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_rows jsonb; v_from date; v_to date;
begin
  perform "pennsync_records".reference_read_role(p_agency);
  -- Parsed from text rather than taken as a date, so an impossible day is this
  -- contract's refusal instead of a cast error crossing the HTTP boundary as
  -- something a caller cannot act on (D38).
  begin
    v_from := case when p_from is null then null else p_from::date end;
    v_to := case when p_to is null then null else p_to::date end;
  exception when others then
    raise exception using errcode='22023', message='PENNSYNC_CONTRACT_DATE_INVALID';
  end;
  if v_from is not null and v_to is not null and v_from > v_to then
    raise exception using errcode='22023', message='PENNSYNC_CONTRACT_RANGE_INVALID';
  end if;
  select coalesce(jsonb_agg(page.row order by page.ordinal), '[]'::jsonb) into v_rows
  from (
    select row_number() over (order by s."shift_date", s."id") as ordinal,
      jsonb_build_object(
        'id', s."id",
        'created_date', s."created_date",
        'updated_date', s."updated_date",
        'created_by', s."created_by",
        'shift_date', s."shift_date",
        'coverage_type', s."coverage_type",
        'holiday_name', s."holiday_name",
        'start_label', s."start_label",
        'end_label', s."end_label",
        'assigned_user_email', s."assigned_user_email",
        'assigned_user_name', s."assigned_user_name",
        'notes', s."notes",
        'agency_id', s."agency_id") as row
    from "pennsync_records"."on_call_shift" s
    where s."agency_id" = p_agency
      and (v_from is null or s."shift_date" >= v_from)
      and (v_to is null or s."shift_date" <= v_to)
    order by s."shift_date", s."id"
    limit "pennsync_records".reference_read_limit(p_limit, 2000)
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

-- The agency's visit point schedule. Its WRITE already has a capability
-- (`saveVisitPointConfig`), so this is the missing half rather than a new pair,
-- and the one call site reads the five most recently updated rows — the history
-- D78 keeps rather than the single active schedule.
create function "pennsync_records".contract_visit_point_config_list(
  p_agency text, p_limit integer)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_rows jsonb;
begin
  perform "pennsync_records".reference_read_role(p_agency);
  select coalesce(jsonb_agg(page.row order by page.ordinal), '[]'::jsonb) into v_rows
  from (
    select row_number() over (order by c."updated_date" desc nulls last, c."id" desc) as ordinal,
      jsonb_build_object(
        'id', c."id",
        'created_date', c."created_date",
        'updated_date', c."updated_date",
        'created_by', c."created_by",
        'soc_points', c."soc_points",
        'roc_points', c."roc_points",
        'recert_points', c."recert_points",
        'routine_points', c."routine_points",
        'discharge_points', c."discharge_points",
        'active', c."active",
        'notes', c."notes",
        'agency_name', c."agency_name",
        'agency_id', c."agency_id") as row
    from "pennsync_records"."visit_point_config" c
    where c."agency_id" = p_agency
    order by c."updated_date" desc nulls last, c."id" desc
    limit "pennsync_records".reference_read_limit(p_limit, 100)
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

reset role;

revoke all on function
  "pennsync_records".reference_read_role(text),
  "pennsync_records".reference_read_limit(integer,integer),
  "pennsync_records".contract_medicare_compliance_rule_list(text,integer),
  "pennsync_records".contract_medicare_guideline_list(text,integer,boolean),
  "pennsync_records".contract_physician_list(text,integer,text,boolean),
  "pennsync_records".contract_document_template_list(text,integer),
  "pennsync_records".contract_library_document_list(text,integer),
  "pennsync_records".contract_on_call_shift_list(text,integer,text,text),
  "pennsync_records".contract_visit_point_config_list(text,integer)
  from public, anon, authenticated, service_role;

-- The two helpers are the record owner's alone: they are not capabilities, and
-- a caller that could ask `reference_read_role` directly would be asking the
-- authority question without the read that gives it a purpose.
grant execute on function
  "pennsync_records".contract_medicare_compliance_rule_list(text,integer),
  "pennsync_records".contract_medicare_guideline_list(text,integer,boolean),
  "pennsync_records".contract_physician_list(text,integer,text,boolean),
  "pennsync_records".contract_document_template_list(text,integer),
  "pennsync_records".contract_library_document_list(text,integer),
  "pennsync_records".contract_on_call_shift_list(text,integer,text,text),
  "pennsync_records".contract_visit_point_config_list(text,integer)
  to authenticated;

create function "public"."pennsync_contract_medicare_compliance_rule_list"(p_agency text, p_limit integer)
  returns jsonb language sql security invoker set search_path = '' as $w$
  select "pennsync_records".contract_medicare_compliance_rule_list(p_agency, p_limit) $w$;
create function "public"."pennsync_contract_medicare_guideline_list"(p_agency text, p_limit integer, p_active boolean)
  returns jsonb language sql security invoker set search_path = '' as $w$
  select "pennsync_records".contract_medicare_guideline_list(p_agency, p_limit, p_active) $w$;
create function "public"."pennsync_contract_physician_list"(p_agency text, p_limit integer, p_order text, p_active boolean)
  returns jsonb language sql security invoker set search_path = '' as $w$
  select "pennsync_records".contract_physician_list(p_agency, p_limit, p_order, p_active) $w$;
create function "public"."pennsync_contract_document_template_list"(p_agency text, p_limit integer)
  returns jsonb language sql security invoker set search_path = '' as $w$
  select "pennsync_records".contract_document_template_list(p_agency, p_limit) $w$;
create function "public"."pennsync_contract_library_document_list"(p_agency text, p_limit integer)
  returns jsonb language sql security invoker set search_path = '' as $w$
  select "pennsync_records".contract_library_document_list(p_agency, p_limit) $w$;
create function "public"."pennsync_contract_on_call_shift_list"(p_agency text, p_limit integer, p_from text, p_to text)
  returns jsonb language sql security invoker set search_path = '' as $w$
  select "pennsync_records".contract_on_call_shift_list(p_agency, p_limit, p_from, p_to) $w$;
create function "public"."pennsync_contract_visit_point_config_list"(p_agency text, p_limit integer)
  returns jsonb language sql security invoker set search_path = '' as $w$
  select "pennsync_records".contract_visit_point_config_list(p_agency, p_limit) $w$;

revoke all on function
  "public"."pennsync_contract_medicare_compliance_rule_list"(text,integer),
  "public"."pennsync_contract_medicare_guideline_list"(text,integer,boolean),
  "public"."pennsync_contract_physician_list"(text,integer,text,boolean),
  "public"."pennsync_contract_document_template_list"(text,integer),
  "public"."pennsync_contract_library_document_list"(text,integer),
  "public"."pennsync_contract_on_call_shift_list"(text,integer,text,text),
  "public"."pennsync_contract_visit_point_config_list"(text,integer)
  from public, anon, authenticated, service_role;

grant execute on function
  "public"."pennsync_contract_medicare_compliance_rule_list"(text,integer),
  "public"."pennsync_contract_medicare_guideline_list"(text,integer,boolean),
  "public"."pennsync_contract_physician_list"(text,integer,text,boolean),
  "public"."pennsync_contract_document_template_list"(text,integer),
  "public"."pennsync_contract_library_document_list"(text,integer),
  "public"."pennsync_contract_on_call_shift_list"(text,integer,text,text),
  "public"."pennsync_contract_visit_point_config_list"(text,integer)
  to authenticated;

commit;
