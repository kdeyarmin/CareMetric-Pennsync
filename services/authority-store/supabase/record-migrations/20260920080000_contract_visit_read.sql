-- The authorized visit read, as reviewed contracts.
--
-- HAND WRITTEN, like the contracts beside it and for the same reason: a
-- capability's authorization is its own. The purpose policies it consults —
-- sixteen field lists across two capabilities — are extracted from the
-- originals into `20260920070000_visit_purpose_policy.sql`, which carries no
-- authorization at all.
--
-- The same shape as `20260920060000_contract_patient_read.sql`, and
-- deliberately so: which ROWS is the policies' answer, which FIELDS and to
-- whom is the purpose's. What is different is where the chart narrowing comes
-- from. `visit` carries its own `agency_id` AND a `patient_id`, so D24 wrote
-- the narrowing onto the table directly: an `agency_admin` or `manager` opens
-- every visit in the agency, a clinician opens the visits of the patients they
-- are assigned to, and a visit whose `patient_id` is null stays agency-scoped
-- because a visit with no subject is not yet anybody's chart.
--
-- Two capabilities, two contracts:
--
-- - `contract_visit_list` is `listAuthorizedVisits`. One mode, not two: the
--   original has no id batch here, and inventing one would be a capability
--   nobody asked for. It takes an optional `patient_id` filter, which is what
--   a chart's visit history is.
-- - `contract_visit_get` is `getAuthorizedVisit`.
--
-- The two share three purpose NAMES — `schedule`, `documentation` and
-- `compliance_review` — and the projections behind them are not the same. One
-- visit under `compliance_review` discloses fourteen fields; a row of a list
-- discloses eight. That is the reason both exist, and it is why each contract
-- asks its own `_known` and `_row` rather than a shared one: letting either
-- answer for the other would widen a list by six fields per row under a name
-- that already works.
--
-- DIVERGENCES from the originals, each a narrowing, each deliberate:
--
-- 1. `platform_owner` is admitted by every purpose there and by none here.
--    D14 and D22 removed the platform tier. Recorded in the policy migration,
--    which refuses to render if dropping it would close a purpose.
-- 2. **Creator provenance is not a basis**, as for patients: the original
--    grants a non-agency-wide caller their active care-team assignments and
--    the patients they created; D24 carries only the first into RLS. The
--    remedy is a backfill pass, not a second predicate here.
-- 3. **The continuation is an id, not a context echo.** The original's cursor
--    carries agency, patient, purpose, status, page size, membership and role
--    and refuses when any changed. Here those arrive as arguments and the row
--    the cursor names is re-checked against the current filter and against
--    what the caller may still see, so a revoked assignment ends the walk in a
--    refusal rather than silently.
-- 4. The answer is `{visits, next}` rather than the original's envelope with
--    `scope` and `page.next_cursor`. `scope` existed to build the cursor echo
--    — membership id, membership version, tenant role — and none of it is an
--    authorization input here, so returning it would publish the caller's own
--    membership record as a side effect of reading a list.
--
-- Read only. A visit write is its own capability with its own authorization.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.visit_list_purpose_row(text,pennsync_records.visit)') is null
    or to_regprocedure('pennsync_records.visit_exact_purpose_row(text,pennsync_records.visit)') is null
    or to_regprocedure('pennsync_records.patient_purpose_gate(text,text,boolean)') is null then
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
 * The visit's own gate, the same shape as the patient one and separate from
 * it because the vocabularies are separate. `p_exact` picks which of the two
 * visit policies applies; it is passed by the contract and never by a caller,
 * so naming a single-visit purpose on a list cannot reach the wider
 * projection behind it.
 *
 * The parentheses around each CASE are load-bearing: plpgsql ends an IF
 * condition at the first THEN outside parentheses.
 */
create function "pennsync_records".visit_purpose_gate(
  p_agency text, p_purpose text, p_exact boolean)
  returns text language plpgsql stable security definer set search_path = '' as $gate$
declare v_role text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_VISIT_AGENCY_NOT_HELD';
  end if;
  if not (case when p_exact
    then "pennsync_records".visit_exact_purpose_known(p_purpose)
    else "pennsync_records".visit_list_purpose_known(p_purpose) end) then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_PURPOSE_INVALID';
  end if;
  if not (case when p_exact
    then "pennsync_records".visit_exact_purpose_admits(p_purpose, v_role)
    else "pennsync_records".visit_list_purpose_admits(p_purpose, v_role) end) then
    raise exception using errcode='42501', message='PENNSYNC_VISIT_FORBIDDEN';
  end if;
  return v_role;
end $gate$;

create function "pennsync_records".contract_visit_list(
  p_agency text, p_purpose text, p_patient_id text default null, p_status text default null,
  p_page_size integer default null, p_after text default null)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_max integer; v_rows jsonb; v_next text;
begin
  perform "pennsync_records".visit_purpose_gate(p_agency, p_purpose, false);
  v_max := "pennsync_records".visit_list_purpose_page_size(p_purpose);
  -- The status vocabulary is the table's own check constraint, written out
  -- because a contract may not ask for a status the column cannot hold.
  if p_status is not null and p_status not in
    ('scheduled', 'in_progress', 'completed', 'pending_review', 'cancelled') then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_STATUS_INVALID';
  end if;
  if p_patient_id is not null and p_patient_id !~ '^[a-f0-9]{24}$' then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_SUBJECT_INVALID';
  end if;
  -- Refused rather than clamped, as the original refuses it.
  if p_page_size is null or p_page_size < 1 or p_page_size > v_max then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_PAGE_SIZE_INVALID';
  end if;
  if p_after is not null and p_after !~ '^[a-f0-9]{24}$' then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_CURSOR_INVALID';
  end if;
  -- A well-formed cursor naming a row this caller cannot now see is refused.
  -- The keyset would otherwise have nothing to compare against and the walk
  -- would end early, reporting a month of visits as a week.
  if p_after is not null and not exists (
    select 1 from "pennsync_records"."visit" v
    where v."source_app_id" = "pennsync_records".deployment_app()
      and v."agency_id" = p_agency and v."id" = p_after
      and v."is_sample" = false
      and (p_patient_id is null or v."patient_id" = p_patient_id)
      and (p_status is null or v."status" = p_status)) then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_CURSOR_UNKNOWN';
  end if;

  -- One row more than asked for, so "is there another page" is answered by
  -- having looked. The extra row is never projected.
  with page as (
    select v."id" as id, "pennsync_records".visit_list_purpose_row(p_purpose, v) as entry
    from "pennsync_records"."visit" v
    where v."source_app_id" = "pennsync_records".deployment_app()
      and v."agency_id" = p_agency
      and v."is_sample" = false
      and (p_patient_id is null or v."patient_id" = p_patient_id)
      and (p_status is null or v."status" = p_status)
      and (p_after is null or v."id" > p_after)
    order by v."id"
    limit p_page_size + 1
  ), shown as (
    select page.id, page.entry from page order by page.id limit p_page_size
  )
  select coalesce(jsonb_agg(shown.entry order by shown.id), '[]'::jsonb),
    case when (select count(*) from page) > p_page_size then max(shown.id) end
  into v_rows, v_next from shown;

  return jsonb_build_object('visits', v_rows, 'next', v_next);
end $contract$;

/*
 * One visit, under the single-read vocabulary.
 *
 * Null, not a refusal, when the visit is not there or not this caller's. The
 * original answers 404 for both in the same words, so that an id cannot be
 * tested for existence, and so does this.
 */
create function "pennsync_records".contract_visit_get(
  p_agency text, p_purpose text, p_visit_id text)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_row jsonb;
begin
  perform "pennsync_records".visit_purpose_gate(p_agency, p_purpose, true);
  if p_visit_id is null or p_visit_id !~ '^[a-f0-9]{24}$' then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_SUBJECT_INVALID';
  end if;
  select "pennsync_records".visit_exact_purpose_row(p_purpose, v) into v_row
  from "pennsync_records"."visit" v
  where v."source_app_id" = "pennsync_records".deployment_app()
    and v."id" = p_visit_id
    and v."agency_id" = p_agency
    and v."is_sample" = false;
  return v_row;
end $contract$;

reset role;

-- The gate is the contracts' own business; no caller role may reach it.
revoke all on function "pennsync_records".visit_purpose_gate(text,text,boolean),
  "pennsync_records".contract_visit_list(text,text,text,text,integer,text),
  "pennsync_records".contract_visit_get(text,text,text)
  from public, anon, authenticated, service_role;

grant execute on function "pennsync_records".contract_visit_list(text,text,text,text,integer,text),
  "pennsync_records".contract_visit_get(text,text,text) to authenticated;

create function "public"."pennsync_contract_visit_list"(
  p_agency text, p_purpose text, p_patient_id text default null, p_status text default null,
  p_page_size integer default null, p_after text default null) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_visit_list(
    p_agency, p_purpose, p_patient_id, p_status, p_page_size, p_after)
$contract$;

create function "public"."pennsync_contract_visit_get"(
  p_agency text, p_purpose text, p_visit_id text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_visit_get(p_agency, p_purpose, p_visit_id)
$contract$;

revoke all on function "public"."pennsync_contract_visit_list"(text,text,text,text,integer,text),
  "public"."pennsync_contract_visit_get"(text,text,text)
  from public, anon, authenticated, service_role;

grant execute on function "public"."pennsync_contract_visit_list"(text,text,text,text,integer,text),
  "public"."pennsync_contract_visit_get"(text,text,text) to authenticated;

commit;
