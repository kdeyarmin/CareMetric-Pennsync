-- The clinical note history: the append and the read, in one contract family.
--
-- HAND WRITTEN, like every contract. What is NOT written by hand is the
-- refusal that makes the log a log: D32 gives `patient_note_history_entry` a
-- read and an insert policy and no update or delete policy at all, because its
-- own schema calls it "Immutable, server-authored clinical-note revision". A
-- correction here writes a NEW event, which is what the original does too.
--
-- **The three derived keys are byte-compatible with the Base44 originals, and
-- that is deliberate.** `logical_note_key` groups every revision of one note —
-- it is sha256 of `["agency","patient","visit"]` — and the read shows only the
-- latest member of each group. If a carried row's key and a newly appended
-- row's key disagreed for the same note, one note's history would split into
-- two and the older revision would surface beside the newer one as if both
-- were current. So the canonical JSON is reproduced rather than reinvented:
-- `to_json(text)` and `JSON.stringify` are proven to agree character for
-- character in the test, including for control characters and an emoji, and
-- the payload object is emitted in the same key order `canonicalJson` sorts
-- into. `compliance_score` renders through `double precision` for the same
-- reason JavaScript renders `93.50` as `93.5`.
--
-- **The membership stamped on an event is this store's, not Base44's.** The
-- original records the `AgencyMembership` row and version that authorized the
-- append. That entity is not the authority any more — `pennsync_private.membership`
-- is — so `caller_membership` reads the real one, and a ported event carries
-- provenance that can actually be checked rather than an id from a store we
-- are leaving.
--
-- DIVERGENCES from the originals, each a narrowing, each deliberate:
--
-- 1. `office_staff` cannot author a note. The original's own
--    `NOTE_AUTHOR_ROLES` already excludes it, and D24 gives it no chart
--    either, so the gate and the policies agree.
-- 2. A chart or a visit the caller cannot open is absent rather than
--    forbidden, like every read contract beside this one.
-- 3. The originals re-prove the whole authority bundle three times around the
--    write and compare snapshots. One transaction has no such window.
-- 4. The read's per-row integrity checks are kept only where a column type
--    cannot make the guarantee: that a row's `clinical_notes` still equals its
--    `note`, and that two events sharing an `event_key` carry the same
--    payload. The rest — that a date is a date, that a mode is one of two
--    words — the record store's own types and checks already hold.
begin;

do $$
begin
  if to_regclass('pennsync_records.patient_note_history_entry') is null
    or to_regprocedure('pennsync_records.caller_tenant_role(text)') is null then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_STORE_REQUIRED';
  end if;
end $$;

/*
 * The caller's membership in one agency, as this store records it.
 *
 * SECURITY DEFINER and owned by the migration administrator, like
 * `claim_new_chart`: `pennsync_private` is not readable by a tenant role, and
 * the record owner is the only thing allowed to ask.
 */
create function pennsync_private.caller_membership(p_agency text)
  returns table(membership_id text, membership_version integer)
  language sql stable security definer set search_path = '' as $membership$
  select m.id::text, m.version::integer
  from pennsync_records.caller_identity() i
  join pennsync_private.membership m
    on m.app_id = pennsync_private.deployment_app_id()
   and m.agency_id = p_agency and m.auth_user_id = i.auth_user_id
  where m.status = 'active' and m.revoked_at is null
$membership$;

revoke all on function pennsync_private.caller_membership(text)
  from public, anon, authenticated, service_role;
-- The same grant `claim_new_chart` makes, repeated because a migration must
-- apply on its own. NEVER pair it with a blanket revoke over this schema: every
-- `pennsync_staging_*` wrapper is an invoker calling an inner function granted
-- to `authenticated`, and stripping those takes nine suites down with them.
grant usage on schema pennsync_private to "pennsync_records_owner";
grant execute on function pennsync_private.caller_membership(text) to "pennsync_records_owner";

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

-- `JSON.stringify([a, b, …])`, exactly: no spaces, and each element escaped
-- the way `to_json` escapes a string — which the test proves is the way
-- `JSON.stringify` does.
create function "pennsync_records".note_key(p_parts text[]) returns text
  language sql immutable set search_path = '' as $key$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    '[' || (select pg_catalog.string_agg(pg_catalog.to_json(part)::text, ','
      order by ordinality) from pg_catalog.unnest(p_parts) with ordinality as u(part, ordinality))
    || ']', 'UTF8')), 'hex')
$key$;

-- The original's `canonicalPayload`, in the key order `canonicalJson` sorts
-- into: clinical_notes, compliance_score, mode, note, visit_date, visit_type.
--
-- `stable` rather than `immutable`: a date reaches text through `to_char`.
create function "pennsync_records".note_payload_fingerprint(
  p_mode text, p_visit_date date, p_visit_type text, p_note text,
  p_clinical_notes text, p_compliance double precision) returns text
  language sql stable set search_path = '' as $fingerprint$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    '{"clinical_notes":' || pg_catalog.to_json(p_clinical_notes)::text
    || ',"compliance_score":' || coalesce(p_compliance::text, 'null')
    || ',"mode":' || pg_catalog.to_json(p_mode)::text
    || ',"note":' || pg_catalog.to_json(p_note)::text
    || ',"visit_date":' || pg_catalog.to_json(
      pg_catalog.to_char(p_visit_date, 'YYYY-MM-DD'))::text
    || ',"visit_type":' || pg_catalog.to_json(p_visit_type)::text
    || '}', 'UTF8')), 'hex')
$fingerprint$;

-- The original's `narrowEvent`, for both capabilities. `entry_id` falls back
-- to the event key so a caller that supplied none still has a handle.
create function "pennsync_records".note_event(p "pennsync_records"."patient_note_history_entry")
  returns jsonb language sql stable set search_path = '' as $projection$
  select jsonb_build_object(
    'entry_id', coalesce(nullif(p."source_entry_id", ''), p."event_key"),
    'event_id', p."id",
    'event_key', p."event_key",
    'logical_note_key', p."logical_note_key",
    'visit_id', p."visit_id",
    'date', coalesce(pg_catalog.to_char(p."visit_date", 'YYYY-MM-DD'),
      pg_catalog.to_char(p."recorded_at" at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'visit_type', nullif(coalesce(p."visit_type", ''), ''),
    'note', p."note",
    'compliance_score', p."compliance_score",
    'created_by', p."actor_email_normalized",
    'created_at', p."recorded_at",
    'revision_at', p."visit_revision_at")
$projection$;

create function "pennsync_records".contract_note_history(
  p_agency text, p_patient_id text, p_event_limit integer, p_offset integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_role text; v_limit integer; v_offset integer; v_count integer;
  v_entries jsonb;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_NOTE_AGENCY_NOT_HELD';
  end if;
  -- The original's `NOTE_READER_ROLES`: everyone but `office_staff`, which
  -- D24 gives no chart to either.
  if v_role = 'office_staff' then
    raise exception using errcode='42501', message='PENNSYNC_NOTE_FORBIDDEN';
  end if;
  if p_patient_id is null or p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_NOTE_PATIENT_INVALID';
  end if;
  v_limit := coalesce(p_event_limit, 200);
  v_offset := coalesce(p_offset, 0);
  if v_limit < 1 or v_limit > 500 then
    raise exception using errcode='22023', message='PENNSYNC_NOTE_LIMIT_INVALID';
  end if;
  if v_offset < 0 or v_offset > 1000000 then
    raise exception using errcode='22023', message='PENNSYNC_NOTE_OFFSET_INVALID';
  end if;

  -- The page, newest first, under the policies: a chart the caller cannot
  -- open yields nothing, which is the same answer as a chart with no notes.
  create temporary table pennsync_note_page on commit drop as
  select e.* from "pennsync_records"."patient_note_history_entry" e
  where e."source_app_id" = "pennsync_records".deployment_app()
    and e."agency_id" = p_agency and e."patient_id" = p_patient_id
  order by e."created_date" desc nulls last, e."id" desc
  limit v_limit offset v_offset;
  select count(*) into v_count from pennsync_note_page;

  -- Two events sharing a key must carry the same payload. A column type
  -- cannot say that, and a store holding two contradictory versions of one
  -- event is not something to project a winner from.
  if exists (select 1 from pennsync_note_page a join pennsync_note_page b
    on a."event_key" = b."event_key" and a."id" < b."id"
    where a."note" is distinct from b."note"
      or a."mode" is distinct from b."mode"
      or a."visit_id" is distinct from b."visit_id"
      or a."visit_date" is distinct from b."visit_date"
      or a."visit_type" is distinct from b."visit_type"
      or a."clinical_notes" is distinct from b."clinical_notes"
      or a."compliance_score" is distinct from b."compliance_score"
      or a."payload_fingerprint" is distinct from b."payload_fingerprint"
      or a."actor_email_normalized" is distinct from b."actor_email_normalized") then
    raise exception using errcode='42501', message='PENNSYNC_NOTE_EVENT_AMBIGUOUS';
  end if;
  -- And an event whose two copies of the note disagree with each other.
  if exists (select 1 from pennsync_note_page e
    where e."clinical_notes" is distinct from e."note"
      or coalesce(pg_catalog.btrim(e."note"), '') = '') then
    raise exception using errcode='42501', message='PENNSYNC_NOTE_INTEGRITY';
  end if;

  -- One row per logical note — the latest revision — in the original's
  -- order. `Visit.updated_date` at authorization time is the logical revision
  -- order, because a physical append can finish after a newer writer's.
  select coalesce(jsonb_agg("pennsync_records".note_event(latest) order by
    latest."visit_revision_at", latest."recorded_at", latest."event_key", latest."id"),
    '[]'::jsonb)
  into v_entries
  from (
    select distinct on (e."logical_note_key") e.*
    from pennsync_note_page e
    order by e."logical_note_key", e."visit_revision_at" desc nulls last,
      e."recorded_at" desc nulls last, e."event_key" desc, e."id" desc) latest;

  return jsonb_build_object(
    'patient_id', p_patient_id,
    'entries', v_entries,
    'latest_clinical_notes', coalesce(v_entries->-1->>'note', ''),
    'page', jsonb_build_object(
      'event_count', v_count,
      'offset', v_offset,
      'next_offset', v_offset + v_count,
      'has_more', v_count = v_limit));
end $contract$;

create function "pennsync_records".contract_note_append(
  p_agency text, p_patient_id text, p_mode text, p_entry jsonb, p_clinical_notes text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_role text; v_user text; v_email text; v_field text;
  v_patient "pennsync_records"."patient"; v_visit "pennsync_records"."visit";
  v_existing "pennsync_records"."patient_note_history_entry";
  v_row "pennsync_records"."patient_note_history_entry";
  v_visit_id text; v_entry_id text; v_note text; v_clinical text;
  v_score double precision; v_visit_type text; v_visit_date date;
  v_logical text; v_fingerprint text; v_event text; v_scope text;
  v_membership_id text; v_membership_version integer; v_attempt integer;
  v_constraint text; v_written boolean := false; v_duplicates integer;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_NOTE_AGENCY_NOT_HELD';
  end if;
  -- The original's `NOTE_AUTHOR_ROLES`.
  if v_role = 'office_staff' then
    raise exception using errcode='42501', message='PENNSYNC_NOTE_FORBIDDEN';
  end if;
  if p_patient_id is null or p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_NOTE_PATIENT_INVALID';
  end if;
  if p_mode is null or p_mode not in ('append', 'update') then
    raise exception using errcode='22023', message='PENNSYNC_NOTE_MODE_INVALID';
  end if;
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_NOTE_ENTRY_INVALID';
  end if;
  for v_field in select jsonb_object_keys(p_entry) loop
    if v_field not in ('entry_id', 'visit_id', 'date', 'visit_type', 'note', 'compliance_score') then
      raise exception using errcode='22023', message='PENNSYNC_NOTE_FIELD_UNSUPPORTED';
    end if;
  end loop;

  v_visit_id := p_entry->>'visit_id';
  if v_visit_id is null or v_visit_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_NOTE_VISIT_INVALID';
  end if;
  v_entry_id := p_entry->>'entry_id';
  if (p_entry ? 'entry_id') and (v_entry_id is null or v_entry_id !~ '^[A-Za-z0-9_-]{1,200}$') then
    raise exception using errcode='22023', message='PENNSYNC_NOTE_ENTRY_ID_INVALID';
  end if;
  -- Key-present first, then type. `jsonb_typeof` of an ABSENT key is SQL null,
  -- and a null in a boolean condition is not false — it would fall through to
  -- the content check below and report the wrong thing.
  if not (p_entry ? 'note') or coalesce(jsonb_typeof(p_entry->'note'), '') <> 'string' then
    raise exception using errcode='22023', message='PENNSYNC_NOTE_TEXT_INVALID';
  end if;
  v_note := p_entry->>'note';
  if pg_catalog.btrim(v_note) = '' or pg_catalog.length(v_note) > 250000 then
    raise exception using errcode='22023', message='PENNSYNC_NOTE_TEXT_INVALID';
  end if;
  -- The original accepts `clinical_notes` only when it equals the note. The
  -- entity keeps both because the legacy `Patient.clinical_notes` column was
  -- written from the same text.
  v_clinical := coalesce(p_clinical_notes, v_note);
  if v_clinical is distinct from v_note then
    raise exception using errcode='22023', message='PENNSYNC_NOTE_CLINICAL_MISMATCH';
  end if;
  if p_entry ? 'compliance_score' then
    if coalesce(jsonb_typeof(p_entry->'compliance_score'), '') <> 'number' then
      raise exception using errcode='22023', message='PENNSYNC_NOTE_SCORE_INVALID';
    end if;
    v_score := (p_entry->>'compliance_score')::double precision;
    if v_score < 0 or v_score > 100 then
      raise exception using errcode='22023', message='PENNSYNC_NOTE_SCORE_INVALID';
    end if;
  end if;

  -- The chart, read under the policies. D24 decides it.
  select * into v_patient from "pennsync_records"."patient" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."id" = p_patient_id and p."agency_id" = p_agency;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_NOTE_PATIENT_NOT_VISIBLE';
  end if;
  -- The original's DOCUMENTABLE_PATIENT_STATUSES: a discharged chart still
  -- takes documentation about the visits it had.
  if coalesce(v_patient."status", '') not in ('active', 'hospitalized', 'discharged')
    or v_patient."is_archived" is not false or v_patient."is_sample" is not false then
    raise exception using errcode='42501', message='PENNSYNC_NOTE_PATIENT_UNAVAILABLE';
  end if;

  select * into v_visit from "pennsync_records"."visit" v
  where v."source_app_id" = "pennsync_records".deployment_app()
    and v."id" = v_visit_id and v."agency_id" = p_agency and v."patient_id" = p_patient_id;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_NOTE_VISIT_NOT_VISIBLE';
  end if;
  -- The original's DOCUMENTED_VISIT_STATUSES: a note belongs to a visit whose
  -- documentation has been written, not to one still being scheduled.
  if coalesce(v_visit."status", '') not in ('completed', 'pending_review') then
    raise exception using errcode='42501', message='PENNSYNC_NOTE_VISIT_UNAVAILABLE';
  end if;
  v_visit_date := v_visit."visit_date";
  v_visit_type := v_visit."visit_type";
  if v_visit_date is null or coalesce(pg_catalog.btrim(v_visit_type), '') = ''
    or pg_catalog.length(v_visit_type) > 100 or v_visit."updated_date" is null then
    raise exception using errcode='42501', message='PENNSYNC_NOTE_VISIT_INCOMPLETE';
  end if;
  -- A caller may restate the visit's own metadata and must restate it
  -- correctly; the stored Visit is the authority either way.
  if ((p_entry ? 'date')
      and p_entry->>'date' is distinct from pg_catalog.to_char(v_visit_date, 'YYYY-MM-DD'))
    or ((p_entry ? 'visit_type') and p_entry->>'visit_type' is distinct from v_visit_type) then
    raise exception using errcode='42501', message='PENNSYNC_NOTE_VISIT_METADATA_MISMATCH';
  end if;
  -- The note history mirrors the documentation on the Visit. A note that does
  -- not match what the Visit says would be a second, divergent record of the
  -- same encounter.
  if v_visit."nurse_notes" is distinct from v_note
    or (v_score is not null and v_visit."compliance_score" is distinct from v_score) then
    raise exception using errcode='42501', message='PENNSYNC_NOTE_CONTENT_MISMATCH';
  end if;

  v_user := "pennsync_records".caller_user_id();
  v_email := "pennsync_records".caller_email();
  select membership_id, membership_version into v_membership_id, v_membership_version
  from pennsync_private.caller_membership(p_agency);
  if v_user is null or v_email is null or v_membership_id is null then
    raise exception using errcode='42501', message='PENNSYNC_NOTE_AGENCY_NOT_HELD';
  end if;

  v_logical := "pennsync_records".note_key(array[p_agency, p_patient_id, v_visit_id]);
  v_fingerprint := "pennsync_records".note_payload_fingerprint(
    p_mode, v_visit_date, v_visit_type, v_note, v_clinical, v_score);
  v_scope := coalesce(nullif(v_entry_id, ''), v_fingerprint);
  v_event := "pennsync_records".note_key(array[p_agency, p_patient_id, v_visit_id, v_scope]);

  -- A replay answers the event it already wrote. Keyed the way the original
  -- keys it, so an event carried in from Base44 is recognised as the same one.
  select * into v_existing from "pennsync_records"."patient_note_history_entry" e
  where e."source_app_id" = "pennsync_records".deployment_app()
    and e."event_key" = v_event
  order by e."created_date", e."id"
  limit 1;
  if found then
    if v_existing."note" is distinct from v_note
      or v_existing."mode" is distinct from p_mode
      or v_existing."patient_id" is distinct from p_patient_id
      or v_existing."visit_id" is distinct from v_visit_id
      or v_existing."payload_fingerprint" is distinct from v_fingerprint then
      raise exception using errcode='22023', message='PENNSYNC_NOTE_EVENT_CONFLICT';
    end if;
    select count(*)::integer into v_duplicates
    from "pennsync_records"."patient_note_history_entry" e
    where e."source_app_id" = "pennsync_records".deployment_app() and e."event_key" = v_event;
    return jsonb_build_object('created', false, 'duplicate_count', v_duplicates,
      'event', "pennsync_records".note_event(v_existing));
  end if;

  v_row."source_app_id" := "pennsync_records".deployment_app();
  v_row."agency_id" := p_agency;
  v_row."patient_id" := p_patient_id;
  v_row."visit_id" := v_visit_id;
  v_row."logical_note_key" := v_logical;
  v_row."event_key" := v_event;
  v_row."payload_fingerprint" := v_fingerprint;
  v_row."source_entry_id" := nullif(v_entry_id, '');
  v_row."mode" := p_mode;
  v_row."visit_date" := v_visit_date;
  v_row."visit_type" := v_visit_type;
  v_row."visit_revision_at" := v_visit."updated_date";
  v_row."note" := v_note;
  v_row."clinical_notes" := v_clinical;
  v_row."compliance_score" := v_score;
  v_row."actor_user_id" := v_user;
  v_row."actor_email_normalized" := v_email;
  v_row."membership_id" := v_membership_id;
  v_row."membership_version" := v_membership_version;
  v_row."recorded_at" := clock_timestamp();
  v_row."created_date" := v_row."recorded_at";
  v_row."updated_date" := v_row."recorded_at";
  v_row."created_by" := v_email;

  -- Minted and retried against the primary key, for the reason
  -- `contract_visit_create` gives: a `select` for a free id runs under the
  -- policies and cannot see a row it is not entitled to.
  for v_attempt in 1..8 loop
    v_row."id" := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
    begin
      insert into "pennsync_records"."patient_note_history_entry" select (v_row).*;
      v_written := true;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'patient_note_history_entry_pkey' then raise; end if;
    end;
    exit when v_written;
  end loop;
  if not v_written then
    raise exception using errcode='53400', message='PENNSYNC_NOTE_IDENTITY_EXHAUSTED';
  end if;

  return jsonb_build_object('created', true, 'duplicate_count', 0,
    'event', "pennsync_records".note_event(v_row));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".note_key(text[]),
  "pennsync_records".note_payload_fingerprint(text,date,text,text,text,double precision),
  "pennsync_records".note_event("pennsync_records"."patient_note_history_entry"),
  "pennsync_records".contract_note_history(text,text,integer,integer),
  "pennsync_records".contract_note_append(text,text,text,jsonb,text)
  from public, anon, authenticated, service_role;

grant execute on function
  "pennsync_records".contract_note_history(text,text,integer,integer),
  "pennsync_records".contract_note_append(text,text,text,jsonb,text) to authenticated;

create function "public"."pennsync_contract_note_history"(
  p_agency text, p_patient_id text, p_event_limit integer, p_offset integer) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_note_history(p_agency, p_patient_id, p_event_limit, p_offset)
$contract$;

create function "public"."pennsync_contract_note_append"(
  p_agency text, p_patient_id text, p_mode text, p_entry jsonb, p_clinical_notes text)
  returns jsonb language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_note_append(
    p_agency, p_patient_id, p_mode, p_entry, p_clinical_notes)
$contract$;

revoke all on function
  "public"."pennsync_contract_note_history"(text,text,integer,integer),
  "public"."pennsync_contract_note_append"(text,text,text,jsonb,text)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_note_history"(text,text,integer,integer),
  "public"."pennsync_contract_note_append"(text,text,text,jsonb,text) to authenticated;

commit;
