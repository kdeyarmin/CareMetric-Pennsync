-- The authorized patient read, as reviewed contracts.
--
-- HAND WRITTEN, like the contracts beside it and for the same reason: a
-- capability's authorization is its own. What it is NOT hand written from is
-- the purpose policies — sixteen field lists, sixteen role sets and eight page
-- bounds live in `20260920050000_patient_purpose_policy.sql`, extracted from
-- the originals rather than retyped. This file decides who may ask; that one
-- answers what a policy says. Neither knows the other's job.
--
-- Three contracts over two originals, because Base44 had two capabilities and
-- one of them had two modes:
--
-- - `contract_patient_list` is `listAuthorizedPatients` mode `page`.
-- - `contract_patient_batch` is its mode `ids`, and shares its purposes.
-- - `contract_patient_get` is `getAuthorizedPatient`, which has its OWN
--   purposes. A list is asked for `contact` or `roster`; one chart is opened
--   for `smart_note_context` or `oasis_analysis_context`. Merging the two
--   vocabularies would hand a list caller a purpose that exists to open a
--   single chart, so `patient_exact_purpose_known` and
--   `patient_list_purpose_known` are asked separately and neither answers for
--   the other.
--
-- The list original (`base44/functions/listAuthorizedPatients/entry.ts`) is
-- 1,404 lines, and most of them are work this store does not have to repeat. Base44
-- has no row-level security, so the function had to build the tenant query
-- itself, re-resolve the caller's membership four times around it, re-read
-- every care-team assignment after the rows were chosen, and compare two
-- independent passes to catch an authority change mid-request. Here the rows
-- a caller may see are decided by the policies on `pennsync_records.patient`
-- inside one statement in one snapshot: `caller_agencies()` for tenancy and
-- D24's `caller_opens_every_chart` / `caller_assigned_patients` for the chart.
-- There is no window between the check and the read to fence off.
--
-- So what is left for the contract is the part RLS does not know about:
--
-- - **Purpose.** The policies decide which ROWS. The purpose decides which
--   FIELDS and which roles may ask for them at all. A clinician may open a
--   chart they are assigned to; that does not mean they may pull the whole
--   agency's contact details under the `contact` purpose. Both checks apply.
-- - **Visibility.** Sample rows, archived rows and rows whose status is
--   `merged` or `archived` are not a roster anybody asked for. The original
--   filtered the first two in its query and rejected the rest per row.
-- - **The page.** Bounded by the purpose, ordered by id, and continued by a
--   keyset cursor that is refused rather than reinterpreted.
--
-- DIVERGENCES from the original, each a narrowing, each deliberate:
--
-- 1. `platform_owner` is admitted by every purpose there and by none here.
--    D14 and D22 removed the platform tier; `caller_tenant_role` cannot
--    answer it. Recorded in the policy migration, which refuses to render if
--    dropping it would close a purpose.
-- 2. **Creator provenance is not a basis.** The original grants a
--    non-agency-wide caller the union of their active care-team assignments
--    AND the patients they themselves created. D24 carries only the first
--    into RLS, deliberately: `pennsync_private.chart_assignment` is the
--    authority, and `patient_creator` is one of the sources the app already
--    records an assignment under, so the creator branch covers rows that
--    predate that. A clinician who created a patient and holds no assignment
--    to it sees it there and not here. The remedy is a backfill pass that
--    records those grants, not a second basis in this contract — a creator
--    predicate here would have to be repeated in fifty-six reference
--    policies to stay consistent, and D24 chose one place for it.
-- 3. **The continuation is an id, not a context echo.** The original's cursor
--    carries agency, purpose, status, page size, membership and role, and
--    refuses when any of them changed between pages. Here it carries the id
--    alone: agency, status and page size arrive as arguments and a changed
--    one is simply a different query, while the row the cursor names is
--    re-checked against the current filter and against what the caller may
--    still see — so a revoked assignment or a changed status ends the walk in
--    a refusal rather than silently. Purpose is the one context the original
--    refuses and this does not, and it decides fields, never rows: the caller
--    could have asked for page one under the new purpose and been given the
--    same rows, after the same role check.
-- 4. An explicitly null `status` is read as absent rather than refused (the
--    original's `String(null)` makes it the literal `'null'`, which fails its
--    enum). The rows are exactly those it answers when `status` is omitted.
-- 5. A row whose status is `merged` or `archived` is skipped; the original
--    fails the whole request on one. Both refuse to disclose it. Failing the
--    page as well means one merged duplicate makes an agency's roster
--    unreadable, which is a worse answer to the same question.
-- 6. The answer is `{patients, next}` rather than the original's
--    `{success, mode, purpose, patients, scope, page}`. This follows from 3:
--    `page.next_cursor` WAS the context echo, and `scope` existed to build it
--    — membership id, membership version, tenant role. None of that is an
--    authorization input here, so returning it would be publishing the
--    caller's own membership record as a side effect of reading a list.
--
-- Read only. There is no patient write here: `createAuthorizedPatient` and
-- `updateAuthorizedPatient` are their own capabilities with their own
-- authorization, and a write path is not something to acquire by being in the
-- area.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.patient_list_purpose_row(text,pennsync_records.patient)') is null
    or to_regprocedure('pennsync_records.patient_exact_purpose_row(text,pennsync_records.patient)') is null
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

-- Owned by the record owner, so `force row level security` binds it. That is
-- the whole security argument for this file: the contract adds the purpose and
-- the visibility filter, and the rows it can see at all are still whatever
-- `patient_read` admits for the caller. It never widens that and could not.
set local role "pennsync_records_owner";

-- The statuses a patient read may show, in one place because every statement
-- below asks for them. `merged` and `archived` are the two left out: a merged
-- duplicate and a bulk-archived record are history, not a roster, and the
-- original rejects a page containing either.
create function "pennsync_records".patient_listable_status(p_status text) returns boolean
  language sql immutable set search_path = '' as $visible$
  select p_status in ('active', 'hospitalized', 'discharged')
$visible$;

/*
 * The shared preamble: the caller's role in this agency, checked against the
 * purpose it was asked for.
 *
 * All three contracts start here, so the order of refusals is one decision
 * rather than three that have to stay in step. The order matters: not holding
 * the agency is answered before anything about the purpose, so a caller
 * cannot learn which purposes exist by asking about an agency that is not
 * theirs.
 *
 * `p_exact` picks the vocabulary. It is the one thing a contract passes in,
 * because which set of purposes applies is a property of the capability and
 * never of the request — a caller cannot ask for a single-chart purpose on a
 * list by naming one.
 *
 * The parentheses around each CASE are load-bearing rather than decorative:
 * plpgsql ends an IF condition at the first THEN outside parentheses, so a
 * bare CASE there truncates the expression and the function does not parse.
 */
create function "pennsync_records".patient_purpose_gate(
  p_agency text, p_purpose text, p_exact boolean)
  returns text language plpgsql stable security definer set search_path = '' as $gate$
declare v_role text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_PATIENT_AGENCY_NOT_HELD';
  end if;
  if not (case when p_exact
    then "pennsync_records".patient_exact_purpose_known(p_purpose)
    else "pennsync_records".patient_list_purpose_known(p_purpose) end) then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_PURPOSE_INVALID';
  end if;
  if not (case when p_exact
    then "pennsync_records".patient_exact_purpose_admits(p_purpose, v_role)
    else "pennsync_records".patient_list_purpose_admits(p_purpose, v_role) end) then
    raise exception using errcode='42501', message='PENNSYNC_PATIENT_FORBIDDEN';
  end if;
  return v_role;
end $gate$;

create function "pennsync_records".contract_patient_list(
  p_agency text, p_purpose text, p_status text default null,
  p_page_size integer default null, p_after text default null)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_max integer; v_rows jsonb; v_next text;
begin
  perform "pennsync_records".patient_purpose_gate(p_agency, p_purpose, false);
  v_max := "pennsync_records".patient_list_purpose_page_size(p_purpose);
  if p_status is not null and not "pennsync_records".patient_listable_status(p_status) then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_STATUS_INVALID';
  end if;
  -- Refused rather than clamped, as the original refuses it. A clamp answers
  -- a different question than the one asked and says nothing about having
  -- done so, which a caller paging through an agency would not notice.
  if p_page_size is null or p_page_size < 1 or p_page_size > v_max then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_PAGE_SIZE_INVALID';
  end if;
  if p_after is not null and p_after !~ '^[a-f0-9]{24}$' then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_CURSOR_INVALID';
  end if;
  -- A well-formed cursor naming a row this caller cannot now see is refused,
  -- and the cases that produce one are the point: an assignment revoked
  -- between two pages, a patient discharged out of the status being filtered,
  -- a record archived. The keyset then has nothing to compare against and the
  -- walk would end early — reporting an agency of three hundred as an agency
  -- of fifty. Starting over from the beginning instead would repeat every
  -- patient already seen. So neither: the caller is told to start again.
  if p_after is not null and not exists (
    select 1 from "pennsync_records"."patient" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."agency_id" = p_agency and p."id" = p_after
      and p."is_sample" = false and p."is_archived" = false
      and "pennsync_records".patient_listable_status(p."status")
      and (p_status is null or p."status" = p_status)) then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_CURSOR_UNKNOWN';
  end if;

  -- One row more than asked for, so "is there another page" is answered by
  -- having looked rather than by guessing from a full page. The extra row is
  -- never projected.
  with page as (
    select p."id" as id, "pennsync_records".patient_list_purpose_row(p_purpose, p) as entry
    from "pennsync_records"."patient" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."agency_id" = p_agency
      and p."is_sample" = false and p."is_archived" = false
      and "pennsync_records".patient_listable_status(p."status")
      and (p_status is null or p."status" = p_status)
      and (p_after is null or p."id" > p_after)
    order by p."id"
    limit p_page_size + 1
  ), shown as (
    select page.id, page.entry from page order by page.id limit p_page_size
  )
  select coalesce(jsonb_agg(shown.entry order by shown.id), '[]'::jsonb),
    case when (select count(*) from page) > p_page_size then max(shown.id) end
  into v_rows, v_next from shown;

  return jsonb_build_object('patients', v_rows, 'next', v_next);
end $contract$;

/*
 * The id batch. The original's second mode, and the one every caller that
 * already holds patient ids uses — a visit list resolving its subjects, a
 * duplicate review resolving a candidate pair.
 *
 * An id the caller may not see is skipped, not refused, and that is the same
 * choice the original makes for the same reason: refusing would tell the
 * caller that the id names a real patient somewhere. Absent and not-yours
 * answer identically.
 */
create function "pennsync_records".contract_patient_batch(
  p_agency text, p_purpose text, p_patient_ids text[])
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_rows jsonb;
begin
  perform "pennsync_records".patient_purpose_gate(p_agency, p_purpose, false);
  -- Twenty-five is the original's `MAX_BATCH_IDS`. A batch is a convenience
  -- for a caller that already holds ids, not a way to page the agency, so an
  -- oversized one is refused rather than truncated — a truncated batch looks
  -- to the caller exactly like ids they were not allowed to see.
  if p_patient_ids is null or array_length(p_patient_ids, 1) is null
    or array_length(p_patient_ids, 1) > 25
    or array_ndims(p_patient_ids) <> 1
    or exists (select 1 from unnest(p_patient_ids) as id where id is null or id !~ '^[a-f0-9]{24}$')
    or (select count(distinct id) from unnest(p_patient_ids) as id) <> array_length(p_patient_ids, 1)
  then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_SUBJECT_INVALID';
  end if;

  -- Answered in the order asked, because a caller resolving a list of ids is
  -- lining the answers up against it. `with ordinality` carries that order
  -- through the join rather than relying on the array's shape surviving it.
  select coalesce(jsonb_agg("pennsync_records".patient_list_purpose_row(p_purpose, p)
      order by asked.position), '[]'::jsonb)
  into v_rows
  from unnest(p_patient_ids) with ordinality as asked(id, position)
  join "pennsync_records"."patient" p
    on p."source_app_id" = "pennsync_records".deployment_app()
   and p."id" = asked.id
   and p."agency_id" = p_agency
   and p."is_sample" = false and p."is_archived" = false
   and "pennsync_records".patient_listable_status(p."status");

  return jsonb_build_object('patients', v_rows);
end $contract$;

/*
 * One chart, under the single-read vocabulary.
 *
 * `getAuthorizedPatient` in the original, and the capability every chart page
 * in the app actually calls. Its purposes are its own — `smart_note_context`
 * carries the clinical notes and the medication list, `display` carries a
 * name — and they are checked against `patient_exact_purpose_*`, never the
 * list's.
 *
 * Null, not a refusal, when the chart is not there or not this caller's. The
 * original answers 404 for both cases in the same words, and for the same
 * reason: a refusal that distinguished them would confirm that an id names a
 * real patient in an agency the caller cannot see.
 */
create function "pennsync_records".contract_patient_get(
  p_agency text, p_purpose text, p_patient_id text)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_row jsonb;
begin
  perform "pennsync_records".patient_purpose_gate(p_agency, p_purpose, true);
  if p_patient_id is null or p_patient_id !~ '^[a-f0-9]{24}$' then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_SUBJECT_INVALID';
  end if;
  select "pennsync_records".patient_exact_purpose_row(p_purpose, p) into v_row
  from "pennsync_records"."patient" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."id" = p_patient_id
    and p."agency_id" = p_agency
    and p."is_sample" = false and p."is_archived" = false
    and "pennsync_records".patient_listable_status(p."status");
  return v_row;
end $contract$;

reset role;

-- The policy functions and the gate are the contract's own business; no caller
-- role may reach them, and the two contracts are the only way in.
revoke all on function "pennsync_records".patient_listable_status(text),
  "pennsync_records".patient_purpose_gate(text,text,boolean),
  "pennsync_records".contract_patient_list(text,text,text,integer,text),
  "pennsync_records".contract_patient_batch(text,text,text[]),
  "pennsync_records".contract_patient_get(text,text,text)
  from public, anon, authenticated, service_role;

grant execute on function "pennsync_records".contract_patient_list(text,text,text,integer,text),
  "pennsync_records".contract_patient_batch(text,text,text[]),
  "pennsync_records".contract_patient_get(text,text,text) to authenticated;

create function "public"."pennsync_contract_patient_list"(
  p_agency text, p_purpose text, p_status text default null,
  p_page_size integer default null, p_after text default null) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_patient_list(p_agency, p_purpose, p_status, p_page_size, p_after)
$contract$;

create function "public"."pennsync_contract_patient_batch"(
  p_agency text, p_purpose text, p_patient_ids text[]) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_patient_batch(p_agency, p_purpose, p_patient_ids)
$contract$;

create function "public"."pennsync_contract_patient_get"(
  p_agency text, p_purpose text, p_patient_id text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_patient_get(p_agency, p_purpose, p_patient_id)
$contract$;

revoke all on function "public"."pennsync_contract_patient_list"(text,text,text,integer,text),
  "public"."pennsync_contract_patient_batch"(text,text,text[]),
  "public"."pennsync_contract_patient_get"(text,text,text)
  from public, anon, authenticated, service_role;

grant execute on function "public"."pennsync_contract_patient_list"(text,text,text,integer,text),
  "public"."pennsync_contract_patient_batch"(text,text,text[]),
  "public"."pennsync_contract_patient_get"(text,text,text) to authenticated;

commit;
