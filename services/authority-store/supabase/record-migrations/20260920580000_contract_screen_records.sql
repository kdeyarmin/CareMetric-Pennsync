-- Seven screens' own records, served by contracts rather than an entity route.
--
-- Stage J's unit of work is a CALL SITE, and these are the twelve in batch E
-- that have somewhere to go. Two of the batch's fourteen do not and are
-- deliberately absent: `ComplianceRule.create` and `ComplianceRule.update` in
-- `RegulatoryMonitor.jsx` write a table that has a read policy and NO insert,
-- update or delete policy -- D83's global reference table, written by migration
-- and never at runtime. Forced RLS binds the record owner too, so a definer
-- contract would match no rows; there is nothing to write here and adding one
-- would be inventing a decision nobody took. The READ beside them is served
-- below, and its route says in its own reason that its siblings are not, so
-- nobody reads that screen as ported.
--
-- **THE ORIGINAL IS THE ENTITY, NOT A FUNCTION.** All twelve call sites are raw
-- `Entity.list/filter/create` reads and writes, so no Base44 function ever
-- governed them. What governed them is each entity's own access block, and five
-- of the seven say something the owned store's policies do not:
--
--   ComplianceRule        read/create/update  role === 'admin'
--   OCRTrainingSession    all four            role === 'admin'
--   OCRFeedback           read                user_email = me  OR admin
--   SentEducationMaterial read/create         sent_by   = me   OR admin
--   NotificationPreference read/create        user_email = me
--                          update/delete      created_by = me AND user_email = me
--   ClinicalEvent          all four           false
--   PatientRecommendation  all four           false
--
-- Four of these tables are agency-WIDE here, so a port that trusted the
-- policies alone would have handed every colleague's OCR corrections and
-- education sends to every colleague, and opened two admin panels to the whole
-- agency. So each contract keeps its OWN ownership or role check, and the
-- successor to the platform tier is an `agency_admin` scoped to their agency
-- (D40). D70 says check whether the policies already say the gate; here the
-- answer is that four times out of seven they do not.
--
-- **What the policies DO carry, and the four shapes are worth telling apart:**
--
--   * `clinical_event`, `patient_recommendation` and `sent_education_material`
--     reach tenancy through `patient_id`, so D24's care-team narrowing applies
--     and a clinician sees their own charts' rows. The contracts add no chart
--     rule of their own. For the education send that narrowing is the FLOOR
--     and the sender's own address is the rule on top of it.
--   * `ocr_feedback` and `ocr_training_session` carry `agency_id` directly, and
--     that is tenancy rather than ownership, so both contracts add their own.
--   * `notification_preference` is `user_email = caller_email()` and force-RLS,
--     so the READ is the caller's own row and nobody else's -- D45's "tenancy
--     is not ownership" from the side where the policy already says so. The
--     SAVE still adds `created_by`, because that is the entity's update rule
--     and the policy does not carry it.
--   * `compliance_rule` is `caller_identified()` and global, which decides the
--     table's tenancy and says nothing about who may read the catalogue.
--
-- **The two places this is NARROWER than the original, both deliberate.** A
-- narrowing is a real defect when it hides rows the access block granted, so
-- neither is left to be discovered:
--
--   * Every contract here requires the caller to hold the agency, and four of
--     the seven access blocks name no agency at all. That is the business API's
--     envelope invariant -- every request names its tenant (D34) -- rather than
--     a judgement taken in this file, and the owned tables are tenanted whether
--     or not the Base44 entity was.
--   * The education read keeps D24's chart narrowing UNDER the sender rule, so
--     a clinician taken off a chart loses sends they made on it, which the
--     original's `sent_by` would still have shown them. D71 made the same trade
--     for a document search and recorded it: the care team is the authority on
--     who reads a chart, and an address on a row is not. Recorded rather than
--     worked around.
--
-- And the place it is deliberately NOT narrower: `notification_preference`'s
-- read block is a single term, `data.user_email = {{user.email}}`, with no
-- admin branch and no third condition -- measured, not assumed. So an
-- `agency_admin` reads nobody's preferences but their own here, and a test
-- asserts exactly that.
--
-- `clinical_event`'s and `patient_recommendation`'s `false` blocks are the one
-- case where no check is a measured answer rather than an omission:
-- `residualRlsAuthorizationContract.spec.js` records the owner's 2026-09-10
-- decision that per-patient clinical detail was readable by any signed-in
-- account and stays denied "until a scoped broker". D24's narrowing is that
-- broker. Note that the timeline component the event read serves is still
-- imported by nothing, which that same spec asserts; this gives it a
-- destination, not a screen.
--
-- **Where a screen asks for an order or a page, the contract does it in SQL**,
-- because a route that sorts a page it did not prove complete answers "the
-- newest fifty" with "fifty of them, newest first". That is
-- `independentEntityRoutes.js`'s own rule and the reason these are contracts
-- rather than routes over a generic read.
--
-- **The two writes carry no field the caller does not own.** Both
-- `record_patient_recommendation` and `record_sent_education_material` name
-- their writable fields and REFUSE an unknown key rather than filtering it
-- (D39): the originals' silent field filters are what keep `status` out of a
-- caller's reach and also what lose a misspelled column without telling anyone.
-- `patient_name` on a sent material is NOT taken from the caller -- the screen
-- sends one, and a caller-supplied subject name in a row the chart already
-- identifies is a second copy that can disagree with the chart. It is derived
-- from the chart the contract just authorized.
--
-- **They also refuse a required field that is ABSENT, which is a second check
-- and not the same one.** `screen_exact_keys` refuses an unknown key and does
-- not require a known one, and the generated record store leaves every entity
-- column NULLABLE -- so without this a send with no content or a
-- recommendation with no title INSERTS, answers `success: true`, and is junk
-- nobody is told about. Base44 enforced these at the platform, so omitting the
-- check would have WIDENED both capabilities. The lists live in
-- `screen_required_keys` calls and the test derives them from each entity's own
-- `required` array, so a field added upstream fails the suite rather than
-- becoming silently optional.
--
-- **The generated store is deliberately permissive, and that costs a write
-- contract two things rather than one.** Its own header says columns are
-- nullable even where the entity marks them required, so a legacy row can
-- migrate and be reconciled rather than rejected -- a decision about IMPORT
-- that a create path must not inherit. It also emits NO column default
-- anywhere: 646 properties across 208 entities declare one and none of them
-- reaches the SQL, which the header does not mention and is not the same
-- trade, because a default fires only where a column is omitted and so costs
-- an import nothing. Five of these seven entities declare defaults. Both
-- writes therefore refuse an absent required field AND stamp the entity's
-- declared default, and the test reads both lists out of the entity rather
-- than out of this file.
--
-- **A caller's bad value is refused by name, not by the store.** Enum values
-- DO become CHECK constraints -- 578 of them -- so a typo in a delivery method
-- raises `check_violation`, which is undeclared at the HTTP boundary and
-- reaches the screen as a 503 `CONTRACT_REFUSED`: a record-store outage where
-- a caller made a typo. Both writes catch it, and the casts beside it, and
-- answer `PENNSYNC_SCREEN_FIELD_VALUE_INVALID`.
--
-- **One pass this file owes the reader, because the absence of a predicate
-- reads as a missing check.** Every one of the seven store policies was read
-- for a shared or cross-agency disjunct, and NONE has one: `clinical_event`,
-- `patient_recommendation` and `sent_education_material` are chart-scoped
-- through `patient_id`; `ocr_feedback` and `ocr_training_session` are
-- `agency_id in caller_agencies()`; `notification_preference` is
-- `user_email = caller_email()` on all four commands; and `compliance_rule` has
-- one read policy, `caller_identified()`, and no write policy at all. So no
-- contract here carries a tenant predicate the policies already enforce, and
-- none of them is hiding a row the policy would have granted.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.caller_tenant_role(text)') is null then
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
 * The agency every capability here needs, and nothing else.
 *
 * Null means the caller holds nothing in this agency, which is the same
 * question `caller_agencies()` answers inside every policy below -- asked once
 * here so a refusal is a named code rather than an empty list, which a screen
 * cannot tell from "no rows".
 */
create function "pennsync_records".screen_agency_held(p_agency text) returns text
  language plpgsql security definer set search_path = '' as $held$
declare v_role text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_SCREEN_AGENCY_NOT_HELD';
  end if;
  return v_role;
end $held$;

/*
 * The successor to `role === 'admin'` on this batch's entities (D40).
 *
 * Five of the seven originals gate on the built-in platform tier D14 and D22
 * removed, either alone (`ComplianceRule`, `OCRTrainingSession`) or as the
 * second half of "your own rows, or the admin's everything" (`OCRFeedback`,
 * `SentEducationMaterial`). The owner's standing answer is an `agency_admin`
 * scoped to their own agency, so that is what both shapes ask.
 *
 * The boolean form exists because the `$or` originals need the answer as a
 * PREDICATE rather than as a gate: the caller is admitted either way and it is
 * the row set that differs.
 */
create function "pennsync_records".screen_agency_admin(p_agency text) returns boolean
  language plpgsql security definer set search_path = '' as $admin$
begin
  return "pennsync_records".screen_agency_held(p_agency) = 'agency_admin';
end $admin$;

create function "pennsync_records".screen_agency_admin_required(p_agency text)
  returns void language plpgsql security definer set search_path = '' as $admin$
begin
  if not "pennsync_records".screen_agency_admin(p_agency) then
    raise exception using errcode='42501', message='PENNSYNC_SCREEN_AGENCY_ADMIN_REQUIRED';
  end if;
end $admin$;

/*
 * A chart this caller may open, or a refusal.
 *
 * The visibility answer is the POLICY's: this selects the row and lets
 * `patient_read` decide, rather than re-deriving a care-team rule the way five
 * originals do (D41). A chart that exists in another agency and one that does
 * not exist are the same answer on purpose -- distinguishing them would tell a
 * caller which patient ids are real.
 */
create function "pennsync_records".screen_chart(p_agency text, p_patient_id text) returns text
  language plpgsql security definer set search_path = '' as $chart$
declare v_id text;
begin
  perform "pennsync_records".screen_agency_held(p_agency);
  if p_patient_id is null or p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_SCREEN_SUBJECT_INVALID';
  end if;
  select p."id" into v_id from "pennsync_records"."patient" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."id" = p_patient_id and p."agency_id" = p_agency;
  if v_id is null then
    raise exception using errcode='42501', message='PENNSYNC_SCREEN_PATIENT_NOT_VISIBLE';
  end if;
  return v_id;
end $chart$;

/*
 * The page size every read below takes from its screen.
 *
 * A caller may ask for less than the ceiling and never for more, and the
 * ceiling is re-applied HERE rather than trusted from the request, because a
 * bound a caller can raise is not a bound (D71).
 *
 * `least`, `greatest` and `coalesce` are SQL CONSTRUCTS rather than catalog
 * functions, so they cannot be schema-qualified and `search_path = ''` does not
 * reach them. Everything else in this file that looks like a call is qualified;
 * these three are the exception because the parser resolves them itself.
 */
create function "pennsync_records".screen_limit(p_limit integer, p_ceiling integer)
  returns integer language sql immutable parallel safe set search_path = '' as $limit$
  select least(greatest(coalesce(p_limit, p_ceiling), 1), p_ceiling)
$limit$;

/*
 * An unknown key is REFUSED, never filtered (D39).
 *
 * The originals drop what they do not recognise, which is what keeps a
 * reviewer-only field out of a caller's reach AND what loses a misspelled one
 * silently. Naming the set makes the first explicit and the second loud.
 */
create function "pennsync_records".screen_exact_keys(p_payload jsonb, p_allowed text[])
  returns void language plpgsql immutable parallel safe set search_path = '' as $keys$
declare v_key text;
begin
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode='22023', message='PENNSYNC_SCREEN_PAYLOAD_INVALID';
  end if;
  for v_key in select jsonb_object_keys(p_payload) loop
    if not (v_key = any(p_allowed)) then
      raise exception using errcode='22023', message='PENNSYNC_SCREEN_FIELD_NOT_WRITABLE';
    end if;
  end loop;
end $keys$;
/*
 * A REQUIRED key is refused when it is absent, and that is a different check
 * from the one above.
 *
 * `screen_exact_keys` refuses an unknown key and does not require a known one
 * -- D76's own lesson about `exactObject`, arriving here in SQL. The generated
 * record store leaves every entity column NULLABLE, so an insert missing a
 * field the Base44 entity declares `required` SUCCEEDS and writes a junk row:
 * an education send with no content, a recommendation with no title. Nothing
 * in an authorization suite can see that, because nothing was refused.
 *
 * So the two write contracts below name the required fields their caller
 * supplies, and `contract-screen-records.test.mjs` reads that list out of each
 * entity's own `required` array rather than trusting this one.
 *
 * Present and NOT NULL is the whole rule, deliberately: JSON Schema's
 * `required` is satisfied by an empty string, so refusing one here would be a
 * narrowing invented in this file rather than the original's behaviour. A
 * required field the CONTRACT supplies -- `patient_id` from its own parameter,
 * `user_email` from `caller_email()` -- is covered structurally and is not in
 * any list here.
 */
create function "pennsync_records".screen_required_keys(p_payload jsonb, p_required text[])
  returns void language plpgsql immutable parallel safe set search_path = '' as $required$
declare v_key text;
begin
  foreach v_key in array p_required loop
    if p_payload->v_key is null or jsonb_typeof(p_payload->v_key) = 'null' then
      raise exception using errcode='22023', message='PENNSYNC_SCREEN_FIELD_REQUIRED';
    end if;
  end loop;
end $required$;

/*
 * A chart's clinical events, for the timeline a nurse reads.
 *
 * Note the contrast with `contract_clinical_event_review` (D64), which reads
 * the same table and does NOT project `source_text`. That is a rule about what
 * reaches a PROMPT: the review hands its events to a model. This one answers a
 * care-team display, to a caller the chart policies already admit, and the
 * timeline renders `source_text` as the quoted note the event was extracted
 * from -- so withholding it here would silently blank the screen's evidence
 * pane. Same table, two purposes, two projections, and the difference is the
 * reader rather than the row.
 *
 * It is also why neither existing capability could serve this call site: the
 * review filters `verified = false`, a strict subset, and the trend context
 * caps at 100 where the screen asks 200 and projects a derived group with no
 * id, event_type or structured_data. Answering "this chart's events" with
 * either would have been "some of them", which reads correct on the screen.
 */
create function "pennsync_records".contract_clinical_event_list(
  p_agency text, p_patient_id text, p_limit integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_events jsonb;
begin
  perform "pennsync_records".screen_chart(p_agency, p_patient_id);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e."id", 'event_type', e."event_type", 'event_date', e."event_date",
      'event_title', e."event_title", 'event_description', e."event_description",
      'structured_data', e."structured_data", 'severity', e."severity",
      'requires_followup', e."requires_followup", 'source_text', e."source_text",
      'verified', e."verified")
    order by e."event_date" desc nulls last, e."id"), '[]'::jsonb) into v_events
  from (select c.* from "pennsync_records"."clinical_event" c
    where c."source_app_id" = "pennsync_records".deployment_app()
      and c."patient_id" = p_patient_id
    order by c."event_date" desc nulls last, c."id"
    limit "pennsync_records".screen_limit(p_limit, 200)) e;
  return jsonb_build_object('success', true, 'events', v_events);
end $contract$;

/*
 * The OCR corrections an agency has recorded.
 *
 * One capability for two call sites, because they differ only in a predicate
 * the policy does not carry: the dashboard reads every correction newest
 * first, and the training monitor reads the ones not yet folded into a
 * session. `p_applied_to_training` null means "either", which is the
 * dashboard's call, and a boolean narrows it -- a three-valued parameter
 * rather than two capabilities that would drift apart.
 *
 * `document_url`, `original_text`, `corrected_text` and `original_ocr_text`
 * are NOT projected. They are the scanned document's contents, the reason
 * `PDFIndex` sits outside the generic broker family at all (D71), and neither
 * screen renders any of them: the dashboard shows a correction's type, kind
 * and note, and the monitor counts them.
 *
 * AUTHORIZATION IS THE ENTITY'S, NOT THE TABLE'S. Both call sites are raw
 * `OCRFeedback` reads, so no function ever governed them -- the entity's own
 * access block did, and it reads `data.user_email = {{user.email}}` OR the
 * platform admin. `ocr_feedback` here is agency-WIDE, so trusting the policy
 * alone would hand every colleague's corrections to every colleague. The
 * ownership half is the contract's own predicate and the admin half is D40's.
 */
create function "pennsync_records".contract_ocr_feedback_list(
  p_agency text, p_applied_to_training boolean, p_limit integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_rows jsonb; v_admin boolean;
begin
  v_admin := "pennsync_records".screen_agency_admin(p_agency);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f."id", 'created_date', f."created_date",
      'correction_type', f."correction_type", 'document_type', f."document_type",
      'feedback_notes', f."feedback_notes", 'applied_to_training', f."applied_to_training")
    order by f."created_date" desc nulls last, f."id"), '[]'::jsonb) into v_rows
  from (select o.* from "pennsync_records"."ocr_feedback" o
    where o."source_app_id" = "pennsync_records".deployment_app()
      and o."agency_id" = p_agency
      and (v_admin or o."user_email" = "pennsync_records".caller_email())
      and (p_applied_to_training is null
        or coalesce(o."applied_to_training", false) = p_applied_to_training)
    order by o."created_date" desc nulls last, o."id"
    limit "pennsync_records".screen_limit(p_limit, 500)) f;
  return jsonb_build_object('success', true, 'entries', v_rows);
end $contract$;

/*
 * The OCR training runs an agency has started.
 *
 * `ai_insights`, `patterns_learned` and `correction_categories` are absent for
 * the same reason as the document text above: the monitor renders a run's
 * name, state, counts and metrics, and what the model wrote about a run is not
 * on the screen.
 *
 * The entity's whole access block is the platform tier, on all four
 * operations, so the read is an `agency_admin`'s (D40) and NOT a member's.
 * Its one call site sits beside the feedback read above in an admin panel.
 */
create function "pennsync_records".contract_ocr_training_list(
  p_agency text, p_limit integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_rows jsonb;
begin
  perform "pennsync_records".screen_agency_admin_required(p_agency);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s."id", 'created_date', s."created_date", 'status', s."status",
      'session_name', s."session_name", 'feedback_count', s."feedback_count",
      'accuracy_before', s."accuracy_before", 'accuracy_after', s."accuracy_after",
      'improvement_percentage', s."improvement_percentage",
      'document_types_trained', s."document_types_trained",
      'training_metrics', s."training_metrics", 'error_message', s."error_message")
    order by s."created_date" desc nulls last, s."id"), '[]'::jsonb) into v_rows
  from (select t.* from "pennsync_records"."ocr_training_session" t
    where t."source_app_id" = "pennsync_records".deployment_app()
      and t."agency_id" = p_agency
    order by t."created_date" desc nulls last, t."id"
    limit "pennsync_records".screen_limit(p_limit, 200)) s;
  return jsonb_build_object('success', true, 'entries', v_rows);
end $contract$;

/*
 * What education material has gone out, for the library's activity panel.
 *
 * Tenancy here is the CHART, through `patient_id`, so the policy already
 * narrows it to charts the caller opens, without this contract saying anything
 * about charts. That is NOT the whole rule. The call site is a raw
 * `SentEducationMaterial.list`, which no function ever governed; what governed
 * it is the entity's own access block, `data.sent_by = {{user.email}}` OR the
 * platform admin. So the chart narrowing is the floor and the sender's own
 * address is the rule: a colleague on the same care team sees the send in
 * Base44 today only if they sent it. The admin half is D40's, scoped to the
 * agency.
 *
 * `personalized_content` is not projected: it is the patient-specific body of
 * the material, the panel shows a title, a subject and a date, and a row's
 * full text on a list screen is the widest thing here for the least reason.
 */
create function "pennsync_records".contract_sent_education_list(
  p_agency text, p_limit integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_rows jsonb; v_admin boolean;
begin
  v_admin := "pennsync_records".screen_agency_admin(p_agency);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m."id", 'material_title', m."material_title",
      'patient_name', m."patient_name", 'patient_acknowledged', m."patient_acknowledged",
      'sent_by', m."sent_by", 'sent_date', m."sent_date",
      'delivery_method', m."delivery_method")
    order by m."sent_date" desc nulls last, m."id"), '[]'::jsonb) into v_rows
  -- THE AGENCY BINDING IS THIS JOIN, and it is the only read here that needs
  -- one written out: the two chart reads take a patient and `screen_chart`
  -- binds it, while this panel takes no subject at all. The table has no
  -- `agency_id`, so its tenancy is the chart -- and the POLICIES admit every
  -- agency the caller holds, which for somebody holding two is both. Without
  -- this join a request naming agency A answers with agency B's sends. A row
  -- whose chart is missing is in no tenant and belongs to nobody, so an inner
  -- join is the right shape rather than an oversight.
  from (select s.* from "pennsync_records"."sent_education_material" s
    join "pennsync_records"."patient" p
      on p."source_app_id" = s."source_app_id" and p."id" = s."patient_id"
      and p."agency_id" = p_agency
    where s."source_app_id" = "pennsync_records".deployment_app()
      and (v_admin or s."sent_by" = "pennsync_records".caller_email())
    order by s."sent_date" desc nulls last, s."id"
    limit "pennsync_records".screen_limit(p_limit, 200)) m;
  return jsonb_build_object('success', true, 'entries', v_rows);
end $contract$;

/*
 * A chart's recommendations, projected down to what the caller actually reads.
 *
 * This is D64's rule at its sharpest. The analyser asks for thirty rows and
 * uses ONE field of them: it counts how many are `completed` and how many are
 * `pending`, and those two counts go into a prompt. Every other column --
 * `title`, `description`, `ai_rationale`, `implementation_notes` -- would ride
 * into a model's context having never been looked at. So the projection is the
 * status and the id, and a screen that later wants more has to widen this
 * deliberately rather than discover it already had it.
 */
create function "pennsync_records".contract_patient_recommendation_list(
  p_agency text, p_patient_id text, p_limit integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_rows jsonb;
begin
  perform "pennsync_records".screen_chart(p_agency, p_patient_id);
  select coalesce(jsonb_agg(jsonb_build_object('id', r."id", 'status', r."status")
    order by r."created_date" desc nulls last, r."id"), '[]'::jsonb) into v_rows
  from (select p.* from "pennsync_records"."patient_recommendation" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."patient_id" = p_patient_id
    order by p."created_date" desc nulls last, p."id"
    limit "pennsync_records".screen_limit(p_limit, 200)) r;
  return jsonb_build_object('success', true, 'entries', v_rows);
end $contract$;

/*
 * One compliance rule by its auditor-matchable code.
 *
 * `compliance_rule` is a GLOBAL reference table: its only policy is a read
 * gated on `caller_identified()`, and D83 says such a table is written by
 * migration and never at runtime. That is why this file carries a lookup and
 * no writer -- the screen's `create` and `update` beside this call have no
 * destination in the owned store, and giving them one here would be taking a
 * decision nobody has taken. The caller's own agency is still required, so a
 * caller with no tenancy cannot read the catalogue.
 *
 * The screen asks for two rows and refuses ambiguity if it gets them, which is
 * its own identity check and is reproduced rather than replaced: the answer
 * carries what it found, and the screen decides.
 *
 * "Global" decides the TABLE's tenancy and not who may read it. The entity's
 * access block is `role === 'admin'` on read, create and update alike, and its
 * one consumer sits behind an `adminOnly` route, so the successor is an
 * `agency_admin` (D40) rather than any member of the agency. A `caller_
 * identified()` policy over a reference table would have answered a clinician.
 */
create function "pennsync_records".contract_compliance_rule_lookup(
  p_agency text, p_rule_code text, p_limit integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_rows jsonb;
begin
  perform "pennsync_records".screen_agency_admin_required(p_agency);
  if p_rule_code is null or pg_catalog.length(p_rule_code) = 0
    or pg_catalog.length(p_rule_code) > 200 then
    raise exception using errcode='22023', message='PENNSYNC_SCREEN_RULE_CODE_INVALID';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c."id", 'rule_name', c."rule_name", 'rule_code', c."rule_code",
      'rule_category', c."rule_category", 'description', c."description",
      'severity', c."severity", 'is_active', c."is_active",
      'effective_date', c."effective_date", 'created_date', c."created_date")
    order by c."created_date" desc nulls last, c."id"), '[]'::jsonb) into v_rows
  from (select r.* from "pennsync_records"."compliance_rule" r
    where r."source_app_id" = "pennsync_records".deployment_app()
      and r."rule_code" = p_rule_code
    order by r."created_date" desc nulls last, r."id"
    limit "pennsync_records".screen_limit(p_limit, 50)) c;
  return jsonb_build_object('success', true, 'entries', v_rows);
end $contract$;

/*
 * Recording that a material went to a patient.
 *
 * Three fields the original takes from the caller are taken from the store
 * instead, and each is a narrowing rather than a tidy-up:
 *
 *   * `patient_id` is the chart this contract just authorized, so a caller
 *     cannot file a send against a chart they cannot open.
 *   * `patient_name` is read from that chart. The original sends
 *     `first_name + ' ' + last_name` from a row the client already had, which
 *     is a second copy of a name the chart already holds and can disagree with
 *     it after a correction. The list above renders this column, so a stale
 *     one is visible and wrong.
 *   * `sent_date` is the server's clock. A client-supplied timestamp on an
 *     outbound-communication record is forgeable and the store has a clock.
 *
 * `patient_acknowledged` and `acknowledgment_date` are the PATIENT's answer,
 * not the sender's, and are refused by name rather than dropped.
 */
create function "pennsync_records".contract_sent_education_record(
  p_agency text, p_patient_id text, p_material jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_id text; v_name text; v_row "pennsync_records"."sent_education_material";
begin
  perform "pennsync_records".screen_chart(p_agency, p_patient_id);
  perform "pennsync_records".screen_exact_keys(p_material, array[
    'material_id', 'material_title', 'personalized_content', 'delivery_method', 'notes']);
  -- `patient_id` is the third of the entity's required fields and arrives as a
  -- parameter, already checked by `screen_chart`.
  perform "pennsync_records".screen_required_keys(p_material, array[
    'material_id', 'personalized_content']);
  select nullif(pg_catalog.btrim(pg_catalog.concat_ws(' ',
    p."first_name", p."last_name")), '') into v_name
  from "pennsync_records"."patient" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."id" = p_patient_id and p."agency_id" = p_agency;
  v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
  begin
    insert into "pennsync_records"."sent_education_material" (
      "source_app_id", "id", "created_date", "created_by", "material_id", "material_title",
      "patient_id", "patient_name", "personalized_content", "sent_by", "sent_date",
      "delivery_method", "notes", "patient_acknowledged")
    values (
      "pennsync_records".deployment_app(), v_id, clock_timestamp(),
      "pennsync_records".caller_email(),
      p_material->>'material_id', p_material->>'material_title',
      p_patient_id, v_name, p_material->>'personalized_content',
      "pennsync_records".caller_email(), clock_timestamp(),
      p_material->>'delivery_method', p_material->>'notes',
      -- The entity's declared default. The generated store emits none, so
      -- without this the row is null where Base44 wrote false.
      false)
    returning * into v_row;
  exception
    when check_violation or invalid_text_representation or invalid_datetime_format
      or datetime_field_overflow then
      raise exception using errcode='22023', message='PENNSYNC_SCREEN_FIELD_VALUE_INVALID';
  end;
  return jsonb_build_object('success', true, 'id', v_row."id",
    'patient_name', v_row."patient_name", 'sent_date', v_row."sent_date");
end $contract$;

/*
 * Pushing an OASIS analysis's recommendations onto a chart.
 *
 * **A defect this port nearly INTRODUCED, and the reading that caught it.**
 * The original writes no `status`, and a first draft of this contract left the
 * column null and recorded that as a defect live in the product, because
 * `PredictiveOutcomesAnalyzer.jsx` counts `status === 'pending'`. That reading
 * was wrong: the ENTITY declares `default: "pending"`, so Base44 fills it and
 * the count works. The null would have been this store's, not the product's --
 * the generated record store emits no column default anywhere, for any entity.
 * So `status` is stamped with the entity's own default and `priority` takes
 * its declared `medium`. Read the entity before calling a null a defect.
 *
 * `status`, `reviewed_by`, `reviewed_at`, `implemented_at` and
 * `implementation_notes` are the REVIEWER's fields and are refused by name.
 * `suggested_by_user` stays writable although the store cannot verify it: the
 * screen sends the literal `AI Assistant`, and dropping it would lose the only
 * mark distinguishing a generated recommendation from a clinician's.
 */
create function "pennsync_records".contract_patient_recommendation_record(
  p_agency text, p_patient_id text, p_recommendation jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_id text;
begin
  perform "pennsync_records".screen_chart(p_agency, p_patient_id);
  perform "pennsync_records".screen_exact_keys(p_recommendation, array[
    'source_type', 'source_id', 'recommendation_type', 'title', 'description',
    'priority', 'ai_rationale', 'expected_impact', 'implementation_steps',
    'suggested_by_user', 'expires_at']);
  -- `patient_id` is the fifth required field and is the contract's parameter.
  perform "pennsync_records".screen_required_keys(p_recommendation, array[
    'source_type', 'recommendation_type', 'title', 'description']);
  -- `suggested_by_user` NAMES A PERSON, and a column naming a person that a
  -- caller may set is an attribution a reader cannot check. The only call site
  -- sends the literal `AI Assistant`, so the value is refused exactly where
  -- forgery lives and nowhere else: an address that is not the caller's own.
  -- Anything that is not an address passes through as the screen sends it.
  if pg_catalog.strpos(coalesce(p_recommendation->>'suggested_by_user', ''), '@') > 0
    and p_recommendation->>'suggested_by_user'
      is distinct from "pennsync_records".caller_email() then
    raise exception using errcode='22023', message='PENNSYNC_SCREEN_FIELD_VALUE_INVALID';
  end if;
  v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
  begin
    insert into "pennsync_records"."patient_recommendation" (
      "source_app_id", "id", "created_date", "created_by", "patient_id",
      "source_type", "source_id", "recommendation_type", "title", "description",
      "priority", "ai_rationale", "expected_impact", "implementation_steps",
      "suggested_by_user", "expires_at", "status")
    values (
      "pennsync_records".deployment_app(), v_id, clock_timestamp(),
      "pennsync_records".caller_email(), p_patient_id,
      p_recommendation->>'source_type', p_recommendation->>'source_id',
      p_recommendation->>'recommendation_type', p_recommendation->>'title',
      p_recommendation->>'description',
      -- The entity's two declared defaults, which the generated store does not
      -- emit. `status` decides whether the analyser's screen can count this
      -- row at all, so a null here is a row the product cannot see.
      coalesce(p_recommendation->>'priority', 'medium'),
      p_recommendation->>'ai_rationale', p_recommendation->>'expected_impact',
      p_recommendation->'implementation_steps', p_recommendation->>'suggested_by_user',
      (p_recommendation->>'expires_at')::timestamptz, 'pending');
  exception
    when check_violation or invalid_text_representation or invalid_datetime_format
      or datetime_field_overflow then
      raise exception using errcode='22023', message='PENNSYNC_SCREEN_FIELD_VALUE_INVALID';
  end;
  return jsonb_build_object('success', true, 'id', v_id);
end $contract$;

/*
 * One preference row per person, enforced (D78).
 *
 * The screen reads `prefs[0]` from a filter and decides create-or-update from
 * whether it found one, which is `select … for update` locking nothing when the
 * row does not exist: two tabs saving at once both find none and both create,
 * and the reader then shows whichever `[0]` happens to be. The table claims no
 * uniqueness in its own schema, so this index is the contract's own key and the
 * save below catches it BY NAME. Partial over a non-null address, because a row
 * with no address belongs to nobody and is not a second copy of anyone's
 * preferences.
 */
create unique index "notification_preference_user_unique"
  on "pennsync_records"."notification_preference" ("source_app_id", "user_email")
  where "user_email" is not null;

/*
 * The caller's own notification preferences.
 *
 * D45's counter-case: `notification_read` is agency-WIDE and the notification
 * contract had to add its own ownership predicate, while
 * `notification_preference_read` is `user_email = caller_email()` under forced
 * RLS -- so here the policy IS the ownership check and this contract adds
 * none. Read the policy to tell which case you are in.
 *
 * An absent row is not an error: it means the defaults, which the screen
 * already holds. `found` says which, so the screen can tell "never saved" from
 * "saved the defaults".
 */
create function "pennsync_records".contract_notification_preference_get(
  p_agency text, p_user_email text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_row "pennsync_records"."notification_preference";
begin
  perform "pennsync_records".screen_agency_held(p_agency);
  -- The screen filters on its own address, so the address arrives on the wire
  -- and has to be answered rather than dropped. An address that is not the
  -- caller's is REFUSED, not answered with an empty list: an empty list is a
  -- claim about that person's preferences and a refusal is a claim about the
  -- caller. Absent means "mine", which is what the contract answers anyway.
  if p_user_email is not null
    and p_user_email is distinct from "pennsync_records".caller_email() then
    raise exception using errcode='42501', message='PENNSYNC_SCREEN_NOT_YOUR_ROWS';
  end if;
  select p.* into v_row from "pennsync_records"."notification_preference" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."user_email" = "pennsync_records".caller_email();
  if v_row."id" is null then
    return jsonb_build_object('success', true, 'found', false, 'preference', null);
  end if;
  return jsonb_build_object('success', true, 'found', true, 'preference', jsonb_build_object(
    'id', v_row."id", 'user_email', v_row."user_email",
    'email_notifications_enabled', v_row."email_notifications_enabled",
    'in_app_notifications_enabled', v_row."in_app_notifications_enabled",
    'push_notifications_enabled', v_row."push_notifications_enabled",
    'preferences', v_row."preferences", 'quiet_hours', v_row."quiet_hours",
    'digest_mode', v_row."digest_mode", 'sound_enabled', v_row."sound_enabled"));
end $contract$;

/*
 * Saving them, create-or-update in one statement.
 *
 * The screen's own branch on `preferences?.id` disappears: the address is the
 * caller's and the index above makes the row unique, so this is an upsert and
 * there is no second request to lose a race to. The `unique_violation` catch
 * is kept anyway and is caught BY NAME, because `on conflict` needs the index
 * to exist and a rename in a future migration should fail loudly here rather
 * than turn a correct save into a raw duplicate-key error the HTTP boundary
 * cannot classify.
 *
 * `user_email` is the caller's, never the payload's -- the one field a person
 * could use to rewrite somebody else's preferences, and the policy would refuse
 * it anyway, which is why the contract refuses it first and says so.
 *
 * `created_by` is the second half of the entity's own update rule and is
 * reproduced rather than dropped. The consequence is worth knowing and is not
 * a defect introduced here: a preference row written FOR somebody by anything
 * other than themselves can never be edited by them, in Base44 today and here.
 * Nothing in the tree writes one, and a narrowing that matches the original is
 * the right side to err on.
 */
create function "pennsync_records".contract_notification_preference_save(
  p_agency text, p_expected_id text, p_preference jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_email text; v_id text; v_held text;
begin
  perform "pennsync_records".screen_agency_held(p_agency);
  perform "pennsync_records".screen_exact_keys(p_preference, array[
    'email_notifications_enabled', 'in_app_notifications_enabled',
    'push_notifications_enabled', 'preferences', 'quiet_hours',
    'digest_mode', 'sound_enabled']);
  v_email := "pennsync_records".caller_email();
  if v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_SCREEN_CALLER_UNKNOWN';
  end if;
  -- The screen's update branch sends the id it is holding. Dropping it would
  -- turn "save THIS row" into "save whichever row is mine", which is right
  -- every time and unverifiable; naming a row that is not the caller's is
  -- refused rather than redirected onto theirs.
  if p_expected_id is not null then
    select p."id" into v_held from "pennsync_records"."notification_preference" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."id" = p_expected_id
      and p."user_email" = v_email;
    if v_held is null then
      raise exception using errcode='42501', message='PENNSYNC_SCREEN_NOT_YOUR_ROWS';
    end if;
  end if;
  begin
    insert into "pennsync_records"."notification_preference" (
      "source_app_id", "id", "created_date", "updated_date", "created_by", "user_email",
      "email_notifications_enabled", "in_app_notifications_enabled",
      "push_notifications_enabled", "preferences", "quiet_hours", "digest_mode",
      "sound_enabled")
    values (
      "pennsync_records".deployment_app(),
      pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24),
      clock_timestamp(), clock_timestamp(), v_email, v_email,
      -- Five of these seven declare a default on the entity and the generated
      -- store emits none, so an omitted key wrote null where Base44 wrote a
      -- value. `preferences` and `quiet_hours` declare none and stay null.
      coalesce((p_preference->>'email_notifications_enabled')::boolean, true),
      coalesce((p_preference->>'in_app_notifications_enabled')::boolean, true),
      coalesce((p_preference->>'push_notifications_enabled')::boolean, false),
      p_preference->'preferences', p_preference->'quiet_hours',
      coalesce(p_preference->>'digest_mode', 'instant'),
      coalesce((p_preference->>'sound_enabled')::boolean, true))
    -- Inferred rather than named: a PARTIAL unique index is an index and not a
    -- constraint, so `on conflict on constraint` cannot see it. The predicate
    -- has to be repeated here for the inference to match it.
    on conflict ("source_app_id", "user_email") where "user_email" is not null
    do update set
      "updated_date" = clock_timestamp(),
      "email_notifications_enabled" = excluded."email_notifications_enabled",
      "in_app_notifications_enabled" = excluded."in_app_notifications_enabled",
      "push_notifications_enabled" = excluded."push_notifications_enabled",
      "preferences" = excluded."preferences",
      "quiet_hours" = excluded."quiet_hours",
      "digest_mode" = excluded."digest_mode",
      "sound_enabled" = excluded."sound_enabled"
    -- The entity's UPDATE rule is `created_by` AND `user_email`, both the
    -- caller's; only its CREATE rule is the address alone. A row addressed to
    -- me that somebody else wrote is therefore not mine to change, and the
    -- guard rides on the same statement so there is no window between reading
    -- the owner and writing the row.
    where "notification_preference"."created_by" = v_email
    returning "id" into v_id;
  exception
    when unique_violation then
      raise exception using errcode='23505', message='PENNSYNC_SCREEN_PREFERENCE_CONFLICT';
    -- A caller's bad value is the caller's, not the store's. Left undeclared it
    -- reaches the HTTP boundary as a 503 CONTRACT_REFUSED, so a typo in a
    -- digest mode reads as a record-store outage.
    when check_violation or invalid_text_representation or invalid_datetime_format
      or datetime_field_overflow then
      raise exception using errcode='22023', message='PENNSYNC_SCREEN_FIELD_VALUE_INVALID';
  end;
  -- A `do update` whose WHERE fails returns nothing and changes nothing, which
  -- would answer a refused save with `success: true`. Refused by name instead.
  if v_id is null then
    raise exception using errcode='42501', message='PENNSYNC_SCREEN_PREFERENCE_NOT_OWNED';
  end if;
  return jsonb_build_object('success', true, 'id', v_id);
end $contract$;

reset role;

-- The helpers are the record owner's alone: they answer who the caller is and
-- which chart they may open, which is exactly what a caller must not be able to
-- ask on its own.
revoke all on function "pennsync_records".screen_agency_held(text),
  "pennsync_records".screen_agency_admin(text),
  "pennsync_records".screen_agency_admin_required(text),
  "pennsync_records".screen_chart(text,text),
  "pennsync_records".screen_limit(integer,integer),
  "pennsync_records".screen_exact_keys(jsonb,text[]),
  "pennsync_records".screen_required_keys(jsonb,text[])
  from public, anon, authenticated, service_role;

revoke all on function
  "pennsync_records".contract_clinical_event_list(text,text,integer),
  "pennsync_records".contract_ocr_feedback_list(text,boolean,integer),
  "pennsync_records".contract_ocr_training_list(text,integer),
  "pennsync_records".contract_sent_education_list(text,integer),
  "pennsync_records".contract_patient_recommendation_list(text,text,integer),
  "pennsync_records".contract_compliance_rule_lookup(text,text,integer),
  "pennsync_records".contract_sent_education_record(text,text,jsonb),
  "pennsync_records".contract_patient_recommendation_record(text,text,jsonb),
  "pennsync_records".contract_notification_preference_get(text,text),
  "pennsync_records".contract_notification_preference_save(text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_clinical_event_list(text,text,integer),
  "pennsync_records".contract_ocr_feedback_list(text,boolean,integer),
  "pennsync_records".contract_ocr_training_list(text,integer),
  "pennsync_records".contract_sent_education_list(text,integer),
  "pennsync_records".contract_patient_recommendation_list(text,text,integer),
  "pennsync_records".contract_compliance_rule_lookup(text,text,integer),
  "pennsync_records".contract_sent_education_record(text,text,jsonb),
  "pennsync_records".contract_patient_recommendation_record(text,text,jsonb),
  "pennsync_records".contract_notification_preference_get(text,text),
  "pennsync_records".contract_notification_preference_save(text,text,jsonb)
  to authenticated;

-- PostgREST resolves `/rest/v1/rpc/<name>` by the names of the body's keys, so
-- these signatures are pinned by `service-rpc-signatures.test.mjs` against the
-- request each capability's own code path builds.
create function "public"."pennsync_contract_clinical_event_list"(
  p_agency text, p_patient_id text, p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_clinical_event_list(p_agency, p_patient_id, p_limit)
$c$;
create function "public"."pennsync_contract_ocr_feedback_list"(
  p_agency text, p_applied_to_training boolean, p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_ocr_feedback_list(p_agency, p_applied_to_training, p_limit)
$c$;
create function "public"."pennsync_contract_ocr_training_list"(
  p_agency text, p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_ocr_training_list(p_agency, p_limit)
$c$;
create function "public"."pennsync_contract_sent_education_list"(
  p_agency text, p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_sent_education_list(p_agency, p_limit)
$c$;
create function "public"."pennsync_contract_patient_recommendation_list"(
  p_agency text, p_patient_id text, p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_patient_recommendation_list(p_agency, p_patient_id, p_limit)
$c$;
create function "public"."pennsync_contract_compliance_rule_lookup"(
  p_agency text, p_rule_code text, p_limit integer) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_compliance_rule_lookup(p_agency, p_rule_code, p_limit)
$c$;
create function "public"."pennsync_contract_sent_education_record"(
  p_agency text, p_patient_id text, p_material jsonb) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_sent_education_record(p_agency, p_patient_id, p_material)
$c$;
create function "public"."pennsync_contract_patient_recommendation_record"(
  p_agency text, p_patient_id text, p_recommendation jsonb) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_patient_recommendation_record(p_agency, p_patient_id, p_recommendation)
$c$;
create function "public"."pennsync_contract_notification_preference_get"(
  p_agency text, p_user_email text) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_notification_preference_get(p_agency, p_user_email)
$c$;
create function "public"."pennsync_contract_notification_preference_save"(
  p_agency text, p_expected_id text, p_preference jsonb) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_notification_preference_save(
    p_agency, p_expected_id, p_preference)
$c$;

revoke all on function
  "public"."pennsync_contract_clinical_event_list"(text,text,integer),
  "public"."pennsync_contract_ocr_feedback_list"(text,boolean,integer),
  "public"."pennsync_contract_ocr_training_list"(text,integer),
  "public"."pennsync_contract_sent_education_list"(text,integer),
  "public"."pennsync_contract_patient_recommendation_list"(text,text,integer),
  "public"."pennsync_contract_compliance_rule_lookup"(text,text,integer),
  "public"."pennsync_contract_sent_education_record"(text,text,jsonb),
  "public"."pennsync_contract_patient_recommendation_record"(text,text,jsonb),
  "public"."pennsync_contract_notification_preference_get"(text,text),
  "public"."pennsync_contract_notification_preference_save"(text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_clinical_event_list"(text,text,integer),
  "public"."pennsync_contract_ocr_feedback_list"(text,boolean,integer),
  "public"."pennsync_contract_ocr_training_list"(text,integer),
  "public"."pennsync_contract_sent_education_list"(text,integer),
  "public"."pennsync_contract_patient_recommendation_list"(text,text,integer),
  "public"."pennsync_contract_compliance_rule_lookup"(text,text,integer),
  "public"."pennsync_contract_sent_education_record"(text,text,jsonb),
  "public"."pennsync_contract_patient_recommendation_record"(text,text,jsonb),
  "public"."pennsync_contract_notification_preference_get"(text,text),
  "public"."pennsync_contract_notification_preference_save"(text,text,jsonb)
  to authenticated;

commit;
