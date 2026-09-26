-- Hide a chart that is not this agency's, rather than only refusing one being
-- created.
--
-- D24 narrows a chart to its care team WITHIN an agency, and the question it
-- asks — `caller_opens_every_chart(agency)` or the id in
-- `caller_assigned_patients(agency)` — never asks which agency the chart is
-- in. Every policy over an entity with an `agency_id` and a top-level
-- `patient_id` asks exactly that pair. So a row tenanted to agency A may name
-- agency B's chart, and an administrator of A reads it: the policy admits the
-- row on A's tenancy and opens every chart in A, and B's patient is nobody's
-- business of theirs.
--
-- `20260920580000_contract_operational_tables.sql` closed the WRITE half with
-- `operational_chart`, and its header says in as many words what it does not
-- do: "it stops a crossed row being CREATED and does not hide one that already
-- exists". A row carried in from Base44, or written before that contract
-- shipped, is still there. This is the read half.
--
-- WHY IT TAKES A HELPER IN `pennsync_private`, AND NOT A JOIN.
--
-- The obvious form is to join `patient` and require `p."agency_id" = p_agency`.
-- It hides the crossed row and it also hides a row whose chart is NOT IN THIS
-- STORE AT ALL, because inside a definer owned by `pennsync_records_owner` —
-- deliberately `rolbypassrls = false` — an absent chart and a chart the caller
-- may not see are the same empty result. That is the same shape as the write
-- guard's first draft, which was written as `not exists (a row proving this
-- chart is elsewhere)` and was a no-op for exactly the caller it was meant to
-- protect. A control that cannot tell ABSENT from HIDDEN cannot make this
-- decision at all, and losing a row from its own agency for a reason nobody
-- can see is D61's failure mode.
--
-- `pennsync_private.chart_agency` is created here by the migration
-- ADMINISTRATOR, before this file assumes the record owner's role, which is
-- what the record store's own helpers do and why (`record_store.sql:80`: "The
-- helpers stay administrator-owned"). Owned by a role that bypasses row-level
-- security, it answers WHICH AGENCY A CHART IS IN for any chart, and `null`
-- when there is no such chart. It never answers whether the caller may see it:
-- a helper asking the second question would inherit `patient_read` and narrow
-- silently, which is the no-op again.
--
-- Measured rather than reasoned: with every record migration applied, it
-- returns the other agency's id for a chart an agency-A administrator cannot
-- see, and null for an id that does not exist.
--
-- If the administrator did NOT bypass row-level security the helper would
-- answer null for everything and the term below would keep every row — a
-- guard that reads correctly and does nothing. The `do $$` block refuses to
-- apply in that case. The real instrument is still the test: the crossed-chart
-- case fails outright if the helper cannot see past the policies.
--
-- THE TERM, AND ITS THREE BRANCHES.
--
-- `chart_not_elsewhere(patient_id, agency)` keeps a row unless the chart is
-- DEMONSTRABLY in another agency. Each branch is a decision, not a fallback:
--
--   * `patient_id` is null — the row names no chart and is agency-scoped.
--     Keep it. The reading D24 takes of a referral taken before a patient
--     exists: not yet anybody's chart.
--   * the helper answers null — the chart is not carried into this store. The
--     row is not proved crossed, only unresolvable. Keep it, and say so here
--     rather than leave a reader to infer it from a `coalesce`.
--   * the helper answers another agency — hide.
--
-- A FILTER on the reads, not a refusal: a read that refused on one bad row
-- would take the whole page down, and the caller was never entitled to that
-- row. The WRITES keep `operational_chart`'s refusal, because a create naming
-- a foreign chart is the caller's own mistake and should be told.
--
-- SCOPE. The four reads this file replaces are the crossable ones batch D
-- owns. `contract_care_plan_list` is not among them and needs nothing:
-- `care_plan` has no `agency_id`, so its tenancy IS the chart and the contract
-- already joins `patient` for it. About twenty further contracts over other
-- entities have the same shape and are NOT touched here — `visit` alone is
-- read by thirteen of them. Each is merged, so under D88 each adoption is its
-- own forward `create or replace` that must also join its suite's apply list;
-- they are named as deferred in the pull request rather than swept in behind
-- this one.
--
-- The four bodies below are the merged file's, with one line added to each and
-- `create` made `create or replace`. They were derived from that file rather
-- than retyped, and `contract-chart-agency.test.mjs` re-derives them and fails
-- if the two ever differ by anything but the term. `create or replace`
-- preserves the ownership and the grants, so nothing is re-granted here and
-- the public wrappers are untouched.
--
-- Refusals added: none. This file removes rows from a page and raises nothing
-- a caller can see.

begin;

do $$
begin
  if to_regprocedure(
      'pennsync_records.contract_task_list(text,text,text,text,text,text,integer)') is null
    or to_regclass('pennsync_records.patient') is null then
    raise exception using errcode='42501',
      message='PENNSYNC_OPERATIONAL_CAPABILITIES_REQUIRED';
  end if;
end $$;

-- Whoever applies this owns the helper below, and the helper is useless unless
-- that role reads past row-level security. Asked of the catalog rather than
-- discovered by trying, because the alternative failure is silent: a helper
-- answering null for every chart keeps every row, and the term would read as
-- though it were working. The test is still the real instrument — the
-- crossed-chart case fails outright if the helper cannot see past a policy.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',
      message='PENNSYNC_CHART_AGENCY_ADMIN_MUST_BYPASS_RLS';
  end if;
end $$;

/*
 * Which agency a chart is in — for ANY chart, and never whether the caller may
 * see it.
 *
 * SECURITY DEFINER and owned by the migration administrator, which is the
 * whole mechanism: `pennsync_records.patient` carries forced row-level
 * security and `pennsync_records_owner` does not bypass it, so a definer owned
 * by the record owner would see exactly what the caller sees and answer
 * nothing useful.
 *
 * No public wrapper, and granted to the record owner alone: the
 * `claim_new_chart` shape. A caller able to ask this directly could test any
 * chart id for existence across every tenant.
 */
create function pennsync_private.chart_agency(p_patient_id text) returns text
  language sql stable security definer set search_path = '' as $chart$
  select p."agency_id" from "pennsync_records"."patient" p
  where p."source_app_id" = pennsync_private.deployment_app_id()
    and p."id" = p_patient_id
$chart$;

revoke all on function pennsync_private.chart_agency(text)
  from public, anon, authenticated, service_role;

-- `20260920110000_claim_new_chart.sql` already grants this usage and the
-- ordering guarantees it has run, but the grant is repeated here rather than
-- depended on: usage on a schema confers nothing on its objects, and a file
-- whose only cross-schema need is one function should say so itself instead of
-- inheriting it from an unrelated bridge.
grant usage on schema pennsync_private to "pennsync_records_owner";
grant execute on function pennsync_private.chart_agency(text)
  to "pennsync_records_owner";

set local role "pennsync_records_owner";

-- Keep a row unless its chart is DEMONSTRABLY in another agency. The three
-- branches are the header's, and the second one is why this is not a join.
create function "pennsync_records".chart_not_elsewhere(
    p_patient_id text, p_agency text) returns boolean
  language sql stable set search_path = '' as $chart$
  select p_patient_id is null
    or pennsync_private.chart_agency(p_patient_id) is null
    or pennsync_private.chart_agency(p_patient_id) = p_agency
$chart$;

create or replace function "pennsync_records".contract_task_list(
    p_agency text, p_patient_id text, p_related_entity text,
    p_related_entity_id text, p_exclude_status text, p_order text, p_limit integer)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_rows jsonb; v_limit integer;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_TASK_AGENCY_NOT_HELD';
  end if;
  if p_order is null or p_order not in ('created_date', 'due_date') then
    raise exception using errcode='22023', message='PENNSYNC_TASK_ORDER_INVALID';
  end if;
  v_limit := "pennsync_records".operational_limit(p_limit, 'PENNSYNC_TASK');

  -- No gate beyond membership, and that is the port. The original's three
  -- alternatives — `created_by`, `data.assigned_to`, the platform tier — are
  -- D41's derived scope, and `task_read` already narrows the agency's tasks to
  -- the caller's charts. A task naming no chart stays agency-wide, which is
  -- what an unassigned operational to-do is.
  select coalesce(jsonb_agg("pennsync_records".task_projected(page) order by
      case when p_order = 'due_date' then page."due_date" end desc nulls last,
      case when p_order = 'created_date' then page."created_date" end desc nulls last,
      page."id" desc), '[]'::jsonb)
  into v_rows
  from (
    select t.* from "pennsync_records"."task" t
    where t."agency_id" = p_agency
      and (p_patient_id is null or t."patient_id" = p_patient_id)
      and (p_related_entity is null or t."related_entity" = p_related_entity)
      and (p_related_entity_id is null or t."related_entity_id" = p_related_entity_id)
      and (p_exclude_status is null or t."status" is distinct from p_exclude_status)
      and "pennsync_records".chart_not_elsewhere(t."patient_id", p_agency)
    order by
      case when p_order = 'due_date' then t."due_date" end desc nulls last,
      case when p_order = 'created_date' then t."created_date" end desc nulls last,
      t."id" desc
    limit v_limit
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

create or replace function "pennsync_records".contract_face_to_face_list(
    p_agency text, p_referral_id text, p_limit integer)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_rows jsonb; v_limit integer;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_F2F_AGENCY_NOT_HELD';
  end if;
  -- D40, and the READ is gated too because the original's read is
  -- `role === 'admin'` as well. Deliberately narrower than D68's intake roles.
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_F2F_FORBIDDEN';
  end if;
  v_limit := "pennsync_records".operational_limit(p_limit, 'PENNSYNC_F2F');
  select coalesce(jsonb_agg("pennsync_records".f2f_projected(page) order by
      page."created_date" desc nulls last, page."id" desc), '[]'::jsonb)
  into v_rows
  from (
    select e.* from "pennsync_records"."face_to_face_encounter" e
    where e."agency_id" = p_agency
      and (p_referral_id is null or e."referral_id" = p_referral_id)
      and "pennsync_records".chart_not_elsewhere(e."patient_id", p_agency)
    order by e."created_date" desc nulls last, e."id" desc
    limit v_limit
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

create or replace function "pennsync_records".contract_document_record_list(
    p_agency text, p_patient_id text, p_limit integer)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_rows jsonb; v_limit integer; v_role text; v_email text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501',
      message='PENNSYNC_DOCUMENT_RECORD_AGENCY_NOT_HELD';
  end if;
  v_limit := "pennsync_records".operational_limit(p_limit, 'PENNSYNC_DOCUMENT_RECORD');
  v_email := "pennsync_records".caller_email();

  -- D36: tenancy is not ownership. `document_record_read` puts the row in the
  -- caller's agency and narrows it to their charts, and neither of those is
  -- "this is my upload" — the original's own rule is `created_by` or the
  -- platform tier, so the ownership check is this contract's and stays. What
  -- moves is the platform half, which D40 makes the agency's administrator.
  select coalesce(jsonb_agg("pennsync_records".document_record_projected(page) order by
      page."created_date" desc nulls last, page."id" desc), '[]'::jsonb)
  into v_rows
  from (
    select d.* from "pennsync_records"."document_record" d
    where d."agency_id" = p_agency
      and (p_patient_id is null or d."patient_id" = p_patient_id)
      and (v_role = 'agency_admin'
        or pg_catalog.lower(coalesce(d."created_by", '')) = v_email)
      and "pennsync_records".chart_not_elsewhere(d."patient_id", p_agency)
    order by d."created_date" desc nulls last, d."id" desc
    limit v_limit
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

create or replace function "pennsync_records".contract_note_conversion_list(
    p_agency text, p_recovery_request_id text, p_limit integer)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_rows jsonb; v_limit integer; v_role text; v_email text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501',
      message='PENNSYNC_NOTE_CONVERSION_AGENCY_NOT_HELD';
  end if;
  v_limit := "pennsync_records".operational_limit(p_limit, 'PENNSYNC_NOTE_CONVERSION');
  v_email := "pennsync_records".caller_email();

  -- The same split as the document record, and the three screens reading this
  -- are the reason it matters: the nurse performance report and the analytics
  -- dashboard ask for every conversion in the agency, which is exactly what
  -- an `agency_admin` may have and nobody else may.
  select coalesce(jsonb_agg("pennsync_records".note_conversion_projected(page) order by
      page."created_date" desc nulls last, page."id" desc), '[]'::jsonb)
  into v_rows
  from (
    select n.* from "pennsync_records"."note_conversion" n
    where n."agency_id" = p_agency
      and (p_recovery_request_id is null
        or n."recovery_request_id" = p_recovery_request_id)
      and (v_role = 'agency_admin'
        or pg_catalog.lower(coalesce(n."nurse_email", '')) = v_email
        or pg_catalog.lower(coalesce(n."created_by", '')) = v_email)
      and "pennsync_records".chart_not_elsewhere(n."patient_id", p_agency)
    order by n."created_date" desc nulls last, n."id" desc
    limit v_limit
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

reset role;

revoke all on function
  "pennsync_records".chart_not_elsewhere(text, text)
  from public, anon, authenticated, service_role;

commit;
