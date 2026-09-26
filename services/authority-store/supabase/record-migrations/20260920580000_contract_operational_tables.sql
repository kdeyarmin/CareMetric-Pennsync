-- The operational tables the frontend reads and writes directly.
--
-- HAND WRITTEN, like every contract. What is new about this file is where its
-- capabilities come from: every contract before it ports a named Base44
-- FUNCTION, and these seven port nothing. Their callers are entity calls —
-- `AgencySettings.filter(...)`, `Task.create(...)` — made from the browser
-- against Base44's generic entity API, so the "original" is that API plus the
-- entity's own `rls` block, and the block is all the authorization there has
-- ever been. Seven entities, 46 call sites, and the reason each needs a named
-- capability rather than the generic family is D16's ceiling: two are refused
-- by name and the other five reach a chart.
--
-- WHAT EACH ENTITY'S `rls` BLOCK ACTUALLY SAYS, because that is the whole of
-- what is being ported and three of the seven say something surprising.
--
-- * `AgencySettings` — read `true`, every write `role === 'admin'`. D40's
--   standing rule applies: the successor to the built-in platform tier is an
--   `agency_admin` scoped to their own agency. That is the widening, and it is
--   the whole of the widening — the read was already open to any member and
--   stays that way.
-- * `PDFTemplate` — the same shape and the same answer.
--
--   Re-checked for a SHARED-ROW shape, because a template table is where one
--   hides and reading the Base44 block is necessary and not sufficient: a
--   narrowing failure can live entirely on the store side, as
--   `document_template`'s does, where the contract deliberately carries no
--   tenant predicate so a system template stays visible to every agency.
--   `pdf_template` has no such shape on either side. The entity schema
--   declares no `is_system`, `is_global`, `is_shared` or `is_default` field,
--   and `pdf_template_read` is plain agency tenancy with no flagged-row term.
--   So this contract naming its agency narrows nothing; it is the business
--   API's invariant that a request names its tenant. All seven were read this
--   way and none carries a shared row.
-- * `Task` — read and write both admit `created_by`, `data.assigned_to` or the
--   platform tier. Every one of those is a derived scope D41 deletes: the
--   table is agency-tenanted AND chart-narrowed by `task_read`, so the policy
--   already answers "which of these are mine" and answers it better than an
--   address comparison can. No gate here beyond membership.
--
--   Its fourth alternative is the one to read carefully, because it is a
--   FLAGGED row rather than a derived scope: `{data.is_sample: true}` makes a
--   sample task readable by everybody, whoever owns it. Nothing here can
--   reproduce that and nothing here is narrowing it — `task_read` is
--   agency-scoped in this store, so another agency's sample task is invisible
--   before this contract is reached. Recorded rather than worked around: it is
--   the store's decision, and a contract that tried to widen past a policy
--   would fail rather than succeed.
-- * `CarePlan` — `{read,create,update,delete: false}`. D32's note applies: in
--   Base44 that means "no client, only a service role", and in this store
--   every path is a service-role path. The `care_plan_*` policies carry the
--   chart narrowing through `patient_id`, so the contract adds no gate.
-- * `FaceToFaceEncounter` — read AND write are `role === 'admin'`, so today
--   nobody but the platform owner can record one, and the intake screen's F2F
--   section reaches no agency user at all. D40 again, and DELIBERATELY NOT
--   D68's wider intake roles: `manageAuthorizedReferral` admits
--   `agency_admin`, `manager` and `office_staff` to the intake queue, which is
--   wider than this, and matching it here would be a widening nobody decided.
--   Recorded rather than taken. Widening it later is a product call.
-- * `DocumentRecord` — read and write admit `created_by` or the platform tier.
--   This is D36's case and NOT D41's: `created_by` here is ownership of an
--   uploaded document rather than a reconstruction of tenancy, and the entity
--   is agency-tenanted beside it. So the contract keeps the ownership check
--   and widens only the platform half, per D40. The consequence is real and is
--   what the product does today: the two fax screens show a caller their OWN
--   uploads for that chart, and an `agency_admin` the agency's.
-- * `NoteConversion` — read admits `nurse_email`, `created_by` or the platform
--   tier; create admits `nurse_email` or the tier; update and delete are
--   `false`. Same split as the document: own rows for a member, the agency's
--   for an `agency_admin`. `nurse_email` is STAMPED on create rather than
--   taken, because a field that decides who may read a row is not a field its
--   writer may choose.
--
-- THE TWO THE CEILING REFUSES BY NAME, which is why they could not be
-- brokered and why their reads project columns rather than rows.
--
-- `AgencySettings` carries `last_credential_digest_sent_on`,
-- `credential_digest_claimed_by` and `credential_digest_claimed_at` — the
-- claim protocol the credential digest sweep runs on, the same shape D50
-- describes on `personnel_credential`. They are NOT projected and they are
-- refused BY NAME on a write (`PENNSYNC_SETTINGS_FIELD_RESERVED`) rather than
-- filtered out, because D39's rule is that a silent filter is what loses a
-- misspelled field without telling anyone. A caller that could write
-- `credential_digest_claimed_by` could take a sweep's claim and stop a
-- reminder going out; one that could read it learns nothing it needs.
--
-- `PDFTemplate` carries `template_file_url`, and `DocumentRecord` carries
-- `file_url` beside it. Both are locators, which is D16's fourth refusal and
-- D71's reason for not projecting `pdf_url` at all. Here they ARE projected,
-- through `pennsync_private.resolve_file_locator` (D77) and never raw: a
-- `cmfile:` handle passes through, a legacy Base44 URL resolves to null
-- because the copy has not run, and the input is never returned as itself. So
-- a screen gets an owned handle it can open or nothing, and never a Base44
-- URL it would then fetch. The raw column is still WRITTEN as the caller sends
-- it, because the runtime mints the handles and the write is where one
-- arrives.
--
-- WHAT IS DELETED. Every one of these call sites reconstructs a scope the
-- policies already answer, and the reconstruction goes:
-- `src/lib/agencySettings.js` looks its settings row up by `agency_code` and
-- then by `office_name`; the fax screens scope documents by `patient_id`; the
-- reports read every conversion and filter by `nurse_email` in the browser.
-- The lookups stay as PREDICATES because a screen that asked for one row by
-- code should get that row, but none of them is the tenancy any more — the
-- agency comes from the envelope and the policies enforce it, so a caller who
-- names another agency's `agency_code` gets nothing rather than that agency's
-- configuration.
--
-- Ordering is `created_date desc, id desc` throughout (D25: the id is the
-- tiebreaker, and without one a test that asserts a position is asserting a
-- coin flip). `task` and `care_plan` take an order parameter because their
-- call sites ask for `-due_date` and `-updated_date`; nothing else does.
--
-- Every write validates its keys against a CLOSED list and refuses an unknown
-- one (D39), builds its `set` list from the keys the caller supplied rather
-- than from a column list this file would have to keep in step (D29), and
-- merges through `jsonb_populate_record` so a value the column cannot hold
-- raises rather than truncating.
--
-- Refusals, per contract:
--   PENNSYNC_SETTINGS_AGENCY_NOT_HELD, _FORBIDDEN, _NOT_FOUND, _ID_INVALID,
--     _LIMIT_INVALID, _FIELDS_INVALID, _FIELDS_EMPTY, _FIELD_UNKNOWN,
--     _FIELD_RESERVED, _FIELD_INVALID
--   PENNSYNC_TASK_AGENCY_NOT_HELD, _ORDER_INVALID, _LIMIT_INVALID,
--     _FIELDS_INVALID, _FIELDS_EMPTY, _FIELD_UNKNOWN, _FIELD_RESERVED,
--     _FIELD_INVALID, _TITLE_REQUIRED, _CHART_FORBIDDEN
--   PENNSYNC_TEMPLATE_AGENCY_NOT_HELD, _FORBIDDEN, _NOT_FOUND, _ID_INVALID,
--     _LIMIT_INVALID, _FIELDS_INVALID, _FIELDS_EMPTY, _FIELD_UNKNOWN,
--     _FIELD_RESERVED, _FIELD_INVALID, _NAME_REQUIRED, _CATEGORY_REQUIRED,
--     _FILE_REQUIRED
--   PENNSYNC_CARE_PLAN_AGENCY_NOT_HELD, _NOT_FOUND, _ID_INVALID, _ORDER_INVALID,
--     _LIMIT_INVALID, _FIELDS_INVALID, _FIELDS_EMPTY, _FIELD_UNKNOWN,
--     _FIELD_RESERVED, _FIELD_INVALID, _PATIENT_REQUIRED, _PROBLEM_REQUIRED,
--     _GOAL_REQUIRED, _CHART_FORBIDDEN
--   PENNSYNC_F2F_AGENCY_NOT_HELD, _FORBIDDEN, _NOT_FOUND, _ID_INVALID,
--     _LIMIT_INVALID, _FIELDS_INVALID, _FIELDS_EMPTY, _FIELD_UNKNOWN,
--     _FIELD_RESERVED, _FIELD_INVALID, _CHART_FORBIDDEN
--   PENNSYNC_DOCUMENT_RECORD_AGENCY_NOT_HELD, _LIMIT_INVALID
--   PENNSYNC_NOTE_CONVERSION_AGENCY_NOT_HELD, _LIMIT_INVALID, _FIELDS_INVALID,
--     _FIELDS_EMPTY, _FIELD_UNKNOWN, _FIELD_RESERVED, _FIELD_INVALID,
--     _CHART_FORBIDDEN
begin;

do $$
begin
  if to_regprocedure('pennsync_records.caller_tenant_role(text)') is null
    or to_regprocedure('pennsync_records.caller_email()') is null
    or to_regprocedure('pennsync_private.resolve_file_locator(text)') is null then
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

-- The key check every write in this file makes, in one place.
--
-- It takes the refusal PREFIX rather than carrying a vocabulary of its own,
-- because each contract declares its own codes and a shared code is a code one
-- contract cannot raise crossing back from another. What is shared is the
-- ORDER of the three questions, which is the part worth having once: a
-- reserved key is named as reserved rather than as unknown, so a caller trying
-- to write a field the contract decides is told that, and an unknown key is
-- refused rather than dropped (D39).
create function "pennsync_records".operational_check_fields(
    p_fields jsonb, p_allowed text[], p_reserved text[], p_prefix text)
  returns void language plpgsql immutable set search_path = '' as $fields$
declare v_key text;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception using errcode='22023', message=p_prefix || '_FIELDS_INVALID';
  end if;
  if p_fields = '{}'::jsonb then
    raise exception using errcode='22023', message=p_prefix || '_FIELDS_EMPTY';
  end if;
  for v_key in select k from jsonb_object_keys(p_fields) k loop
    if v_key = any (p_reserved) then
      raise exception using errcode='22023', message=p_prefix || '_FIELD_RESERVED';
    end if;
    if not (v_key = any (p_allowed)) then
      raise exception using errcode='22023', message=p_prefix || '_FIELD_UNKNOWN';
    end if;
  end loop;
end $fields$;

-- The values the Base44 schema gives a field when a create omits it.
--
-- The record store is GENERATED and emits NO column default anywhere, so a
-- create through a contract writes null where the original wrote `true`, `0`
-- or `pending`. That is the same generator decision as the nullable columns
-- above, with a quieter consequence: nothing refuses, and the row is simply
-- different from the one Base44 would have made. A template created here
-- without `is_active` would be invisible to every screen that filters on it.
--
-- These objects are TRANSCRIBED from the entity schemas, which is the one
-- thing D12 settled against, so `contract-operational-tables.test.mjs` reads
-- each entity's `.jsonc` and fails unless the object here is exactly the
-- defaults of that contract's own writable set. Add a field to a writable set
-- and the check tells you whether it owes a default.
--
-- They apply on CREATE only, and the caller's value always wins: an absent key
-- takes the default, a key the caller sent keeps what they sent, including
-- null. On an UPDATE an absent key means unchanged, which is not the same
-- question.
--
-- Nothing declared is deliberately left out, so there is no omission here to
-- explain: each object is EVERY default of that contract's own writable set,
-- and the test is what says so. Where a later change decides not to stamp one,
-- the reason belongs beside it — a default the generator should not emit and a
-- default somebody forgot look identical in the SQL, and whoever takes the
-- generator needs the difference.
create function "pennsync_records".settings_defaults() returns jsonb
  language sql immutable set search_path = '' as $defaults$
  select '{"oasis_response_schema_v2_enabled":false,"oasis_response_writes_disable'
    'd":false,"wage_index":1,"avg_staff_hourly_rate":45,"training_cost_per_ho'
    'ur":35,"documentation_time_per_episode":0.5,"audit_staff_hourly_rate":50'
    ',"avg_episodes_per_year":50,"pennsync_is_system_of_record":false,"is_ent'
    'erprise":false,"ai_learning_enabled":true,"agency_wide_learning":false,"'
    'ai_model_preference":"balanced","min_confidence_threshold":70,"share_lea'
    'rnings_across_providers":true,"auto_apply_best_practices":false,"custom_'
    'templates_count":0,"tcpa_quiet_hours_enabled":true,"tcpa_quiet_start_hou'
    'r":8,"tcpa_quiet_end_hour":21,"fax_receiving_enabled":false,"sms_messagi'
    'ng_enabled":true,"voicemail_enabled":false,"allow_international":false,"'
    'business_hours_enabled":false,"business_hours_timezone":"America/New_Yor'
    'k","after_hours_call_action":"transfer","after_hours_sms_auto_reply_enab'
    'led":true,"a2p_10dlc_status":"not_registered"}'::jsonb
$defaults$;

create function "pennsync_records".task_defaults() returns jsonb
  language sql immutable set search_path = '' as $defaults$
  select '{"priority":"medium","status":"pending","source":"manual","is_recurring"'
    ':false,"recurrence_interval":1,"is_sample":false}'::jsonb
$defaults$;

create function "pennsync_records".template_defaults() returns jsonb
  language sql immutable set search_path = '' as $defaults$
  select '{"version":"1.0","is_active":true,"is_packet":false,"document_count":1,"'
    'usage_count":0}'::jsonb
$defaults$;

create function "pennsync_records".care_plan_defaults() returns jsonb
  language sql immutable set search_path = '' as $defaults$
  select '{"status":"active"}'::jsonb
$defaults$;

create function "pennsync_records".f2f_defaults() returns jsonb
  language sql immutable set search_path = '' as $defaults$
  select '{"validation_status":"needs_review"}'::jsonb
$defaults$;

create function "pennsync_records".note_conversion_defaults() returns jsonb
  language sql immutable set search_path = '' as $defaults$
  select '{}'::jsonb
$defaults$;

-- Three things this file does that are NOT about these seven entities, each
-- being a shape any contract over a generated table can have.
--
-- A THREE-VALUED GUARD IS NOT A GUARD. Every enum-ish parameter here is
-- checked as `p_x is null or p_x not in (...)`, with the null leg first,
-- because `p_x in (...)` is NULL rather than false when the caller omits the
-- key and `if NULL then raise` never fires — after which every later equality
-- against NULL falls through and the request lands on whichever branch is
-- last. An omitted key is a refusal here, not a default.
--
-- A CHECK VIOLATION IS A REFUSAL, NOT AN OUTAGE. The generated tables carry
-- the schemas' enum constraints, so a caller's typo raises `23514` from the
-- INSERT or the UPDATE rather than from anything this file evaluates. Every
-- write statement is wrapped and re-raises it as that contract's declared
-- `_FIELD_INVALID`; without the wrapper the HTTP boundary sees an undeclared
-- code and reports a 503, so a typo reads as the record store being down.
--
-- `created_by` IS NOT THE ONLY COLUMN THAT NAMES A PERSON. Two others are
-- writable here — `task.assigned_to` and `agency_settings.agency_manager_email`
-- — and both stay writable because both are the row's CONTENT rather than a
-- claim about the caller: nothing in this store reads either for
-- authorization, which the test suite asserts rather than assumes, so setting
-- one grants the person named nothing. The moment a policy or a contract asks
-- one of them that stops being true and it belongs in the reserved set.

-- The chart a write names, checked against the agency the request named.
--
-- Four of these entities carry a writable `patient_id`, and the obvious check
-- — D24's `caller_opens_every_chart(p_agency) or patient_id in
-- caller_assigned_patients(p_agency)` — HAS A HOLE, which the policies share
-- because they ask the same two questions. Both are about the caller's reach
-- WITHIN an agency; neither asks which agency the chart is in. So for an
-- `agency_admin`, who opens every chart, the first disjunct is true whatever
-- `patient_id` holds, and a caller who is an administrator of two agencies
-- (which nothing forbids) can file a task in agency A naming agency B's
-- chart. The row lands in A, tenanted to A, referencing a patient nobody in A
-- can see — invisible to its assignee, and a chart reference across a tenant
-- boundary.
--
-- It is not reachable from the shared fixtures, where every identity holds one
-- membership and the caller is refused before any of this. That is the point:
-- the check that finds it is the one driven by a caller who holds both.
--
-- So the chart's OWN agency is checked first and the care-team narrowing
-- second, and both refuse with the same name, because "that is not your
-- chart" is one answer and distinguishing its two halves would say which
-- charts exist elsewhere.
--
-- THE SHAPE OF THAT FIRST CHECK IS LOAD-BEARING and the obvious one is a
-- no-op. This runs in a SECURITY DEFINER under FORCE row-level security with
-- the caller's own claims, and the record owner holds no BYPASSRLS, so a
-- chart in another agency is INVISIBLE here — to exactly the caller who needs
-- protecting from it. Written as `not exists (a row proving this chart is
-- elsewhere)`, invisible reads as absent, absent reads as fine, and the guard
-- refuses the caller who holds both agencies while letting through the one
-- who holds one. Backwards, and green under any fixture built from a
-- dual-agency caller. It is written the other way, as a POSITIVE requirement
-- that the chart be provably IN `p_agency`, so an invisible row fails it for
-- the same reason an absent one does. `contract-operational-tables.test.mjs`
-- asserts that with a SINGLE-agency caller and fails if the predicate is
-- turned around, because the two shapes are indistinguishable under a caller
-- holding both. Measured rather than reasoned: the negative shape was written,
-- run, and seen to pass every other test in the file.
--
-- IT IS CALLED ON WRITES ONLY — the four paths with a writable `patient_id`
-- — and that placement is a decision rather than an omission, because the
-- guard RESOLVES the patient row under the caller's own policies and so
-- inherits `patient_read`, which D24 narrows to the care team. A read filtered
-- through it would therefore hide two kinds of row the caller is entitled to:
-- one naming a chart this store does not hold, which would vanish for
-- EVERYONE (D61's failure mode), and one naming a chart in the caller's own
-- agency that the caller is not assigned to, which would vanish for its own
-- author. Both are silent — fewer rows, not an error. Measured elsewhere in
-- the migration, on a read contract, and the remedy there is a helper that
-- answers "which agency is this chart in" for ANY chart from a definer rather
-- than "may this caller see this chart". The reads here bind the ROW's own
-- `agency_id` and ask the guard nothing.
--
-- On a write the same inheritance is visible and is kept, with one case worth
-- naming because it refuses something the insert policy would admit: an
-- `agency_admin` creating a row that names a chart this store does not hold.
-- `caller_opens_every_chart` is true for them, so the policy passes it, and the
-- guard refuses because an uncarried chart is invisible. That is a NARROWING
-- and it is deliberate — the row it would create is one nobody can ever read,
-- tenanted here and pointing outside — and it is a create, so the caller is
-- told rather than shown a shorter list.
--
-- THE CARE-TEAM HALF BELOW IS NOT EXERCISED BY ANYTHING IN THIS REPOSITORY,
-- and that is measured rather than suspected: delete the second `if` outright
-- and all 29 tests in `contract-operational-tables.test.mjs` still pass. It is
-- not a narrowing either — `task_insert` and its siblings already carry D24 —
-- and the reason no test can tell it apart is upstream of the check: a
-- clinician handed a chart they are not assigned to is refused by the FIRST
-- `if`, because `patient_read` makes that row invisible to them, so control
-- never reaches the second. It is kept because the first `if`'s refusal is an
-- accident of which policy resolves the row rather than a statement about the
-- care team, and a later widening of `patient_read` would leave the rule
-- unstated. Do not read its presence as coverage: it is a claim this file
-- makes, not one this file proves.
--
-- WHAT IT DOES NOT DO: it stops a crossed row being CREATED and does not hide
-- one that already exists. A row carried from Base44 tenanted to agency A and
-- naming agency B's chart is still readable by an A caller, because every read
-- here binds the ROW's `agency_id` and the reads cannot resolve the chart for
-- the same invisibility reason. Closing that needs a helper in
-- `pennsync_private` granted to the record owner, the way
-- `caller_assigned_patients` is, and it is the store's authorization surface
-- rather than this file's.
create function "pennsync_records".operational_chart(
    p_agency text, p_patient_id text, p_prefix text)
  returns void language plpgsql stable set search_path = '' as $chart$
begin
  if p_patient_id is null then return; end if;
  if not exists (select 1 from "pennsync_records"."patient" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."id" = p_patient_id and p."agency_id" = p_agency)
  then
    raise exception using errcode='42501', message=p_prefix || '_CHART_FORBIDDEN';
  end if;
  -- Unreachable today: the check above already refuses every caller who
  -- cannot see the row. Stated here anyway — see the header.
  if not "pennsync_records".caller_opens_every_chart(p_agency)
    and p_patient_id not in (
      select "pennsync_records".caller_assigned_patients(p_agency))
  then
    raise exception using errcode='42501', message=p_prefix || '_CHART_FORBIDDEN';
  end if;
end $chart$;

-- The fields an entity's own schema declares REQUIRED, refused by name.
--
-- This is not a rule any of the seven `rls` blocks states, and it is not
-- belt-and-braces over the table either. The record store is GENERATED, and
-- the generator emits every entity column NULLABLE, so an insert missing a
-- field the Base44 schema required succeeds here and the row is junk. That is
-- the store being MORE permissive than the original, which is a narrowing
-- failure in the other direction and shows up nowhere: no policy refuses it,
-- no check constraint catches it, and no refusal suite sees it unless it is
-- looking. So each write contract names its own required set, and its suite
-- proves the refusal by sending a payload without it.
--
-- Two properties are deliberate. A field the schema gives a DEFAULT is not
-- required of the caller — `Task.priority` defaults to `medium` in Base44, so
-- requiring it here would refuse a create the original accepted — and the
-- contract supplies the default instead. And on an UPDATE a required field is
-- checked only when the caller SENDS it: the row already has one, so demanding
-- it again would make every partial patch impossible, while allowing an empty
-- string through would empty it.
--
-- `p_codes` is parallel to `p_required` rather than derived from it, because a
-- code a contract declares is the contract's own and `template_name` would
-- otherwise raise `PENNSYNC_TEMPLATE_TEMPLATE_NAME_REQUIRED`.
create function "pennsync_records".operational_check_required(
    p_fields jsonb, p_required text[], p_codes text[], p_prefix text,
    p_creating boolean)
  returns void language plpgsql immutable set search_path = '' as $required$
declare v_i integer;
begin
  for v_i in 1 .. coalesce(pg_catalog.array_length(p_required, 1), 0) loop
    if p_creating or p_fields ? p_required[v_i] then
      if coalesce(p_fields->>p_required[v_i], '') = '' then
        raise exception using errcode='22023',
          message = p_prefix || '_' || p_codes[v_i] || '_REQUIRED';
      end if;
    end if;
  end loop;
end $required$;

-- A page size, clamped rather than refused above the ceiling.
--
-- The ceiling is 5,000 because `ALL_ROWS` in `src/lib/queryLimits.js` is
-- 5,000 and it is what the screens asking for everything pass. A caller naming
-- a larger bound is naming one it does not expect to reach, which is the
-- reading `independentEntityRoutes.js` settled on; what is NOT allowed is a
-- bound that is not a number, because that is a caller meaning something this
-- cannot serve.
create function "pennsync_records".operational_limit(p_limit integer, p_prefix text)
  returns integer language plpgsql immutable set search_path = '' as $limit$
begin
  if p_limit is null then return 50; end if;
  if p_limit < 1 then
    raise exception using errcode='22023', message=p_prefix || '_LIMIT_INVALID';
  end if;
  return pg_catalog.least(p_limit, 5000);
end $limit$;

-- An owned handle or nothing, never the locator as it was stored (D77).
create function "pennsync_records".operational_locator(p_locator text)
  returns text language sql stable set search_path = '' as $locator$
  select case when p_locator is null or p_locator = '' then null
    else pennsync_private.resolve_file_locator(p_locator) end
$locator$;

create function "pennsync_records".operational_new_id()
  returns text language sql volatile set search_path = '' as $id$
  select pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24)
$id$;

-- ---------------------------------------------------------------------------
-- AgencySettings
-- ---------------------------------------------------------------------------

-- The 53 columns a caller may write, which is every column of the entity but
-- the three the credential digest sweep claims and the five the store owns.
create function "pennsync_records".settings_writable() returns text[]
  language sql immutable set search_path = '' as $writable$
  select array[
    'office_zip_code', 'oasis_response_schema_v2_enabled',
    'oasis_response_writes_disabled', 'wage_index', 'office_name',
    'office_address', 'avg_staff_hourly_rate', 'training_cost_per_hour',
    'documentation_time_per_episode', 'audit_staff_hourly_rate',
    'avg_episodes_per_year', 'pennsync_is_system_of_record', 'is_enterprise',
    'agency_code', 'agency_manager_email', 'ai_learning_enabled',
    'agency_wide_learning', 'custom_compliance_rules',
    'custom_documentation_style', 'ai_model_preference',
    'min_confidence_threshold', 'share_learnings_across_providers',
    'agency_specific_prompts', 'auto_apply_best_practices',
    'custom_terminology', 'custom_templates_count', 'tcpa_quiet_hours_enabled',
    'tcpa_quiet_start_hour', 'tcpa_quiet_end_hour', 'fax_receiving_enabled',
    'main_office_number_e164', 'office_fax_number_e164',
    'outbound_fax_number_e164', 'default_off_duty_template',
    'sms_messaging_enabled', 'sms_quick_replies', 'sms_templates',
    'voicemail_enabled', 'voicemail_greeting', 'allow_international',
    'monthly_sms_cap', 'business_hours_enabled', 'business_hours_timezone',
    'business_hours', 'business_hours_holidays', 'after_hours_call_action',
    'after_hours_transfer_number_e164', 'after_hours_call_greeting',
    'after_hours_sms_auto_reply_enabled', 'after_hours_sms_auto_reply',
    'a2p_10dlc_status', 'a2p_brand_id', 'a2p_campaign_id']
$writable$;

-- The sweep's claim protocol. Refused by name on every write and projected by
-- no read.
create function "pennsync_records".settings_reserved() returns text[]
  language sql immutable set search_path = '' as $reserved$
  select array['last_credential_digest_sent_on', 'credential_digest_claimed_by',
    'credential_digest_claimed_at', 'id', 'agency_id', 'created_by',
    'created_date', 'updated_date']
$reserved$;

create function "pennsync_records".settings_projected(p_row "pennsync_records"."agency_settings")
  returns jsonb language sql stable set search_path = '' as $projected$
  select jsonb_build_object(
    'id', p_row."id",
    'agency_id', p_row."agency_id",
    'created_date', p_row."created_date",
    'updated_date', p_row."updated_date",
    'created_by', p_row."created_by")
    || (pg_catalog.to_jsonb(p_row) - "pennsync_records".settings_reserved()
        - 'source_app_id')
$projected$;

create function "pennsync_records".contract_agency_settings_read(
    p_agency text, p_agency_code text, p_office_name text, p_limit integer)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_rows jsonb; v_limit integer;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_SETTINGS_AGENCY_NOT_HELD';
  end if;
  v_limit := "pennsync_records".operational_limit(p_limit, 'PENNSYNC_SETTINGS');

  select coalesce(jsonb_agg("pennsync_records".settings_projected(page) order by
      page."created_date" desc nulls last, page."id" desc), '[]'::jsonb)
  into v_rows
  from (
    select s.* from "pennsync_records"."agency_settings" s
    where s."agency_id" = p_agency
      -- The lookups `src/lib/agencySettings.js` makes, as predicates and not
      -- as the tenancy they used to be: the agency comes from the envelope, so
      -- naming another agency's code finds nothing rather than its settings.
      and (p_agency_code is null or s."agency_code" = p_agency_code)
      and (p_office_name is null or s."office_name" = p_office_name)
    order by s."created_date" desc nulls last, s."id" desc
    limit v_limit
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

create function "pennsync_records".contract_agency_settings_save(
    p_agency text, p_id text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_existing "pennsync_records"."agency_settings";
  v_row "pennsync_records"."agency_settings";
  v_assignments text; v_written integer; v_now timestamptz;
begin
  -- D40. The original's only gate is the built-in `role === 'admin'`.
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_SETTINGS_AGENCY_NOT_HELD';
  end if;
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_SETTINGS_FORBIDDEN';
  end if;
  perform "pennsync_records".operational_check_fields(p_fields,
    "pennsync_records".settings_writable(), "pennsync_records".settings_reserved(),
    'PENNSYNC_SETTINGS');
  v_now := clock_timestamp();

  if p_id is null then
    v_row := null;
    begin
      -- The schema's own defaults first, the caller's payload over them.
      v_row := jsonb_populate_record(v_row,
        "pennsync_records".settings_defaults() || p_fields);
    exception when others then
      raise exception using errcode='22023', message='PENNSYNC_SETTINGS_FIELD_INVALID';
    end;
    v_row."source_app_id" := "pennsync_records".deployment_app();
    v_row."id" := "pennsync_records".operational_new_id();
    v_row."agency_id" := p_agency;
    v_row."created_by" := "pennsync_records".caller_email();
    v_row."created_date" := v_now;
    v_row."updated_date" := v_now;
    begin
      insert into "pennsync_records"."agency_settings" select (v_row).* returning * into v_row;
    exception when check_violation then
      raise exception using errcode='22023', message='PENNSYNC_SETTINGS_FIELD_INVALID';
    end;
    return jsonb_build_object('created', true,
      'settings', "pennsync_records".settings_projected(v_row));
  end if;

  if p_id = '' then
    raise exception using errcode='22023', message='PENNSYNC_SETTINGS_ID_INVALID';
  end if;
  select * into v_existing from "pennsync_records"."agency_settings" s
  where s."source_app_id" = "pennsync_records".deployment_app()
    and s."id" = p_id and s."agency_id" = p_agency
  for update;
  if not found then
    raise exception using errcode='22023', message='PENNSYNC_SETTINGS_NOT_FOUND';
  end if;
  begin
    v_row := jsonb_populate_record(v_existing, p_fields);
  exception when others then
    raise exception using errcode='22023', message='PENNSYNC_SETTINGS_FIELD_INVALID';
  end;
  v_row."updated_date" := v_now;
  -- D29's rule: the set list is the keys that arrived, never a column list
  -- kept here, so a field added to the writable set cannot validate and then
  -- silently not be written. Every key has already been proved against the
  -- closed list above, and `%I` quotes it besides.
  v_assignments := (select pg_catalog.string_agg(
    pg_catalog.format('%I = ($1).%I', k, k), ', ' order by k)
    from jsonb_object_keys(p_fields) k);
  begin
    execute pg_catalog.format(
      'update "pennsync_records"."agency_settings" as t set %s,'
      || ' "updated_date" = ($1)."updated_date"'
      || ' where t."source_app_id" = $2 and t."id" = $3 and t."agency_id" = $4',
      v_assignments)
      using v_row, "pennsync_records".deployment_app(), p_id, p_agency;
  get diagnostics v_written = row_count;
  exception when check_violation then
    raise exception using errcode='22023', message='PENNSYNC_SETTINGS_FIELD_INVALID';
  end;
  if v_written <> 1 then
    raise exception using errcode='22023', message='PENNSYNC_SETTINGS_NOT_FOUND';
  end if;
  select * into v_row from "pennsync_records"."agency_settings" s
  where s."source_app_id" = "pennsync_records".deployment_app() and s."id" = p_id;
  return jsonb_build_object('created', false,
    'settings', "pennsync_records".settings_projected(v_row));
end $contract$;

-- ---------------------------------------------------------------------------
-- Task
-- ---------------------------------------------------------------------------

create function "pennsync_records".task_writable() returns text[]
  language sql immutable set search_path = '' as $writable$
  select array['client_request_id', 'patient_id', 'title', 'description', 'type',
    'priority', 'status', 'due_date', 'due_time', 'due_timeframe', 'assigned_to',
    'source', 'ai_reason', 'related_visit_id', 'related_entity',
    'related_entity_id', 'completion_notes', 'is_recurring', 'recurrence_type',
    'recurrence_interval', 'recurrence_days', 'recurrence_end_date',
    'parent_task_id', 'notification_preferences', 'is_sample']
$writable$;

-- `last_notification_sent` is the reminder sweep's marker, the same shape as
-- the settings digest claim: a caller that could set it could stop a task's
-- reminder going out.
create function "pennsync_records".task_reserved() returns text[]
  language sql immutable set search_path = '' as $reserved$
  select array['last_notification_sent', 'id', 'agency_id', 'created_by',
    'created_date', 'updated_date']
$reserved$;

create function "pennsync_records".task_projected(p_row "pennsync_records"."task")
  returns jsonb language sql stable set search_path = '' as $projected$
  select pg_catalog.to_jsonb(p_row) - 'source_app_id'
$projected$;

create function "pennsync_records".contract_task_list(
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
    order by
      case when p_order = 'due_date' then t."due_date" end desc nulls last,
      case when p_order = 'created_date' then t."created_date" end desc nulls last,
      t."id" desc
    limit v_limit
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

create function "pennsync_records".contract_task_create(p_agency text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_row "pennsync_records"."task"; v_now timestamptz;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_TASK_AGENCY_NOT_HELD';
  end if;
  perform "pennsync_records".operational_check_fields(p_fields,
    "pennsync_records".task_writable(), "pennsync_records".task_reserved(),
    'PENNSYNC_TASK');
  perform "pennsync_records".operational_check_required(p_fields,
    array['title'], array['TITLE'], 'PENNSYNC_TASK', true);
  v_now := clock_timestamp();
  begin
    -- The schema's own defaults first, the caller's payload over them.
    v_row := jsonb_populate_record(v_row,
      "pennsync_records".task_defaults() || p_fields);
  exception when others then
    raise exception using errcode='22023', message='PENNSYNC_TASK_FIELD_INVALID';
  end;
  v_row."source_app_id" := "pennsync_records".deployment_app();
  v_row."id" := "pennsync_records".operational_new_id();
  v_row."agency_id" := p_agency;
  v_row."created_by" := "pennsync_records".caller_email();
  v_row."created_date" := v_now;
  v_row."updated_date" := v_now;
  -- A task naming a chart the caller does not open is refused HERE rather
  -- than by the insert policy, because the policy's refusal is a bare
  -- row-level-security error the HTTP boundary cannot classify (D33's rule
  -- about catching by name, arriving from the other side) — and because the
  -- policy shares the hole `operational_chart` closes.
  perform "pennsync_records".operational_chart(p_agency, v_row."patient_id",
    'PENNSYNC_TASK');
  begin
    insert into "pennsync_records"."task" select (v_row).* returning * into v_row;
  exception when check_violation then
    raise exception using errcode='22023', message='PENNSYNC_TASK_FIELD_INVALID';
  end;
  return jsonb_build_object('created', true,
    'task', "pennsync_records".task_projected(v_row));
end $contract$;

-- ---------------------------------------------------------------------------
-- PDFTemplate
-- ---------------------------------------------------------------------------

create function "pennsync_records".template_writable() returns text[]
  language sql immutable set search_path = '' as $writable$
  select array['template_name', 'template_category', 'description',
    'template_file_url', 'version', 'is_active', 'field_mappings',
    'signature_fields', 'visual_elements', 'is_packet', 'document_count',
    'carry_forward_fields', 'packet_documents', 'parent_template_id',
    'change_notes', 'usage_count']
$writable$;

create function "pennsync_records".template_reserved() returns text[]
  language sql immutable set search_path = '' as $reserved$
  select array['id', 'agency_id', 'created_by', 'created_date', 'updated_date']
$reserved$;

-- `template_file_url` goes out RESOLVED and never raw (D77): an owned
-- `cmfile:` handle passes through, a legacy Base44 URL becomes null because
-- the file copy has not run, and the caller never receives a locator into
-- somebody else's storage to fetch.
create function "pennsync_records".template_projected(p_row "pennsync_records"."pdf_template")
  returns jsonb language sql stable set search_path = '' as $projected$
  select (pg_catalog.to_jsonb(p_row) - 'source_app_id') || jsonb_build_object(
    'template_file_url', "pennsync_records".operational_locator(p_row."template_file_url"))
$projected$;

create function "pennsync_records".contract_pdf_template_list(
    p_agency text, p_parent_template_id text, p_limit integer)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_rows jsonb; v_limit integer;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_TEMPLATE_AGENCY_NOT_HELD';
  end if;
  v_limit := "pennsync_records".operational_limit(p_limit, 'PENNSYNC_TEMPLATE');
  select coalesce(jsonb_agg("pennsync_records".template_projected(page) order by
      page."created_date" desc nulls last, page."id" desc), '[]'::jsonb)
  into v_rows
  from (
    select t.* from "pennsync_records"."pdf_template" t
    where t."agency_id" = p_agency
      and (p_parent_template_id is null or t."parent_template_id" = p_parent_template_id)
    order by t."created_date" desc nulls last, t."id" desc
    limit v_limit
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

create function "pennsync_records".contract_pdf_template_save(
    p_agency text, p_id text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_existing "pennsync_records"."pdf_template"; v_row "pennsync_records"."pdf_template";
  v_assignments text; v_written integer; v_now timestamptz;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_TEMPLATE_AGENCY_NOT_HELD';
  end if;
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_TEMPLATE_FORBIDDEN';
  end if;
  perform "pennsync_records".operational_check_fields(p_fields,
    "pennsync_records".template_writable(), "pennsync_records".template_reserved(),
    'PENNSYNC_TEMPLATE');
  perform "pennsync_records".operational_check_required(p_fields,
    array['template_name', 'template_category', 'template_file_url'],
    array['NAME', 'CATEGORY', 'FILE'], 'PENNSYNC_TEMPLATE', p_id is null);
  v_now := clock_timestamp();

  if p_id is null then
    begin
      -- The schema's own defaults first, the caller's payload over them.
      v_row := jsonb_populate_record(v_row,
        "pennsync_records".template_defaults() || p_fields);
    exception when others then
      raise exception using errcode='22023', message='PENNSYNC_TEMPLATE_FIELD_INVALID';
    end;
    v_row."source_app_id" := "pennsync_records".deployment_app();
    v_row."id" := "pennsync_records".operational_new_id();
    v_row."agency_id" := p_agency;
    v_row."created_by" := "pennsync_records".caller_email();
    v_row."created_date" := v_now;
    v_row."updated_date" := v_now;
    begin
    insert into "pennsync_records"."pdf_template" select (v_row).* returning * into v_row;
  exception when check_violation then
    raise exception using errcode='22023', message='PENNSYNC_TEMPLATE_FIELD_INVALID';
  end;
    return jsonb_build_object('created', true,
      'template', "pennsync_records".template_projected(v_row));
  end if;

  if p_id = '' then
    raise exception using errcode='22023', message='PENNSYNC_TEMPLATE_ID_INVALID';
  end if;
  select * into v_existing from "pennsync_records"."pdf_template" t
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."id" = p_id and t."agency_id" = p_agency
  for update;
  if not found then
    raise exception using errcode='22023', message='PENNSYNC_TEMPLATE_NOT_FOUND';
  end if;
  begin
    v_row := jsonb_populate_record(v_existing, p_fields);
  exception when others then
    raise exception using errcode='22023', message='PENNSYNC_TEMPLATE_FIELD_INVALID';
  end;
  v_row."updated_date" := v_now;
  v_assignments := (select pg_catalog.string_agg(
    pg_catalog.format('%I = ($1).%I', k, k), ', ' order by k)
    from jsonb_object_keys(p_fields) k);
  begin
    execute pg_catalog.format(
      'update "pennsync_records"."pdf_template" as t set %s,'
      || ' "updated_date" = ($1)."updated_date"'
      || ' where t."source_app_id" = $2 and t."id" = $3 and t."agency_id" = $4',
      v_assignments)
      using v_row, "pennsync_records".deployment_app(), p_id, p_agency;
  get diagnostics v_written = row_count;
  exception when check_violation then
    raise exception using errcode='22023', message='PENNSYNC_TEMPLATE_FIELD_INVALID';
  end;
  if v_written <> 1 then
    raise exception using errcode='22023', message='PENNSYNC_TEMPLATE_NOT_FOUND';
  end if;
  select * into v_row from "pennsync_records"."pdf_template" t
  where t."source_app_id" = "pennsync_records".deployment_app() and t."id" = p_id;
  return jsonb_build_object('created', false,
    'template', "pennsync_records".template_projected(v_row));
end $contract$;

create function "pennsync_records".contract_pdf_template_delete(p_agency text, p_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_deleted integer;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_TEMPLATE_AGENCY_NOT_HELD';
  end if;
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_TEMPLATE_FORBIDDEN';
  end if;
  if p_id is null or p_id = '' then
    raise exception using errcode='22023', message='PENNSYNC_TEMPLATE_ID_INVALID';
  end if;
  delete from "pennsync_records"."pdf_template" t
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."id" = p_id and t."agency_id" = p_agency;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception using errcode='22023', message='PENNSYNC_TEMPLATE_NOT_FOUND';
  end if;
  return jsonb_build_object('deleted', true, 'id', p_id);
end $contract$;

-- ---------------------------------------------------------------------------
-- CarePlan
-- ---------------------------------------------------------------------------

create function "pennsync_records".care_plan_writable() returns text[]
  language sql immutable set search_path = '' as $writable$
  select array['problem', 'goal', 'interventions', 'target_date', 'status',
    'baseline_measurement', 'frequency', 'clinical_notes', 'ai_generated',
    'visit_schedule', 'documentation_templates']
$writable$;

-- `patient_id` is the chart this plan belongs to and `care_plan` has no
-- `agency_id`, so it is the whole of the row's tenancy: moving it moves the
-- row between charts, and between agencies. It is settable on CREATE and
-- refused by name on an update.
create function "pennsync_records".care_plan_reserved() returns text[]
  language sql immutable set search_path = '' as $reserved$
  select array['patient_id', 'id', 'created_by', 'created_date', 'updated_date']
$reserved$;

create function "pennsync_records".care_plan_projected(p_row "pennsync_records"."care_plan")
  returns jsonb language sql stable set search_path = '' as $projected$
  select pg_catalog.to_jsonb(p_row) - 'source_app_id'
$projected$;

create function "pennsync_records".contract_care_plan_list(
    p_agency text, p_id text, p_patient_id text, p_order text, p_limit integer)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_rows jsonb; v_limit integer;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_CARE_PLAN_AGENCY_NOT_HELD';
  end if;
  if p_order is null or p_order not in ('created_date', 'updated_date') then
    raise exception using errcode='22023', message='PENNSYNC_CARE_PLAN_ORDER_INVALID';
  end if;
  v_limit := "pennsync_records".operational_limit(p_limit, 'PENNSYNC_CARE_PLAN');

  -- No gate of its own: `care_plan_read` reaches tenancy through the chart and
  -- carries D24's care-team narrowing with it, so a caller who does not open
  -- the chart sees nothing here and a caller who does sees the plans on it.
  -- The agency is still named, because `caller_agencies()` returns every
  -- agency the caller holds (D51's trap) and this row reaches its own through
  -- a join the predicate cannot see.
  select coalesce(jsonb_agg("pennsync_records".care_plan_projected(page) order by
      case when p_order = 'updated_date' then page."updated_date" end desc nulls last,
      case when p_order = 'created_date' then page."created_date" end desc nulls last,
      page."id" desc), '[]'::jsonb)
  into v_rows
  from (
    select c.* from "pennsync_records"."care_plan" c
    join "pennsync_records"."patient" p
      on p."source_app_id" = c."source_app_id" and p."id" = c."patient_id"
    where p."agency_id" = p_agency
      and (p_id is null or c."id" = p_id)
      and (p_patient_id is null or c."patient_id" = p_patient_id)
    order by
      case when p_order = 'updated_date' then c."updated_date" end desc nulls last,
      case when p_order = 'created_date' then c."created_date" end desc nulls last,
      c."id" desc
    limit v_limit
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

create function "pennsync_records".contract_care_plan_save(
    p_agency text, p_id text, p_patient_id text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_existing "pennsync_records"."care_plan"; v_row "pennsync_records"."care_plan";
  v_assignments text; v_written integer; v_now timestamptz;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_CARE_PLAN_AGENCY_NOT_HELD';
  end if;
  perform "pennsync_records".operational_check_fields(p_fields,
    "pennsync_records".care_plan_writable(), "pennsync_records".care_plan_reserved(),
    'PENNSYNC_CARE_PLAN');
  -- `patient_id` is the third of this entity's required fields and is refused
  -- below as a parameter rather than here as a field, because the contract
  -- takes it as one (it is the row's whole tenancy).
  perform "pennsync_records".operational_check_required(p_fields,
    array['problem', 'goal'], array['PROBLEM', 'GOAL'],
    'PENNSYNC_CARE_PLAN', p_id is null);
  v_now := clock_timestamp();

  if p_id is null then
    if coalesce(p_patient_id, '') = '' then
      raise exception using errcode='22023', message='PENNSYNC_CARE_PLAN_PATIENT_REQUIRED';
    end if;
    -- The chart is checked here so the refusal has a name. Without it the
    -- insert policy refuses with a bare row-level-security error, which reads
    -- as a broken service rather than as "that is not your chart".
    perform "pennsync_records".operational_chart(p_agency, p_patient_id,
      'PENNSYNC_CARE_PLAN');
    begin
      -- The schema's own defaults first, the caller's payload over them.
      v_row := jsonb_populate_record(v_row,
        "pennsync_records".care_plan_defaults() || p_fields);
    exception when others then
      raise exception using errcode='22023', message='PENNSYNC_CARE_PLAN_FIELD_INVALID';
    end;
    v_row."source_app_id" := "pennsync_records".deployment_app();
    v_row."id" := "pennsync_records".operational_new_id();
    v_row."patient_id" := p_patient_id;
    v_row."created_by" := "pennsync_records".caller_email();
    v_row."created_date" := v_now;
    v_row."updated_date" := v_now;
    begin
    insert into "pennsync_records"."care_plan" select (v_row).* returning * into v_row;
  exception when check_violation then
    raise exception using errcode='22023', message='PENNSYNC_CARE_PLAN_FIELD_INVALID';
  end;
    return jsonb_build_object('created', true,
      'care_plan', "pennsync_records".care_plan_projected(v_row));
  end if;

  if p_id = '' then
    raise exception using errcode='22023', message='PENNSYNC_CARE_PLAN_ID_INVALID';
  end if;
  select c.* into v_existing from "pennsync_records"."care_plan" c
  join "pennsync_records"."patient" p
    on p."source_app_id" = c."source_app_id" and p."id" = c."patient_id"
  where c."source_app_id" = "pennsync_records".deployment_app()
    and c."id" = p_id and p."agency_id" = p_agency
  for update of c;
  if not found then
    raise exception using errcode='22023', message='PENNSYNC_CARE_PLAN_NOT_FOUND';
  end if;
  begin
    v_row := jsonb_populate_record(v_existing, p_fields);
  exception when others then
    raise exception using errcode='22023', message='PENNSYNC_CARE_PLAN_FIELD_INVALID';
  end;
  v_row."updated_date" := v_now;
  v_assignments := (select pg_catalog.string_agg(
    pg_catalog.format('%I = ($1).%I', k, k), ', ' order by k)
    from jsonb_object_keys(p_fields) k);
  begin
    execute pg_catalog.format(
      'update "pennsync_records"."care_plan" as t set %s,'
      || ' "updated_date" = ($1)."updated_date"'
      || ' where t."source_app_id" = $2 and t."id" = $3', v_assignments)
      using v_row, "pennsync_records".deployment_app(), p_id;
  get diagnostics v_written = row_count;
  exception when check_violation then
    raise exception using errcode='22023', message='PENNSYNC_CARE_PLAN_FIELD_INVALID';
  end;
  if v_written <> 1 then
    raise exception using errcode='22023', message='PENNSYNC_CARE_PLAN_NOT_FOUND';
  end if;
  select * into v_row from "pennsync_records"."care_plan" c
  where c."source_app_id" = "pennsync_records".deployment_app() and c."id" = p_id;
  return jsonb_build_object('created', false,
    'care_plan', "pennsync_records".care_plan_projected(v_row));
end $contract$;

-- ---------------------------------------------------------------------------
-- FaceToFaceEncounter
-- ---------------------------------------------------------------------------

-- `patient_id` IS writable here and is refused on `care_plan`'s update, which
-- looks inconsistent and is not. `care_plan` has no `agency_id`: its tenancy
-- IS the chart, so moving the chart moves the row between agencies. This table
-- carries `agency_id not null`, so the chart is the row's SUBJECT and not its
-- tenancy, and an encounter may legitimately be filed before anyone knows
-- whose it is — the schema requires nothing at all, `patient_id` included —
-- and attached afterwards. The original permits the move and so does this.
-- What it adds is `operational_chart` on BOTH halves, so the chart a row is
-- moved to has to be one in this agency that the caller opens.
--
-- Read the tenancy before copying either decision. The question is not whether
-- a field looks like a subject; it is whether the row's tenancy is derived
-- from it.
create function "pennsync_records".f2f_writable() returns text[]
  language sql immutable set search_path = '' as $writable$
  select array['referral_id', 'patient_id', 'encounter_date', 'practitioner_name',
    'practitioner_credential', 'eligible_practitioner', 'clinical_reason',
    'documented_conditions', 'primary_diagnosis', 'soc_date', 'days_from_soc',
    'within_window', 'diagnosis_linked', 'validation_status',
    'validation_reasons', 'source']
$writable$;

create function "pennsync_records".f2f_reserved() returns text[]
  language sql immutable set search_path = '' as $reserved$
  select array['id', 'agency_id', 'created_by', 'created_date', 'updated_date']
$reserved$;

create function "pennsync_records".f2f_projected(
    p_row "pennsync_records"."face_to_face_encounter")
  returns jsonb language sql stable set search_path = '' as $projected$
  select pg_catalog.to_jsonb(p_row) - 'source_app_id'
$projected$;

create function "pennsync_records".contract_face_to_face_list(
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
    order by e."created_date" desc nulls last, e."id" desc
    limit v_limit
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

create function "pennsync_records".contract_face_to_face_save(
    p_agency text, p_id text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_existing "pennsync_records"."face_to_face_encounter";
  v_row "pennsync_records"."face_to_face_encounter";
  v_assignments text; v_written integer; v_now timestamptz;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_F2F_AGENCY_NOT_HELD';
  end if;
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_F2F_FORBIDDEN';
  end if;
  perform "pennsync_records".operational_check_fields(p_fields,
    "pennsync_records".f2f_writable(), "pennsync_records".f2f_reserved(), 'PENNSYNC_F2F');
  -- `patient_id` is writable here, so a save may NAME a chart. Checked on
  -- either half: on a create it is the chart the row lands on, and on an
  -- update it is a chart the row is being MOVED to.
  perform "pennsync_records".operational_chart(p_agency, p_fields->>'patient_id',
    'PENNSYNC_F2F');
  v_now := clock_timestamp();

  if p_id is null then
    begin
      -- The schema's own defaults first, the caller's payload over them.
      v_row := jsonb_populate_record(v_row,
        "pennsync_records".f2f_defaults() || p_fields);
    exception when others then
      raise exception using errcode='22023', message='PENNSYNC_F2F_FIELD_INVALID';
    end;
    v_row."source_app_id" := "pennsync_records".deployment_app();
    v_row."id" := "pennsync_records".operational_new_id();
    v_row."agency_id" := p_agency;
    v_row."created_by" := "pennsync_records".caller_email();
    v_row."created_date" := v_now;
    v_row."updated_date" := v_now;
    begin
      insert into "pennsync_records"."face_to_face_encounter" select (v_row).* returning * into v_row;
    exception when check_violation then
      raise exception using errcode='22023', message='PENNSYNC_F2F_FIELD_INVALID';
    end;
    return jsonb_build_object('created', true,
      'encounter', "pennsync_records".f2f_projected(v_row));
  end if;

  if p_id = '' then
    raise exception using errcode='22023', message='PENNSYNC_F2F_ID_INVALID';
  end if;
  select * into v_existing from "pennsync_records"."face_to_face_encounter" e
  where e."source_app_id" = "pennsync_records".deployment_app()
    and e."id" = p_id and e."agency_id" = p_agency
  for update;
  if not found then
    raise exception using errcode='22023', message='PENNSYNC_F2F_NOT_FOUND';
  end if;
  begin
    v_row := jsonb_populate_record(v_existing, p_fields);
  exception when others then
    raise exception using errcode='22023', message='PENNSYNC_F2F_FIELD_INVALID';
  end;
  v_row."updated_date" := v_now;
  v_assignments := (select pg_catalog.string_agg(
    pg_catalog.format('%I = ($1).%I', k, k), ', ' order by k)
    from jsonb_object_keys(p_fields) k);
  begin
    execute pg_catalog.format(
      'update "pennsync_records"."face_to_face_encounter" as t set %s,'
      || ' "updated_date" = ($1)."updated_date"'
      || ' where t."source_app_id" = $2 and t."id" = $3 and t."agency_id" = $4',
      v_assignments)
      using v_row, "pennsync_records".deployment_app(), p_id, p_agency;
  get diagnostics v_written = row_count;
  exception when check_violation then
    raise exception using errcode='22023', message='PENNSYNC_F2F_FIELD_INVALID';
  end;
  if v_written <> 1 then
    raise exception using errcode='22023', message='PENNSYNC_F2F_NOT_FOUND';
  end if;
  select * into v_row from "pennsync_records"."face_to_face_encounter" e
  where e."source_app_id" = "pennsync_records".deployment_app() and e."id" = p_id;
  return jsonb_build_object('created', false,
    'encounter', "pennsync_records".f2f_projected(v_row));
end $contract$;

-- ---------------------------------------------------------------------------
-- DocumentRecord
-- ---------------------------------------------------------------------------

-- `file_url` is resolved for the same reason `template_file_url` is, and it
-- matters more here: this is a patient's uploaded document, so a raw locator
-- would be a link into Base44's storage for a row the owned store authorized.
create function "pennsync_records".document_record_projected(
    p_row "pennsync_records"."document_record")
  returns jsonb language sql stable set search_path = '' as $projected$
  select (pg_catalog.to_jsonb(p_row) - 'source_app_id') || jsonb_build_object(
    'file_url', "pennsync_records".operational_locator(p_row."file_url"))
$projected$;

create function "pennsync_records".contract_document_record_list(
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
    order by d."created_date" desc nulls last, d."id" desc
    limit v_limit
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

-- ---------------------------------------------------------------------------
-- NoteConversion
-- ---------------------------------------------------------------------------

create function "pennsync_records".note_conversion_writable() returns text[]
  language sql immutable set search_path = '' as $writable$
  select array['recovery_request_id', 'patient_id', 'visit_type', 'diagnosis',
    'rough_note_length', 'enhanced_note_length', 'quality_score',
    'compliance_score', 'rough_note_compliance', 'enhanced_note_compliance',
    'compliance_improvement', 'conversion_time_ms', 'draft_presence_score',
    'rough_len', 'enhanced_len']
$writable$;

-- `nurse_email` decides who may READ the row, so it is the contract's and not
-- the caller's: it is stamped from the caller's own identity and refused by
-- name if sent.
create function "pennsync_records".note_conversion_reserved() returns text[]
  language sql immutable set search_path = '' as $reserved$
  select array['nurse_email', 'id', 'agency_id', 'created_by', 'created_date',
    'updated_date']
$reserved$;

create function "pennsync_records".note_conversion_projected(
    p_row "pennsync_records"."note_conversion")
  returns jsonb language sql stable set search_path = '' as $projected$
  select pg_catalog.to_jsonb(p_row) - 'source_app_id'
$projected$;

create function "pennsync_records".contract_note_conversion_list(
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
    order by n."created_date" desc nulls last, n."id" desc
    limit v_limit
  ) page;
  return jsonb_build_object('entries', v_rows);
end $contract$;

create function "pennsync_records".contract_note_conversion_create(
    p_agency text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_row "pennsync_records"."note_conversion"; v_now timestamptz;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501',
      message='PENNSYNC_NOTE_CONVERSION_AGENCY_NOT_HELD';
  end if;
  perform "pennsync_records".operational_check_fields(p_fields,
    "pennsync_records".note_conversion_writable(),
    "pennsync_records".note_conversion_reserved(), 'PENNSYNC_NOTE_CONVERSION');
  perform "pennsync_records".operational_chart(p_agency, p_fields->>'patient_id',
    'PENNSYNC_NOTE_CONVERSION');
  -- The schema requires one field, `nurse_email`, and this contract STAMPS it
  -- from the caller and refuses it as reserved, so there is no payload here
  -- that can be missing it. `AgencySettings` and `FaceToFaceEncounter` declare
  -- no required field at all and so carry no such check either; both were read
  -- rather than assumed.
  v_now := clock_timestamp();
  begin
    v_row := jsonb_populate_record(v_row, p_fields);
  exception when others then
    raise exception using errcode='22023', message='PENNSYNC_NOTE_CONVERSION_FIELD_INVALID';
  end;
  v_row."source_app_id" := "pennsync_records".deployment_app();
  v_row."id" := "pennsync_records".operational_new_id();
  v_row."agency_id" := p_agency;
  v_row."nurse_email" := "pennsync_records".caller_email();
  v_row."created_by" := "pennsync_records".caller_email();
  v_row."created_date" := v_now;
  v_row."updated_date" := v_now;
  begin
    insert into "pennsync_records"."note_conversion" select (v_row).* returning * into v_row;
  exception when check_violation then
    raise exception using errcode='22023', message='PENNSYNC_NOTE_CONVERSION_FIELD_INVALID';
  end;
  return jsonb_build_object('created', true,
    'conversion', "pennsync_records".note_conversion_projected(v_row));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".operational_check_fields(jsonb, text[], text[], text),
  "pennsync_records".operational_limit(integer, text),
  "pennsync_records".operational_locator(text),
  "pennsync_records".operational_new_id(),
  "pennsync_records".settings_writable(),
  "pennsync_records".settings_reserved(),
  "pennsync_records".settings_projected("pennsync_records"."agency_settings"),
  "pennsync_records".task_writable(),
  "pennsync_records".task_reserved(),
  "pennsync_records".task_projected("pennsync_records"."task"),
  "pennsync_records".template_writable(),
  "pennsync_records".template_reserved(),
  "pennsync_records".template_projected("pennsync_records"."pdf_template"),
  "pennsync_records".care_plan_writable(),
  "pennsync_records".care_plan_reserved(),
  "pennsync_records".care_plan_projected("pennsync_records"."care_plan"),
  "pennsync_records".f2f_writable(),
  "pennsync_records".f2f_reserved(),
  "pennsync_records".f2f_projected("pennsync_records"."face_to_face_encounter"),
  "pennsync_records".document_record_projected("pennsync_records"."document_record"),
  "pennsync_records".note_conversion_writable(),
  "pennsync_records".note_conversion_reserved(),
  "pennsync_records".note_conversion_projected("pennsync_records"."note_conversion"),
  "pennsync_records".contract_agency_settings_read(text, text, text, integer),
  "pennsync_records".contract_agency_settings_save(text, text, jsonb),
  "pennsync_records".contract_task_list(text, text, text, text, text, text, integer),
  "pennsync_records".contract_task_create(text, jsonb),
  "pennsync_records".contract_pdf_template_list(text, text, integer),
  "pennsync_records".contract_pdf_template_save(text, text, jsonb),
  "pennsync_records".contract_pdf_template_delete(text, text),
  "pennsync_records".contract_care_plan_list(text, text, text, text, integer),
  "pennsync_records".contract_care_plan_save(text, text, text, jsonb),
  "pennsync_records".contract_face_to_face_list(text, text, integer),
  "pennsync_records".contract_face_to_face_save(text, text, jsonb),
  "pennsync_records".contract_document_record_list(text, text, integer),
  "pennsync_records".contract_note_conversion_list(text, text, integer),
  "pennsync_records".contract_note_conversion_create(text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_agency_settings_read(text, text, text, integer),
  "pennsync_records".contract_agency_settings_save(text, text, jsonb),
  "pennsync_records".contract_task_list(text, text, text, text, text, text, integer),
  "pennsync_records".contract_task_create(text, jsonb),
  "pennsync_records".contract_pdf_template_list(text, text, integer),
  "pennsync_records".contract_pdf_template_save(text, text, jsonb),
  "pennsync_records".contract_pdf_template_delete(text, text),
  "pennsync_records".contract_care_plan_list(text, text, text, text, integer),
  "pennsync_records".contract_care_plan_save(text, text, text, jsonb),
  "pennsync_records".contract_face_to_face_list(text, text, integer),
  "pennsync_records".contract_face_to_face_save(text, text, jsonb),
  "pennsync_records".contract_document_record_list(text, text, integer),
  "pennsync_records".contract_note_conversion_list(text, text, integer),
  "pennsync_records".contract_note_conversion_create(text, jsonb)
  to authenticated;

create function "public"."pennsync_contract_agency_settings_read"(
    p_agency text, p_agency_code text, p_office_name text, p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_agency_settings_read(
    p_agency, p_agency_code, p_office_name, p_limit)
$contract$;

create function "public"."pennsync_contract_agency_settings_save"(
    p_agency text, p_id text, p_fields jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_agency_settings_save(p_agency, p_id, p_fields)
$contract$;

create function "public"."pennsync_contract_task_list"(
    p_agency text, p_patient_id text, p_related_entity text,
    p_related_entity_id text, p_exclude_status text, p_order text,
    p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_task_list(p_agency, p_patient_id,
    p_related_entity, p_related_entity_id, p_exclude_status, p_order, p_limit)
$contract$;

create function "public"."pennsync_contract_task_create"(
    p_agency text, p_fields jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_task_create(p_agency, p_fields)
$contract$;

create function "public"."pennsync_contract_pdf_template_list"(
    p_agency text, p_parent_template_id text, p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_pdf_template_list(
    p_agency, p_parent_template_id, p_limit)
$contract$;

create function "public"."pennsync_contract_pdf_template_save"(
    p_agency text, p_id text, p_fields jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_pdf_template_save(p_agency, p_id, p_fields)
$contract$;

create function "public"."pennsync_contract_pdf_template_delete"(
    p_agency text, p_id text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_pdf_template_delete(p_agency, p_id)
$contract$;

create function "public"."pennsync_contract_care_plan_list"(
    p_agency text, p_id text, p_patient_id text, p_order text,
    p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_care_plan_list(
    p_agency, p_id, p_patient_id, p_order, p_limit)
$contract$;

create function "public"."pennsync_contract_care_plan_save"(
    p_agency text, p_id text, p_patient_id text, p_fields jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_care_plan_save(p_agency, p_id, p_patient_id, p_fields)
$contract$;

create function "public"."pennsync_contract_face_to_face_list"(
    p_agency text, p_referral_id text, p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_face_to_face_list(p_agency, p_referral_id, p_limit)
$contract$;

create function "public"."pennsync_contract_face_to_face_save"(
    p_agency text, p_id text, p_fields jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_face_to_face_save(p_agency, p_id, p_fields)
$contract$;

create function "public"."pennsync_contract_document_record_list"(
    p_agency text, p_patient_id text, p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_document_record_list(p_agency, p_patient_id, p_limit)
$contract$;

create function "public"."pennsync_contract_note_conversion_list"(
    p_agency text, p_recovery_request_id text, p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_note_conversion_list(
    p_agency, p_recovery_request_id, p_limit)
$contract$;

create function "public"."pennsync_contract_note_conversion_create"(
    p_agency text, p_fields jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_note_conversion_create(p_agency, p_fields)
$contract$;

revoke all on function
  "public"."pennsync_contract_agency_settings_read"(text, text, text, integer),
  "public"."pennsync_contract_agency_settings_save"(text, text, jsonb),
  "public"."pennsync_contract_task_list"(text, text, text, text, text, text, integer),
  "public"."pennsync_contract_task_create"(text, jsonb),
  "public"."pennsync_contract_pdf_template_list"(text, text, integer),
  "public"."pennsync_contract_pdf_template_save"(text, text, jsonb),
  "public"."pennsync_contract_pdf_template_delete"(text, text),
  "public"."pennsync_contract_care_plan_list"(text, text, text, text, integer),
  "public"."pennsync_contract_care_plan_save"(text, text, text, jsonb),
  "public"."pennsync_contract_face_to_face_list"(text, text, integer),
  "public"."pennsync_contract_face_to_face_save"(text, text, jsonb),
  "public"."pennsync_contract_document_record_list"(text, text, integer),
  "public"."pennsync_contract_note_conversion_list"(text, text, integer),
  "public"."pennsync_contract_note_conversion_create"(text, jsonb)
  from public, anon, service_role;
grant execute on function
  "public"."pennsync_contract_agency_settings_read"(text, text, text, integer),
  "public"."pennsync_contract_agency_settings_save"(text, text, jsonb),
  "public"."pennsync_contract_task_list"(text, text, text, text, text, text, integer),
  "public"."pennsync_contract_task_create"(text, jsonb),
  "public"."pennsync_contract_pdf_template_list"(text, text, integer),
  "public"."pennsync_contract_pdf_template_save"(text, text, jsonb),
  "public"."pennsync_contract_pdf_template_delete"(text, text),
  "public"."pennsync_contract_care_plan_list"(text, text, text, text, integer),
  "public"."pennsync_contract_care_plan_save"(text, text, text, jsonb),
  "public"."pennsync_contract_face_to_face_list"(text, text, integer),
  "public"."pennsync_contract_face_to_face_save"(text, text, jsonb),
  "public"."pennsync_contract_document_record_list"(text, text, integer),
  "public"."pennsync_contract_note_conversion_list"(text, text, integer),
  "public"."pennsync_contract_note_conversion_create"(text, jsonb)
  to authenticated;

commit;
