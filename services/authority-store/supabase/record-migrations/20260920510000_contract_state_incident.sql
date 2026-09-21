-- The state-reportable incident: the flag its sibling reserves to a reviewer,
-- set by the contract because that is what the endpoint is FOR.
--
-- HAND WRITTEN, like every contract, and deliberately NOT an argument to
-- `contract_incident_submit`. D44 made `severity`, `state_reportable` and
-- `ai_tags` reviewer-only on a submit, and its own header says why: they are
-- the inputs to the resolve gate. A caller who could pass
-- `state_reportable: true` to the ordinary submit would have the control back.
--
-- So this endpoint sets both itself. The reporter chooses the EVENT TYPE — one
-- of the state's codes — and the contract decides what that means for the
-- record: `state_reportable` true, `severity` high, and an incident type from
-- the code rather than from the caller. That is the same rule as D67's
-- `verified` and D29's `reserved`: **a field a reviewer decides is not made a
-- caller's by adding an endpoint that wants it set.**
--
-- The original's own note on the type mapping is kept because it is a
-- reporting requirement rather than a convenience: mapping the state code onto
-- a real `incident_type` is what makes "these — the most severe events —
-- appear in falls/hospitalization/med-error aggregates instead of vanishing
-- into 'other'."
--
-- WHAT IS PAUSED AND WHY, since this is the fifth PARTIAL port:
--
--  * The PDF retention. The original renders a report and hands it to
--    `createAuthorizedDocument`, which is the file layer — `cmfile:` handles
--    exist, the data migration and the `file_url` compatibility layer do not,
--    and porting it verbatim would carry Base44's storage host into the
--    service. The answer says `document_retention_paused: true` rather than
--    reporting a document that was never retained.
--  * The email. `Core.SendEmail` is D56's open owner decision, exactly as it
--    is for the invitation send (D42) and four others. The answer says
--    `email_paused: true`, and — following D42 — the incident's own audit
--    records it, so the trail cannot read as though a message went out.
--
-- The NOTIFICATION fan-out is not paused, because a notification is a ROW
-- rather than a message (D51). Its recipients are the agency's active
-- `agency_admin` memberships through `pennsync_private.agency_roster`, not the
-- original's 5,000-row `User` scan filtered by `role === 'admin'` plus the
-- patient's `created_by` and `assigned_nurses` — the platform tier D14 and D22
-- removed, crossed with D41's derived scope.
--
-- **And the alert names no patient.** D44's rule, and it bites harder here
-- than anywhere: the original's message is
-- `"<reporter> submitted a state reportable event for <patientName> on
-- <date>"`, and `notification_read` is agency-WIDE while D24 narrows a chart
-- to its care team — so an `office_staff` member who opens no chart would read
-- the name of a patient in the most serious incident class the product has.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.contract_incident_submit(text,jsonb)') is null
    or to_regprocedure('pennsync_records.notification_mint(text,text,text,text,integer,text,text,text,text,text,text,jsonb,text)') is null then
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

-- The original's `STATE_EVENT_TO_INCIDENT_TYPE`, and its default. Two codes
-- are mapped and everything else is `other`, which is the original's `|| 'other'`.
create function "pennsync_records".state_event_incident_type(p_code text)
  returns text language sql immutable set search_path = '' as $map$
  select case pg_catalog.upper(pg_catalog.btrim(coalesce(p_code, '')))
    when 'IE' then 'hospitalized'
    when 'HC' then 'medication_error'
    else 'other'
  end
$map$;

create function "pennsync_records".contract_state_incident_submit(
  p_agency text, p_incident jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_row "pennsync_records"."incident"; v_email text; v_id text; v_now timestamptz;
  v_date date; v_patient text; v_name text; v_key text; v_type text;
  v_event text; v_recipient record; v_notified integer := 0;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_STATE_INCIDENT_AGENCY_NOT_HELD';
  end if;
  if p_incident is null or jsonb_typeof(p_incident) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_STATE_INCIDENT_INVALID';
  end if;
  v_patient := p_incident->>'patient_id';
  v_date := "pennsync_records".time_off_date(p_incident->>'event_date');
  v_event := pg_catalog.btrim(coalesce(p_incident->>'event_type', ''));
  if coalesce(v_patient, '') = '' or v_event = '' or v_date is null
    or coalesce(p_incident->>'report_text', '') = '' then
    raise exception using errcode='22023', message='PENNSYNC_STATE_INCIDENT_REQUIRED';
  end if;

  -- The chart decides who may report on it. The original's gate is
  -- `patient.created_by`, `patient.assigned_nurses` and the `SUPER_ADMIN_EMAIL`
  -- owner — D41's derived scope, the addresses D24's backfill refuses to read,
  -- and the removed platform tier — and `patient_read` answers all three.
  select pg_catalog.btrim(pg_catalog.concat_ws(' ', p."first_name", p."last_name"))
    into v_name from "pennsync_records"."patient" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."id" = v_patient and p."agency_id" = p_agency;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_STATE_INCIDENT_PATIENT_NOT_VISIBLE';
  end if;

  v_email := "pennsync_records".caller_email();
  v_key := pg_catalog.btrim(coalesce(p_incident->>'client_request_id', ''));
  if v_key <> '' then
    select * into v_row from "pennsync_records"."incident" i
    where i."source_app_id" = "pennsync_records".deployment_app()
      and i."client_request_id" = v_key
    limit 1;
    if found then
      return jsonb_build_object('success', true, 'deduplicated', true,
        'notified', 0, 'document_retention_paused', true, 'email_paused', true,
        'incident', "pennsync_records".incident_row(v_row));
    end if;
  end if;

  v_type := "pennsync_records".state_event_incident_type(p_incident->>'event_type_id');
  v_now := clock_timestamp();
  v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);

  insert into "pennsync_records"."incident"
    ("source_app_id", "id", "client_request_id", "patient_id", "patient_name",
     "incident_type", "incident_name", "incident_date", "incident_time",
     "severity", "state_reportable", "details", "report", "photo_urls",
     "office_notified", "alert_triggered", "status", "created_by",
     "created_date", "updated_date")
  values ("pennsync_records".deployment_app(), v_id,
    case when v_key = '' then null else v_key end,
    v_patient, nullif(v_name, ''),
    v_type, 'State Reportable: ' || v_event, v_date,
    coalesce(p_incident->>'event_time', ''),
    -- The contract's, not the caller's. Both are the reviewer-only fields D44
    -- keeps off a submit, and this endpoint exists precisely because these
    -- events are always both.
    'high', true,
    jsonb_build_object(
      'state_reportable', true,
      'event_type', v_event,
      'event_type_id', p_incident->>'event_type_id',
      'location_of_event', p_incident->>'location_of_event',
      'medications', p_incident->>'medications',
      'diagnosis', p_incident->>'diagnosis',
      'factual_description', p_incident->>'factual_description',
      'followup_action', p_incident->>'followup_action',
      -- `submitted_by_name` is the caller's own claim in the original and is
      -- the VERIFIED address here: the carried `user` table has no name column
      -- (D38), and a compliance record naming whoever the form said is worse
      -- than one naming the account that filed it.
      'submitted_by_email', v_email,
      'submitted_by_title', p_incident->>'submitted_by_title',
      'submitted_at', to_jsonb(v_now),
      'source', coalesce(nullif(p_incident->>'source', ''), 'state_reportable_form'),
      -- D42's rule: the trail must not read as though a message went out.
      'document_retention_paused', true,
      'email_paused', true),
    p_incident->>'report_text',
    case when jsonb_typeof(p_incident->'photo_urls') = 'array'
      then p_incident->'photo_urls' else '[]'::jsonb end,
    -- The original sets both false and raises them only after a side effect
    -- succeeds, so the primary incident never implies delivery occurred. The
    -- notification fan-out below is a real side effect, so `office_notified`
    -- follows it; the email is paused, so `alert_triggered` stays false.
    false, false, 'reported', v_email, v_now, v_now)
  returning * into v_row;

  -- A notification is a ROW rather than a message (D51), so this half is not
  -- paused — and it NAMES NO PATIENT, because `notification_read` is
  -- agency-wide while D24 narrows a chart to its care team.
  for v_recipient in
    select r.base44_user_id, r.expected_email, r.membership_id, r.membership_version
    from pennsync_private.agency_roster(p_agency) r
    where r.tenant_role = 'agency_admin'
    order by r.expected_email
  loop
    perform "pennsync_records".notification_mint(
      p_agency, v_recipient.base44_user_id, v_recipient.expected_email,
      v_recipient.membership_id, v_recipient.membership_version,
      'State reportable event: ' || v_event,
      v_email || ' submitted a state reportable event on '
        || pg_catalog.to_char(v_date, 'YYYY-MM-DD') || '. Immediate follow-up required.',
      'critical_alert', 'critical', '/IncidentReportingModule', 'Review incident',
      jsonb_build_object('incident_id', v_id, 'state_reportable', true,
        'reported_by', v_email),
      'state_incident:' || v_id || ':' || v_recipient.expected_email);
    v_notified := v_notified + 1;
  end loop;

  if v_notified > 0 then
    update "pennsync_records"."incident" t set "office_notified" = true,
      "updated_date" = v_now
    where t."source_app_id" = "pennsync_records".deployment_app() and t."id" = v_id
    returning * into v_row;
  end if;

  return jsonb_build_object('success', true, 'notified', v_notified,
    'document_retention_paused', true, 'email_paused', true,
    'incident', "pennsync_records".incident_row(v_row));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".state_event_incident_type(text),
  "pennsync_records".contract_state_incident_submit(text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "pennsync_records".contract_state_incident_submit(text,jsonb)
  to authenticated;

create function "public"."pennsync_contract_state_incident_submit"(
  p_agency text, p_incident jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_state_incident_submit(p_agency, p_incident)
$contract$;

revoke all on function "public"."pennsync_contract_state_incident_submit"(text,jsonb)
  from public, anon, service_role;
grant execute on function "public"."pennsync_contract_state_incident_submit"(text,jsonb)
  to authenticated;

commit;
