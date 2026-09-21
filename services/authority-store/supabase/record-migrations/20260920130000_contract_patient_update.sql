-- Mutating a patient, and the first ported capability that changes one.
--
-- HAND WRITTEN, like the contracts beside it. What is NOT hand written is the
-- policy it enforces: `updateAuthorizedPatient` fences its own
-- `ACTION_FIELD_NAMES` and `ACTION_ROLE_NAMES`, and those are extracted into
-- `20260920050000_patient_purpose_policy.sql` as `patient_action_known`,
-- `_admits`, `_writes` and `_rank`. Six actions over twenty-nine fields is the
-- transcription D12 settled against, and a field typed in by hand here would
-- let a caller write a column the original never let them near.
--
-- **A caller does not send a patch.** It names workflow actions — edit the
-- demographics, set the primary diagnosis, discharge — and each action decides
-- both which fields it may touch and which tenant roles may perform it. That
-- is the whole design of the original and it is why the capability can be
-- ported at all: an arbitrary patch would have no reviewable authorization.
--
-- The action field sets are DISJOINT, which the generator proves rather than
-- assumes, so a batch of actions is one merged write whose result does not
-- depend on the order the caller sent them in. The original asserts the same
-- property at runtime and throws if it is ever violated.
--
-- What the contract decides rather than the caller:
--
-- - **Who may open the chart.** Nothing here asks. The read and the write both
--   go through the `patient` policies, and D24 narrows those to the care team:
--   an `agency_admin` or `manager` opens every chart in the agency, a
--   `clinician`, `social_worker` or `spiritual_care` worker opens the ones
--   they are assigned, and `office_staff` opens none. A chart the caller
--   cannot open is `PENNSYNC_PATIENT_NOT_VISIBLE` on the read, so the write is
--   never reached.
-- - **Concurrency.** `expected_updated_date` is the caller's claim about what
--   it read. It is checked before the write AND carried into the `where`
--   clause, so a concurrent change loses rather than being overwritten.
-- - **`updated_date`.** Stamped here. A caller cannot name it: it is not a
--   field any action declares.
-- - **Which columns move.** Only the keys the actions supplied, each one
--   proven against `patient_action_writes` before it reaches the statement.
--
-- DIVERGENCES from the original, each a narrowing, each deliberate:
--
-- 1. `platform_owner` is not a mutating role here; D14 and D22 removed the
--    platform tier. Recorded once in the generated policy file.
-- 2. **`office_staff` can perform no action on any chart**, although the
--    original admits it for `edit_demographics` and `edit_insurance`. Not a
--    rule this contract adds — D24 gives that role no chart at all, so the
--    read finds nothing and the action never runs. The role gate still admits
--    it, faithfully, because the gate answers the policy's question and D24
--    answers a different one. Restoring the capability means deciding that
--    `office_staff` opens charts, which is a D24 decision and not this
--    contract's to make.
-- 3. **A non-creator, non-assigned caller is refused** where the original
--    admits the chart's creator. D28 makes the creator a care-team member at
--    the moment of creation, so the two agree for anything created through the
--    ported path; a chart carried in from Base44 whose creator was never
--    assigned is the case that narrows.
-- 4. **`medical_record_number` may be moved only by a caller who opens every
--    chart.** The original checks the whole agency for a collision using a
--    service role. This contract is bound by the same policies as its caller,
--    so it sees only the charts they open — and a collision check that cannot
--    see every chart would let a duplicate through, which is a WIDENING rather
--    than a narrowing and is the one thing a port may not do. So the field is
--    admitted exactly where the check is honest and refused everywhere else.
--    The alternative is a uniqueness constraint on the column; the entity
--    schema does not declare one, and inventing one is not this contract's
--    call. The four fields whose descriptions DO ask for datastore uniqueness
--    are a separate decision.
-- 5. The original re-reads the row and the caller's membership three times
--    around the write and verifies a readback afterwards, because Base44 gives
--    it no transaction. One statement in one transaction has no such window.
-- 6. The answer is the original's own `narrowPatient` projection plus
--    `updated`, `action`, `actions` and `changed_fields`, exactly as the
--    original returns them.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.patient_action_known(text)') is null
    or to_regprocedure('pennsync_records.patient_action_admits(text,text)') is null
    or to_regprocedure('pennsync_records.patient_action_writes(text,text)') is null
    or to_regprocedure('pennsync_records.patient_action_rank(text)') is null
    or to_regprocedure('pennsync_records.caller_opens_every_chart(text)') is null then
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

-- The original's `validateChangeValue`, field by field.
--
-- Shape and bounds, never authority: which fields may be sent at all is the
-- extracted policy's answer and is settled before this is called. What this
-- adds is what the column type cannot say — that a name is trimmed and not
-- blank, that an address is bounded, that an email is canonicalised the way
-- the original canonicalises it, and that a diagnosis list is a list of
-- strings rather than whatever JSON arrived.
--
-- `stable` rather than `immutable`: a date is parsed through the session's
-- DateStyle, so this is not constant-foldable.
create function "pennsync_records".patient_change_value(p_field text, p_value jsonb)
  returns jsonb language plpgsql stable set search_path = '' as $value$
declare v_text text; v_item jsonb; v_date date;
begin
  if p_value is null then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_INVALID';
  end if;
  -- The original's MAX_BODY_BYTES, applied per value as it does.
  if pg_catalog.length(p_value::text) > 1000000 then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_TOO_LARGE';
  end if;

  -- The original's SIMPLE_ARRAY_FIELDS. `allergies` is deliberately not one of
  -- them: the original treats it as bounded text and so does the column.
  if p_field in ('secondary_diagnoses', 'past_medical_history', 'goals_of_care') then
    if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 200 then
      raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_INVALID';
    end if;
    for v_item in select * from jsonb_array_elements(p_value) loop
      if jsonb_typeof(v_item) <> 'string'
        or pg_catalog.length(v_item #>> '{}') > 1000 then
        raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_INVALID';
      end if;
    end loop;
    return p_value;
  end if;

  if jsonb_typeof(p_value) <> 'string' then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_INVALID';
  end if;
  v_text := p_value #>> '{}';

  if p_field in ('first_name', 'last_name', 'primary_diagnosis') then
    v_text := pg_catalog.btrim(v_text);
    if v_text = '' or pg_catalog.length(v_text) > 1000 then
      raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_INVALID';
    end if;
    return pg_catalog.to_jsonb(v_text);
  end if;

  if p_field = 'medical_record_number' then
    v_text := pg_catalog.btrim(v_text);
    if pg_catalog.length(v_text) > 200 then
      raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_INVALID';
    end if;
    return pg_catalog.to_jsonb(v_text);
  end if;

  -- The original's EMAIL_FIELDS and its `canonicalEmail`: trimmed, lowercased,
  -- and STORED that way. An empty string clears the field and is not an
  -- address, so it skips the check rather than failing it.
  if p_field in ('email', 'physician_email', 'caregiver_email') then
    if v_text = '' then return pg_catalog.to_jsonb(''::text); end if;
    v_text := pg_catalog.lower(pg_catalog.btrim(v_text));
    if v_text = '' or pg_catalog.length(v_text) > 320
      or pg_catalog.strpos(v_text, '@') = 0 or v_text ~ '\s' then
      raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_INVALID';
    end if;
    return pg_catalog.to_jsonb(v_text);
  end if;

  -- The original's DATE_FIELDS. An empty string is how it CLEARS a date, and
  -- the column is a `date`, so the cleared value is JSON null here.
  -- `jsonb_populate_record` sets a column to NULL for a null and leaves an
  -- ABSENT key alone, so the clear is carried rather than dropped.
  if p_field in ('date_of_birth', 'admission_date', 'discharge_date') then
    if v_text = '' then return 'null'::jsonb; end if;
    if v_text !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_INVALID';
    end if;
    begin
      v_date := v_text::date;
    exception when others then
      raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_INVALID';
    end;
    -- `2021-02-30` matches the shape and is not a day. The cast alone accepts
    -- it in some settings, so the round trip is what rejects it.
    if pg_catalog.to_char(v_date, 'YYYY-MM-DD') <> v_text then
      raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_INVALID';
    end if;
    return pg_catalog.to_jsonb(v_text);
  end if;

  -- The enumerations. The table's own CHECK constraints carry the same values;
  -- these are here so a caller gets a refusal naming the field instead of a
  -- constraint violation naming the table. `status` is narrower than the
  -- column's check on purpose: `merged` and `archived` are lifecycle states no
  -- action may set, which is the original's LIVE_PATIENT_STATUSES.
  if p_field = 'care_type' and v_text not in ('home_health', 'hospice') then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_INVALID';
  end if;
  if p_field = 'admission_source' and v_text not in
    ('home', 'hospital', 'skilled_nursing_facility', 'rehab', 'other') then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_INVALID';
  end if;
  if p_field = 'discharge_disposition' and v_text not in
    ('home', 'hospital', 'skilled_nursing_facility', 'deceased', 'other') then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_INVALID';
  end if;
  if p_field = 'status' and v_text not in ('active', 'hospitalized', 'discharged') then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_INVALID';
  end if;

  -- The original's fallback: bounded text.
  if pg_catalog.length(v_text) > 20000 then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_TOO_LARGE';
  end if;
  return pg_catalog.to_jsonb(v_text);
end $value$;

-- The original's own narrow projection of a mutated chart. Deliberately not
-- `patient_created`: a create answers the provenance and the request id it
-- just stamped, and a mutation answers the lifecycle it just moved.
create function "pennsync_records".patient_updated(p "pennsync_records"."patient") returns jsonb
  language sql stable set search_path = '' as $projection$
  select jsonb_build_object(
    'id', p."id",
    'agency_id', p."agency_id",
    'first_name', p."first_name",
    'middle_name', coalesce(p."middle_name", ''),
    'last_name', p."last_name",
    'status', p."status",
    'care_type', coalesce(p."care_type", 'home_health'),
    'is_archived', p."is_archived" is true,
    'updated_date', p."updated_date")
$projection$;

create function "pennsync_records".contract_patient_update(
  p_agency text, p_patient_id text,
  p_expected_updated_date timestamptz, p_actions jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_role text; v_entry jsonb; v_action text; v_changes jsonb; v_field text;
  v_seen text[] := '{}'; v_merged jsonb := '{}'::jsonb; v_ordered text[];
  v_existing "pennsync_records"."patient"; v_row "pennsync_records"."patient";
  v_changed text[]; v_status text; v_target text; v_mrn text; v_assignments text;
  v_written bigint;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_PATIENT_AGENCY_NOT_HELD';
  end if;
  if p_patient_id is null or p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_ID_INVALID';
  end if;
  -- The original requires it and so does this: without it a caller is writing
  -- over a row it never read.
  if p_expected_updated_date is null then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_EXPECTED_REQUIRED';
  end if;
  if p_actions is null or jsonb_typeof(p_actions) <> 'array'
    or jsonb_array_length(p_actions) = 0 then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_ACTIONS_INVALID';
  end if;

  for v_entry in select * from jsonb_array_elements(p_actions) loop
    -- Exactly `action` and `changes`, like the original. An extra key is
    -- refused rather than ignored: a caller who sent one believes it counted.
    if jsonb_typeof(v_entry) <> 'object'
      or (select count(*) from jsonb_object_keys(v_entry)) <> 2
      or not (v_entry ? 'action') or not (v_entry ? 'changes') then
      raise exception using errcode='22023', message='PENNSYNC_PATIENT_ACTION_SHAPE';
    end if;
    v_action := v_entry->>'action';
    if v_action is null or not "pennsync_records".patient_action_known(v_action)
      or v_action = any(v_seen) then
      raise exception using errcode='22023', message='PENNSYNC_PATIENT_ACTION_UNKNOWN';
    end if;
    if not "pennsync_records".patient_action_admits(v_action, v_role) then
      raise exception using errcode='42501', message='PENNSYNC_PATIENT_ACTION_FORBIDDEN';
    end if;
    v_changes := v_entry->'changes';
    if jsonb_typeof(v_changes) <> 'object'
      or (select count(*) from jsonb_object_keys(v_changes)) = 0 then
      raise exception using errcode='22023', message='PENNSYNC_PATIENT_CHANGES_INVALID';
    end if;
    for v_field in select jsonb_object_keys(v_changes) loop
      if not "pennsync_records".patient_action_writes(v_action, v_field) then
        raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_UNSUPPORTED';
      end if;
      -- The action field sets are disjoint and a repeated action is already
      -- refused, so this cannot fire today. It is the property the original
      -- asserts at runtime, kept here because the merge below is only one
      -- write if it holds.
      if v_merged ? v_field then
        raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_REPEATED';
      end if;
      v_merged := v_merged || jsonb_build_object(v_field,
        "pennsync_records".patient_change_value(v_field, v_changes->v_field));
    end loop;
    -- The original's one per-action requirement that its field list cannot
    -- express: a status change must name the status. `set_primary_diagnosis`
    -- needs no such rule — it declares one field, and `changes` is nonempty.
    if v_action = 'change_status' and not (v_changes ? 'status') then
      raise exception using errcode='22023', message='PENNSYNC_PATIENT_STATUS_REQUIRED';
    end if;
    v_seen := v_seen || v_action;
  end loop;
  v_ordered := (select pg_catalog.array_agg(a order by "pennsync_records".patient_action_rank(a))
    from pg_catalog.unnest(v_seen) a);

  -- The chart, read under the same policies as every other read. D24 decides
  -- whether this caller can open it at all, and a chart they cannot open is
  -- indistinguishable from one that does not exist.
  select * into v_existing from "pennsync_records"."patient" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."id" = p_patient_id and p."agency_id" = p_agency;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_PATIENT_NOT_VISIBLE';
  end if;

  -- The original's `validatePatientRecord` preconditions. A sample chart, an
  -- archived one, or one in a lifecycle state no workflow acts on.
  if v_existing."is_archived" is not false or v_existing."is_sample" is not false
    or coalesce(v_existing."status", '') not in ('active', 'hospitalized', 'discharged')
    or v_existing."updated_date" is null then
    raise exception using errcode='42501', message='PENNSYNC_PATIENT_UNAVAILABLE';
  end if;
  if v_existing."updated_date" <> p_expected_updated_date then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_STALE';
  end if;

  v_status := v_existing."status";

  -- The original's CLINICAL_ACTIONS: a discharged chart takes no clinical
  -- edit, because the episode it documents is over.
  if ('edit_clinical_profile' = any(v_seen) or 'set_primary_diagnosis' = any(v_seen))
    and v_status not in ('active', 'hospitalized') then
    raise exception using errcode='42501',
      message='PENNSYNC_PATIENT_NOT_CLINICALLY_ACTIVE';
  end if;

  if 'edit_care_episode' = any(v_seen) then
    if v_status = 'discharged' then
      raise exception using errcode='42501', message='PENNSYNC_PATIENT_EPISODE_DISCHARGED';
    end if;
    -- Home health and hospice are different episodes, not a label. The
    -- original moves it only while the chart is active.
    if (v_merged ? 'care_type') and v_status <> 'active' then
      raise exception using errcode='42501', message='PENNSYNC_PATIENT_CARE_TYPE_LOCKED';
    end if;
  end if;

  if 'change_status' = any(v_seen) then
    v_target := v_merged->>'status';
    if v_target = v_status then
      if (v_merged ? 'discharge_date') or (v_merged ? 'discharge_disposition') then
        raise exception using errcode='22023',
          message='PENNSYNC_PATIENT_DISCHARGE_FIELDS_UNEXPECTED';
      end if;
    else
      -- The original's STATUS_TRANSITIONS. A discharge is terminal here;
      -- readmission is a new episode, not a status edit.
      --
      -- Parenthesised deliberately: a plpgsql `if` condition ends at the first
      -- `then` outside parentheses, so a bare `case` truncates the expression
      -- and the function fails to parse.
      if not (case v_status
        when 'active' then v_target in ('hospitalized', 'discharged')
        when 'hospitalized' then v_target in ('active', 'discharged')
        else false end) then
        raise exception using errcode='42501', message='PENNSYNC_PATIENT_STATUS_TRANSITION';
      end if;
      if v_target = 'discharged' then
        if nullif(v_merged->>'discharge_date', '') is null
          or nullif(v_merged->>'discharge_disposition', '') is null then
          raise exception using errcode='22023',
            message='PENNSYNC_PATIENT_DISCHARGE_FIELDS_REQUIRED';
        end if;
      elsif (v_merged ? 'discharge_date') or (v_merged ? 'discharge_disposition') then
        raise exception using errcode='22023',
          message='PENNSYNC_PATIENT_DISCHARGE_FIELDS_UNEXPECTED';
      end if;
    end if;
  end if;

  -- Divergence 4. Admitted only where the collision check below sees every
  -- chart in the agency, because a check that sees fewer would let a duplicate
  -- through.
  if v_merged ? 'medical_record_number' then
    if not "pennsync_records".caller_opens_every_chart(p_agency) then
      raise exception using errcode='42501', message='PENNSYNC_PATIENT_MRN_SCOPE';
    end if;
    v_mrn := nullif(v_merged->>'medical_record_number', '');
    if v_mrn is not null and exists (select 1 from "pennsync_records"."patient" p
      where p."source_app_id" = "pennsync_records".deployment_app()
        and p."agency_id" = p_agency and p."medical_record_number" = v_mrn
        and p."id" <> p_patient_id) then
      raise exception using errcode='23505', message='PENNSYNC_PATIENT_MRN_TAKEN';
    end if;
  end if;

  -- The merged row. An absent key keeps the column it already had, so nothing
  -- outside the actions' fields can move, and a value the column cannot hold
  -- raises rather than truncating.
  begin
    v_row := jsonb_populate_record(v_existing, v_merged);
  exception when others then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_INVALID';
  end;

  -- The original validates the COMBINED result, not each action against the
  -- old row: an admission edit and a discharge can each be valid alone and
  -- contradict each other together.
  if v_row."status" = 'discharged' then
    if v_row."discharge_date" is null
      or coalesce(v_row."discharge_disposition", '') = '' then
      raise exception using errcode='22023',
        message='PENNSYNC_PATIENT_DISCHARGE_FIELDS_REQUIRED';
    end if;
  elsif v_row."discharge_date" is not null
    or coalesce(v_row."discharge_disposition", '') <> '' then
    raise exception using errcode='22023',
      message='PENNSYNC_PATIENT_DISCHARGE_FIELDS_UNEXPECTED';
  end if;
  if v_row."admission_date" is not null and v_row."discharge_date" is not null
    and v_row."discharge_date" < v_row."admission_date" then
    raise exception using errcode='22023',
      message='PENNSYNC_PATIENT_DISCHARGE_BEFORE_ADMISSION';
  end if;

  -- The original drops a field whose value already matches and reports what
  -- actually moved. Compared as the COLUMN rather than as the payload, so a
  -- date sent as a string and the date already stored are the same value.
  v_changed := (select coalesce(pg_catalog.array_agg(k order by k), '{}'::text[])
    from jsonb_object_keys(v_merged) k
    where pg_catalog.to_jsonb(v_row) -> k
      is distinct from pg_catalog.to_jsonb(v_existing) -> k);

  if pg_catalog.array_length(v_changed, 1) is null then
    return jsonb_build_object('updated', false,
      'action', case when pg_catalog.array_length(v_ordered, 1) = 1
        then v_ordered[1] else 'batch' end,
      'actions', pg_catalog.to_jsonb(v_ordered),
      'changed_fields', '[]'::jsonb,
      'patient', "pennsync_records".patient_updated(v_existing));
  end if;

  v_row."updated_date" := clock_timestamp();
  -- The set list is built from the keys that moved rather than from a column
  -- list this contract would have to keep in step with the extracted policy.
  -- That is not a convenience: a field added to an action in the original
  -- would pass validation and then silently not be written, which is the one
  -- failure mode a hand-kept list has and this one cannot. Every key here has
  -- already been proven by `patient_action_writes` against a closed list of
  -- twenty-nine literals, and `%I` quotes it besides.
  v_assignments := (select pg_catalog.string_agg(
    pg_catalog.format('%I = ($1).%I', k, k), ', ' order by k)
    from jsonb_object_keys(v_merged) k);
  execute pg_catalog.format(
    'update "pennsync_records"."patient" as t set %s, "updated_date" = ($1)."updated_date"'
    || ' where t."source_app_id" = $2 and t."id" = $3 and t."agency_id" = $4'
    || ' and t."updated_date" = $5', v_assignments)
    using v_row, "pennsync_records".deployment_app(), p_patient_id,
      p_agency, p_expected_updated_date;
  -- `execute` does NOT set `found`; only `get diagnostics` sees its row count.
  -- Nothing updated here means the row moved between the read and the write,
  -- which is the race `expected_updated_date` is in the `where` clause for.
  get diagnostics v_written = row_count;
  if v_written <> 1 then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_STALE';
  end if;

  return jsonb_build_object('updated', true,
    'action', case when pg_catalog.array_length(v_ordered, 1) = 1
      then v_ordered[1] else 'batch' end,
    'actions', pg_catalog.to_jsonb(v_ordered),
    'changed_fields', pg_catalog.to_jsonb(v_changed),
    'patient', "pennsync_records".patient_updated(v_row));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".patient_change_value(text,jsonb),
  "pennsync_records".patient_updated("pennsync_records"."patient"),
  "pennsync_records".contract_patient_update(text,text,timestamptz,jsonb)
  from public, anon, authenticated, service_role;

grant execute on function
  "pennsync_records".contract_patient_update(text,text,timestamptz,jsonb) to authenticated;

create function "public"."pennsync_contract_patient_update"(
  p_agency text, p_patient_id text,
  p_expected_updated_date timestamptz, p_actions jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_patient_update(
    p_agency, p_patient_id, p_expected_updated_date, p_actions)
$contract$;

revoke all on function
  "public"."pennsync_contract_patient_update"(text,text,timestamptz,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_patient_update"(text,text,timestamptz,jsonb) to authenticated;

commit;
