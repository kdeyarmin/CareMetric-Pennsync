-- Documenting a visit: the clinical write the SmartNote path actually makes.
--
-- HAND WRITTEN, like the contracts beside it. The actions and the INPUTS each
-- one accepts are extracted from `updateAuthorizedVisit`'s own `ACTION_FIELDS`
-- into `20260920070000_visit_purpose_policy.sql`. Inputs rather than columns,
-- because an action interprets them: `advance_handoff` accepts `next_status`
-- and writes `emr_handoff_status` and its history, and `set_review_ack`
-- accepts a hash and writes none of it.
--
-- **Four of the original's nine actions.** The other five are KNOWN here and
-- refused with the reason the generator carries, which is not the same answer
-- as an action that does not exist:
--
-- - `set_ai_tags` admits the platform super-administrator and nobody else, and
--   D14 and D22 removed that tier. Dropping it closes the action outright, so
--   who may set an AI tag is a decision rather than a rendering detail — the
--   same rule the purpose generator applies when it refuses to render a
--   purpose that would admit nobody.
-- - `read_ai_processing_source`, `claim_ai_processing` and
--   `publish_ai_processing` are server-to-server, behind `INTERNAL_FN_SECRET`.
--   Their one caller is `processCompletedVisit`, which is not ported, and the
--   record store has no concept of a service identity yet.
-- - `legacy_recovery` answers 503 at source, deliberately. Porting it would be
--   re-enabling it.
--
-- **The roles are this contract's, because the original decides them in code.**
-- `requireActionPolicy` requires `tenant_role = 'clinician'` — exactly that,
-- not an agency administrator and not a manager — for `save_documentation`,
-- `advance_handoff` and `set_review_ack`. `reschedule` has no gate of its own
-- and is left to the policies, which is where D24 already answers it. A
-- generator that invented a data shape for three lines of code would be
-- transcribing a decision rather than carrying one.
--
-- **The chart is D24 and is not asked about here.** The `visit` policies carry
-- the tenant check and the chart check, and `select … for update` takes both
-- the row lock and the authorization in one statement — which is also what
-- replaces the original's full-row compare-and-swap. Base44 gave it no
-- transaction, so it filtered an UPDATE on all forty-six columns of the row it
-- had read; one transaction with a locked row has no window to defend.
--
-- **`note_fnv1a` is a port, not a convenience.** The browser recomputes that
-- exact hash to decide whether an acknowledgement has gone stale
-- (`isAcknowledgementStale` in `src/components/smartNote/emrHandoff.js`), so a
-- different answer for one emoji would make every later note look edited.
-- JavaScript folds UTF-16 CODE UNITS, so a character outside the basic plane
-- is two steps there and is two steps here. A test proves the two agree,
-- including for an emoji, and 250,000 characters fold in about 100ms.
--
-- DIVERGENCES from the original, each a narrowing, each deliberate:
--
-- 1. The five actions above are refused rather than served.
-- 2. A note containing a NUL character is refused, and not by anything here:
--    `jsonb` rejects `\u0000` on input, because PostgreSQL text cannot hold one.
--    The original stored it, because Base44's datastore is JSON all the way
--    down. The refusal is the type system's and arrives before the contract
--    runs, which is why the control-character class below starts at `\u0001`
--    rather than at `\u0000`: the missing end of the range is unreachable.
-- 3. The original re-resolves authority three times around the write and
--    UNDOES the acknowledgement it just wrote if the note moved underneath it.
--    A locked row has no such window, so there is nothing to undo.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.visit_action_known(text)') is null
    or to_regprocedure('pennsync_records.visit_action_served(text)') is null
    or to_regprocedure('pennsync_records.visit_action_accepts(text,text)') is null
    or to_regprocedure('pennsync_records.visit_action_unported(text)') is null then
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

-- The browser's `hashNoteText`, exactly.
--
-- Not a security primitive and not pretending to be one: it answers "is this
-- the same note text the clinician acknowledged?" and the browser asks it
-- again locally. So the two must agree character for character, which is why
-- this folds UTF-16 CODE UNITS rather than code points — JavaScript's
-- `charCodeAt` walks surrogate halves, and a note containing one emoji would
-- otherwise hash differently here and look permanently edited there.
create function "pennsync_records".note_fnv1a(p_text text) returns text
  language plpgsql immutable set search_path = '' as $hash$
declare
  v_hash bigint := 2166136261; v_chars text[]; v_point integer;
  v_unit integer; v_i integer; v_n integer;
begin
  -- Not folded through the loop: splitting an empty string yields one EMPTY
  -- element, whose `ascii` is 0, which would fold a step JavaScript does not.
  if p_text is null or p_text = '' then return '811c9dc5'; end if;
  v_chars := pg_catalog.regexp_split_to_array(p_text, '');
  v_n := coalesce(pg_catalog.array_length(v_chars, 1), 0);
  for v_i in 1 .. v_n loop
    v_point := pg_catalog.ascii(v_chars[v_i]);
    foreach v_unit in array (case when v_point > 65535
      then array[55296 + ((v_point - 65536) / 1024), 56320 + ((v_point - 65536) % 1024)]
      else array[v_point] end) loop
      -- `hash ^= unit; hash = Math.imul(hash, 0x01000193) >>> 0`, in 64-bit
      -- arithmetic masked back to 32 bits.
      v_hash := ((v_hash # v_unit) * 16777619) & 4294967295;
    end loop;
  end loop;
  return pg_catalog.lpad(pg_catalog.to_hex(v_hash), 8, '0');
end $hash$;

-- The original's `narrowVisit` for the served actions. The two AI columns it
-- adds for the internal ones are deliberately absent: those actions are not
-- served, so a projection carrying their answer would be reachable by nobody.
create function "pennsync_records".visit_updated(p "pennsync_records"."visit") returns jsonb
  language sql stable set search_path = '' as $projection$
  select jsonb_build_object(
    'id', p."id",
    'patient_id', p."patient_id",
    'agency_id', p."agency_id",
    'status', coalesce(p."status", 'scheduled'),
    'visit_time', nullif(coalesce(p."visit_time", ''), ''),
    'emr_handoff_status', coalesce(p."emr_handoff_status", 'not_started'),
    -- Coalesced, because an absent acknowledgement is FALSE rather than
    -- unknown: `jsonb_typeof(null)` is null and the whole conjunction would
    -- come back null, which a caller would read as "cannot tell".
    'review_acknowledged', coalesce(
      jsonb_typeof(p."documentation_review_ack") = 'object'
      and p."documentation_review_ack"->>'acknowledged' = 'true', false))
$projection$;

-- The original's `sanitizeClinicalField`, field by field.
--
-- Shape and bounds, never authority: which inputs an action accepts is the
-- extracted policy's answer and is settled before this is called.
create function "pennsync_records".visit_documentation_value(p_field text, p_value jsonb)
  returns jsonb language plpgsql stable set search_path = '' as $value$
declare v_text text; v_item jsonb; v_key text; v_number numeric; v_seen text[] := '{}';
begin
  if p_value is null then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
  end if;

  if p_field in ('homebound_status_verified', 'skilled_intervention_documented',
    'grounding_pending') then
    if jsonb_typeof(p_value) <> 'boolean' then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
    end if;
    return p_value;
  end if;

  if p_field = 'compliance_score' then
    if jsonb_typeof(p_value) <> 'number' then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
    end if;
    v_number := (p_value#>>'{}')::numeric;
    if v_number < 0 or v_number > 100 then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
    end if;
    return p_value;
  end if;

  -- The original's VITAL_FIELDS. A null CLEARS one, which is how the form
  -- preserves a field the clinician emptied, so it is removed rather than
  -- rejected — otherwise clearing a vital would block the whole save.
  if p_field = 'vital_signs' then
    if jsonb_typeof(p_value) <> 'object' then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
    end if;
    for v_key in select jsonb_object_keys(p_value) loop
      if v_key not in ('temperature', 'blood_pressure_systolic', 'blood_pressure_diastolic',
        'heart_rate', 'respiratory_rate', 'oxygen_saturation', 'pain_level', 'weight') then
        raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
      end if;
      if jsonb_typeof(p_value->v_key) = 'null' then continue; end if;
      if jsonb_typeof(p_value->v_key) <> 'number' then
        raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
      end if;
      if pg_catalog.abs((p_value->>v_key)::numeric) > 1000000 then
        raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
      end if;
    end loop;
    return (select coalesce(jsonb_object_agg(k, p_value->k), '{}'::jsonb)
      from jsonb_object_keys(p_value) k where jsonb_typeof(p_value->k) <> 'null');
  end if;

  -- The original's `boundedStringList`: bounded, non-empty, trimmed, free of
  -- control characters and without duplicates. `ai_tags` additionally carries
  -- the system prefixes, because `save_documentation` writes only tags the
  -- system derived — a clinician does not type one.
  if p_field in ('compliance_issues', 'ai_tags') then
    if jsonb_typeof(p_value) <> 'array'
      or jsonb_array_length(p_value) > (case p_field when 'ai_tags' then 64 else 100 end) then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
    end if;
    for v_item in select * from jsonb_array_elements(p_value) loop
      v_text := v_item#>>'{}';
      if jsonb_typeof(v_item) <> 'string' or coalesce(v_text, '') = ''
        or pg_catalog.length(v_text) > (case p_field when 'ai_tags' then 128 else 2000 end)
        or pg_catalog.btrim(v_text) <> v_text
        or v_text ~ '[\u0001-\u001f\u007f]'
        or v_text = any(v_seen) then
        raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
      end if;
      if p_field = 'ai_tags' and v_text !~ '^(trend:|chart_flag:|denial_risk:)' then
        raise exception using errcode='22023', message='PENNSYNC_VISIT_TAG_NOT_SYSTEM';
      end if;
      v_seen := v_seen || v_text;
    end loop;
    return p_value;
  end if;

  if jsonb_typeof(p_value) <> 'string' then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
  end if;
  v_text := p_value#>>'{}';

  if p_field = 'status' then
    if v_text not in ('completed', 'pending_review') then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
    end if;
  elsif p_field = 'documentation_source' then
    if v_text not in ('smart_note', 'audio', 'manual') then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
    end if;
  elsif p_field = 'visit_time' then
    if v_text !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
    end if;
  elsif p_field in ('nurse_notes', 'raw_transcription') then
    if pg_catalog.length(v_text) > 250000 then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
    end if;
  elsif p_field = 'homebound_justification' then
    if pg_catalog.length(v_text) > 20000 then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
    end if;
  elsif p_field <> 'patient_id' then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
  end if;
  return p_value;
end $value$;

create function "pennsync_records".contract_visit_update(
  p_agency text, p_visit_id text, p_action text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_role text; v_email text; v_field text; v_reason text;
  v_visit "pennsync_records"."visit"; v_patient "pennsync_records"."patient";
  v_input jsonb := '{}'::jsonb; v_mutation jsonb := '{}'::jsonb;
  v_status text; v_target text; v_grounding boolean;
  v_history jsonb; v_entry jsonb; v_order integer; v_prior integer := 0;
  v_note text; v_sha text; v_assignments text; v_written bigint;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_VISIT_AGENCY_NOT_HELD';
  end if;
  if p_visit_id is null or p_visit_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_ID_INVALID';
  end if;
  if p_action is null or not "pennsync_records".visit_action_known(p_action) then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_ACTION_UNKNOWN';
  end if;
  -- Known and not served is a different answer from unknown, and the reason
  -- travels with it so a reader is not left guessing which of the five it is.
  if not "pennsync_records".visit_action_served(p_action) then
    v_reason := "pennsync_records".visit_action_unported(p_action);
    raise exception using errcode='42501',
      message='PENNSYNC_VISIT_ACTION_UNPORTED', detail=v_reason;
  end if;
  -- The original's `requireActionPolicy`, which is code there and so is
  -- authorization here. Exactly `clinician`: an agency administrator does not
  -- document a visit, and neither does a manager.
  if p_action in ('save_documentation', 'advance_handoff', 'set_review_ack')
    and v_role <> 'clinician' then
    raise exception using errcode='42501', message='PENNSYNC_VISIT_CLINICIAN_REQUIRED';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_PAYLOAD_INVALID';
  end if;
  for v_field in select jsonb_object_keys(p_fields) loop
    if not "pennsync_records".visit_action_accepts(p_action, v_field) then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_UNSUPPORTED';
    end if;
  end loop;

  -- The row, locked. `for update` takes the lock AND the UPDATE policy's
  -- authorization in one statement, so D24 decides the chart before anything
  -- is read and nothing can move it underneath the checks below.
  select * into v_visit from "pennsync_records"."visit" v
  where v."source_app_id" = "pennsync_records".deployment_app()
    and v."id" = p_visit_id and v."agency_id" = p_agency
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_VISIT_NOT_VISIBLE';
  end if;
  if v_visit."is_sample" is true
    or coalesce(v_visit."status", 'scheduled') not in
      ('scheduled', 'in_progress', 'completed', 'pending_review', 'cancelled') then
    raise exception using errcode='42501', message='PENNSYNC_VISIT_UNAVAILABLE';
  end if;
  -- The original's bundle requires an ACTIVE patient for every action, so a
  -- visit on a discharged chart is closed to all of them.
  select * into v_patient from "pennsync_records"."patient" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."id" = v_visit."patient_id" and p."agency_id" = p_agency;
  if not found or v_patient."status" is distinct from 'active'
    or v_patient."is_archived" is not false then
    raise exception using errcode='42501', message='PENNSYNC_VISIT_PATIENT_UNAVAILABLE';
  end if;

  v_email := "pennsync_records".caller_email();
  if v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_VISIT_AGENCY_NOT_HELD';
  end if;
  v_status := coalesce(v_visit."status", 'scheduled');

  if p_action = 'save_documentation' then
    if (select count(*) from jsonb_object_keys(p_fields)) = 0 then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELDS_REQUIRED';
    end if;
    for v_field in select jsonb_object_keys(p_fields) loop
      v_input := v_input || jsonb_build_object(v_field,
        "pennsync_records".visit_documentation_value(v_field, p_fields->v_field));
    end loop;
    -- An assertion about which chart the caller believes it is writing, not a
    -- column to move. The original refuses a mismatch rather than ignoring it.
    if (v_input ? 'patient_id')
      and v_input->>'patient_id' is distinct from v_visit."patient_id" then
      raise exception using errcode='42501', message='PENNSYNC_VISIT_PATIENT_MISMATCH';
    end if;
    v_mutation := v_input - 'patient_id';
    if (select count(*) from jsonb_object_keys(v_mutation)) = 0 then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELDS_REQUIRED';
    end if;
    if v_status = 'cancelled' then
      raise exception using errcode='42501', message='PENNSYNC_VISIT_CANCELLED';
    end if;
    if v_status = 'completed' and v_mutation->>'status' = 'pending_review' then
      raise exception using errcode='42501', message='PENNSYNC_VISIT_STATUS_REGRESSION';
    end if;
    -- `pending_review` means "the grounding pass has not finished", so the two
    -- must agree or the visit is in a state nothing downstream can read.
    v_target := coalesce(v_mutation->>'status', v_status);
    v_grounding := case when v_mutation ? 'grounding_pending'
      then (v_mutation->>'grounding_pending')::boolean
      else v_visit."grounding_pending" is true end;
    if (v_target = 'pending_review') <> v_grounding then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_GROUNDING_INCONSISTENT';
    end if;
    -- New documentation invalidates an acknowledgement of the old text. The
    -- browser would otherwise show a review that covers a note nobody read.
    if (v_mutation ? 'nurse_notes') or (v_mutation ? 'raw_transcription') then
      v_mutation := v_mutation || jsonb_build_object('documentation_review_ack', null);
    end if;

  elsif p_action = 'reschedule' then
    if not (p_fields ? 'visit_time')
      or (select count(*) from jsonb_object_keys(p_fields)) <> 1 then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELDS_REQUIRED';
    end if;
    -- Shape before state, like the original: it validates every input while
    -- parsing the request and reaches the row afterwards, so a malformed time
    -- is answered the same way whatever the visit happens to be doing.
    v_mutation := jsonb_build_object('visit_time',
      "pennsync_records".visit_documentation_value('visit_time', p_fields->'visit_time'));
    if v_status <> 'scheduled' then
      raise exception using errcode='42501', message='PENNSYNC_VISIT_NOT_SCHEDULED';
    end if;

  elsif p_action = 'advance_handoff' then
    if not (p_fields ? 'next_status')
      or (select count(*) from jsonb_object_keys(p_fields)) <> 1
      or coalesce(p_fields->>'next_status', '') not in
        ('not_started', 'copied_to_emr', 'reviewed_in_emr', 'signed_in_emr') then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELDS_REQUIRED';
    end if;
    -- The history is re-validated before it is appended to, because it is the
    -- record of who reported each step and a malformed one cannot be extended
    -- into a coherent one.
    v_history := case when jsonb_typeof(v_visit."emr_handoff_history") = 'array'
      then v_visit."emr_handoff_history" else
      case when v_visit."emr_handoff_history" is null then '[]'::jsonb else null end end;
    if v_history is null or jsonb_array_length(v_history) > 100 then
      raise exception using errcode='42501', message='PENNSYNC_VISIT_HANDOFF_HISTORY_INVALID';
    end if;
    for v_entry in select * from jsonb_array_elements(v_history) loop
      v_order := case v_entry->>'status'
        when 'not_started' then 0 when 'copied_to_emr' then 1
        when 'reviewed_in_emr' then 2 when 'signed_in_emr' then 3 else null end;
      if jsonb_typeof(v_entry) <> 'object' or v_order is distinct from v_prior + 1
        or coalesce(v_entry->>'reported_by', '') = ''
        or coalesce(v_entry->>'reported_at', '') = ''
        or v_entry->>'self_reported' <> 'true'
        or jsonb_typeof(v_entry->'note') <> 'string'
        or pg_catalog.length(v_entry->>'note') > 2000 then
        raise exception using errcode='42501', message='PENNSYNC_VISIT_HANDOFF_HISTORY_INVALID';
      end if;
      v_prior := v_order;
    end loop;
    v_order := case coalesce(v_visit."emr_handoff_status", 'not_started')
      when 'not_started' then 0 when 'copied_to_emr' then 1
      when 'reviewed_in_emr' then 2 when 'signed_in_emr' then 3 else null end;
    if v_order is null or v_prior <> v_order then
      raise exception using errcode='42501', message='PENNSYNC_VISIT_HANDOFF_HISTORY_INVALID';
    end if;
    if (case p_fields->>'next_status'
      when 'not_started' then 0 when 'copied_to_emr' then 1
      when 'reviewed_in_emr' then 2 else 3 end) <> v_order + 1 then
      raise exception using errcode='42501', message='PENNSYNC_VISIT_HANDOFF_STEP';
    end if;
    if jsonb_array_length(v_history) >= 100 then
      raise exception using errcode='42501', message='PENNSYNC_VISIT_HANDOFF_FULL';
    end if;
    v_mutation := jsonb_build_object(
      'emr_handoff_status', p_fields->'next_status',
      'emr_handoff_history', v_history || jsonb_build_array(jsonb_build_object(
        'status', p_fields->>'next_status',
        'reported_by', v_email,
        'reported_at', to_char(clock_timestamp() at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'self_reported', true,
        'note', '')));

  else -- set_review_ack
    if jsonb_typeof(p_fields->'acknowledged') <> 'boolean' then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELDS_REQUIRED';
    end if;
    if (p_fields->>'acknowledged') = 'false' then
      -- A withdrawal carries nothing else: the other two describe the note
      -- being acknowledged, and there is none.
      if (select count(*) from jsonb_object_keys(p_fields)) <> 1 then
        raise exception using errcode='22023', message='PENNSYNC_VISIT_ACK_FIELDS_UNEXPECTED';
      end if;
      v_mutation := jsonb_build_object('documentation_review_ack', null);
    else
      if coalesce(p_fields->>'expected_note_hash', '') !~ '^[a-f0-9]{64}$' then
        raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELDS_REQUIRED';
      end if;
      if (p_fields ? 'nurse_edited') and jsonb_typeof(p_fields->'nurse_edited') <> 'boolean' then
        raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELDS_REQUIRED';
      end if;
      v_note := coalesce(v_visit."nurse_notes", '');
      if pg_catalog.btrim(v_note) = '' then
        raise exception using errcode='42501', message='PENNSYNC_VISIT_NO_DOCUMENTATION';
      end if;
      v_sha := pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(v_note, 'UTF8')), 'hex');
      -- The caller says which text it read. If the note moved since, the
      -- acknowledgement would cover something nobody reviewed.
      if v_sha <> p_fields->>'expected_note_hash' then
        raise exception using errcode='42501', message='PENNSYNC_VISIT_NOTE_CHANGED';
      end if;
      v_mutation := jsonb_build_object('documentation_review_ack', jsonb_build_object(
        'acknowledged', true,
        'acknowledged_by', v_email,
        'acknowledged_at', to_char(clock_timestamp() at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'note_hash', "pennsync_records".note_fnv1a(v_note),
        'note_sha256', v_sha,
        'note_length', pg_catalog.length(v_note),
        'ai_assisted', true,
        'nurse_edited', coalesce(p_fields->>'nurse_edited', 'false') = 'true',
        'statement', 'I reviewed this suggested documentation for accuracy before '
          || 'copying it to the EMR.',
        'is_clinical_signature', false));
    end if;
  end if;

  -- The set list is built from the mutation's own keys. Every one of them is
  -- either an input `visit_action_accepts` proved against a closed list, or a
  -- column this contract names as a literal in the branches above — never
  -- anything a caller chose, and `%I` quotes it besides.
  v_assignments := (select pg_catalog.string_agg(
    pg_catalog.format('%I = ($1).%I', k, k), ', ' order by k)
    from jsonb_object_keys(v_mutation) k);
  v_visit := jsonb_populate_record(v_visit, v_mutation);
  v_visit."updated_date" := clock_timestamp();
  execute pg_catalog.format(
    'update "pennsync_records"."visit" as t set %s, "updated_date" = ($1)."updated_date"'
    || ' where t."source_app_id" = $2 and t."id" = $3 and t."agency_id" = $4', v_assignments)
    using v_visit, "pennsync_records".deployment_app(), p_visit_id, p_agency;
  get diagnostics v_written = row_count;
  -- The row was locked above, so the only way to write none of it is for the
  -- UPDATE policy to refuse the result — which is not something to report as
  -- success.
  if v_written <> 1 then
    raise exception using errcode='42501', message='PENNSYNC_VISIT_NOT_VISIBLE';
  end if;

  return jsonb_build_object('updated', true, 'action', p_action,
    'visit', "pennsync_records".visit_updated(v_visit));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".note_fnv1a(text),
  "pennsync_records".visit_updated("pennsync_records"."visit"),
  "pennsync_records".visit_documentation_value(text,jsonb),
  "pennsync_records".contract_visit_update(text,text,text,jsonb)
  from public, anon, authenticated, service_role;

grant execute on function
  "pennsync_records".contract_visit_update(text,text,text,jsonb) to authenticated;

create function "public"."pennsync_contract_visit_update"(
  p_agency text, p_visit_id text, p_action text, p_fields jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_visit_update(p_agency, p_visit_id, p_action, p_fields)
$contract$;

revoke all on function "public"."pennsync_contract_visit_update"(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_visit_update"(text,text,text,jsonb) to authenticated;

commit;
