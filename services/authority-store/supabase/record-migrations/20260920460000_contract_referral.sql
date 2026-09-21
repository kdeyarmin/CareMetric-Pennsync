-- Referral intake: the six-action broker, as one contract.
--
-- HAND WRITTEN, like every contract. `manageAuthorizedReferral` is the largest
-- capability in the migration at 1,275 lines, and the reason it is that large
-- is the reason this file is not: roughly two thirds of it are compensations
-- for having no transaction and no constraints, and a store that has both
-- deletes them rather than reimplementing them.
--
-- What goes, and why each one is safe to delete:
--
-- 1. `validateMembershipRows`, `validateActiveAssigneeMembership` and
--    `loadExactEnabledAgency` re-prove a membership row's whole canonical
--    lifecycle on every request — membership_key, both normalized addresses,
--    both transition actors, the instant, the reason, the version floor, the
--    status/timestamp coherence — because in Base44 any service-role writer
--    could half-write one. `pennsync_private.membership` holds all of it in
--    CHECK constraints. D34 and D35 already deleted the same forty-line
--    `validateMemberships`, and D46 deleted the same pair again.
-- 2. `loadAuthority(…, expectedSnapshot)` is called two to four times per
--    request and compares a ten-field snapshot each time. It exists because
--    the original's reads and its write are separate round trips and a
--    membership could be revoked between them. Here they are one transaction.
-- 3. `getReferral` reads the row, re-reads authority, reads the row AGAIN and
--    compares the two projections. `listReferrals` re-reads authority after
--    the page. `createReferral` re-reads the row, re-reads the creation key,
--    re-reads authority, and on any failure calls `removeCreatedReferral` to
--    delete what it just wrote and then verifies the delete. `updateReferral`
--    and `deleteReferral` each re-read and re-compare before writing and
--    verify every field afterwards. All of it is one `begin`/`commit` here.
-- 4. `MEMBERSHIP_SCAN_LIMIT`, `USER_SCAN_LIMIT` and `EXACT_ROW_LIMIT` fetch
--    N+1 rows to prove a lookup unambiguous, because the SDK pages and a
--    filter is not a key. `(source_app_id, id)` is the primary key here.
-- 5. `validateReferralIntegrity` re-derives `referral_creation_key` from the
--    row's own columns and re-validates provenance on every row of every
--    list. The key is a column with a unique index on it (D30).
--
-- What stays, because it is the capability rather than the plumbing: the
-- client field set, the three enum checks, the assignee resolution and its
-- seven-column provenance stamp, the follow-up capability fields, the
-- creation-key idempotency and its replay comparison, the declined and
-- soc_completed audit stamps, the same-agency visible-patient link check, and
-- the archive-on-remove.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. **The conditional versioned write becomes `select … for update`, and
--    nothing is lost — but read why before copying this.** The original writes
--    `where version = <what I just read> and updated_date = <what I just read>`
--    and answers 409 when that matches nothing. That looks like optimistic
--    concurrency and is NOT: the client sends no version, so the predicate is
--    built from a read this same handler performed microseconds earlier. It
--    protects the handler from itself, which is what a transaction does for
--    free. Contrast `updateFleetVehicle` (D46) and `contract_patient_update`
--    (D29), whose originals take an `expected_version` and an
--    `expected_updated_date` FROM THE CALLER: those are a real client
--    invariant and both ports keep them. Read where the expectation comes from
--    before deciding a version check is machinery.
-- 2. **`list_assignees` needs no SQL here.** It lists `AgencyMembership`,
--    then for EVERY row calls `loadExactAssignee`, which runs two more
--    queries — a membership filter and a `User` filter — and re-proves both.
--    That is `pennsync_private.agency_roster` (D48) filtered to three roles,
--    in one statement. D34's rule again: check which store already models
--    what the original reads.
-- 3. **`full_name` is always null.** The carried `user` table has no name
--    column, as D38 recorded and D46 recorded again. The original projects
--    `user.full_name` here and the client accepts null for it, so the shape
--    holds; the answer is the verified address, which the client already has.
-- 4. **The membership id and version stamped on an assignment are THIS
--    store's**, as D34 settled for `contract_note_history`: the original
--    stamps Base44's `AgencyMembership.id`, and that row is not the authority
--    here.
-- 5. **D24 narrows this capability and the narrowing is not the contract's.**
--    `referral` has `agency_id` and a top-level `patient_id`, so its policies
--    carry the chart rule: an `office_staff` member opens no chart, and a
--    referral that names a patient is part of that chart. So an office_staff
--    caller — an intake role, and the one whose job this is — sees referrals
--    that name no patient and loses one the moment it is linked, and cannot
--    create a linked one at all. That is D24 working as decided, recorded
--    here rather than worked around, exactly as `contract_patient_update`
--    records its two. An `agency_admin` or `manager` opens every chart and is
--    unaffected.
-- 6. **The role gate is the original's `INTAKE_ROLES` and is NARROWER than
--    D24.** `agency_admin`, `manager` and `office_staff` may use referral
--    intake; a `clinician` may be ASSIGNED a referral and still cannot list,
--    read or edit one through this capability. The two sets are different on
--    purpose in the original and are different on purpose here — delete
--    either and the policies would admit a clinician to the whole intake
--    queue.
-- 7. **A top-level null is stripped from the answer.** The original builds its
--    response with `pickFields`, which yields `undefined` for a column that
--    was never set, and `Response.json` drops those keys. `jsonb_build_object`
--    keeps them as JSON null, and the published client reads
--    `referral.status === undefined || STATUSES.has(referral.status)` — so a
--    null `status` would fail an integrity check that an absent one passes.
--    Stripped at the TOP LEVEL only: `jsonb_strip_nulls` is recursive and
--    would reach inside `extracted_data` and `analysis_results`, editing a
--    caller's own payload on the way out.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.caller_tenant_role(text)') is null
    or to_regprocedure('pennsync_private.agency_roster(text)') is null
    or to_regprocedure('pennsync_private.caller_membership(text)') is null then
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

-- The original's `CLIENT_REFERRAL_FIELDS`, by NAME. Named rather than fenced
-- because the original does not fence it, which is the same reason
-- `WRITE_POLICIES` names a declaration instead of extracting one.
create function "pennsync_records".referral_client_field(p_field text)
  returns boolean language sql immutable set search_path = '' as $fields$
  select p_field in ('patient_name', 'patient_id', 'patient_dob', 'diagnosis',
    'referral_source', 'referral_date', 'estimated_start_date', 'document_type',
    'priority', 'status', 'soc_date', 'first_visit_date', 'document_url',
    'processed_document_url', 'page_range', 'detection_confidence',
    'manually_confirmed', 'requires_manual_review', 'assigned_to',
    'match_confidence', 'match_factors', 'match_suggestions', 'match_analysis',
    'analysis_results', 'missing_information', 'discrepancies',
    'ai_generated_tasks', 'extracted_data', 'diagnosis_coding',
    'follow_up_requests', 'follow_up_notes')
$fields$;

-- The fourteen keys inside `follow_up_requests` that belong to a capability
-- rather than to a caller: the provider portal's token and submission
-- provenance, the inbound-fax binding only `processInboundFaxes` may write,
-- and the stale worker's claim and publication markers. A client edit must not
-- reset a claim, manufacture a completed alert, or retry an uncertain
-- publication — so these are removed from what a caller sends and, on update,
-- carried across from the stored row.
create function "pennsync_records".referral_follow_up_reserved(p_field text)
  returns boolean language sql immutable set search_path = '' as $reserved$
  select p_field in ('portal_link_active', 'portal_token_id',
    'portal_token_snapshot_hash', 'portal_token_issued_at',
    'portal_token_expires_at', 'portal_submission_id', 'portal_submission_hash',
    'portal_submitted_at', 'fax_back', 'stale_notified_at',
    'stale_notification_key', 'stale_notification_claimed_by',
    'stale_notification_claimed_at', 'stale_notification_publish_started_at')
$reserved$;

-- The original's `RESPONSE_FIELDS`, projected by name. `select *` is never the
-- answer (D64): a column added to the table must not appear in a published
-- response because somebody regenerated a migration.
create function "pennsync_records".referral_row(r "pennsync_records"."referral")
  returns jsonb language sql immutable set search_path = '' as $row$
  select coalesce(
    (select jsonb_object_agg(e.key, e.value)
     from jsonb_each(jsonb_build_object(
       'id', r."id",
       'agency_id', r."agency_id",
       'version', r."version",
       'created_date', r."created_date",
       'updated_date', r."updated_date",
       'patient_name', r."patient_name",
       'patient_id', r."patient_id",
       'patient_dob', r."patient_dob",
       'diagnosis', r."diagnosis",
       'referral_source', r."referral_source",
       'referral_date', r."referral_date",
       'estimated_start_date', r."estimated_start_date",
       'document_type', r."document_type",
       'priority', r."priority",
       'status', r."status",
       'soc_date', r."soc_date",
       'first_visit_date', r."first_visit_date",
       'document_url', r."document_url",
       'processed_document_url', r."processed_document_url",
       'page_range', r."page_range",
       'detection_confidence', r."detection_confidence",
       'manually_confirmed', r."manually_confirmed",
       'requires_manual_review', r."requires_manual_review",
       'assigned_to', r."assigned_to",
       'match_confidence', r."match_confidence",
       'match_factors', r."match_factors",
       'match_suggestions', r."match_suggestions",
       'match_analysis', r."match_analysis",
       'analysis_results', r."analysis_results",
       'missing_information', r."missing_information",
       'discrepancies', r."discrepancies",
       'ai_generated_tasks', r."ai_generated_tasks",
       'extracted_data', r."extracted_data",
       'diagnosis_coding', r."diagnosis_coding",
       'follow_up_requests', r."follow_up_requests",
       'follow_up_notes', r."follow_up_notes",
       'rejection_date', r."rejection_date",
       'rejected_by', r."rejected_by",
       'soc_completed_by', r."soc_completed_by",
       'assigned_to_user_id', r."assigned_to_user_id",
       'assigned_to_membership_id', r."assigned_to_membership_id",
       'assigned_to_membership_version', r."assigned_to_membership_version",
       'assigned_at', r."assigned_at",
       'assigned_by_user_id', r."assigned_by_user_id",
       'assigned_by_user_email_normalized', r."assigned_by_user_email_normalized")) e
     where e.value <> 'null'::jsonb),
    '{}'::jsonb)
$row$;

-- The caller's own membership, in the shape the published client validates:
-- exactly `agency_id`, `membership_id`, `membership_version`, `tenant_role`.
create function "pennsync_records".referral_scope(p_agency text, p_role text)
  returns jsonb language sql stable set search_path = '' as $scope$
  select jsonb_build_object('agency_id', p_agency,
    'membership_id', m.membership_id, 'membership_version', m.membership_version,
    'tenant_role', p_role)
  from pennsync_private.caller_membership(p_agency) m
$scope$;

-- The role gate and the scope in one place, because six entry points open the
-- same way and a second copy is a second thing to keep honest.
create function "pennsync_records".referral_authority(p_agency text)
  returns jsonb language plpgsql stable security definer set search_path = '' as $authority$
declare v_role text; v_scope jsonb;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_REFERRAL_AGENCY_NOT_HELD';
  end if;
  -- `INTAKE_ROLES`. Narrower than D24 and narrower than the assignee set: a
  -- clinician may be assigned a referral and may not work the intake queue.
  if v_role not in ('agency_admin', 'manager', 'office_staff') then
    raise exception using errcode='42501', message='PENNSYNC_REFERRAL_FORBIDDEN';
  end if;
  v_scope := "pennsync_records".referral_scope(p_agency, v_role);
  if v_scope is null then
    raise exception using errcode='42501', message='PENNSYNC_REFERRAL_AGENCY_NOT_HELD';
  end if;
  return v_scope;
end $authority$;

-- `exactIdentifier`: a bounded, untrimmed-free, control-character-free string
-- that cannot start with `$`, because a Base44 filter value beginning with one
-- is an operator rather than a value.
create function "pennsync_records".referral_exact_identifier(p_value text)
  returns boolean language sql immutable set search_path = '' as $exact$
  select p_value is not null and p_value <> '' and pg_catalog.length(p_value) <= 200
    and pg_catalog.btrim(p_value) = p_value
    and pg_catalog.left(p_value, 1) <> '$'
    and p_value !~ '[\u0000-\u001f\u007f]'
$exact$;

-- `canonicalEmail`: trimmed, lower-cased, at most 320 characters, contains an
-- `@`, contains no whitespace. Null when it is none of those.
create function "pennsync_records".referral_canonical_email(p_value text)
  returns text language sql immutable set search_path = '' as $email$
  select case
    when p_value is null then null
    when pg_catalog.lower(pg_catalog.btrim(p_value)) = '' then null
    when pg_catalog.length(pg_catalog.lower(pg_catalog.btrim(p_value))) > 320 then null
    when pg_catalog.strpos(pg_catalog.lower(pg_catalog.btrim(p_value)), '@') = 0 then null
    when pg_catalog.lower(pg_catalog.btrim(p_value)) ~ '\s' then null
    else pg_catalog.lower(pg_catalog.btrim(p_value))
  end
$email$;

-- `validInstant`, which the follow-up preservation asks of both sides. A jsonb
-- string that names a moment, or null. Wrapped because a cast that fails must
-- answer "not an instant" rather than abort the transaction.
create function "pennsync_records".referral_instant(p_value jsonb)
  returns timestamptz language plpgsql immutable set search_path = '' as $instant$
declare v_out timestamptz;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'string' then return null; end if;
  begin
    v_out := (p_value #>> '{}')::timestamptz;
  exception when others then
    return null;
  end;
  return v_out;
end $instant$;

-- The stale worker's dedupe key is the INSTANT, not its text. A client that
-- reformats the same moment — an offset instead of a Z, a fractional second
-- dropped — must not reset a claim, so the two are compared as timestamps.
create function "pennsync_records".referral_follow_up_preserved(
  p_current jsonb, p_requested jsonb)
  returns jsonb language plpgsql immutable set search_path = '' as $preserve$
declare v_out jsonb; v_field text;
begin
  if p_requested is null or jsonb_typeof(p_requested) <> 'object' then
    return p_requested;
  end if;
  v_out := p_requested;
  if p_current is null or jsonb_typeof(p_current) <> 'object' then return v_out; end if;
  if "pennsync_records".referral_instant(p_current -> 'generated_at') is null
    or "pennsync_records".referral_instant(p_current -> 'generated_at')
      is distinct from "pennsync_records".referral_instant(p_requested -> 'generated_at') then
    return v_out;
  end if;
  -- `current[field] !== undefined` is a test for the KEY, so a stored null
  -- carries across as a null rather than being left off.
  for v_field in select jsonb_object_keys(p_current) loop
    if "pennsync_records".referral_follow_up_reserved(v_field) then
      v_out := jsonb_set(v_out, array[v_field], p_current -> v_field, true);
    end if;
  end loop;
  return v_out;
end $preserve$;

-- `validateBusinessFields`, which is the whole of what a caller may say about
-- a referral. Every refusal here is the original's, in its order.
create function "pennsync_records".referral_business_fields(p_payload jsonb)
  returns jsonb language plpgsql immutable set search_path = '' as $fields$
declare v_out jsonb; v_field text; v_follow jsonb; v_email text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_REFERRAL_FIELDS_INVALID';
  end if;
  if p_payload = '{}'::jsonb then
    raise exception using errcode='22023', message='PENNSYNC_REFERRAL_FIELDS_EMPTY';
  end if;
  for v_field in select jsonb_object_keys(p_payload) loop
    if not "pennsync_records".referral_client_field(v_field) then
      raise exception using errcode='22023', message='PENNSYNC_REFERRAL_FIELD_UNKNOWN';
    end if;
  end loop;
  v_out := p_payload;

  if v_out ? 'follow_up_requests' then
    if jsonb_typeof(v_out -> 'follow_up_requests') <> 'object' then
      raise exception using errcode='22023', message='PENNSYNC_REFERRAL_FOLLOW_UP_INVALID';
    end if;
    v_follow := v_out -> 'follow_up_requests';
    for v_field in select jsonb_object_keys(v_follow) loop
      if "pennsync_records".referral_follow_up_reserved(v_field) then
        v_follow := v_follow - v_field;
      end if;
    end loop;
    -- Stripping every key means the caller asked to change nothing a caller
    -- owns, which is a refusal rather than an empty write.
    if v_follow = '{}'::jsonb then
      raise exception using errcode='22023', message='PENNSYNC_REFERRAL_FOLLOW_UP_EMPTY';
    end if;
    v_out := jsonb_set(v_out, '{follow_up_requests}', v_follow, true);
  end if;

  if v_out ? 'patient_id' and v_out -> 'patient_id' <> 'null'::jsonb then
    if jsonb_typeof(v_out -> 'patient_id') <> 'string'
      or not "pennsync_records".referral_exact_identifier(v_out ->> 'patient_id') then
      raise exception using errcode='22023', message='PENNSYNC_REFERRAL_PATIENT_ID_INVALID';
    end if;
  end if;
  -- An explicit null status or priority is refused, and an explicit null
  -- document_type is not. That asymmetry is the original's `String(output.x)`
  -- against `output.x !== null`, and it is kept rather than tidied: a caller
  -- who clears the document type is saying something a caller who clears the
  -- status is not.
  if v_out ? 'status' and coalesce(v_out ->> 'status', '') not in ('new', 'pending',
    'processing', 'awaiting_info', 'active', 'declined', 'ready_for_admission',
    'soc_completed') then
    raise exception using errcode='22023', message='PENNSYNC_REFERRAL_STATUS_INVALID';
  end if;
  if v_out ? 'priority' and coalesce(v_out ->> 'priority', '') not in ('low', 'normal',
    'high', 'urgent') then
    raise exception using errcode='22023', message='PENNSYNC_REFERRAL_PRIORITY_INVALID';
  end if;
  if v_out ? 'document_type' and v_out -> 'document_type' <> 'null'::jsonb
    and coalesce(v_out ->> 'document_type', '') not in ('pdf', 'fax', 'image',
      'manual', 'electronic') then
    raise exception using errcode='22023', message='PENNSYNC_REFERRAL_DOCUMENT_TYPE_INVALID';
  end if;
  if v_out ? 'assigned_to' and v_out -> 'assigned_to' <> 'null'::jsonb then
    v_email := case when jsonb_typeof(v_out -> 'assigned_to') = 'string'
      then "pennsync_records".referral_canonical_email(v_out ->> 'assigned_to') end;
    if v_email is null then
      raise exception using errcode='22023', message='PENNSYNC_REFERRAL_ASSIGNEE_INVALID';
    end if;
    v_out := jsonb_set(v_out, '{assigned_to}', to_jsonb(v_email), true);
  end if;
  return v_out;
end $fields$;

-- `serverAuditFields`. The three columns here are not in the client field set,
-- so a caller cannot send them; the contract decides them from the status
-- being written, which is what makes a rejection record trustworthy.
create function "pennsync_records".referral_audit_fields(
  p_fields jsonb, p_email text, p_now timestamptz)
  returns jsonb language sql immutable set search_path = '' as $audit$
  select case
    when p_fields ->> 'status' = 'declined' then p_fields
      || jsonb_build_object('rejection_date', to_jsonb(p_now),
           'rejected_by', to_jsonb(p_email))
    when p_fields ->> 'status' = 'soc_completed' then p_fields
      || jsonb_build_object('soc_completed_by', to_jsonb(p_email))
    else p_fields
  end
$audit$;

-- One assignee, by address, with the seven columns an assignment stamps.
-- `agency_roster` (D48) is the general form of the three one-off membership
-- lookups written before it, and it already returns the membership id and
-- version this needs — which `agency_colleague` does not. Its own agency gate
-- cannot refuse here: `referral_authority` has already asked the same question
-- with the same caller in the same transaction.
create function "pennsync_records".referral_assignment(
  p_agency text, p_email text, p_user text, p_now timestamptz)
  returns jsonb language plpgsql stable security definer set search_path = '' as $assign$
declare v_row record;
begin
  select r.base44_user_id, r.tenant_role, r.expected_email,
    r.membership_id, r.membership_version
  into v_row from pennsync_private.agency_roster(p_agency) r
  where r.expected_email = p_email
    -- `REFERRAL_ASSIGNEE_ROLES`, which is not `INTAKE_ROLES`: a clinician may
    -- be given a referral and may not work the queue, and an office_staff
    -- member works the queue and may not be given one.
    and r.tenant_role in ('agency_admin', 'manager', 'clinician');
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_REFERRAL_ASSIGNEE_UNAVAILABLE';
  end if;
  return jsonb_build_object(
    -- The VERIFIED address, never the one the caller typed: the two are equal
    -- here only because the lookup matched on it.
    'assigned_to', v_row.expected_email,
    'assigned_to_user_id', v_row.base44_user_id,
    -- THIS store's membership, as D34 settled. The original stamps Base44's
    -- `AgencyMembership.id`, which is not the authority here.
    'assigned_to_membership_id', v_row.membership_id,
    'assigned_to_membership_version', v_row.membership_version,
    'assigned_at', to_jsonb(p_now),
    'assigned_by_user_id', p_user,
    'assigned_by_user_email_normalized', "pennsync_records".caller_email());
end $assign$;

-- The same-agency patient check. The policies decide what is visible, so this
-- adds only what the original adds on top of tenancy: a real chart, not a
-- sample, not archived, in a status intake may link to.
create function "pennsync_records".referral_patient_linkable(p_agency text, p_patient text)
  returns void language plpgsql stable security definer set search_path = '' as $link$
begin
  if not exists (select 1 from "pennsync_records"."patient" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."id" = p_patient and p."agency_id" = p_agency
      and p."is_sample" is not distinct from false
      and p."is_archived" is not distinct from false
      and p."status" in ('active', 'hospitalized', 'discharged')) then
    raise exception using errcode='42501', message='PENNSYNC_REFERRAL_PATIENT_UNAVAILABLE';
  end if;
end $link$;

create function "pennsync_records".contract_referral_list(
  p_agency text, p_limit integer default 200, p_patient_id text default null,
  p_status text default null, p_assigned_to text default null)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_scope jsonb; v_rows jsonb; v_assigned text;
begin
  v_scope := "pennsync_records".referral_authority(p_agency);
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception using errcode='22023', message='PENNSYNC_REFERRAL_LIMIT_INVALID';
  end if;
  if p_patient_id is not null
    and not "pennsync_records".referral_exact_identifier(p_patient_id) then
    raise exception using errcode='22023', message='PENNSYNC_REFERRAL_PATIENT_ID_INVALID';
  end if;
  if p_status is not null and p_status not in ('new', 'pending', 'processing',
    'awaiting_info', 'active', 'declined', 'ready_for_admission', 'soc_completed') then
    raise exception using errcode='22023', message='PENNSYNC_REFERRAL_STATUS_INVALID';
  end if;
  if p_assigned_to is not null then
    v_assigned := "pennsync_records".referral_canonical_email(p_assigned_to);
    -- The original's rule and worth keeping as a rule: a caller may filter the
    -- queue down to their OWN referrals and may not ask who else has what.
    if v_assigned is null
      or v_assigned is distinct from "pennsync_records".caller_email() then
      raise exception using errcode='42501',
        message='PENNSYNC_REFERRAL_ASSIGNMENT_FILTER_FORBIDDEN';
    end if;
  end if;
  -- The page carries the whole ROW as a typed composite (`t as entry`) rather
  -- than its columns: `select t.*` in a subquery yields an untyped `record`,
  -- which cannot be passed to a function taking the table's composite type —
  -- the same trap D46 hit with `row_number()`.
  with page as (
    select t as entry, t."created_date" as created_date, t."id" as id
    from "pennsync_records"."referral" t
    where t."source_app_id" = "pennsync_records".deployment_app()
      and t."agency_id" = p_agency
      and t."archived_at" is null
      and (p_patient_id is null or t."patient_id" = p_patient_id)
      and (p_status is null or t."status" = p_status)
      and (v_assigned is null or t."assigned_to" = v_assigned)
    order by t."created_date" desc nulls last, t."id" desc
    limit p_limit
  )
  select coalesce(jsonb_agg("pennsync_records".referral_row(page.entry)
      order by page.created_date desc nulls last, page.id desc), '[]'::jsonb)
  into v_rows from page;
  return jsonb_build_object('referrals', v_rows, 'scope', v_scope);
end $contract$;

create function "pennsync_records".contract_referral_get(p_agency text, p_referral_id text)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_scope jsonb; v_row "pennsync_records"."referral";
begin
  v_scope := "pennsync_records".referral_authority(p_agency);
  if not "pennsync_records".referral_exact_identifier(p_referral_id) then
    raise exception using errcode='22023', message='PENNSYNC_REFERRAL_ID_INVALID';
  end if;
  select * into v_row from "pennsync_records"."referral" t
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."id" = p_referral_id and t."agency_id" = p_agency and t."archived_at" is null;
  -- Archived, absent, in another agency, and in a chart this caller does not
  -- open all answer the same way, which is what keeps a caller from learning
  -- that a referral they may not see exists.
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_REFERRAL_NOT_FOUND';
  end if;
  return jsonb_build_object('referral', "pennsync_records".referral_row(v_row),
    'scope', v_scope);
end $contract$;

create function "pennsync_records".contract_referral_assignees(p_agency text)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_scope jsonb; v_rows jsonb;
begin
  v_scope := "pennsync_records".referral_authority(p_agency);
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', r.base44_user_id,
      'email', r.expected_email,
      -- The carried `user` table has no name column (D38, D46). Null is a
      -- shape the published client already accepts, and the address beside it
      -- is what it would have displayed anyway.
      'full_name', null,
      'tenant_role', r.tenant_role,
      'membership_id', r.membership_id,
      'membership_version', r.membership_version)
    order by r.expected_email, r.base44_user_id), '[]'::jsonb)
  into v_rows from pennsync_private.agency_roster(p_agency) r
  where r.tenant_role in ('agency_admin', 'manager', 'clinician');
  return jsonb_build_object('assignees', v_rows, 'scope', v_scope);
end $contract$;

create function "pennsync_records".contract_referral_create(
  p_agency text, p_client_request_id text, p_referral jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_scope jsonb; v_user text; v_email text; v_key text; v_now timestamptz;
  v_client jsonb; v_fields jsonb; v_field text; v_constraint text;
  v_row "pennsync_records"."referral"; v_existing "pennsync_records"."referral";
begin
  v_scope := "pennsync_records".referral_authority(p_agency);
  if not "pennsync_records".referral_exact_identifier(p_client_request_id) then
    raise exception using errcode='22023', message='PENNSYNC_REFERRAL_REQUEST_ID_INVALID';
  end if;
  v_now := clock_timestamp();
  v_client := "pennsync_records".referral_business_fields(p_referral);
  v_user := "pennsync_records".caller_user_id();
  v_email := "pennsync_records".caller_email();
  if v_user is null or v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_REFERRAL_AGENCY_NOT_HELD';
  end if;
  v_fields := "pennsync_records".referral_audit_fields(v_client, v_email, v_now);
  if v_client ? 'assigned_to' then
    if v_client -> 'assigned_to' = 'null'::jsonb then
      -- The original DELETES the key on create rather than writing a null,
      -- because there is no provenance to clear on a row that does not exist.
      v_fields := v_fields - 'assigned_to';
    else
      v_fields := v_fields || "pennsync_records".referral_assignment(
        p_agency, v_client ->> 'assigned_to', v_user, v_now);
    end if;
  end if;
  if coalesce(v_fields ->> 'patient_id', '') <> '' then
    perform "pennsync_records".referral_patient_linkable(p_agency, v_fields ->> 'patient_id');
  end if;

  v_key := p_agency || ':' || v_user || ':' || p_client_request_id;
  select * into v_existing from "pennsync_records"."referral" t
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."referral_creation_key" = v_key;
  if found then
    -- A retry answers the referral it already made; a DIFFERENT payload under
    -- the same request id is a caller reusing an identifier, which is refused
    -- rather than silently answering somebody else's row. Compared field by
    -- field against what the caller sent, as the original does, and only the
    -- fields they sent.
    if coalesce(v_existing."version", 0) <> 1 then
      raise exception using errcode='22023', message='PENNSYNC_REFERRAL_REQUEST_CONFLICT';
    end if;
    for v_field in select jsonb_object_keys(v_client) loop
      if pg_catalog.to_jsonb(v_existing) -> v_field
        is distinct from v_client -> v_field then
        raise exception using errcode='22023', message='PENNSYNC_REFERRAL_REQUEST_CONFLICT';
      end if;
    end loop;
    return jsonb_build_object('created', false,
      'referral', "pennsync_records".referral_row(v_existing), 'scope', v_scope);
  end if;

  begin
    -- By column name rather than by a list this contract would keep in step
    -- with `referral_client_field`. Unknown keys cannot reach here, so nothing
    -- is dropped, and a value the column cannot hold raises rather than
    -- truncating.
    begin
      v_row := jsonb_populate_record(null::"pennsync_records"."referral", v_fields);
    exception when others then
      raise exception using errcode='22023', message='PENNSYNC_REFERRAL_FIELD_INVALID';
    end;
    v_row."source_app_id" := "pennsync_records".deployment_app();
    v_row."id" := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
    v_row."agency_id" := p_agency;
    v_row."created_by_user_id" := v_user;
    v_row."created_by_user_email_normalized" := v_email;
    v_row."created_by" := v_email;
    v_row."client_request_id" := p_client_request_id;
    v_row."referral_creation_key" := v_key;
    v_row."version" := 1;
    v_row."created_date" := v_now;
    v_row."updated_date" := v_now;
    insert into "pennsync_records"."referral" select (v_row).*;
  exception when unique_violation then
    -- The lookup above found nothing and the insert found a duplicate, so a
    -- concurrent request carrying the same key committed in between. The
    -- constraint is READ rather than assumed (D30): any other unique violation
    -- is a different defect and is re-raised untouched.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'referral_referral_creation_key_unique' then raise; end if;
    select * into v_existing from "pennsync_records"."referral" t
    where t."source_app_id" = "pennsync_records".deployment_app()
      and t."referral_creation_key" = v_key;
    if not found then
      raise exception using errcode='22023', message='PENNSYNC_REFERRAL_REQUEST_CONFLICT';
    end if;
    return jsonb_build_object('created', false,
      'referral', "pennsync_records".referral_row(v_existing), 'scope', v_scope);
  end;
  return jsonb_build_object('created', true,
    'referral', "pennsync_records".referral_row(v_row), 'scope', v_scope);
end $contract$;

create function "pennsync_records".contract_referral_update(
  p_agency text, p_referral_id text, p_changes jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_scope jsonb; v_user text; v_email text; v_now timestamptz;
  v_client jsonb; v_fields jsonb; v_assignments text; v_written integer;
  v_row "pennsync_records"."referral"; v_existing "pennsync_records"."referral";
begin
  v_scope := "pennsync_records".referral_authority(p_agency);
  if not "pennsync_records".referral_exact_identifier(p_referral_id) then
    raise exception using errcode='22023', message='PENNSYNC_REFERRAL_ID_INVALID';
  end if;
  v_now := clock_timestamp();
  v_client := "pennsync_records".referral_business_fields(p_changes);
  v_user := "pennsync_records".caller_user_id();
  v_email := "pennsync_records".caller_email();
  if v_user is null or v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_REFERRAL_AGENCY_NOT_HELD';
  end if;
  v_fields := "pennsync_records".referral_audit_fields(v_client, v_email, v_now);
  -- Resolved BEFORE the row is read, as the original resolves it, so an
  -- unavailable assignee is reported as one rather than as whatever the row
  -- lookup would have said.
  if v_client ? 'assigned_to' then
    if v_client -> 'assigned_to' = 'null'::jsonb then
      -- Clearing an assignment clears its whole provenance. Seven columns,
      -- because a row keeping `assigned_to_user_id` after `assigned_to` went
      -- says a person holds a referral that names nobody.
      v_fields := (v_fields - 'assigned_to') || jsonb_build_object(
        'assigned_to', null, 'assigned_to_user_id', null,
        'assigned_to_membership_id', null, 'assigned_to_membership_version', null,
        'assigned_at', null, 'assigned_by_user_id', null,
        'assigned_by_user_email_normalized', null);
    else
      v_fields := v_fields || "pennsync_records".referral_assignment(
        p_agency, v_client ->> 'assigned_to', v_user, v_now);
    end if;
  end if;

  -- Locked rather than read-then-compared. The original's `where version = …
  -- and updated_date = …` is built from a read IT performed, not from anything
  -- the caller sent, so it is protecting the handler from itself — which is
  -- what one transaction does.
  select * into v_existing from "pennsync_records"."referral" t
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."id" = p_referral_id and t."agency_id" = p_agency and t."archived_at" is null
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_REFERRAL_NOT_FOUND';
  end if;

  if v_fields ? 'follow_up_requests' then
    v_fields := jsonb_set(v_fields, '{follow_up_requests}',
      "pennsync_records".referral_follow_up_preserved(
        v_existing."follow_up_requests", v_fields -> 'follow_up_requests'), true);
  end if;
  if coalesce(v_fields ->> 'patient_id', '') <> '' then
    perform "pennsync_records".referral_patient_linkable(p_agency, v_fields ->> 'patient_id');
  end if;

  v_row := v_existing;
  begin
    v_row := jsonb_populate_record(v_row, v_fields);
  exception when others then
    raise exception using errcode='22023', message='PENNSYNC_REFERRAL_FIELD_INVALID';
  end;
  v_row."version" := coalesce(v_existing."version", 0) + 1;
  v_row."updated_date" := v_now;
  -- The set list is built from the keys that were SUPPLIED rather than from a
  -- column list of this contract's own, which is D29's rule: a hand-kept list
  -- would let a field added to the client set validate and then silently not
  -- be written. Every key here has already been proved by
  -- `referral_client_field` or written by this contract, and `%I` quotes it.
  v_assignments := (select pg_catalog.string_agg(
    pg_catalog.format('%I = ($1).%I', k, k), ', ' order by k)
    from jsonb_object_keys(v_fields) k);
  execute pg_catalog.format(
    'update "pennsync_records"."referral" as t set %s,'
    || ' "version" = ($1)."version", "updated_date" = ($1)."updated_date"'
    || ' where t."source_app_id" = $2 and t."id" = $3 and t."agency_id" = $4', v_assignments)
    using v_row, "pennsync_records".deployment_app(), p_referral_id, p_agency;
  -- `execute` does not set `found`; only `get diagnostics` sees its row count.
  -- Zero here means the UPDATE policy refused what the SELECT policy admitted,
  -- which is a caller moving a referral into a chart they do not open.
  get diagnostics v_written = row_count;
  if v_written <> 1 then
    raise exception using errcode='42501', message='PENNSYNC_REFERRAL_FORBIDDEN';
  end if;
  select * into v_row from "pennsync_records"."referral" t
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."id" = p_referral_id and t."agency_id" = p_agency;
  return jsonb_build_object('referral', "pennsync_records".referral_row(v_row),
    'scope', v_scope);
end $contract$;

create function "pennsync_records".contract_referral_archive(
  p_agency text, p_referral_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_scope jsonb; v_user text; v_email text; v_now timestamptz; v_written integer;
  v_existing "pennsync_records"."referral";
begin
  v_scope := "pennsync_records".referral_authority(p_agency);
  if not "pennsync_records".referral_exact_identifier(p_referral_id) then
    raise exception using errcode='22023', message='PENNSYNC_REFERRAL_ID_INVALID';
  end if;
  v_user := "pennsync_records".caller_user_id();
  v_email := "pennsync_records".caller_email();
  if v_user is null or v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_REFERRAL_AGENCY_NOT_HELD';
  end if;
  v_now := clock_timestamp();
  select * into v_existing from "pennsync_records"."referral" t
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."id" = p_referral_id and t."agency_id" = p_agency and t."archived_at" is null
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_REFERRAL_NOT_FOUND';
  end if;
  -- Removal is an ARCHIVE, exactly as the original's `delete` action is: the
  -- row keeps its whole history and stops being part of the queue. The
  -- rejection stamp travels with it because a removed referral is a declined
  -- one, which is what the intake reports count.
  update "pennsync_records"."referral" t
  set "archived_at" = v_now, "archived_by_user_id" = v_user,
    "archived_by_user_email_normalized" = v_email,
    "archive_reason" = 'Removed from Referral Intake',
    "status" = 'declined', "rejection_date" = v_now, "rejected_by" = v_email,
    "version" = coalesce(v_existing."version", 0) + 1, "updated_date" = v_now
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."id" = p_referral_id and t."agency_id" = p_agency;
  get diagnostics v_written = row_count;
  if v_written <> 1 then
    raise exception using errcode='42501', message='PENNSYNC_REFERRAL_FORBIDDEN';
  end if;
  return jsonb_build_object('archived', true, 'referral_id', p_referral_id,
    'scope', v_scope);
end $contract$;

reset role;

revoke all on function
  "pennsync_records".referral_client_field(text),
  "pennsync_records".referral_follow_up_reserved(text),
  "pennsync_records".referral_row("pennsync_records"."referral"),
  "pennsync_records".referral_scope(text,text),
  "pennsync_records".referral_authority(text),
  "pennsync_records".referral_exact_identifier(text),
  "pennsync_records".referral_canonical_email(text),
  "pennsync_records".referral_instant(jsonb),
  "pennsync_records".referral_follow_up_preserved(jsonb,jsonb),
  "pennsync_records".referral_business_fields(jsonb),
  "pennsync_records".referral_audit_fields(jsonb,text,timestamptz),
  "pennsync_records".referral_assignment(text,text,text,timestamptz),
  "pennsync_records".referral_patient_linkable(text,text),
  "pennsync_records".contract_referral_list(text,integer,text,text,text),
  "pennsync_records".contract_referral_get(text,text),
  "pennsync_records".contract_referral_assignees(text),
  "pennsync_records".contract_referral_create(text,text,jsonb),
  "pennsync_records".contract_referral_update(text,text,jsonb),
  "pennsync_records".contract_referral_archive(text,text)
  from public, anon, authenticated, service_role;

grant execute on function
  "pennsync_records".contract_referral_list(text,integer,text,text,text),
  "pennsync_records".contract_referral_get(text,text),
  "pennsync_records".contract_referral_assignees(text),
  "pennsync_records".contract_referral_create(text,text,jsonb),
  "pennsync_records".contract_referral_update(text,text,jsonb),
  "pennsync_records".contract_referral_archive(text,text)
  to authenticated;

create function "public"."pennsync_contract_referral_list"(
  p_agency text, p_limit integer default 200, p_patient_id text default null,
  p_status text default null, p_assigned_to text default null) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_referral_list(
    p_agency, p_limit, p_patient_id, p_status, p_assigned_to)
$contract$;

create function "public"."pennsync_contract_referral_get"(
  p_agency text, p_referral_id text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_referral_get(p_agency, p_referral_id)
$contract$;

create function "public"."pennsync_contract_referral_assignees"(p_agency text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_referral_assignees(p_agency)
$contract$;

create function "public"."pennsync_contract_referral_create"(
  p_agency text, p_client_request_id text, p_referral jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_referral_create(p_agency, p_client_request_id, p_referral)
$contract$;

create function "public"."pennsync_contract_referral_update"(
  p_agency text, p_referral_id text, p_changes jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_referral_update(p_agency, p_referral_id, p_changes)
$contract$;

create function "public"."pennsync_contract_referral_archive"(
  p_agency text, p_referral_id text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_referral_archive(p_agency, p_referral_id)
$contract$;

revoke all on function
  "public"."pennsync_contract_referral_list"(text,integer,text,text,text),
  "public"."pennsync_contract_referral_get"(text,text),
  "public"."pennsync_contract_referral_assignees"(text),
  "public"."pennsync_contract_referral_create"(text,text,jsonb),
  "public"."pennsync_contract_referral_update"(text,text,jsonb),
  "public"."pennsync_contract_referral_archive"(text,text)
  from public, anon, service_role;

grant execute on function
  "public"."pennsync_contract_referral_list"(text,integer,text,text,text),
  "public"."pennsync_contract_referral_get"(text,text),
  "public"."pennsync_contract_referral_assignees"(text),
  "public"."pennsync_contract_referral_create"(text,text,jsonb),
  "public"."pennsync_contract_referral_update"(text,text,jsonb),
  "public"."pennsync_contract_referral_archive"(text,text)
  to authenticated;

commit;
