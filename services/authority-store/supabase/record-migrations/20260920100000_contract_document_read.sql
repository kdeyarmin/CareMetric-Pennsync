-- The authorized document read, as reviewed contracts.
--
-- HAND WRITTEN, like the contracts beside it. The purpose policies it consults
-- are extracted into `20260920090000_document_purpose_policy.sql`, which
-- carries no authorization at all.
--
-- Two things make this family different from the patient and visit ones, and
-- both are the reason it is worth reading rather than skimming.
--
-- **The binding is the tenancy, and the store now knows it.** A `document` row
-- has no `agency_id`. D27 gave `Document` a `binding` tenant path, so
-- `document_read` asks `document_tenant_binding` — which agency, which patient
-- — instead of following `document.patient_id` to a chart. Before that, a
-- document bound to an agency and no patient, which is what a referral
-- document is before an intake becomes a patient, belonged to nobody and was
-- invisible to everyone including an agency administrator. D24's narrowing
-- travels on the binding, so an `agency_admin` or `manager` sees every binding
-- in the agency and a clinician sees the bindings of their assigned patients.
-- These contracts read FROM the binding for the same reason the policy does,
-- and because that is what both originals do: they scan bindings and validate
-- the document pair.
--
-- **No projection carries a file locator, and none may.** `document.file_url`
-- and `document_tenant_binding.file_uri` are the two columns that could hand a
-- caller a URL into storage, and neither appears in any of the six purposes —
-- not even `download`, which returns `file_name`, `file_size` and `file_type`
-- and nothing to fetch with. The original goes further and REFUSES a document
-- whose `file_url` is not null, which is how it enforces that the locator has
-- already been moved out of the row; that refusal is carried here as a
-- predicate. This is why the document read is portable BEFORE the file layer
-- rather than after it: the capability never needed the locator.
--
-- Two capabilities, two contracts:
--
-- - `contract_document_list` is `listAuthorizedDocuments`. Bounded at ten, not
--   by purpose: the original declares one page size for both of its purposes,
--   outside the fenced policy, so it is stated here rather than generated.
-- - `contract_document_get` is `getAuthorizedDocument`.
--
-- DIVERGENCES from the originals, each a narrowing, each deliberate:
--
-- 1. `platform_owner` is admitted by every purpose there and by none here;
--    D14 and D22 removed the platform tier.
-- 2. Creator provenance is not a basis, as for patients and visits: D24
--    carries only the care team into RLS.
-- 3. The continuation is a document id re-checked against the current filter
--    and against what the caller may still see, not a context echo.
-- 4. The answer is `{documents, next}` rather than the original's envelope
--    with `scope`, which existed to build that echo and would otherwise
--    publish the caller's own membership record as a side effect.
-- 5. A document whose `file_url` is still set is skipped; the original fails
--    the whole request on one. Both refuse to disclose it, and skipping means
--    one un-migrated document does not make an agency's library unreadable.
-- 6. A document with no binding at all is disclosed by neither. It is in no
--    tenant, which is the same answer the originals give: every document they
--    serve is joined to a binding.
--
-- Read only.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.document_list_purpose_row(text,pennsync_records.document)') is null
    or to_regprocedure('pennsync_records.document_exact_purpose_row(text,pennsync_records.document)') is null
    or to_regclass('pennsync_records.document_tenant_binding') is null then
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
 * The document family's gate. Same shape as its neighbours, and the same
 * reason for `p_exact`: the two capabilities declare their own purposes, and
 * which vocabulary applies is a property of the capability rather than of the
 * request.
 *
 * The parentheses around each CASE are load-bearing: plpgsql ends an IF
 * condition at the first THEN outside parentheses.
 */
create function "pennsync_records".document_purpose_gate(
  p_agency text, p_purpose text, p_exact boolean)
  returns text language plpgsql stable security definer set search_path = '' as $gate$
declare v_role text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_DOCUMENT_AGENCY_NOT_HELD';
  end if;
  if not (case when p_exact
    then "pennsync_records".document_exact_purpose_known(p_purpose)
    else "pennsync_records".document_list_purpose_known(p_purpose) end) then
    raise exception using errcode='22023', message='PENNSYNC_DOCUMENT_PURPOSE_INVALID';
  end if;
  if not (case when p_exact
    then "pennsync_records".document_exact_purpose_admits(p_purpose, v_role)
    else "pennsync_records".document_list_purpose_admits(p_purpose, v_role) end) then
    raise exception using errcode='42501', message='PENNSYNC_DOCUMENT_FORBIDDEN';
  end if;
  return v_role;
end $gate$;

create function "pennsync_records".contract_document_list(
  p_agency text, p_purpose text, p_patient_id text default null,
  p_binding_purpose text default null, p_page_size integer default null, p_after text default null)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_rows jsonb; v_next text;
begin
  perform "pennsync_records".document_purpose_gate(p_agency, p_purpose, false);
  -- A caller who does not open every chart must name one patient. RLS already
  -- restricts them to their own patients' bindings, so this is stricter than
  -- confidentiality needs — and it is the original's rule, kept because what
  -- it protects is different: an unscoped list tells a clinician how many
  -- documents their whole caseload holds, which is a volume signal the
  -- capability was never meant to give.
  if p_patient_id is null and not "pennsync_records".caller_opens_every_chart(p_agency) then
    raise exception using errcode='42501', message='PENNSYNC_DOCUMENT_SUBJECT_REQUIRED';
  end if;
  if p_patient_id is not null and p_patient_id !~ '^[a-f0-9]{24}$' then
    raise exception using errcode='22023', message='PENNSYNC_DOCUMENT_SUBJECT_INVALID';
  end if;
  -- What a document is attached to. The original's two, written out because a
  -- contract may not ask for a binding purpose the column cannot hold.
  if p_binding_purpose is not null and p_binding_purpose not in ('patient_document', 'referral') then
    raise exception using errcode='22023', message='PENNSYNC_DOCUMENT_BINDING_INVALID';
  end if;
  -- Ten, and refused rather than clamped. The original declares one page size
  -- for both purposes, outside the fenced policy, so there is nothing to
  -- generate and this is where it is stated.
  if p_page_size is null or p_page_size < 1 or p_page_size > 10 then
    raise exception using errcode='22023', message='PENNSYNC_DOCUMENT_PAGE_SIZE_INVALID';
  end if;
  if p_after is not null and p_after !~ '^[a-f0-9]{24}$' then
    raise exception using errcode='22023', message='PENNSYNC_DOCUMENT_CURSOR_INVALID';
  end if;
  -- A well-formed cursor naming a row this caller cannot now see is refused:
  -- the keyset would otherwise have nothing to compare against and the walk
  -- would end early, reporting a library of three hundred as one of fifty.
  if p_after is not null and not exists (
    select 1 from "pennsync_records"."document_tenant_binding" b
    join "pennsync_records"."document" d
      on d."source_app_id" = b."source_app_id" and d."id" = b."document_id"
    where b."source_app_id" = "pennsync_records".deployment_app()
      and b."agency_id" = p_agency and b."document_id" = p_after
      and d."file_url" is null
      and (p_patient_id is null or b."patient_id" = p_patient_id)
      and (p_binding_purpose is null or b."purpose" = p_binding_purpose)) then
    raise exception using errcode='22023', message='PENNSYNC_DOCUMENT_CURSOR_UNKNOWN';
  end if;

  -- One row more than asked for, so "is there another page" is answered by
  -- having looked. The extra row is never projected.
  with page as (
    select b."document_id" as id, "pennsync_records".document_list_purpose_row(p_purpose, d) as entry
    from "pennsync_records"."document_tenant_binding" b
    join "pennsync_records"."document" d
      on d."source_app_id" = b."source_app_id" and d."id" = b."document_id"
    where b."source_app_id" = "pennsync_records".deployment_app()
      and b."agency_id" = p_agency
      -- The locator must already be out of the row. A document that still
      -- carries one is not disclosed, by either capability.
      and d."file_url" is null
      and (p_patient_id is null or b."patient_id" = p_patient_id)
      and (p_binding_purpose is null or b."purpose" = p_binding_purpose)
      and (p_after is null or b."document_id" > p_after)
    order by b."document_id"
    limit p_page_size + 1
  ), shown as (
    select page.id, page.entry from page order by page.id limit p_page_size
  )
  select coalesce(jsonb_agg(shown.entry order by shown.id), '[]'::jsonb),
    case when (select count(*) from page) > p_page_size then max(shown.id) end
  into v_rows, v_next from shown;

  return jsonb_build_object('documents', v_rows, 'next', v_next);
end $contract$;

/*
 * One document, under the single-read vocabulary. Null, not a refusal, when
 * it is not there or not this caller's — the original answers 404 to both in
 * the same words so an id cannot be tested for existence.
 *
 * It reads from the binding too, and for the same reason the list does: the
 * document row does not know which agency it belongs to.
 */
create function "pennsync_records".contract_document_get(
  p_agency text, p_purpose text, p_document_id text)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_row jsonb;
begin
  perform "pennsync_records".document_purpose_gate(p_agency, p_purpose, true);
  if p_document_id is null or p_document_id !~ '^[a-f0-9]{24}$' then
    raise exception using errcode='22023', message='PENNSYNC_DOCUMENT_SUBJECT_INVALID';
  end if;
  select "pennsync_records".document_exact_purpose_row(p_purpose, d) into v_row
  from "pennsync_records"."document_tenant_binding" b
  join "pennsync_records"."document" d
    on d."source_app_id" = b."source_app_id" and d."id" = b."document_id"
  where b."source_app_id" = "pennsync_records".deployment_app()
    and b."agency_id" = p_agency
    and b."document_id" = p_document_id
    and d."file_url" is null;
  return v_row;
end $contract$;

reset role;

revoke all on function "pennsync_records".document_purpose_gate(text,text,boolean),
  "pennsync_records".contract_document_list(text,text,text,text,integer,text),
  "pennsync_records".contract_document_get(text,text,text)
  from public, anon, authenticated, service_role;

grant execute on function "pennsync_records".contract_document_list(text,text,text,text,integer,text),
  "pennsync_records".contract_document_get(text,text,text) to authenticated;

create function "public"."pennsync_contract_document_list"(
  p_agency text, p_purpose text, p_patient_id text default null,
  p_binding_purpose text default null, p_page_size integer default null,
  p_after text default null) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_document_list(
    p_agency, p_purpose, p_patient_id, p_binding_purpose, p_page_size, p_after)
$contract$;

create function "public"."pennsync_contract_document_get"(
  p_agency text, p_purpose text, p_document_id text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_document_get(p_agency, p_purpose, p_document_id)
$contract$;

revoke all on function "public"."pennsync_contract_document_list"(text,text,text,text,integer,text),
  "public"."pennsync_contract_document_get"(text,text,text)
  from public, anon, authenticated, service_role;

grant execute on function "public"."pennsync_contract_document_list"(text,text,text,text,integer,text),
  "public"."pennsync_contract_document_get"(text,text,text) to authenticated;

commit;
