-- Recording the clinical events a model extracted from a visit note.
--
-- HAND WRITTEN, like every contract. A read that authorizes the chart and
-- binds the visit, then the model, then a write that puts the events, their
-- follow-up tasks and their alerts in ONE transaction — the shape D58 set and
-- D63 repeated.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. The chart decides, replacing `assigned_nurses`, `created_by`,
--    `account_type` and a five-thousand-row `User` scan (D21, D24, D41).
-- 2. **`event_date` is the VISIT's, not the caller's.** The original takes a
--    `visit_date` from the request body and stamps it on every clinical event
--    it writes. The visit is already bound to the patient by then, so its own
--    date is available and is the only one that cannot be claimed.
-- 3. **The field set is NAMED.** The original builds its row as
--    `{ patient_id, visit_id, event_date, ...event, … }` — every key the model
--    returned, spread into a create. A model answering an unexpected key would
--    write it. Only the ten fields its own response schema declares are
--    stored, and anything else is IGNORED rather than refused: a model's extra
--    key is not a caller's typo (D54), which is the opposite of D59's rule for
--    an operator's CSV.
-- 4. `events_extract_claimed_by`, its re-read and the "re-check the claim
--    before stamping" dance are gone: the write locks the visit row and skips
--    a visit whose events already exist, so the second run is a no-op with no
--    token to lose (D46, D58, D63). The original's own comment calls its
--    version "best-effort; not true CAS".
-- 5. **The follow-up task is assigned to the CALLER**, not to
--    `evPatient.created_by || user.email`. The chart's creator is an address on
--    a carried row that may belong to nobody in the agency any more, and the
--    original's own comment records why the field matters: without an
--    assignee "the create is rejected and the follow-up task is silently never
--    made".
-- 6. The text anchors are computed in the service, because they are `indexOf`
--    over a string the CALLER sent. Reproducing JavaScript's `indexOf`,
--    `trim` and `toLowerCase` in SQL would be a transcription with nothing to
--    gain; the store records what it is told and names the columns.
--
-- NOT DIVERGED. The enum coercion is the original's own — it has an
-- `ALLOWED_EVENT_TYPES`/`ALLOWED_SEVERITIES` guard and says why: "coerce any
-- AI value outside these sets to a safe default so ClinicalEvent.create won't
-- reject the record" — and the mappings from an event to a task type, a task
-- priority and an alert type are ported term for term, `includes` as a
-- SUBSTRING test (D64). The follow-up task carries a `due_timeframe` and NO
-- `due_date`, as the original leaves it.
begin;

do $$
begin
  if to_regclass('pennsync_records.clinical_event') is null
    or to_regclass('pennsync_records.patient_alert') is null then
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

/* The original's `ALLOWED_EVENT_TYPES`, and its `'other'` default. */
create function "pennsync_records".clinical_event_type(p_value text)
  returns text language sql immutable set search_path = '' as $t$
  select case when p_value in ('medication_change','medication_started','medication_stopped',
    'physician_appointment','hospitalization','er_visit','fall','wound_new','wound_change',
    'lab_result','symptom_new','symptom_resolved','vital_change','cognitive_change',
    'functional_change','pain_change','infection','surgery','therapy_change','dme_ordered',
    'other') then p_value else 'other' end
$t$;

/* The original's `ALLOWED_SEVERITIES`, and its `'medium'` default. */
create function "pennsync_records".clinical_event_severity(p_value text)
  returns text language sql immutable set search_path = '' as $s$
  select case when p_value in ('low','medium','high','critical') then p_value else 'medium' end
$s$;

/* The original's alert-type ladder, in its own order: later tests win. */
create function "pennsync_records".clinical_alert_type(p_event_type text)
  returns text language sql immutable set search_path = '' as $a$
  select case
    when p_event_type = 'cognitive_change' then 'symptom_escalation'
    when p_event_type = 'infection' then 'infection_risk'
    when pg_catalog.strpos(coalesce(p_event_type, ''), 'vital') > 0 then 'vital_deterioration'
    when p_event_type = 'fall' then 'fall_risk'
    when pg_catalog.strpos(coalesce(p_event_type, ''), 'medication') > 0 then 'medication_risk'
    else 'urgent_intervention' end
$a$;

/* The original's task-type ladder, likewise. */
create function "pennsync_records".clinical_task_type(p_event_type text)
  returns text language sql immutable set search_path = '' as $k$
  select case
    when pg_catalog.strpos(coalesce(p_event_type, ''), 'wound') > 0 then 'document'
    when p_event_type = 'fall' then 'safety'
    when pg_catalog.strpos(coalesce(p_event_type, ''), 'medication') > 0 then 'call'
    else 'followup' end
$k$;

create function "pennsync_records".contract_clinical_extract_context(
  p_agency text, p_patient_id text, p_visit_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_visit_date date; v_found boolean;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_EXTRACT_AGENCY_NOT_HELD';
  end if;
  if p_patient_id is null or p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$'
    or p_visit_id is null or p_visit_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_EXTRACT_SUBJECT_INVALID';
  end if;
  -- Divergence 1: the chart, not `assigned_nurses`.
  if not exists (select 1 from "pennsync_records"."patient" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."id" = p_patient_id and p."agency_id" = p_agency) then
    raise exception using errcode='42501', message='PENNSYNC_EXTRACT_PATIENT_NOT_VISIBLE';
  end if;
  -- The original's own rule, and divergence 2: the visit's date comes back.
  select v."visit_date", true into v_visit_date, v_found
  from "pennsync_records"."visit" v
  where v."source_app_id" = "pennsync_records".deployment_app()
    and v."id" = p_visit_id and v."patient_id" = p_patient_id;
  if not coalesce(v_found, false) then
    raise exception using errcode='42501', message='PENNSYNC_EXTRACT_VISIT_NOT_FOUND';
  end if;
  return jsonb_build_object('success', true, 'patient_id', p_patient_id,
    'visit_id', p_visit_id, 'visit_date', v_visit_date,
    -- Reported so a model call is not paid for; the write re-checks it under
    -- the lock, which is where it actually decides anything.
    'already_processed', exists (select 1 from "pennsync_records"."clinical_event" c
      where c."source_app_id" = "pennsync_records".deployment_app()
        and c."visit_id" = p_visit_id));
end $contract$;

create function "pennsync_records".contract_clinical_extract_record(
  p_agency text, p_patient_id text, p_visit_id text, p_events jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_context jsonb; v_now timestamptz; v_email text; v_event jsonb; v_id text;
  v_type text; v_severity text; v_title text; v_date date;
  v_saved jsonb := '[]'::jsonb; v_count integer := 0; v_skipped integer := 0;
  v_tasks integer := 0; v_alerts integer := 0; v_anchor_start double precision;
  v_anchor_end double precision;
begin
  v_context := "pennsync_records".contract_clinical_extract_context(
    p_agency, p_patient_id, p_visit_id);
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception using errcode='22023', message='PENNSYNC_EXTRACT_INVALID';
  end if;
  if jsonb_array_length(p_events) > 200 then
    raise exception using errcode='22023', message='PENNSYNC_EXTRACT_TOO_MANY';
  end if;

  v_now := clock_timestamp();
  v_email := "pennsync_records".caller_email();
  v_date := (v_context ->> 'visit_date')::date;

  -- Divergence 4: the lock the claim token was emulating, and the original's
  -- own idempotency, which is what it actually relied on.
  perform 1 from "pennsync_records"."visit" v
  where v."source_app_id" = "pennsync_records".deployment_app()
    and v."id" = p_visit_id for update;
  if exists (select 1 from "pennsync_records"."clinical_event" c
    where c."source_app_id" = "pennsync_records".deployment_app()
      and c."visit_id" = p_visit_id) then
    return jsonb_build_object('success', true, 'already_processed', true,
      'events_extracted', 0, 'events', '[]'::jsonb, 'events_skipped', 0,
      'tasks_created', 0, 'alerts_created', 0,
      'skipped', 'events already extracted for visit');
  end if;

  for v_event in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(v_event) <> 'object' then v_skipped := v_skipped + 1; continue; end if;
    v_title := case when jsonb_typeof(v_event->'event_title') = 'string'
      then pg_catalog.btrim(v_event->>'event_title') else null end;
    -- An event with no title is not an event, and nothing downstream can name
    -- it: the task title and the alert title are both built from it.
    if v_title is null or v_title = '' then v_skipped := v_skipped + 1; continue; end if;
    -- Not diverged: the original's own coercion, for the reason it states.
    v_type := "pennsync_records".clinical_event_type(v_event->>'event_type');
    v_severity := "pennsync_records".clinical_event_severity(v_event->>'severity');
    v_anchor_start := case when jsonb_typeof(v_event->'text_anchor_start') = 'number'
      then (v_event->>'text_anchor_start')::double precision end;
    v_anchor_end := case when jsonb_typeof(v_event->'text_anchor_end') = 'number'
      then (v_event->>'text_anchor_end')::double precision end;

    v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
    -- Divergence 3: the ten fields its own response schema declares, named.
    insert into "pennsync_records"."clinical_event"
      ("source_app_id","id","patient_id","visit_id","event_date","event_type",
       "event_title","event_description","structured_data","severity",
       "requires_followup","followup_notes","source_text","source_section",
       "extraction_confidence","text_anchor_start","text_anchor_end","verified",
       "created_by","created_date","updated_date")
    values ("pennsync_records".deployment_app(), v_id, p_patient_id, p_visit_id,
      v_date, v_type, v_title,
      case when jsonb_typeof(v_event->'event_description') = 'string'
        then v_event->>'event_description' end,
      case when jsonb_typeof(v_event->'structured_data') = 'object'
        then v_event->'structured_data' end,
      v_severity,
      case when jsonb_typeof(v_event->'requires_followup') = 'boolean'
        then (v_event->>'requires_followup')::boolean else false end,
      case when jsonb_typeof(v_event->'followup_notes') = 'string'
        then v_event->>'followup_notes' end,
      case when jsonb_typeof(v_event->'source_text') = 'string'
        then v_event->>'source_text' end,
      case when jsonb_typeof(v_event->'source_section') = 'string'
        then v_event->>'source_section' end,
      case when jsonb_typeof(v_event->'extraction_confidence') = 'number'
        then (v_event->>'extraction_confidence')::double precision end,
      v_anchor_start, v_anchor_end, false, v_email, v_now, v_now);
    v_count := v_count + 1;
    v_saved := v_saved || jsonb_build_object('id', v_id, 'event_type', v_type,
      'event_title', v_title, 'severity', v_severity,
      'requires_followup', coalesce(
        case when jsonb_typeof(v_event->'requires_followup') = 'boolean'
          then (v_event->>'requires_followup')::boolean end, false),
      'text_anchor_start', v_anchor_start, 'text_anchor_end', v_anchor_end);

    if coalesce(case when jsonb_typeof(v_event->'requires_followup') = 'boolean'
      then (v_event->>'requires_followup')::boolean end, false) then
      insert into "pennsync_records"."task"
        ("source_app_id","id","agency_id","patient_id","assigned_to","title",
         "description","type","priority","status","due_timeframe","source",
         "ai_reason","related_visit_id","created_by","created_date","updated_date")
      values ("pennsync_records".deployment_app(),
        pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24),
        p_agency, p_patient_id,
        -- Divergence 5: the caller, never the chart's creator.
        v_email, 'Follow-up: ' || v_title,
        coalesce(nullif(case when jsonb_typeof(v_event->'followup_notes') = 'string'
            then v_event->>'followup_notes' end, ''),
          case when jsonb_typeof(v_event->'event_description') = 'string'
            then v_event->>'event_description' end),
        "pennsync_records".clinical_task_type(v_type),
        case when v_severity in ('critical', 'high') then 'high' else 'medium' end,
        'pending',
        case when v_severity = 'critical' then 'today' else '48_hours' end,
        'ai_generated', 'Auto-generated from clinical event: ' || v_type,
        p_visit_id, v_email, v_now, v_now);
      v_tasks := v_tasks + 1;
    end if;

    if v_severity in ('high', 'critical') then
      insert into "pennsync_records"."patient_alert"
        ("source_app_id","id","patient_id","alert_type","severity","title","message",
         "contributing_factors","recommended_actions","data_sources","status",
         "flagged_urgent","created_by","created_date","updated_date")
      values ("pennsync_records".deployment_app(),
        pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24),
        p_patient_id, "pennsync_records".clinical_alert_type(v_type), v_severity,
        v_title,
        case when jsonb_typeof(v_event->'event_description') = 'string'
          then v_event->>'event_description' end,
        jsonb_build_array(v_type, 'Detected from visit ' || p_visit_id),
        case when jsonb_typeof(v_event->'followup_notes') = 'string'
            and v_event->>'followup_notes' <> ''
          then jsonb_build_array(v_event->>'followup_notes') else '[]'::jsonb end,
        jsonb_build_object('clinical_event_id', v_id, 'visit_id', p_visit_id,
          'event_type', v_type, 'structured_data',
          case when jsonb_typeof(v_event->'structured_data') = 'object'
            then v_event->'structured_data' end),
        'active', v_severity = 'critical', v_email, v_now, v_now);
      v_alerts := v_alerts + 1;
    end if;
  end loop;

  -- The original stamps this after its writes and re-checks the claim first,
  -- because it could have lost the visit meanwhile. In one transaction it
  -- cannot have.
  update "pennsync_records"."visit" v set "events_extracted_at" = v_now,
    "updated_date" = v_now
  where v."source_app_id" = "pennsync_records".deployment_app() and v."id" = p_visit_id;

  return jsonb_build_object('success', true, 'already_processed', false,
    'events_extracted', v_count, 'events_skipped', v_skipped, 'events', v_saved,
    'tasks_created', v_tasks, 'alerts_created', v_alerts);
end $contract$;

reset role;

revoke all on function "pennsync_records".clinical_event_type(text)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".clinical_event_severity(text)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".clinical_alert_type(text)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".clinical_task_type(text)
  from public, anon, authenticated, service_role;
revoke all on function
  "pennsync_records".contract_clinical_extract_context(text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function
  "pennsync_records".contract_clinical_extract_record(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_clinical_extract_context(text,text,text) to authenticated;
grant execute on function
  "pennsync_records".contract_clinical_extract_record(text,text,text,jsonb) to authenticated;

create function "public"."pennsync_contract_clinical_extract_context"(
  p_agency text, p_patient_id text, p_visit_id text) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_clinical_extract_context(p_agency, p_patient_id, p_visit_id)
$c$;
create function "public"."pennsync_contract_clinical_extract_record"(
  p_agency text, p_patient_id text, p_visit_id text, p_events jsonb) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_clinical_extract_record(
    p_agency, p_patient_id, p_visit_id, p_events)
$c$;
revoke all on function "public"."pennsync_contract_clinical_extract_context"(text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function "public"."pennsync_contract_clinical_extract_record"(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_clinical_extract_context"(text,text,text)
  to authenticated;
grant execute on function "public"."pennsync_contract_clinical_extract_record"(text,text,text,jsonb)
  to authenticated;

commit;
