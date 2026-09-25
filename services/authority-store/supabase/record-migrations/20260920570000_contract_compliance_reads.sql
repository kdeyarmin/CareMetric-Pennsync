-- The read half of five compliance domains the frontend already writes.
--
-- HAND WRITTEN, like every contract. Five list capabilities over five carried
-- tables — `incident`, `compliance_audit`, `adr_audit_case`,
-- `personnel_credential` and `policy_acknowledgment` — which between them are
-- 34 of the frontend's read call sites and the largest group after D23's
-- roster. Three of the five already have a WRITE contract beside them (D39's
-- `submitPersonnelCredential`, D40's credential review, D44's incident submit
-- and patch); none of them had a way to READ, so every screen over them still
-- went to Base44.
--
-- These are not ported Base44 function names. The originals are raw
-- `Entity.list` and `Entity.filter` calls from the SPA, which means the
-- authorization that governed them is the entity's own `rls` block and
-- nothing else. That block is the same shape on all five:
--
--     Incident            created_by = me   OR role = 'admin' OR is_sample
--     ComplianceAudit     nurse_email = me  OR role = 'admin'
--     AdrAuditCase        created_by = me   OR role = 'admin'
--     PersonnelCredential user_id = me      OR role = 'admin'
--     PolicyAcknowledgment user_id = me     OR role = 'admin'
--
-- **So the reviewed authorization is D45's rule and D40's, together.**
--
-- D45: TENANCY IS NOT OWNERSHIP. Four of the five tables are policy-tenanted
-- AGENCY-WIDE in this store (`personnel_credential`, `policy_acknowledgment`,
-- and — through the chart and the visit respectively — every incident and
-- audit on a chart the caller opens). A contract that trusted the policies
-- would let any colleague read anybody's licence numbers, anybody's policy
-- signatures and anybody's incident reports. So each contract carries its own
-- ownership predicate, exactly the `rls` block's, and the policies stay under
-- it rather than in place of it.
--
-- D40: where the original's only other gate is the built-in `role === 'admin'`
-- — the platform tier D14 and D22 removed — the successor is an `agency_admin`
-- SCOPED TO THEIR OWN AGENCY. That is the widening D40 took, and it is what
-- makes `AdminCredentialApproval`, `IncidentReviewQueue` and the compliance
-- reports work for somebody who is not the platform owner.
--
-- DIVERGENCES from the SDK reads they replace, each deliberate:
--
-- 1. **NO FILE LOCATOR IS PROJECTED.** `incident.photo_urls` and
--    `state_reportable_pdf_url`, `adr_audit_case.letter_file_url`,
--    `packet_file_url` and `final_packet_url`,
--    `personnel_credential.uploaded_file_url` and
--    `policy_acknowledgment.doc_url` are all carried `file_url` strings
--    pointing at Base44's own storage (D56), and D77's resolver FAILS CLOSED
--    on exactly those rather than handing one back. Returning them here would
--    do what that resolver refuses to do: give a caller a Base44 URL it would
--    then fetch. They are absent, by name, until the file layer's copy maps
--    them. `uploaded_file_name` is a filename rather than a locator and is
--    projected.
--
-- 2. An ORDER is a small enumerated set per capability, and always DESCENDING
--    with the id as a tiebreaker. The call sites ask for seven distinct
--    orders across the five (`-created_date`, `-incident_date`, `-audit_date`,
--    `-expiration_date`, `-updated_date`) and no ascending one; an order
--    outside the set is REFUSED rather than silently replaced, because a
--    screen showing the newest incidents under a heading that says oldest is
--    a defect nothing would report. The tiebreaker is D25's rule: `id` is a
--    random uuid, so without it the order of two rows sharing a timestamp is
--    a coin flip and a page walk can repeat or drop a row.
--
-- 3. A filter naming SOMEBODY ELSE, asked by a caller who is not an
--    `agency_admin`, is refused by name rather than answered with an empty
--    list. An empty list would say "this colleague has no credentials", which
--    is a claim about them; the refusal says "you may not ask", which is a
--    claim about the caller. The chart filters (`patient_id`) carry no such
--    refusal, because there the chart policies are the answer and D24 already
--    decides who opens which chart.
--
-- 4. The limit CLAMPS rather than refusing, as `contract_roster_list` does,
--    and the seam in `src/lib/independentEntityRoutes.js` refuses above the
--    ceiling. That split is deliberate and is the one place the two halves
--    disagree on purpose: a contract that refused would break a caller that
--    legitimately asked for more than exists, while a route that clamped would
--    let a screen render a short page as the whole agency.
--
-- TWO THINGS THAT ARE RECORDED RATHER THAN FIXED, because the store's policies
-- are generated (D88) and not this contract's to change:
--
-- * `incident_read` reaches tenancy through `incident.patient_id`, and
--   `compliance_audit_read` through `compliance_audit.visit_id`. Both columns
--   are NULLABLE, so a row with a null there is in no tenant and readable by
--   nobody — D61's finding, in the two tables that still have it. It is not
--   observable for rows written here: the matching INSERT policies carry the
--   same predicate, so this store cannot hold a chartless incident or a
--   visitless audit in the first place. A test asserts that rather than
--   asserting the comment.
--
-- * `adr_audit_case.medicare_number` IS projected and is the widest field in
--   this file. It is the point of the screen the capability serves — an ADR is
--   a payer's demand for records naming a claim — and the contract has already
--   proved the caller either filed the case or administers the agency.
begin;

do $$
begin
  if to_regclass('pennsync_records.patient') is null
    or to_regclass('pennsync_records.visit') is null
    or to_regclass('pennsync_records.incident') is null
    or to_regclass('pennsync_records.compliance_audit') is null
    or to_regclass('pennsync_records.adr_audit_case') is null
    or to_regclass('pennsync_records.personnel_credential') is null
    or to_regclass('pennsync_records.policy_acknowledgment') is null
    or to_regprocedure('pennsync_records.caller_tenant_role(text)') is null
    or to_regprocedure('pennsync_records.caller_email()') is null then
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
 * The clamp every capability here shares.
 *
 * `contract_roster_list`'s, to the row: a null or absent limit is the default,
 * anything below one is one, and the ceiling is the ceiling. Written once
 * because five copies of an arithmetic expression is five places for a
 * ceiling to drift, and the route declares the same number on its side.
 */
create function "pennsync_records".compliance_read_limit(
  p_limit integer, p_default integer, p_ceiling integer)
  returns integer language sql immutable set search_path = '' as $limit$
  select least(greatest(coalesce(p_limit, p_default), 1), p_ceiling)
$limit$;

/*
 * The order, checked against the capability's own allowlist.
 *
 * Divergence 2. The allowlist arrives as an array from the caller's own
 * contract rather than living here, so one capability cannot come to accept
 * another's column — the same reason D50's credential sweep takes its marker
 * column as a parameter.
 */
create function "pennsync_records".compliance_read_order(
  p_order text, p_allowed text[], p_message text)
  returns text language plpgsql immutable set search_path = '' as $order$
begin
  if p_order is null then return p_allowed[1]; end if;
  if not (p_order = any (p_allowed)) then
    raise exception using errcode='22023', message=p_message;
  end if;
  return p_order;
end $order$;

/* ---------------------------------------------------------------- incident */

create function "pennsync_records".contract_incident_list(
  p_agency text, p_patient_id text default null, p_client_request_id text default null,
  p_order text default null, p_limit integer default 200)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_role text; v_email text; v_admin boolean; v_order text; v_limit integer; v_rows jsonb;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_INCIDENT_READ_AGENCY_NOT_HELD';
  end if;
  if p_patient_id is not null and p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_INCIDENT_READ_SUBJECT_INVALID';
  end if;
  if p_client_request_id is not null and p_client_request_id !~ '^[A-Za-z0-9_:.-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_INCIDENT_READ_REQUEST_ID_INVALID';
  end if;
  v_order := "pennsync_records".compliance_read_order(p_order,
    array['created_date', 'incident_date'], 'PENNSYNC_INCIDENT_READ_ORDER_INVALID');
  v_email := "pennsync_records".caller_email();
  v_admin := v_role = 'agency_admin';
  v_limit := "pennsync_records".compliance_read_limit(p_limit, 200, 5000);

  -- The `rls` block, term for term: mine, or a sample row, or an
  -- `agency_admin`'s whole agency (D40). The chart predicate on
  -- `incident_read` is under all of it and decides which charts are in reach.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r."id", 'created_date', r."created_date", 'updated_date', r."updated_date",
      'created_by', r."created_by", 'client_request_id', r."client_request_id",
      'patient_id', r."patient_id", 'patient_name', r."patient_name",
      'visit_id', r."visit_id", 'incident_type', r."incident_type",
      'incident_name', r."incident_name", 'incident_date', r."incident_date",
      'incident_time', r."incident_time", 'severity', r."severity",
      'details', r."details", 'report', r."report",
      'physician_notified', r."physician_notified", 'office_notified', r."office_notified",
      'status', r."status", 'resolution_notes', r."resolution_notes",
      'investigator_email', r."investigator_email", 'reviewed_by', r."reviewed_by",
      'reviewed_at', r."reviewed_at", 'corrective_action_plan', r."corrective_action_plan",
      'corrective_action_due_date', r."corrective_action_due_date",
      'closed_by', r."closed_by", 'closed_at', r."closed_at",
      'ai_tags', r."ai_tags", 'is_sample', r."is_sample",
      'alert_triggered', r."alert_triggered", 'state_reportable', r."state_reportable",
      'state_reportable_alert_sent_at', r."state_reportable_alert_sent_at")
    order by r."sort_key" desc nulls last, r."id"), '[]'::jsonb) into v_rows
  from (
    select i.*, case when v_order = 'incident_date' then i."incident_date"::timestamptz
      else i."created_date" end as "sort_key"
    from "pennsync_records"."incident" i
    where i."source_app_id" = "pennsync_records".deployment_app()
      -- D51's trap: `caller_agencies()` is every agency the caller holds, so
      -- the policy alone would put another agency's charts in this agency's
      -- list. The contract names its own agency through the chart.
      and exists (select 1 from "pennsync_records"."patient" t
        where t."source_app_id" = i."source_app_id" and t."id" = i."patient_id"
          and t."agency_id" = p_agency)
      and (p_patient_id is null or i."patient_id" = p_patient_id)
      and (p_client_request_id is null or i."client_request_id" = p_client_request_id)
      and (v_admin or i."created_by" = v_email or i."is_sample" = true)
    order by case when v_order = 'incident_date' then i."incident_date"::timestamptz
      else i."created_date" end desc nulls last, i."id"
    limit v_limit) r;
  return jsonb_build_object('entries', v_rows, 'order', v_order, 'limit', v_limit);
end $contract$;

/* -------------------------------------------------------- compliance audit */

create function "pennsync_records".contract_compliance_audit_list(
  p_agency text, p_patient_id text default null, p_visit_id text default null,
  p_order text default null, p_limit integer default 200)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_role text; v_email text; v_admin boolean; v_order text; v_limit integer; v_rows jsonb;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_AUDIT_READ_AGENCY_NOT_HELD';
  end if;
  if p_patient_id is not null and p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_AUDIT_READ_SUBJECT_INVALID';
  end if;
  if p_visit_id is not null and p_visit_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_AUDIT_READ_VISIT_INVALID';
  end if;
  v_order := "pennsync_records".compliance_read_order(p_order,
    array['created_date', 'audit_date'], 'PENNSYNC_AUDIT_READ_ORDER_INVALID');
  v_email := "pennsync_records".caller_email();
  v_admin := v_role = 'agency_admin';
  v_limit := "pennsync_records".compliance_read_limit(p_limit, 200, 5000);

  -- The `rls` block's own term is `nurse_email`, not `created_by`: an audit is
  -- the nurse's whether the row was written by the note path or by a sweep.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r."id", 'created_date', r."created_date", 'updated_date', r."updated_date",
      'created_by', r."created_by", 'recovery_request_id', r."recovery_request_id",
      'visit_id', r."visit_id", 'nurse_email', r."nurse_email",
      'patient_id', r."patient_id", 'audit_date', r."audit_date",
      'compliance_score', r."compliance_score", 'status', r."status",
      'issues', r."issues", 'compliant_elements', r."compliant_elements",
      'audit_type', r."audit_type", 'reviewed_by', r."reviewed_by",
      'reviewed_at', r."reviewed_at", 'review_notes', r."review_notes",
      'acknowledgment', r."acknowledgment", 'rule_versions', r."rule_versions")
    order by r."sort_key" desc nulls last, r."id"), '[]'::jsonb) into v_rows
  from (
    select a.*, case when v_order = 'audit_date' then a."audit_date"
      else a."created_date" end as "sort_key"
    from "pennsync_records"."compliance_audit" a
    where a."source_app_id" = "pennsync_records".deployment_app()
      -- D51's trap again, through this table's own tenant path: the visit.
      and exists (select 1 from "pennsync_records"."visit" t
        where t."source_app_id" = a."source_app_id" and t."id" = a."visit_id"
          and t."agency_id" = p_agency)
      and (p_patient_id is null or a."patient_id" = p_patient_id)
      and (p_visit_id is null or a."visit_id" = p_visit_id)
      and (v_admin or a."nurse_email" = v_email)
    order by case when v_order = 'audit_date' then a."audit_date"
      else a."created_date" end desc nulls last, a."id"
    limit v_limit) r;
  return jsonb_build_object('entries', v_rows, 'order', v_order, 'limit', v_limit);
end $contract$;

/* --------------------------------------------------------- adr audit case */

create function "pennsync_records".contract_adr_case_list(
  p_agency text, p_order text default null, p_limit integer default 200)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_role text; v_email text; v_admin boolean; v_order text; v_limit integer; v_rows jsonb;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_ADR_READ_AGENCY_NOT_HELD';
  end if;
  v_order := "pennsync_records".compliance_read_order(p_order,
    array['created_date'], 'PENNSYNC_ADR_READ_ORDER_INVALID');
  v_email := "pennsync_records".caller_email();
  v_admin := v_role = 'agency_admin';
  v_limit := "pennsync_records".compliance_read_limit(p_limit, 200, 1000);

  -- Divergence 1 costs this capability the most: an ADR case is a packet of
  -- documents, and three of its columns are locators. What the screen keeps is
  -- the page counts and the verification summary, which say whether a packet
  -- exists and whether it passed — the decision the screen is for.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r."id", 'created_date', r."created_date", 'updated_date', r."updated_date",
      'created_by', r."created_by", 'case_name', r."case_name", 'status', r."status",
      'audit_type', r."audit_type", 'contractor_name', r."contractor_name",
      'patient_name', r."patient_name", 'patient_id', r."patient_id",
      'medicare_number', r."medicare_number", 'claim_number', r."claim_number",
      'dates_of_service', r."dates_of_service", 'letter_date', r."letter_date",
      'response_due_date', r."response_due_date", 'letter_analysis', r."letter_analysis",
      'checklist', r."checklist", 'packet_page_count', r."packet_page_count",
      'verification_summary', r."verification_summary",
      'final_packet_pages', r."final_packet_pages", 'notes', r."notes",
      'deadline_reminders', r."deadline_reminders", 'submission_faxes', r."submission_faxes",
      'outcome', r."outcome", 'decision_date', r."decision_date",
      'appeal_due_date', r."appeal_due_date", 'outcome_notes', r."outcome_notes",
      'agency_id', r."agency_id")
    order by r."created_date" desc nulls last, r."id"), '[]'::jsonb) into v_rows
  from (
    select c.* from "pennsync_records"."adr_audit_case" c
    where c."source_app_id" = "pennsync_records".deployment_app()
      and c."agency_id" = p_agency
      and (v_admin or c."created_by" = v_email)
    order by c."created_date" desc nulls last, c."id"
    limit v_limit) r;
  return jsonb_build_object('entries', v_rows, 'order', v_order, 'limit', v_limit);
end $contract$;

/* ---------------------------------------------------- personnel credential */

create function "pennsync_records".contract_personnel_credential_list(
  p_agency text, p_user_id text default null, p_status text default null,
  p_order text default null, p_limit integer default 200)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_role text; v_email text; v_admin boolean; v_order text; v_limit integer; v_rows jsonb;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_CREDENTIAL_READ_AGENCY_NOT_HELD';
  end if;
  v_order := "pennsync_records".compliance_read_order(p_order,
    array['created_date', 'expiration_date', 'updated_date'],
    'PENNSYNC_CREDENTIAL_READ_ORDER_INVALID');
  -- The column is constrained, so an unknown status is a caller mistake rather
  -- than an empty shelf: refused by name, D39's rule about the original's
  -- silent field filter losing a misspelling.
  if p_status is not null
    and p_status not in ('pending_approval', 'approved', 'rejected', 'expired') then
    raise exception using errcode='22023', message='PENNSYNC_CREDENTIAL_READ_STATUS_INVALID';
  end if;
  v_email := "pennsync_records".caller_email();
  v_admin := v_role = 'agency_admin';
  -- Divergence 3: asking for a colleague's credentials is a question about
  -- them, so it is refused rather than answered empty.
  if p_user_id is not null and not v_admin and p_user_id is distinct from v_email then
    raise exception using errcode='42501', message='PENNSYNC_CREDENTIAL_READ_SUBJECT_FORBIDDEN';
  end if;
  v_limit := "pennsync_records".compliance_read_limit(p_limit, 200, 5000);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r."id", 'created_date', r."created_date", 'updated_date', r."updated_date",
      'created_by', r."created_by", 'user_id', r."user_id", 'user_name', r."user_name",
      'agency_name', r."agency_name", 'item_type', r."item_type", 'title', r."title",
      'issuing_organization', r."issuing_organization",
      'credential_number', r."credential_number", 'issued_date', r."issued_date",
      'expiration_date', r."expiration_date", 'uploaded_file_name', r."uploaded_file_name",
      'notes', r."notes", 'status', r."status", 'approved_by', r."approved_by",
      'approved_at', r."approved_at", 'rejection_reason', r."rejection_reason",
      'last_reminder_sent_at', r."last_reminder_sent_at", 'agency_id', r."agency_id")
    order by r."sort_key" desc nulls last, r."id"), '[]'::jsonb) into v_rows
  from (
    select p.*, case when v_order = 'expiration_date' then p."expiration_date"::timestamptz
      when v_order = 'updated_date' then p."updated_date"
      else p."created_date" end as "sort_key"
    from "pennsync_records"."personnel_credential" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."agency_id" = p_agency
      and (p_user_id is null or p."user_id" = p_user_id)
      and (p_status is null or p."status" = p_status)
      and (v_admin or p."user_id" = v_email)
    order by case when v_order = 'expiration_date' then p."expiration_date"::timestamptz
      when v_order = 'updated_date' then p."updated_date"
      else p."created_date" end desc nulls last, p."id"
    limit v_limit) r;
  return jsonb_build_object('entries', v_rows, 'order', v_order, 'limit', v_limit);
end $contract$;

/* --------------------------------------------------- policy acknowledgment */

create function "pennsync_records".contract_policy_acknowledgment_list(
  p_agency text, p_user_id text default null, p_order text default null,
  p_limit integer default 200)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_role text; v_email text; v_admin boolean; v_order text; v_limit integer; v_rows jsonb;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_POLICY_ACK_READ_AGENCY_NOT_HELD';
  end if;
  v_order := "pennsync_records".compliance_read_order(p_order,
    array['created_date'], 'PENNSYNC_POLICY_ACK_READ_ORDER_INVALID');
  v_email := "pennsync_records".caller_email();
  v_admin := v_role = 'agency_admin';
  if p_user_id is not null and not v_admin and p_user_id is distinct from v_email then
    raise exception using errcode='42501', message='PENNSYNC_POLICY_ACK_READ_SUBJECT_FORBIDDEN';
  end if;
  v_limit := "pennsync_records".compliance_read_limit(p_limit, 200, 2000);

  -- `ip_address` and `device_metadata` are projected because they are what the
  -- row already holds; D36 refuses to RECORD a caller-supplied one, which is a
  -- rule about the write half and says nothing about reading a stored value.
  -- `doc_url` is absent under divergence 1.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r."id", 'created_date', r."created_date", 'updated_date', r."updated_date",
      'created_by', r."created_by", 'policy_id', r."policy_id",
      'policy_title', r."policy_title", 'policy_number', r."policy_number",
      'policy_version', r."policy_version", 'user_id', r."user_id",
      'user_name', r."user_name", 'distributed_by', r."distributed_by",
      'assigned_date', r."assigned_date", 'due_date', r."due_date",
      'status', r."status", 'acknowledged', r."acknowledged",
      'acknowledged_at', r."acknowledged_at", 'signed_name', r."signed_name",
      'device_metadata', r."device_metadata", 'ip_address', r."ip_address",
      'agency_id', r."agency_id")
    order by r."created_date" desc nulls last, r."id"), '[]'::jsonb) into v_rows
  from (
    select a.* from "pennsync_records"."policy_acknowledgment" a
    where a."source_app_id" = "pennsync_records".deployment_app()
      and a."agency_id" = p_agency
      and (p_user_id is null or a."user_id" = p_user_id)
      and (v_admin or a."user_id" = v_email)
    order by a."created_date" desc nulls last, a."id"
    limit v_limit) r;
  return jsonb_build_object('entries', v_rows, 'order', v_order, 'limit', v_limit);
end $contract$;

reset role;

revoke all on function "pennsync_records".compliance_read_limit(integer,integer,integer)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".compliance_read_order(text,text[],text)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_incident_list(text,text,text,text,integer)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_compliance_audit_list(text,text,text,text,integer)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_adr_case_list(text,text,integer)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_personnel_credential_list(text,text,text,text,integer)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_policy_acknowledgment_list(text,text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function "pennsync_records".contract_incident_list(text,text,text,text,integer)
  to authenticated;
grant execute on function "pennsync_records".contract_compliance_audit_list(text,text,text,text,integer)
  to authenticated;
grant execute on function "pennsync_records".contract_adr_case_list(text,text,integer)
  to authenticated;
grant execute on function "pennsync_records".contract_personnel_credential_list(text,text,text,text,integer)
  to authenticated;
grant execute on function "pennsync_records".contract_policy_acknowledgment_list(text,text,text,integer)
  to authenticated;

create function "public"."pennsync_contract_incident_list"(
  p_agency text, p_patient_id text default null, p_client_request_id text default null,
  p_order text default null, p_limit integer default 200) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_incident_list(
    p_agency, p_patient_id, p_client_request_id, p_order, p_limit)
$c$;
create function "public"."pennsync_contract_compliance_audit_list"(
  p_agency text, p_patient_id text default null, p_visit_id text default null,
  p_order text default null, p_limit integer default 200) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_compliance_audit_list(
    p_agency, p_patient_id, p_visit_id, p_order, p_limit)
$c$;
create function "public"."pennsync_contract_adr_case_list"(
  p_agency text, p_order text default null, p_limit integer default 200) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_adr_case_list(p_agency, p_order, p_limit)
$c$;
create function "public"."pennsync_contract_personnel_credential_list"(
  p_agency text, p_user_id text default null, p_status text default null,
  p_order text default null, p_limit integer default 200) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_personnel_credential_list(
    p_agency, p_user_id, p_status, p_order, p_limit)
$c$;
create function "public"."pennsync_contract_policy_acknowledgment_list"(
  p_agency text, p_user_id text default null, p_order text default null,
  p_limit integer default 200) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_policy_acknowledgment_list(
    p_agency, p_user_id, p_order, p_limit)
$c$;
revoke all on function "public"."pennsync_contract_incident_list"(text,text,text,text,integer)
  from public, anon, authenticated, service_role;
revoke all on function "public"."pennsync_contract_compliance_audit_list"(text,text,text,text,integer)
  from public, anon, authenticated, service_role;
revoke all on function "public"."pennsync_contract_adr_case_list"(text,text,integer)
  from public, anon, authenticated, service_role;
revoke all on function "public"."pennsync_contract_personnel_credential_list"(text,text,text,text,integer)
  from public, anon, authenticated, service_role;
revoke all on function "public"."pennsync_contract_policy_acknowledgment_list"(text,text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_incident_list"(text,text,text,text,integer)
  to authenticated;
grant execute on function "public"."pennsync_contract_compliance_audit_list"(text,text,text,text,integer)
  to authenticated;
grant execute on function "public"."pennsync_contract_adr_case_list"(text,text,integer)
  to authenticated;
grant execute on function "public"."pennsync_contract_personnel_credential_list"(text,text,text,text,integer)
  to authenticated;
grant execute on function "public"."pennsync_contract_policy_acknowledgment_list"(text,text,text,integer)
  to authenticated;

commit;
