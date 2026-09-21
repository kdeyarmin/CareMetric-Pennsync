-- The PDF search's corpus: the rows a caller may read, bounded, in the two
-- shapes the original fetches them.
--
-- HAND WRITTEN, like every contract. The SPLIT is the thing to understand
-- before changing it, and it is D67's: **text arithmetic over caller-supplied
-- input belongs in the service; every decision about what may be READ belongs
-- here.** BM25 over a query somebody typed is the first half. Which rows enter
-- the corpus at all — and whether their extracted text travels with them — is
-- the second, and it is decided in SQL where the policies are.
--
-- WHAT THE ORIGINAL'S SCOPE SAYS ABOUT ITSELF. Its own comment is the finding:
--
--   "Unscoped searches cannot safely infer PDFIndex ownership from the mutable
--    patient_id relationship, so an ordinary caller is restricted to Base44's
--    immutable created_by field."
--
-- So a search with no patient returns only rows the caller CREATED, and a
-- search naming a patient proves access through `created_by`,
-- `assigned_nurses` or the `SUPER_ADMIN_EMAIL` owner — D41's derived scope, the
-- addresses D24's backfill refuses to read because they resurrect revoked
-- access, and the platform tier D14 and D22 removed. All of it exists because
-- `patient_id` could not be trusted to decide who may read a row.
--
-- It can be trusted here. `PDFIndex` is one of D61's twelve: it carries
-- `agency_id NOT NULL` now, and `pdf_index_read` is agency plus the chart
-- wherever a subject is named. So an unscoped search is every row in the
-- caller's agency whose chart they open, and a scoped one is that filtered to
-- a patient. Both directions of that change are D24's rather than this
-- contract's, and both are worth naming: a clinician gains their team's charts
-- and LOSES rows they created for a chart they have since been taken off,
-- which is exactly what a revocation should do and what `created_by` could
-- never express.
--
-- TWO BOUNDS ARE KEPT BECAUSE THEY ARE DISCLOSURE CONTROLS, not paging.
--
--  1. The count mode projects four columns and never `extracted_text` or
--     `page_contents`. The original says why: it is "a safe broker for the
--     browser badge", and its corpus is the extracted PHI of every document.
--     A count that carried the text would be a search nobody asked for.
--  2. The search mode fetches `limit * 2`, and the original's own comment
--     records what an unbounded one costs: a caller sending 500000 pulls the
--     entire index, with its PHI, into memory per request. The clamp to
--     1..200 lives in the service with the rest of the input arithmetic; the
--     ceiling is re-applied here, because a bound a caller could raise is not
--     a bound.
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

-- The document types the original allows, which are also the table's own CHECK
-- constraint. Named rather than read off the constraint, because a type added
-- to the column is not automatically a type this capability filters on.
create function "pennsync_records".pdf_search_document_type(p_type text)
  returns boolean language sql immutable set search_path = '' as $types$
  select p_type in ('consent', 'assessment', 'visit', 'care_plan', 'signature',
    'template', 'other')
$types$;

-- One corpus row, in the shape the BM25 scorer reads it. `...doc` in the
-- original spreads the WHOLE index row into each result, so the response
-- carries `metadata` and `pdf_url` besides.
--
-- `pdf_url` is the one column this contract will NOT project — it is a locator
-- into Base44's storage, which is what keeps `PDFIndex` out of the generic
-- family in the first place (D16).
--
-- `metadata` IS projected, and narrowed to one key. An earlier draft of this
-- header said both were "named here" while the projection named neither, and
-- `PDFSearchInterface.jsx` reads exactly `result.metadata?.page_count || 0` to
-- render "N pages" — so every indexed document rendered as `0 pages` under
-- this backend. D72's rule is what should have caught it: the code that
-- consumes a field set has already written it down, so read it rather than
-- guess. The whole `jsonb` blob is deliberately NOT swept in, because D64's
-- naming discipline applies to a response as much as to a prompt and nothing
-- constrains what else that column holds.
create function "pennsync_records".pdf_search_row(r "pennsync_records"."pdf_index")
  returns jsonb language sql immutable set search_path = '' as $row$
  select jsonb_build_object(
    'id', r."id",
    'document_name', r."document_name",
    'document_type', r."document_type",
    'patient_id', r."patient_id",
    'created_date', r."created_date",
    'extracted_text', r."extracted_text",
    'page_contents', r."page_contents",
    'keywords', r."keywords",
    -- Narrowed to the one key the consumer reads, and null-safe: a row whose
    -- `metadata` is absent answers `{}` rather than dropping the key, so the
    -- optional chain in the page finds an object either way.
    'metadata', jsonb_build_object(
      'page_count', coalesce(r."metadata", '{}'::jsonb) -> 'page_count'))
$row$;

create function "pennsync_records".contract_pdf_search_corpus(
  p_agency text, p_document_type text default null, p_patient_id text default null,
  p_limit integer default 100, p_count_only boolean default false)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_role text; v_rows jsonb; v_count integer; v_limit integer;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_PDF_SEARCH_AGENCY_NOT_HELD';
  end if;
  if p_document_type is not null
    and not "pennsync_records".pdf_search_document_type(p_document_type) then
    raise exception using errcode='22023', message='PENNSYNC_PDF_SEARCH_DOCUMENT_TYPE_INVALID';
  end if;
  if p_patient_id is not null
    and (p_patient_id = '' or pg_catalog.length(p_patient_id) > 200) then
    raise exception using errcode='22023', message='PENNSYNC_PDF_SEARCH_SUBJECT_INVALID';
  end if;

  -- A named patient is proved BEFORE the corpus is read, so a caller who names
  -- a chart they do not open is told so rather than handed an empty result —
  -- which the original also does, and which is the difference between "no
  -- documents" and "not yours".
  if p_patient_id is not null and not exists (
    select 1 from "pennsync_records"."patient" t
    where t."source_app_id" = "pennsync_records".deployment_app()
      and t."id" = p_patient_id and t."agency_id" = p_agency) then
    raise exception using errcode='42501', message='PENNSYNC_PDF_SEARCH_PATIENT_NOT_VISIBLE';
  end if;

  if coalesce(p_count_only, false) then
    -- One more than the cap, so truncation is a fact rather than a guess —
    -- the original's `countLimit + 1`.
    select pg_catalog.count(*) into v_count from (
      select 1 from "pennsync_records"."pdf_index" t
      where t."source_app_id" = "pennsync_records".deployment_app()
        and t."agency_id" = p_agency
        and (p_document_type is null or t."document_type" = p_document_type)
        and (p_patient_id is null or t."patient_id" = p_patient_id)
      limit 1001) counted;
    -- No row travels at all in this mode, so there is nothing to project and
    -- nothing to leak.
    return jsonb_build_object(
      'count_only', true,
      'accessible_index_count', least(v_count, 1000),
      'count_is_capped', v_count > 1000);
  end if;

  -- `limit * 2` is the original's, and the ceiling is re-applied because a
  -- bound a caller could raise is not a bound.
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 400);
  with page as (
    select t as entry, t."created_date" as created_date, t."id" as id
    from "pennsync_records"."pdf_index" t
    where t."source_app_id" = "pennsync_records".deployment_app()
      and t."agency_id" = p_agency
      and (p_document_type is null or t."document_type" = p_document_type)
      and (p_patient_id is null or t."patient_id" = p_patient_id)
    order by t."created_date" desc nulls last, t."id" desc
    limit v_limit
  )
  select coalesce(jsonb_agg("pennsync_records".pdf_search_row(page.entry)
      order by page.created_date desc nulls last, page.id desc), '[]'::jsonb)
  into v_rows from page;
  return jsonb_build_object('count_only', false, 'documents', v_rows);
end $contract$;

reset role;

revoke all on function
  "pennsync_records".pdf_search_document_type(text),
  "pennsync_records".pdf_search_row("pennsync_records"."pdf_index"),
  "pennsync_records".contract_pdf_search_corpus(text,text,text,integer,boolean)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_pdf_search_corpus(text,text,text,integer,boolean)
  to authenticated;

create function "public"."pennsync_contract_pdf_search_corpus"(
  p_agency text, p_document_type text default null, p_patient_id text default null,
  p_limit integer default 100, p_count_only boolean default false) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_pdf_search_corpus(
    p_agency, p_document_type, p_patient_id, p_limit, p_count_only)
$contract$;

revoke all on function
  "public"."pennsync_contract_pdf_search_corpus"(text,text,text,integer,boolean)
  from public, anon, service_role;
grant execute on function
  "public"."pennsync_contract_pdf_search_corpus"(text,text,text,integer,boolean)
  to authenticated;

commit;
