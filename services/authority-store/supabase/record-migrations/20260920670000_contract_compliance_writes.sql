-- The write half of the two compliance domains the frontend writes: the
-- compliance audit a note's save records, and the ADR audit case the ADR
-- Center drives end to end. The read half landed in
-- `20260920660000_contract_compliance_reads.sql`; this is its pair, and the
-- two are one decision — a screen that can read a case and not advance it is
-- a screen still on Base44.
--
-- The filename's suffix is 670000 because `planMigration` sorts each
-- directory's filenames and refuses `MIGRATE_OUT_OF_ORDER` the moment an
-- APPLIED file sorts after a PENDING one. The read half moved FIVE times for
-- that reason inside one pull request, twice against files that tied its
-- timestamp prefix EXACTLY and sorted after it on the alphabet — so a shared
-- prefix is not a collision and is not safety either: sorting is over the
-- whole filename, and a prefix only ties. A suffix is only "after everything
-- applied" relative to a TREE, so this is re-checked on every rebase, and it
-- is ASSERTED rather than re-read: the suite applies the whole record
-- directory in apply order and requires this contract to be the last name in
-- it, which is what caught the fourth and fifth moves at rebase time instead
-- of at an operator's apply.
--
-- HAND WRITTEN, like every contract.
--
-- ============================================================ authorization
--
-- These are not ported Base44 function names either. The originals are raw
-- `Entity.create` / `.update` / `.delete` calls from the SPA, so the
-- authorization that governed them is each entity's own `rls` block and
-- nothing else. Both blocks name the same two terms for every command:
--
--     ComplianceAudit   create/update/delete: nurse_email = me OR role='admin'
--     AdrAuditCase      create/update/delete: created_by  = me OR role='admin'
--
-- which is the read half's shape exactly, so the same two decisions carry:
--
-- D45: TENANCY IS NOT OWNERSHIP. `compliance_audit` is policy-tenanted through
-- its visit and `adr_audit_case` on its own `agency_id`, both agency-WIDE, so
-- a port that trusted the policies would let any colleague rewrite anybody's
-- audits and delete anybody's ADR cases. Each contract carries its own
-- ownership predicate — the `rls` block's own term — and the policies stay
-- under it rather than in place of it.
--
-- D40: the other term is the built-in `role === 'admin'`, the platform tier
-- D14 and D22 removed, and its successor is an `agency_admin` SCOPED TO THEIR
-- OWN AGENCY. That is what keeps the ADR Center working: the page is
-- admin-only and its cases are frequently another person's.
--
-- ================================================== divergences, all narrowings
--
-- 1. **`nurse_email` and `created_by` are STAMPED, never accepted.** The
--    originals let a client send either, and an admin could therefore file a
--    row owned by somebody else. Two things make stamping the right call
--    rather than a convenience. It is a narrowing of the `rls` block (the
--    admin branch loses the ability to name a different owner, and nothing in
--    `src/` uses it). And `AIComplianceAuditor.jsx:485` sends
--    `currentUser?.email || 'system'` — a row whose owner is the literal
--    string `system`, which the read contract's own predicate
--    (`nurse_email = caller_email()`) matches for nobody. That audit is
--    written and then readable by no one but an `agency_admin`. Stamping
--    closes it; the field is REFUSED by name rather than ignored, because a
--    caller who names it believes it took effect (D39).
--
-- 2. **A file locator must already be owned.** `letter_file_url`,
--    `packet_file_url` and `final_packet_url` are `Core.UploadFile` results.
--    On the independent path the integration runtime mints durable private
--    `cmfile:` handles, so the real call sites work; a Base44 storage URL is
--    REFUSED rather than stored, which is D77's direction — its resolver fails
--    closed on exactly those, so storing one would write a row whose file leg
--    can never resolve and which nothing would report. The read half does not
--    project any of the three, so nothing reads one back out either.
--
-- 3. **`deadline_reminders` is refused on both create and update.** It is the
--    idempotency marker `checkAdrDeadlines` writes (D51), one reminder per
--    case per calendar day. A caller who could write it could silence a
--    Medicare response deadline, and D50's rule about a claim field is that
--    the sweep owns it.
--
-- 4. **`reviewed_by`, `reviewed_at` and `review_notes` are refused by name on
--    the audit.** They are the reviewer's, and there is no reviewer capability
--    here — the same shape as D39's `reviewPersonnelCredential`, whose port
--    was declined until the exit decisions recorded who may approve. Do not
--    add a review path to this file until that decision names a performer.
--
-- 5. **An array of history may not SHRINK.** `submission_faxes` is the record
--    of what was faxed to a Medicare contractor and `notes` is the case's
--    chronological trail. Both are written by the client as a whole array
--    built by spreading what it last read (`AdrSubmissionPanel.jsx:58,78`), so
--    a stale read plus a write ERASES faxes that really went out — a
--    compliance record losing entries with nothing raised. The array shape is
--    kept, because the route passes the call site's own payload through and an
--    append would double the history; what is added is the refusal of a write
--    that is shorter than what is stored. It does not close the interleaved
--    lost-update race, which is the original's and is named below.
--
-- 6. **A named chart must be this agency's.** The read half closed the crossed
--    chart with #313's `chart_not_elsewhere` — an ADR case naming a patient
--    whose chart is in another agency returned that patient's name and
--    medicare number to an administrator who cannot open it. The write side
--    refuses at the source: a `patient_id` that resolves to another agency's
--    chart is refused rather than kept. The helper's own "unresolvable is not
--    proved crossed" branch carries, so a chart this store does not carry is
--    accepted — losing a write for a reason nobody can see is D61's failure
--    mode.
--
-- =========================================================== recorded, not fixed
--
-- `submission_faxes` and `notes` remain read-modify-write arrays, so two
-- concurrent writers still lose one another's entry. Closing that needs either
-- an append parameter (which changes the call sites) or an expectation from
-- the caller, and `updateFleetVehicle` and `contract_patient_update` show the
-- shape: an expectation the CALLER supplies is concurrency control, while a
-- `where version = <what I just read>` the contract invents is a transaction
-- (D68). The call sites send neither today. The non-shrinking refusal above
-- catches the case that actually loses data — a write built on a stale read
-- of an array that has since grown — and is not a substitute for that.
--
-- `compliance_audit` has no `agency_id` and reaches tenancy through
-- `visit_id`, a nullable column (D61). The create contract REQUIRES a visit
-- and checks it is this agency's, so a row this capability writes is always in
-- a tenant; a row written by something else with a null visit is readable by
-- nobody, which is the read half's recorded finding and not this one's to fix.

do $precondition$
begin
  if pg_catalog.to_regprocedure(
    'pennsync_records.contract_adr_case_list(text,text,integer)') is null then
    raise exception using errcode='42883',
      message='PENNSYNC_COMPLIANCE_WRITES_REQUIRE_READS';
  end if;
  if pg_catalog.to_regprocedure(
    'pennsync_records.chart_not_elsewhere(text,text)') is null then
    raise exception using errcode='42883',
      message='PENNSYNC_COMPLIANCE_WRITES_REQUIRE_CHART_AGENCY';
  end if;
end $precondition$;

set local role "pennsync_records_owner";

/* ------------------------------------------------------------- shared helpers */

-- A locator this store may hold. Null and empty pass through as null, because
-- a create that names no letter is legitimate; anything that is not an owned
-- handle is refused with the caller's own field named, rather than stored and
-- discovered later by a resolver that answers null.
create function "pennsync_records".compliance_write_locator(
  p_value text, p_code text) returns text
  language plpgsql immutable set search_path = '' as $helper$
begin
  if p_value is null or pg_catalog.btrim(p_value) = '' then
    return null;
  end if;
  if p_value !~ '^cmfile:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode='22023', message=p_code;
  end if;
  return p_value;
end $helper$;

-- An array column of history may grow and may be rewritten, and may not lose
-- entries. `jsonb_array_length` refuses a non-array, which is why the type is
-- checked first: the caller's own refusal code is more use than `22023` from
-- deep inside a built-in.
create function "pennsync_records".compliance_write_no_shrink(
  p_next jsonb, p_prev jsonb, p_code text) returns void
  language plpgsql immutable set search_path = '' as $helper$
begin
  if p_next is null or jsonb_typeof(p_next) = 'null' then
    raise exception using errcode='22023', message=p_code;
  end if;
  if jsonb_typeof(p_next) <> 'array' then
    raise exception using errcode='22023', message=p_code;
  end if;
  if jsonb_typeof(coalesce(p_prev, '[]'::jsonb)) = 'array'
    and pg_catalog.jsonb_array_length(p_next)
      < pg_catalog.jsonb_array_length(coalesce(p_prev, '[]'::jsonb)) then
    raise exception using errcode='22023', message=p_code;
  end if;
end $helper$;

/* ----------------------------------------------------------- compliance audit */

create function "pennsync_records".compliance_audit_writable(p_field text)
  returns boolean language sql immutable set search_path = '' as $writable$
  select p_field in ('recovery_request_id', 'visit_id', 'patient_id',
    'audit_date', 'compliance_score', 'status', 'issues', 'compliant_elements',
    'audit_type', 'acknowledgment', 'rule_versions');
$writable$;

-- Named separately from "unknown" so the refusal says which of the two it is.
-- A caller sending `nurse_email` has made a different mistake from a caller
-- sending a misspelled field, and telling them apart is the whole reason D39
-- refuses an unknown key rather than filtering it.
create function "pennsync_records".compliance_audit_reserved(p_field text)
  returns boolean language sql immutable set search_path = '' as $reserved$
  select p_field in ('id', 'source_app_id', 'created_by', 'created_date',
    'updated_date', 'nurse_email', 'reviewed_by', 'reviewed_at', 'review_notes');
$reserved$;

create function "pennsync_records".compliance_audit_row(
  r "pennsync_records"."compliance_audit") returns jsonb
  language sql stable set search_path = '' as $row$
  select jsonb_build_object(
    'id', r."id", 'created_date', r."created_date", 'updated_date', r."updated_date",
    'created_by', r."created_by", 'recovery_request_id', r."recovery_request_id",
    'visit_id', r."visit_id", 'nurse_email', r."nurse_email",
    'patient_id', r."patient_id", 'audit_date', r."audit_date",
    'compliance_score', r."compliance_score", 'status', r."status",
    'issues', r."issues", 'compliant_elements', r."compliant_elements",
    'audit_type', r."audit_type", 'reviewed_by', r."reviewed_by",
    'reviewed_at', r."reviewed_at", 'review_notes', r."review_notes",
    'acknowledgment', r."acknowledgment", 'rule_versions', r."rule_versions");
$row$;

create function "pennsync_records".contract_compliance_audit_create(
  p_agency text, p_audit jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_role text; v_email text; v_field text; v_row "pennsync_records"."compliance_audit";
  v_visit text; v_patient text; v_status text; v_type text; v_now timestamptz;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_AUDIT_WRITE_AGENCY_NOT_HELD';
  end if;
  if p_audit is null or jsonb_typeof(p_audit) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_AUDIT_WRITE_PAYLOAD_INVALID';
  end if;
  for v_field in select jsonb_object_keys(p_audit) loop
    if "pennsync_records".compliance_audit_reserved(v_field) then
      raise exception using errcode='22023', message='PENNSYNC_AUDIT_WRITE_FIELD_RESERVED';
    end if;
    if not "pennsync_records".compliance_audit_writable(v_field) then
      raise exception using errcode='22023', message='PENNSYNC_AUDIT_WRITE_FIELD_UNKNOWN';
    end if;
  end loop;

  -- The entity's own four required fields. `nurse_email` is the fifth and is
  -- stamped rather than asked for, which is divergence 1.
  v_visit := pg_catalog.btrim(coalesce(p_audit->>'visit_id', ''));
  if v_visit = '' or p_audit->'compliance_score' is null
    or jsonb_typeof(p_audit->'compliance_score') <> 'number'
    or coalesce(p_audit->>'status', '') = '' then
    raise exception using errcode='22023', message='PENNSYNC_AUDIT_WRITE_REQUIRED';
  end if;

  v_status := p_audit->>'status';
  if v_status not in ('passed', 'flagged', 'critical', 'pending_review') then
    raise exception using errcode='22023', message='PENNSYNC_AUDIT_WRITE_STATUS_INVALID';
  end if;
  v_type := coalesce(nullif(pg_catalog.btrim(coalesce(p_audit->>'audit_type', '')), ''),
    'automated');
  if v_type not in ('automated', 'manual', 'triggered') then
    raise exception using errcode='22023', message='PENNSYNC_AUDIT_WRITE_TYPE_INVALID';
  end if;

  -- D51's trap, through this table's own tenant path. `caller_agencies()`
  -- returns every agency the caller holds, so the agency is named in the
  -- contract's own predicate rather than left to the policies.
  perform 1 from "pennsync_records"."visit" t
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."id" = v_visit and t."agency_id" = p_agency;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_AUDIT_WRITE_VISIT_NOT_VISIBLE';
  end if;
  v_patient := nullif(pg_catalog.btrim(coalesce(p_audit->>'patient_id', '')), '');
  if v_patient is not null
    and not "pennsync_records".chart_not_elsewhere(v_patient, p_agency) then
    raise exception using errcode='42501', message='PENNSYNC_AUDIT_WRITE_CHART_ELSEWHERE';
  end if;

  v_email := "pennsync_records".caller_email();
  if v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_AUDIT_WRITE_AGENCY_NOT_HELD';
  end if;
  v_now := clock_timestamp();

  -- The supplied keys only, coerced by the table's own types, then the stamped
  -- columns over the top. A hand-kept column list would let a field added to
  -- the writable set validate and then silently not be written.
  v_row := pg_catalog.jsonb_populate_record(
    null::"pennsync_records"."compliance_audit", p_audit);
  v_row."source_app_id" := "pennsync_records".deployment_app();
  v_row."id" := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
  v_row."nurse_email" := v_email;
  v_row."created_by" := v_email;
  v_row."created_date" := v_now;
  v_row."updated_date" := v_now;
  v_row."patient_id" := v_patient;
  v_row."status" := v_status;
  v_row."audit_type" := v_type;
  v_row."issues" := case when jsonb_typeof(p_audit->'issues') = 'array'
    then p_audit->'issues' else '[]'::jsonb end;
  v_row."compliant_elements" := case
    when jsonb_typeof(p_audit->'compliant_elements') = 'array'
    then p_audit->'compliant_elements' else '[]'::jsonb end;
  v_row."rule_versions" := case when jsonb_typeof(p_audit->'rule_versions') = 'array'
    then p_audit->'rule_versions' else '[]'::jsonb end;

  insert into "pennsync_records"."compliance_audit" values (v_row.*) returning * into v_row;
  return jsonb_build_object('success', true,
    'audit', "pennsync_records".compliance_audit_row(v_row));
end $contract$;

create function "pennsync_records".contract_compliance_audit_update(
  p_agency text, p_audit_id text, p_patch jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_role text; v_email text; v_admin boolean; v_field text; v_status text;
  v_type text; v_existing "pennsync_records"."compliance_audit";
  v_row "pennsync_records"."compliance_audit"; v_assignments text; v_written integer;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_AUDIT_WRITE_AGENCY_NOT_HELD';
  end if;
  if p_audit_id is null or p_audit_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_AUDIT_WRITE_ID_INVALID';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
    or (select pg_catalog.count(*) from jsonb_object_keys(p_patch)) = 0 then
    raise exception using errcode='22023', message='PENNSYNC_AUDIT_WRITE_PAYLOAD_INVALID';
  end if;
  for v_field in select jsonb_object_keys(p_patch) loop
    if "pennsync_records".compliance_audit_reserved(v_field)
      -- The row's identity and its tenant path are not a patch's to move: an
      -- audit that changed visit would change agency, past the check above.
      or v_field in ('visit_id', 'patient_id', 'recovery_request_id') then
      raise exception using errcode='22023', message='PENNSYNC_AUDIT_WRITE_FIELD_RESERVED';
    end if;
    if not "pennsync_records".compliance_audit_writable(v_field) then
      raise exception using errcode='22023', message='PENNSYNC_AUDIT_WRITE_FIELD_UNKNOWN';
    end if;
  end loop;

  v_email := "pennsync_records".caller_email();
  v_admin := v_role = 'agency_admin';
  select a.* into v_existing from "pennsync_records"."compliance_audit" a
  where a."source_app_id" = "pennsync_records".deployment_app()
    and a."id" = p_audit_id
    and exists (select 1 from "pennsync_records"."visit" t
      where t."source_app_id" = a."source_app_id" and t."id" = a."visit_id"
        and t."agency_id" = p_agency);
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_AUDIT_WRITE_NOT_FOUND';
  end if;
  -- D45 again, and the reason this predicate is here rather than in a policy:
  -- `compliance_audit` is tenanted agency-wide through its visit, so every
  -- colleague passes the lookup above.
  if not v_admin and v_existing."nurse_email" is distinct from v_email then
    raise exception using errcode='42501', message='PENNSYNC_AUDIT_WRITE_NOT_OWNED';
  end if;

  if p_patch ? 'status' then
    v_status := p_patch->>'status';
    if v_status is null
      or v_status not in ('passed', 'flagged', 'critical', 'pending_review') then
      raise exception using errcode='22023', message='PENNSYNC_AUDIT_WRITE_STATUS_INVALID';
    end if;
  end if;
  if p_patch ? 'audit_type' then
    v_type := p_patch->>'audit_type';
    if v_type is null or v_type not in ('automated', 'manual', 'triggered') then
      raise exception using errcode='22023', message='PENNSYNC_AUDIT_WRITE_TYPE_INVALID';
    end if;
  end if;
  if p_patch ? 'compliance_score'
    and jsonb_typeof(p_patch->'compliance_score') <> 'number' then
    raise exception using errcode='22023', message='PENNSYNC_AUDIT_WRITE_SCORE_INVALID';
  end if;

  -- A key present with a JSON null is written as null, deliberately.
  -- `buildAuditFields` ALWAYS sends `acknowledgment`, as null when the nurse
  -- acknowledged nothing, and its own comment says why: omitting the key on a
  -- re-save left the prior override stamp on the audit, so the record still
  -- claimed findings were acknowledged that the note no longer has.
  v_row := pg_catalog.jsonb_populate_record(v_existing, p_patch);
  v_row."updated_date" := clock_timestamp();
  v_assignments := (select pg_catalog.string_agg(
    pg_catalog.format('%I = ($1).%I', k, k), ', ' order by k)
    from jsonb_object_keys(p_patch) k);
  execute pg_catalog.format(
    'update "pennsync_records"."compliance_audit" as t set %s,'
    || ' "updated_date" = ($1)."updated_date"'
    || ' where t."source_app_id" = $2 and t."id" = $3', v_assignments)
    using v_row, "pennsync_records".deployment_app(), p_audit_id;
  -- `execute` does not set `found`; only `get diagnostics` sees its row count.
  get diagnostics v_written = row_count;
  if v_written <> 1 then
    raise exception using errcode='42501', message='PENNSYNC_AUDIT_WRITE_NOT_FOUND';
  end if;
  select a.* into v_row from "pennsync_records"."compliance_audit" a
  where a."source_app_id" = "pennsync_records".deployment_app() and a."id" = p_audit_id;
  return jsonb_build_object('success', true, 'updated', true,
    'audit', "pennsync_records".compliance_audit_row(v_row));
end $contract$;

/* ------------------------------------------------------------ adr audit case */

create function "pennsync_records".adr_case_writable(p_field text)
  returns boolean language sql immutable set search_path = '' as $writable$
  select p_field in ('case_name', 'status', 'audit_type', 'contractor_name',
    'patient_name', 'patient_id', 'medicare_number', 'claim_number',
    'dates_of_service', 'letter_date', 'response_due_date', 'letter_file_url',
    'letter_analysis', 'checklist', 'packet_file_url', 'packet_page_count',
    'verification_summary', 'final_packet_url', 'final_packet_pages', 'notes',
    'submission_faxes', 'outcome', 'decision_date', 'appeal_due_date',
    'outcome_notes');
$writable$;

create function "pennsync_records".adr_case_reserved(p_field text)
  returns boolean language sql immutable set search_path = '' as $reserved$
  -- `deadline_reminders` is divergence 3: the sweep's marker, not a caller's.
  select p_field in ('id', 'source_app_id', 'agency_id', 'created_by',
    'created_date', 'updated_date', 'deadline_reminders');
$reserved$;

create function "pennsync_records".adr_case_row(
  r "pennsync_records"."adr_audit_case") returns jsonb
  language sql stable set search_path = '' as $row$
  -- The read half's projection exactly, including its three absent locators:
  -- a write that answered with one would hand back what the read refuses.
  select jsonb_build_object(
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
    'agency_id', r."agency_id");
$row$;

-- Shared by create and update: the enums the table constrains, the three
-- locators, and the chart. Validated here rather than left to the CHECK
-- constraints, because a check violation raises a code the HTTP boundary
-- cannot classify and the caller is told nothing about which field it was.
create function "pennsync_records".adr_case_validate(
  p_payload jsonb, p_agency text) returns void
  language plpgsql stable set search_path = '' as $validate$
declare v_patient text;
begin
  if p_payload ? 'status' and coalesce(p_payload->>'status', '') not in
    ('letter_uploaded', 'checklist_ready', 'packet_uploaded', 'packet_verified',
     'packet_generated', 'submitted', 'closed') then
    raise exception using errcode='22023', message='PENNSYNC_ADR_WRITE_STATUS_INVALID';
  end if;
  if p_payload ? 'audit_type' and coalesce(p_payload->>'audit_type', '') not in
    ('mac_adr', 'tpe', 'rcd', 'upic', 'smrc', 'cert', 'ra', 'managed_care',
     'state_survey', 'other') then
    raise exception using errcode='22023', message='PENNSYNC_ADR_WRITE_TYPE_INVALID';
  end if;
  if p_payload ? 'outcome' and coalesce(p_payload->>'outcome', '') not in
    ('pending', 'paid_in_full', 'partially_denied', 'fully_denied', 'appealed',
     'appeal_favorable', 'appeal_unfavorable') then
    raise exception using errcode='22023', message='PENNSYNC_ADR_WRITE_OUTCOME_INVALID';
  end if;
  perform "pennsync_records".compliance_write_locator(
    p_payload->>'letter_file_url', 'PENNSYNC_ADR_WRITE_LOCATOR_UNSUPPORTED');
  perform "pennsync_records".compliance_write_locator(
    p_payload->>'packet_file_url', 'PENNSYNC_ADR_WRITE_LOCATOR_UNSUPPORTED');
  perform "pennsync_records".compliance_write_locator(
    p_payload->>'final_packet_url', 'PENNSYNC_ADR_WRITE_LOCATOR_UNSUPPORTED');
  if p_payload ? 'patient_id' then
    v_patient := nullif(pg_catalog.btrim(coalesce(p_payload->>'patient_id', '')), '');
    -- Divergence 6. The helper keeps a chart this store does not carry, which
    -- is deliberate: unresolvable is not proved crossed.
    if v_patient is not null
      and not "pennsync_records".chart_not_elsewhere(v_patient, p_agency) then
      raise exception using errcode='42501', message='PENNSYNC_ADR_WRITE_CHART_ELSEWHERE';
    end if;
  end if;
end $validate$;

create function "pennsync_records".contract_adr_case_create(
  p_agency text, p_case jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_role text; v_email text; v_field text; v_row "pennsync_records"."adr_audit_case";
  v_now timestamptz;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_ADR_WRITE_AGENCY_NOT_HELD';
  end if;
  if p_case is null or jsonb_typeof(p_case) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_ADR_WRITE_PAYLOAD_INVALID';
  end if;
  for v_field in select jsonb_object_keys(p_case) loop
    if "pennsync_records".adr_case_reserved(v_field) then
      raise exception using errcode='22023', message='PENNSYNC_ADR_WRITE_FIELD_RESERVED';
    end if;
    if not "pennsync_records".adr_case_writable(v_field) then
      raise exception using errcode='22023', message='PENNSYNC_ADR_WRITE_FIELD_UNKNOWN';
    end if;
  end loop;
  -- The entity requires no field ("metadata arrives from AI analysis after
  -- create", its own comment says), and the empty-body guard is D43's: an
  -- accidental call would otherwise file a blank case.
  if (select pg_catalog.count(*) from jsonb_object_keys(p_case)) = 0 then
    raise exception using errcode='22023', message='PENNSYNC_ADR_WRITE_PAYLOAD_INVALID';
  end if;
  perform "pennsync_records".adr_case_validate(p_case, p_agency);

  v_email := "pennsync_records".caller_email();
  if v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_ADR_WRITE_AGENCY_NOT_HELD';
  end if;
  v_now := clock_timestamp();
  v_row := pg_catalog.jsonb_populate_record(
    null::"pennsync_records"."adr_audit_case", p_case);
  v_row."source_app_id" := "pennsync_records".deployment_app();
  v_row."id" := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
  v_row."agency_id" := p_agency;
  v_row."created_by" := v_email;
  v_row."created_date" := v_now;
  v_row."updated_date" := v_now;
  v_row."patient_id" := nullif(pg_catalog.btrim(coalesce(p_case->>'patient_id', '')), '');
  v_row."status" := coalesce(nullif(coalesce(p_case->>'status', ''), ''), 'letter_uploaded');
  v_row."audit_type" := coalesce(nullif(coalesce(p_case->>'audit_type', ''), ''), 'other');
  v_row."outcome" := coalesce(nullif(coalesce(p_case->>'outcome', ''), ''), 'pending');
  -- Normalised through the SAME helper that validated them, rather than left
  -- as `jsonb_populate_record` wrote them: an empty string is no locator, and
  -- storing `''` beside a null in the same column is a second representation
  -- of absence that every reader would then have to know about.
  v_row."letter_file_url" := "pennsync_records".compliance_write_locator(
    p_case->>'letter_file_url', 'PENNSYNC_ADR_WRITE_LOCATOR_UNSUPPORTED');
  v_row."packet_file_url" := "pennsync_records".compliance_write_locator(
    p_case->>'packet_file_url', 'PENNSYNC_ADR_WRITE_LOCATOR_UNSUPPORTED');
  v_row."final_packet_url" := "pennsync_records".compliance_write_locator(
    p_case->>'final_packet_url', 'PENNSYNC_ADR_WRITE_LOCATOR_UNSUPPORTED');
  v_row."notes" := case when jsonb_typeof(p_case->'notes') = 'array'
    then p_case->'notes' else '[]'::jsonb end;
  v_row."submission_faxes" := case
    when jsonb_typeof(p_case->'submission_faxes') = 'array'
    then p_case->'submission_faxes' else '[]'::jsonb end;

  insert into "pennsync_records"."adr_audit_case" values (v_row.*) returning * into v_row;
  return jsonb_build_object('success', true,
    'case', "pennsync_records".adr_case_row(v_row));
end $contract$;

create function "pennsync_records".contract_adr_case_update(
  p_agency text, p_case_id text, p_patch jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_role text; v_email text; v_admin boolean; v_field text;
  v_existing "pennsync_records"."adr_audit_case";
  v_row "pennsync_records"."adr_audit_case"; v_assignments text; v_written integer;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_ADR_WRITE_AGENCY_NOT_HELD';
  end if;
  if p_case_id is null or p_case_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_ADR_WRITE_ID_INVALID';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
    or (select pg_catalog.count(*) from jsonb_object_keys(p_patch)) = 0 then
    raise exception using errcode='22023', message='PENNSYNC_ADR_WRITE_PAYLOAD_INVALID';
  end if;
  for v_field in select jsonb_object_keys(p_patch) loop
    if "pennsync_records".adr_case_reserved(v_field) then
      raise exception using errcode='22023', message='PENNSYNC_ADR_WRITE_FIELD_RESERVED';
    end if;
    if not "pennsync_records".adr_case_writable(v_field) then
      raise exception using errcode='22023', message='PENNSYNC_ADR_WRITE_FIELD_UNKNOWN';
    end if;
  end loop;
  perform "pennsync_records".adr_case_validate(p_patch, p_agency);

  v_email := "pennsync_records".caller_email();
  v_admin := v_role = 'agency_admin';
  -- `for update` so the read-modify-write arrays below are read and written
  -- under one lock. The row exists, so this really serializes — which is the
  -- half D33 warns does NOT hold when the row is being created.
  select c.* into v_existing from "pennsync_records"."adr_audit_case" c
  where c."source_app_id" = "pennsync_records".deployment_app()
    and c."id" = p_case_id and c."agency_id" = p_agency
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_ADR_WRITE_NOT_FOUND';
  end if;
  if not v_admin and v_existing."created_by" is distinct from v_email then
    raise exception using errcode='42501', message='PENNSYNC_ADR_WRITE_NOT_OWNED';
  end if;

  -- Divergence 5. Compared against the row under the lock rather than against
  -- what the caller last read, which is the only comparison that can see the
  -- entry a concurrent fax added.
  if p_patch ? 'submission_faxes' then
    perform "pennsync_records".compliance_write_no_shrink(p_patch->'submission_faxes',
      v_existing."submission_faxes", 'PENNSYNC_ADR_WRITE_FAXES_TRUNCATED');
  end if;
  if p_patch ? 'notes' then
    perform "pennsync_records".compliance_write_no_shrink(p_patch->'notes',
      v_existing."notes", 'PENNSYNC_ADR_WRITE_NOTES_TRUNCATED');
  end if;

  v_row := pg_catalog.jsonb_populate_record(v_existing, p_patch);
  v_row."updated_date" := clock_timestamp();
  if p_patch ? 'patient_id' then
    v_row."patient_id" := nullif(pg_catalog.btrim(coalesce(p_patch->>'patient_id', '')), '');
  end if;
  -- As on create, and only for a key the patch named: absence stays absence.
  if p_patch ? 'letter_file_url' then
    v_row."letter_file_url" := "pennsync_records".compliance_write_locator(
      p_patch->>'letter_file_url', 'PENNSYNC_ADR_WRITE_LOCATOR_UNSUPPORTED');
  end if;
  if p_patch ? 'packet_file_url' then
    v_row."packet_file_url" := "pennsync_records".compliance_write_locator(
      p_patch->>'packet_file_url', 'PENNSYNC_ADR_WRITE_LOCATOR_UNSUPPORTED');
  end if;
  if p_patch ? 'final_packet_url' then
    v_row."final_packet_url" := "pennsync_records".compliance_write_locator(
      p_patch->>'final_packet_url', 'PENNSYNC_ADR_WRITE_LOCATOR_UNSUPPORTED');
  end if;
  v_assignments := (select pg_catalog.string_agg(
    pg_catalog.format('%I = ($1).%I', k, k), ', ' order by k)
    from jsonb_object_keys(p_patch) k);
  execute pg_catalog.format(
    'update "pennsync_records"."adr_audit_case" as t set %s,'
    || ' "updated_date" = ($1)."updated_date"'
    || ' where t."source_app_id" = $2 and t."id" = $3 and t."agency_id" = $4',
    v_assignments)
    using v_row, "pennsync_records".deployment_app(), p_case_id, p_agency;
  get diagnostics v_written = row_count;
  if v_written <> 1 then
    raise exception using errcode='42501', message='PENNSYNC_ADR_WRITE_NOT_FOUND';
  end if;
  select c.* into v_row from "pennsync_records"."adr_audit_case" c
  where c."source_app_id" = "pennsync_records".deployment_app()
    and c."id" = p_case_id and c."agency_id" = p_agency;
  return jsonb_build_object('success', true, 'updated', true,
    'case', "pennsync_records".adr_case_row(v_row));
end $contract$;

create function "pennsync_records".contract_adr_case_delete(
  p_agency text, p_case_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_role text; v_email text; v_admin boolean;
  v_existing "pennsync_records"."adr_audit_case"; v_written integer;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_ADR_WRITE_AGENCY_NOT_HELD';
  end if;
  if p_case_id is null or p_case_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_ADR_WRITE_ID_INVALID';
  end if;
  v_email := "pennsync_records".caller_email();
  v_admin := v_role = 'agency_admin';
  select c.* into v_existing from "pennsync_records"."adr_audit_case" c
  where c."source_app_id" = "pennsync_records".deployment_app()
    and c."id" = p_case_id and c."agency_id" = p_agency
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_ADR_WRITE_NOT_FOUND';
  end if;
  if not v_admin and v_existing."created_by" is distinct from v_email then
    raise exception using errcode='42501', message='PENNSYNC_ADR_WRITE_NOT_OWNED';
  end if;

  delete from "pennsync_records"."adr_audit_case" c
  where c."source_app_id" = "pennsync_records".deployment_app()
    and c."id" = p_case_id and c."agency_id" = p_agency;
  get diagnostics v_written = row_count;
  if v_written <> 1 then
    raise exception using errcode='42501', message='PENNSYNC_ADR_WRITE_NOT_FOUND';
  end if;
  -- The deleted case is answered in full rather than as a bare id: the screen
  -- that asked has already dropped it from its list, and a caller that cannot
  -- see what it removed cannot report it either.
  return jsonb_build_object('success', true, 'deleted', true,
    'case', "pennsync_records".adr_case_row(v_existing));
end $contract$;

reset role;

/* ----------------------------------------------------------------- grants */

-- PostgreSQL grants EXECUTE to PUBLIC by default, so these revokes are what
-- decide who may call these, not the grants under them.
revoke all on function "pennsync_records".compliance_write_locator(text,text)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".compliance_write_no_shrink(jsonb,jsonb,text)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".compliance_audit_writable(text)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".compliance_audit_reserved(text)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".compliance_audit_row("pennsync_records"."compliance_audit")
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".adr_case_writable(text)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".adr_case_reserved(text)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".adr_case_row("pennsync_records"."adr_audit_case")
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".adr_case_validate(jsonb,text)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_compliance_audit_create(text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_compliance_audit_update(text,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_adr_case_create(text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_adr_case_update(text,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_adr_case_delete(text,text)
  from public, anon, authenticated, service_role;

grant execute on function "pennsync_records".contract_compliance_audit_create(text,jsonb)
  to authenticated;
grant execute on function "pennsync_records".contract_compliance_audit_update(text,text,jsonb)
  to authenticated;
grant execute on function "pennsync_records".contract_adr_case_create(text,jsonb)
  to authenticated;
grant execute on function "pennsync_records".contract_adr_case_update(text,text,jsonb)
  to authenticated;
grant execute on function "pennsync_records".contract_adr_case_delete(text,text)
  to authenticated;

/* -------------------------------------------------------- public wrappers */

create function "public"."pennsync_contract_compliance_audit_create"(
  p_agency text, p_audit jsonb) returns jsonb
  language sql set search_path = '' as $wrapper$
  select "pennsync_records".contract_compliance_audit_create(p_agency, p_audit);
$wrapper$;

create function "public"."pennsync_contract_compliance_audit_update"(
  p_agency text, p_audit_id text, p_patch jsonb) returns jsonb
  language sql set search_path = '' as $wrapper$
  select "pennsync_records".contract_compliance_audit_update(p_agency, p_audit_id, p_patch);
$wrapper$;

create function "public"."pennsync_contract_adr_case_create"(
  p_agency text, p_case jsonb) returns jsonb
  language sql set search_path = '' as $wrapper$
  select "pennsync_records".contract_adr_case_create(p_agency, p_case);
$wrapper$;

create function "public"."pennsync_contract_adr_case_update"(
  p_agency text, p_case_id text, p_patch jsonb) returns jsonb
  language sql set search_path = '' as $wrapper$
  select "pennsync_records".contract_adr_case_update(p_agency, p_case_id, p_patch);
$wrapper$;

create function "public"."pennsync_contract_adr_case_delete"(
  p_agency text, p_case_id text) returns jsonb
  language sql set search_path = '' as $wrapper$
  select "pennsync_records".contract_adr_case_delete(p_agency, p_case_id);
$wrapper$;

revoke all on function "public"."pennsync_contract_compliance_audit_create"(text,jsonb)
  from public, anon;
revoke all on function "public"."pennsync_contract_compliance_audit_update"(text,text,jsonb)
  from public, anon;
revoke all on function "public"."pennsync_contract_adr_case_create"(text,jsonb)
  from public, anon;
revoke all on function "public"."pennsync_contract_adr_case_update"(text,text,jsonb)
  from public, anon;
revoke all on function "public"."pennsync_contract_adr_case_delete"(text,text)
  from public, anon;

grant execute on function "public"."pennsync_contract_compliance_audit_create"(text,jsonb)
  to authenticated;
grant execute on function "public"."pennsync_contract_compliance_audit_update"(text,text,jsonb)
  to authenticated;
grant execute on function "public"."pennsync_contract_adr_case_create"(text,jsonb)
  to authenticated;
grant execute on function "public"."pennsync_contract_adr_case_update"(text,text,jsonb)
  to authenticated;
grant execute on function "public"."pennsync_contract_adr_case_delete"(text,text)
  to authenticated;
