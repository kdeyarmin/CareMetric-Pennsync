-- Reporting an incident, and moving one through its review.
--
-- HAND WRITTEN, like every contract. Two Base44 capabilities —
-- `submitIncidentReport` and `updateIncident`'s three actions — over one
-- carried table.
--
-- **The field split is a security control, not a tidy-up, and the original
-- says so in its own words:**
--
--     "Split by caller because severity and state_reportable are the inputs to
--      incidentNeedsCorrectiveAction: if the reporter could write them, they
--      could downgrade their own high-severity incident and clear the
--      state-reportable flag, after which the resolve gate reads the softened
--      values and lets it close with no corrective action -- defeating the
--      control this function exists to enforce."
--
-- So `severity`, `state_reportable` and `ai_tags` are reviewer-only ON A
-- PATCH, and the narrative fields stay writable by the reporter. Note the
-- shape carefully: the reporter DOES name the severity when filing, and may
-- not soften it afterwards. Refusing it at submission too would be worse than
-- the original rather than safer — a nurse filing a high-severity fall would
-- have it recorded at the floor value, and the resolve gate reads the stored
-- severity, so the control this contract exists to enforce would never fire.
--
-- **D40 puts that control at risk, and this closes it.** In the original the
-- reviewer is the protected platform owner, who never reports an agency's
-- incidents — so "the reporter" and "the reviewer" were necessarily different
-- people and the split held by itself. D40 makes the reviewer an
-- `agency_admin`, who can report an incident like anybody else. An
-- administrator patching the privileged fields on THEIR OWN incident is
-- therefore refused here, and a transition on their own incident is refused
-- too. This is the same finding D40 recorded for credential self-approval:
-- re-read what the platform tier was STRUCTURALLY preventing.
--
-- DIVERGENCES from the originals, each deliberate:
--
-- 1. The reviewer is an `agency_admin` (D40) rather than the platform owner,
--    with the self-review refusal above as its condition.
-- 2. **Three owner-patchable fields have no carried column.** The original's
--    `OWNER_PATCHABLE_FIELDS` names `witnesses`, `follow_up_required` and
--    `follow_up_notes`, and `pennsync_records.incident` carries none of them.
--    They are REFUSED by name rather than silently dropped, so a caller that
--    sends one is told, instead of believing a witness list was recorded.
-- 3. The scope is the patient's chart. The original decides who may report on
--    a patient from `assigned_nurses`, `created_by` and an `agency_name`
--    comparison — the representation D21, D24 and D41 threw out — and the
--    `patient` policy answers it here. The explicit visibility check before
--    the insert is for the NAMED refusal: the `incident_insert` policy already
--    carries the same chart predicate, but a policy failure is a raw RLS error
--    the HTTP boundary cannot classify.
-- 4. `patient_name` is read off the chart rather than taken from the payload.
--    The original stores whatever name the caller sent; a denormalized name
--    that disagrees with the chart is a falsehood in a safety record, and the
--    caller has already been proved able to open that chart to send the id.
-- 5. **The urgent-alert fan-out keeps the capability and deletes the
--    reconstruction**, and mints through `notification_mint` rather than
--    inlining the authority envelope, which is what D45 caught it doing. The original selects its recipients by listing 5000
--    `User` rows and comparing `account_type` and `agency_name` — two
--    self-editable labels — and carries two bug fixes in its own comments for
--    having got that wrong (admins past the first 200 rows were never
--    alerted; an unscoped fan-out "leaked patient name/id to every tenant's
--    agency_admins"). Here the recipients ARE the agency's active
--    `agency_admin` memberships, which is what that comparison was trying to
--    approximate, and the query cannot reach another tenant at all.
-- 6. **The alert names no patient.** The original puts the patient's name in
--    the notification title and its name and id in the metadata. In this store
--    `notification_read` is agency-WIDE, while D24 narrows a chart to its care
--    team — so a patient name on a notification would be readable by an
--    `office_staff` member who opens no chart. The alert carries the incident
--    id and its category; the addressed administrator opens the incident,
--    which is chart-narrowed, to see whose it is.
-- 7. The audit entries go to D25's trail rather than `UserActivity`, in the
--    same transaction (D37). That deletes the original's `audit_recorded`
--    flag, its `catch`, and the "Record this transition manually" warning it
--    returns: those exist because the status write has already committed by
--    the time the trail write is attempted, and here neither half can exist
--    without the other.
-- 8. `reassign_patient` requires the destination chart to be one the reviewer
--    can open. The original accepts any id at all, so the duplicate-patient
--    merge it exists for could move an incident onto a chart — or out of the
--    agency — that nobody involved can see.
-- 9. `critical` stays in the corrective-action test although the carried
--    `incident_severity_allowed` constraint admits only low, medium and high.
--    The rule is the original's; if the enum ever widens, the control should
--    not have to be remembered.
--
-- ONE DIVERGENCE DELIBERATELY NOT MADE. The offline drain dedupes retries by
-- `client_request_id`, and the original says why it must survive into the row:
-- "an interrupted drain (server committed, queue removal failed) creates a
-- second copy of the same safety event on the next pass." That check is ported
-- as the original has it — read, then insert — and it is racy for the same
-- reason: `Incident.client_request_id` makes no uniqueness claim in its own
-- schema, so D30 emits no index for it and there is nothing for a named
-- `unique_violation` catch to name. Two drains running at once can still
-- double-report. Closing it means the SCHEMA claiming uniqueness, which is an
-- entity decision and not this contract's to make.
begin;

do $$
begin
  if to_regclass('pennsync_records.incident') is null
    or to_regclass('pennsync_records.notification') is null
    or to_regprocedure('pennsync_records.time_off_date(text)') is null
    or to_regprocedure('pennsync_private.agency_roster(text)') is null
    or to_regprocedure('pennsync_records.notification_mint(text,text,text,text,integer,'
      || 'text,text,text,text,text,text,jsonb,text)') is null
    or to_regprocedure('pennsync_records.contract_activity_append(text,text,text,text,jsonb)') is null then
    raise exception using errcode='42501',message='PENNSYNC_ACTIVITY_TRAIL_REQUIRED';
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
 * The original's `canTransitionIncidentStatus`, through the same lifecycle
 * names it maps statuses onto — including its one explicit shortcut, which
 * `corrective_action -> resolved` needs because the lifecycle graph does not
 * contain it.
 */
create function "pennsync_records".incident_lifecycle(p_status text) returns text
  language sql immutable set search_path = '' as $life$
  select case coalesce(p_status, 'reported')
    when 'reported' then 'submitted'
    when 'under_review' then 'in_review'
    when 'corrective_action' then 'correction_requested'
    when 'resolved' then 'final'
    when 'archived' then 'archived'
    else null end
$life$;

create function "pennsync_records".incident_can_transition(p_from text, p_to text)
  returns boolean language sql immutable set search_path = '' as $can$
  select case
    when p_from = 'corrective_action' and p_to = 'resolved' then true
    when "pennsync_records".incident_lifecycle(p_from) is null
      or "pennsync_records".incident_lifecycle(p_to) is null then false
    when "pennsync_records".incident_lifecycle(p_from)
      = "pennsync_records".incident_lifecycle(p_to) then true
    else "pennsync_records".incident_lifecycle(p_to) = any(
      case "pennsync_records".incident_lifecycle(p_from)
        when 'submitted' then array['in_review','correction_requested','final','voided']
        when 'in_review' then array['correction_requested','final','voided']
        when 'correction_requested' then array['corrected','final','voided']
        when 'final' then array['correction_requested','archived']
        else array[]::text[] end) end
$can$;

/*
 * The original's `incidentNeedsCorrectiveAction`: the test the resolve gate
 * reads, and the reason severity and state_reportable are reviewer-only.
 */
create function "pennsync_records".incident_needs_corrective_action(
  r "pennsync_records"."incident") returns boolean
  language sql immutable set search_path = '' as $needs$
  select r."state_reportable" is true
    or pg_catalog.lower(coalesce(r."severity", '')) in ('high', 'critical')
$needs$;

create function "pennsync_records".incident_row(r "pennsync_records"."incident")
  returns jsonb language sql stable set search_path = '' as $row$
  select jsonb_build_object(
    'id', r."id", 'patient_id', r."patient_id", 'patient_name', r."patient_name",
    'incident_type', r."incident_type", 'incident_name', r."incident_name",
    'incident_date', r."incident_date", 'incident_time', r."incident_time",
    'severity', r."severity", 'status', r."status", 'report', r."report",
    'details', r."details", 'photo_urls', r."photo_urls",
    'physician_notified', r."physician_notified",
    'office_notified', r."office_notified",
    'alert_triggered', r."alert_triggered",
    'state_reportable', r."state_reportable",
    'corrective_action_plan', r."corrective_action_plan",
    'resolution_notes', r."resolution_notes",
    'investigator_email', r."investigator_email",
    'reviewed_by', r."reviewed_by", 'reviewed_at', r."reviewed_at",
    'closed_by', r."closed_by", 'closed_at', r."closed_at",
    'client_request_id', r."client_request_id",
    'created_by', r."created_by")
$row$;

create function "pennsync_records".contract_incident_submit(
  p_agency text, p_incident jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_row "pennsync_records"."incident"; v_email text; v_id text; v_now timestamptz;
  v_date date; v_patient text; v_name text; v_severity text; v_key text;
  v_alert boolean; v_recipient record; v_notified integer := 0;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_INCIDENT_AGENCY_NOT_HELD';
  end if;
  if p_incident is null or jsonb_typeof(p_incident) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_INCIDENT_INVALID';
  end if;
  v_patient := p_incident->>'patient_id';
  v_date := "pennsync_records".time_off_date(p_incident->>'incident_date');
  -- The original's four required fields. The date is additionally required to
  -- BE a date: the original stores the string it was handed.
  if coalesce(v_patient, '') = '' or coalesce(p_incident->>'incident_type', '') = ''
    or coalesce(p_incident->>'report', '') = '' or v_date is null then
    raise exception using errcode='22023', message='PENNSYNC_INCIDENT_REQUIRED';
  end if;

  -- Divergences 3 and 4: the chart decides who may report on it, and the name
  -- on the record comes from the chart rather than from the caller.
  select pg_catalog.btrim(pg_catalog.concat_ws(' ', p."first_name", p."last_name"))
    into v_name from "pennsync_records"."patient" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."id" = v_patient and p."agency_id" = p_agency;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_INCIDENT_PATIENT_NOT_VISIBLE';
  end if;

  v_email := "pennsync_records".caller_email();
  v_key := pg_catalog.btrim(coalesce(p_incident->>'client_request_id', ''));
  -- The original's offline-drain dedupe, and the reason it stores the key.
  -- Read under the policy, so it can only ever match an incident on a chart
  -- this caller already opens; see the note at the head of this file for the
  -- race it does NOT close.
  if v_key <> '' then
    select * into v_row from "pennsync_records"."incident" i
    where i."source_app_id" = "pennsync_records".deployment_app()
      and i."client_request_id" = v_key
    limit 1;
    if found then
      return jsonb_build_object('success', true, 'deduplicated', true,
        'incident', "pennsync_records".incident_row(v_row));
    end if;
  end if;

  -- The reporter names the severity, as the original lets them, defaulting the
  -- same way. They may not soften it later: that is `patch`'s rule, not this
  -- one's. An unknown value is refused rather than stored, because the carried
  -- constraint would otherwise raise a check violation the boundary cannot
  -- classify.
  v_severity := coalesce(pg_catalog.lower(pg_catalog.btrim(
    coalesce(p_incident->>'severity', ''))), '');
  if v_severity = '' then v_severity := 'medium'; end if;
  if v_severity not in ('low', 'medium', 'high') then
    raise exception using errcode='22023', message='PENNSYNC_INCIDENT_SEVERITY_INVALID';
  end if;
  -- `->` on an ABSENT key is SQL null, and `null = 'true'::jsonb` is null, not
  -- false. The original's `!!payload.immediate_alert` is false for an absent
  -- key, and a null here would be stored as an unknown alert flag AND carried
  -- into `office_notified`'s fallback below.
  v_alert := coalesce((p_incident->'immediate_alert') = 'true'::jsonb, false);
  v_now := clock_timestamp();
  v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);

  insert into "pennsync_records"."incident"
    ("source_app_id", "id", "client_request_id", "patient_id", "patient_name",
     "incident_type", "incident_name", "incident_date", "incident_time",
     "severity", "details", "report", "photo_urls", "physician_notified",
     "office_notified", "alert_triggered", "status", "created_by",
     "created_date", "updated_date")
  values ("pennsync_records".deployment_app(), v_id,
    case when v_key = '' then null else v_key end,
    v_patient, nullif(v_name, ''),
    p_incident->>'incident_type', p_incident->>'incident_name', v_date,
    p_incident->>'incident_time', v_severity,
    case when jsonb_typeof(p_incident->'details') = 'object'
      then p_incident->'details' else '{}'::jsonb end,
    p_incident->>'report',
    case when jsonb_typeof(p_incident->'photo_urls') = 'array'
      then p_incident->'photo_urls' else '[]'::jsonb end,
    coalesce((p_incident->'physician_notified') = 'true'::jsonb, false),
    -- The original's own fix, kept with its reason: "Honour what the reporter
    -- actually checked. Deriving this from immediate_alert meant the stored
    -- compliance flag contradicted the form." Severity is not the fallback
    -- here, the alert flag is, exactly as the original leaves it.
    case when jsonb_typeof(p_incident->'office_notified') = 'boolean'
      then (p_incident->'office_notified') = 'true'::jsonb else v_alert end,
    v_alert, 'reported', v_email, v_now, v_now)
  returning * into v_row;

  -- Divergences 5 and 6: the agency's administrators, from membership, with no
  -- patient on the alert.
  --
  -- The envelope is `notification_mint`'s, not this contract's. It was inlined
  -- here and stamped three of the six columns the recipient's own reader
  -- filters on, so every alert it wrote was addressed to nobody — which is
  -- what D45 found and why the facility exists.
  if v_alert then
    for v_recipient in
      select r.base44_user_id, r.expected_email, r.membership_id, r.membership_version
      from pennsync_private.agency_roster(p_agency) r
      where r.tenant_role = 'agency_admin'
      order by r.expected_email
    loop
      perform "pennsync_records".notification_mint(
        p_agency, v_recipient.base44_user_id, v_recipient.expected_email,
        v_recipient.membership_id, v_recipient.membership_version,
        'Urgent incident: ' || coalesce(nullif(v_row."incident_name", ''),
          v_row."incident_type"),
        v_email || ' submitted a ' || v_severity || ' severity incident.',
        case when v_severity = 'high' then 'critical_alert' else 'patient_alert' end,
        case when v_severity = 'high' then 'critical' else 'high' end,
        '/Incidents', 'Review incident',
        jsonb_build_object('incident_id', v_id, 'reported_by', v_email),
        'incident:' || v_id || ':' || v_recipient.expected_email);
      v_notified := v_notified + 1;
    end loop;
  end if;

  return jsonb_build_object('success', true, 'notified', v_notified,
    'incident', "pennsync_records".incident_row(v_row));
end $contract$;

create function "pennsync_records".contract_incident_update(
  p_agency text, p_incident_id text, p_action text, p_patch jsonb,
  p_to_status text, p_corrective_action_plan text, p_resolution_notes text,
  p_patient_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_row "pennsync_records"."incident"; v_email text; v_role text; v_key text;
  v_now timestamptz; v_admin boolean; v_owner boolean; v_from text; v_event text;
  v_plan text; v_notes text; v_fields text[]; v_needed boolean; v_name text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_INCIDENT_AGENCY_NOT_HELD';
  end if;
  if p_incident_id is null or p_incident_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_INCIDENT_SUBJECT_INVALID';
  end if;
  if p_action is null or p_action not in ('patch', 'transition', 'reassign_patient') then
    raise exception using errcode='22023', message='PENNSYNC_INCIDENT_ACTION_INVALID';
  end if;
  v_email := "pennsync_records".caller_email();
  v_admin := v_role = 'agency_admin';

  -- Read under the policies, which reach this table's tenancy through the
  -- chart, so a caller who cannot open the patient sees no incident. The
  -- original resolves the row by filtering for two and refusing if it gets
  -- anything but one exact match, because a service-role filter can return a
  -- prefix match from another tenant; a primary key cannot.
  select * into v_row from "pennsync_records"."incident" i
  where i."source_app_id" = "pennsync_records".deployment_app() and i."id" = p_incident_id
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_INCIDENT_NOT_FOUND';
  end if;
  v_owner := pg_catalog.lower(coalesce(v_row."created_by", '')) = pg_catalog.lower(v_email);
  v_now := clock_timestamp();

  if p_action = 'patch' then
    if not v_admin and not v_owner then
      raise exception using errcode='42501', message='PENNSYNC_INCIDENT_FORBIDDEN';
    end if;
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
      raise exception using errcode='22023', message='PENNSYNC_INCIDENT_PATCH_EMPTY';
    end if;
    for v_key in select k from jsonb_object_keys(p_patch) k loop
      -- Divergence 2: three of the original's owner-writable fields have no
      -- carried column, and are refused by NAME so a caller is told rather
      -- than believing a witness list was recorded.
      if v_key in ('witnesses', 'follow_up_required', 'follow_up_notes') then
        raise exception using errcode='22023', message='PENNSYNC_INCIDENT_FIELD_NOT_CARRIED';
      end if;
      if v_key not in ('report', 'incident_type', 'photo_urls',
        'severity', 'state_reportable', 'ai_tags') then
        raise exception using errcode='22023', message='PENNSYNC_INCIDENT_FIELD_UNSUPPORTED';
      end if;
      if v_key in ('severity', 'state_reportable', 'ai_tags') then
        if not v_admin then
          raise exception using errcode='42501', message='PENNSYNC_INCIDENT_FIELD_PRIVILEGED';
        end if;
        -- The check D40 makes necessary. In the original the reviewer was the
        -- platform owner, who never reports an agency's incidents, so the
        -- reporter and the reviewer could not be the same person.
        if v_owner then
          raise exception using errcode='42501', message='PENNSYNC_INCIDENT_SELF_REVIEW';
        end if;
      end if;
    end loop;
    if p_patch ? 'severity' and pg_catalog.lower(coalesce(p_patch->>'severity', ''))
      not in ('low', 'medium', 'high') then
      raise exception using errcode='22023', message='PENNSYNC_INCIDENT_SEVERITY_INVALID';
    end if;
    select array_agg(k order by k) into v_fields from jsonb_object_keys(p_patch) k;
    update "pennsync_records"."incident" i set
      "report" = case when p_patch ? 'report' then p_patch->>'report' else i."report" end,
      "incident_type" = case when p_patch ? 'incident_type'
        then p_patch->>'incident_type' else i."incident_type" end,
      "photo_urls" = case when p_patch ? 'photo_urls'
        then p_patch->'photo_urls' else i."photo_urls" end,
      "severity" = case when p_patch ? 'severity'
        then pg_catalog.lower(p_patch->>'severity') else i."severity" end,
      "state_reportable" = case when p_patch ? 'state_reportable'
        then (p_patch->'state_reportable') = 'true'::jsonb else i."state_reportable" end,
      "ai_tags" = case when p_patch ? 'ai_tags' then p_patch->'ai_tags' else i."ai_tags" end,
      "updated_date" = v_now
    where i."source_app_id" = v_row."source_app_id" and i."id" = v_row."id"
    returning * into v_row;

    -- The original's audit entry, and the rule it states for what may go in
    -- one: "Record only which fields changed: the values can contain incident
    -- narrative, witness names, notes, or photo URLs and belong only on
    -- Incident itself." The KEYS, never the values.
    v_event := "pennsync_records".contract_activity_append(
      p_agency, 'incident_patched', 'patient', v_row."patient_id",
      jsonb_build_object('incident_id', v_row."id",
        'updated_fields', to_jsonb(v_fields)));
    return jsonb_build_object('success', true, 'action', 'patch',
      'audit_event_id', v_event, 'updated_fields', to_jsonb(v_fields),
      'incident', "pennsync_records".incident_row(v_row));
  end if;

  -- Both remaining actions are a reviewer's, and neither is a reviewer's own.
  if not v_admin then
    raise exception using errcode='42501', message='PENNSYNC_INCIDENT_FORBIDDEN';
  end if;
  if v_owner then
    raise exception using errcode='42501', message='PENNSYNC_INCIDENT_SELF_REVIEW';
  end if;

  if p_action = 'reassign_patient' then
    if p_patient_id is null or p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$' then
      raise exception using errcode='22023', message='PENNSYNC_INCIDENT_SUBJECT_INVALID';
    end if;
    -- Divergence 8. The original reassigns to any id at all, so the merge it
    -- exists for could move an incident out of sight.
    select pg_catalog.btrim(pg_catalog.concat_ws(' ', p."first_name", p."last_name"))
      into v_name from "pennsync_records"."patient" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."id" = p_patient_id and p."agency_id" = p_agency;
    if not found then
      raise exception using errcode='42501', message='PENNSYNC_INCIDENT_PATIENT_NOT_VISIBLE';
    end if;
    update "pennsync_records"."incident" i set
      "patient_id" = p_patient_id, "patient_name" = nullif(v_name, ''),
      "updated_date" = v_now
    where i."source_app_id" = v_row."source_app_id" and i."id" = v_row."id"
    returning * into v_row;
    v_event := "pennsync_records".contract_activity_append(
      p_agency, 'incident_patient_reassigned', 'patient', p_patient_id,
      jsonb_build_object('incident_id', v_row."id"));
    return jsonb_build_object('success', true, 'action', 'reassign_patient',
      'audit_event_id', v_event, 'incident', "pennsync_records".incident_row(v_row));
  end if;

  v_from := coalesce(v_row."status", 'reported');
  if p_to_status is null then
    raise exception using errcode='22023', message='PENNSYNC_INCIDENT_STATUS_REQUIRED';
  end if;
  -- The lifecycle graph treats from === to as legal, and the original refuses
  -- it anyway, in its own words: this "re-stamps closed_by/closed_at and
  -- reviewed_by/reviewed_at from the *current* caller", so replaying
  -- 'resolved' would "reattribute the closure to whoever replayed it and bury
  -- the real one in duplicate audit entries."
  if v_from = p_to_status then
    raise exception using errcode='22023', message='PENNSYNC_INCIDENT_STATUS_UNCHANGED';
  end if;
  if not "pennsync_records".incident_can_transition(v_from, p_to_status) then
    raise exception using errcode='22023', message='PENNSYNC_INCIDENT_TRANSITION';
  end if;
  v_plan := pg_catalog.btrim(coalesce(p_corrective_action_plan, ''));
  v_notes := pg_catalog.btrim(coalesce(p_resolution_notes, ''));
  v_needed := "pennsync_records".incident_needs_corrective_action(v_row);
  -- The gate the field split exists to protect: a high-severity or
  -- state-reportable incident cannot reach `resolved` with nothing recorded.
  if p_to_status = 'resolved' and v_needed
    and v_plan = '' and v_notes = ''
    and pg_catalog.btrim(coalesce(v_row."corrective_action_plan", '')) = '' then
    raise exception using errcode='22023', message='PENNSYNC_INCIDENT_CORRECTIVE_ACTION_REQUIRED';
  end if;

  update "pennsync_records"."incident" i set
    "status" = p_to_status,
    "corrective_action_plan" = case when v_plan <> '' then v_plan
      else i."corrective_action_plan" end,
    "resolution_notes" = case when v_notes <> '' then v_notes else i."resolution_notes" end,
    "reviewed_by" = case when p_to_status in ('under_review', 'corrective_action')
      then v_email when p_to_status = 'resolved' then coalesce(i."reviewed_by", v_email)
      else i."reviewed_by" end,
    "reviewed_at" = case when p_to_status in ('under_review', 'corrective_action')
      then v_now when p_to_status = 'resolved' then coalesce(i."reviewed_at", v_now)
      else i."reviewed_at" end,
    -- Both stamped by the original on the same two statuses: taking an
    -- incident up for review IS the office being notified of it.
    "investigator_email" = case when p_to_status in ('under_review', 'corrective_action')
      then coalesce(v_email, i."investigator_email") else i."investigator_email" end,
    "office_notified" = case when p_to_status in ('under_review', 'corrective_action')
      then true else i."office_notified" end,
    "closed_by" = case when p_to_status = 'resolved' then v_email else i."closed_by" end,
    "closed_at" = case when p_to_status = 'resolved' then v_now else i."closed_at" end,
    "updated_date" = v_now
  where i."source_app_id" = v_row."source_app_id" and i."id" = v_row."id"
  returning * into v_row;

  -- The original's own words for why this is persisted rather than shaped and
  -- dropped: "so the review history is an append-only trail rather than
  -- whatever the mutable fields last held."
  v_event := "pennsync_records".contract_activity_append(
    p_agency, 'incident_status_changed', 'patient', v_row."patient_id",
    jsonb_build_object(
      'incident_id', v_row."id",
      'from_status', v_from, 'to_status', p_to_status,
      'from_lifecycle', "pennsync_records".incident_lifecycle(v_from),
      'to_lifecycle', "pennsync_records".incident_lifecycle(p_to_status),
      'required_corrective_action', v_needed));
  return jsonb_build_object('success', true, 'action', 'transition',
    'audit_event_id', v_event, 'status', p_to_status,
    'incident', "pennsync_records".incident_row(v_row));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".incident_lifecycle(text),
  "pennsync_records".incident_can_transition(text,text),
  "pennsync_records".incident_needs_corrective_action("pennsync_records"."incident"),
  "pennsync_records".incident_row("pennsync_records"."incident"),
  "pennsync_records".contract_incident_submit(text,jsonb),
  "pennsync_records".contract_incident_update(text,text,text,jsonb,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_incident_submit(text,jsonb),
  "pennsync_records".contract_incident_update(text,text,text,jsonb,text,text,text,text)
  to authenticated;

create function "public"."pennsync_contract_incident_submit"(
  p_agency text, p_incident jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_incident_submit(p_agency, p_incident)
$contract$;

create function "public"."pennsync_contract_incident_update"(
  p_agency text, p_incident_id text, p_action text, p_patch jsonb,
  p_to_status text, p_corrective_action_plan text, p_resolution_notes text,
  p_patient_id text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_incident_update(p_agency, p_incident_id, p_action,
    p_patch, p_to_status, p_corrective_action_plan, p_resolution_notes, p_patient_id)
$contract$;

revoke all on function
  "public"."pennsync_contract_incident_submit"(text,jsonb),
  "public"."pennsync_contract_incident_update"(text,text,text,jsonb,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_incident_submit"(text,jsonb),
  "public"."pennsync_contract_incident_update"(text,text,text,jsonb,text,text,text,text)
  to authenticated;

commit;
