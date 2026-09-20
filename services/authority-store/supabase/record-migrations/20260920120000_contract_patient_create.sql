-- Creating a patient, and the first ported capability that writes one (D28).
--
-- HAND WRITTEN, like the contracts beside it. The 43 fields a client may
-- supply are extracted from `createAuthorizedPatient`'s own
-- `CLIENT_PATIENT_FIELDS` into `20260920050000_patient_purpose_policy.sql`,
-- because a field added by hand would let a caller write a column the original
-- never let them near.
--
-- **It claims the chart and inserts it in one transaction.** That is the whole
-- reason `pennsync_private.claim_new_chart` exists: creating a chart and being
-- on its care team are writes to two ownership domains, and without the second
-- a clinician creates a patient they cannot then open. D28 first reasoned
-- about which ORDER to use if the two could not be atomic — grant first,
-- because an assignment naming a patient that does not exist is inert while a
-- chart its creator cannot open is not. They can be: the two domains are two
-- schemas in ONE database. So the ordering argument is the failure analysis
-- and atomicity is the design, and a caller never observes a half-made chart.
--
-- What the contract decides rather than the caller:
--
-- - **The identity.** Minted by the bridge, never taken from the payload. A
--   caller who could name it would name a chart that already exists.
-- - **Tenancy.** `agency_id` is the agency the caller was checked against, and
--   a payload naming one is refused rather than ignored — the same rule the
--   broker family follows.
-- - **Provenance.** `created_by_user_id`, `created_by_user_email_normalized`,
--   `created_by` and `patient_creation_key` are stamped from the caller
--   helpers. A capability cannot attribute a chart to somebody else.
-- - **Lifecycle.** `status` is `active`, `is_sample` and `is_archived` false.
--   The original refuses any other status on a new chart and so does this.
--
-- **Idempotency is the original's, and it is not a convenience.** A create is
-- keyed on `client_request_id`, and the key it stores is
-- `agency:user:client_request_id`, so a retry of the same request returns the
-- same chart rather than making a second one — and the same id from another
-- caller is a different key, so nobody can collide with somebody else's. A key
-- that exists but names a chart with different names is a conflict, not a
-- match, because answering the first chart would silently discard the second
-- request's data.
--
-- **And it is no longer best-effort.** The original's own words for
-- `patient_creation_key` are "Best-effort until Base44 exposes a datastore
-- uniqueness constraint", because a lookup followed by an insert is two
-- statements and a concurrent retry fits between them. The record store
-- carries that constraint now (`patient_patient_creation_key_unique`), so the
-- race ends in a unique violation this contract catches, unwinds and answers
-- with the chart the winner made — rather than in a second chart neither
-- caller knows about.
--
-- DIVERGENCES from the original, each a narrowing, each deliberate:
--
-- 1. `platform_owner` is not a creating role here; D14 and D22 removed the
--    platform tier. The other three the original admits are unchanged.
-- 2. The original re-resolves the caller's authority four times around the
--    write and deletes the row it just created if anything changed, because
--    Base44 gives it no transaction. One statement in one transaction has no
--    such window, so there is nothing to undo.
-- 3. The answer is `{created, patient}` where `patient` is the original's own
--    narrow projection. Its `scope` block is not returned, for the reason the
--    read contracts give: it existed to build a cursor echo and is the
--    caller's own membership record.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.patient_create_writable(text)') is null
    or to_regprocedure('pennsync_private.claim_new_chart(text)') is null then
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

-- The original's own narrow projection of a created chart, in one place
-- because both answers below return it.
create function "pennsync_records".patient_created(p "pennsync_records"."patient") returns jsonb
  language sql immutable set search_path = '' as $projection$
  select jsonb_build_object(
    'id', p."id",
    'agency_id', p."agency_id",
    'created_by_user_id', p."created_by_user_id",
    'created_by_user_email_normalized', p."created_by_user_email_normalized",
    'first_name', p."first_name",
    'middle_name', coalesce(p."middle_name", ''),
    'last_name', p."last_name",
    'medical_record_number', p."medical_record_number",
    'status', p."status",
    'care_type', coalesce(p."care_type", 'home_health'),
    'is_sample', p."is_sample" is true,
    'is_archived', p."is_archived" is true,
    'client_request_id', p."client_request_id")
$projection$;

-- The answer a key that already exists deserves, in one place because the
-- contract reaches it from two directions: the lookup before the insert, and
-- the unique violation when a concurrent request got there first.
--
-- A key that names a chart with different names is a CONFLICT rather than a
-- match: answering the first would silently discard this request's data.
create function "pennsync_records".patient_creation_answer(
  p "pennsync_records"."patient", p_first text, p_last text, p_user text) returns jsonb
  language plpgsql stable set search_path = '' as $answer$
begin
  if p."first_name" is distinct from p_first or p."last_name" is distinct from p_last
    or p."created_by_user_id" is distinct from p_user then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_REQUEST_CONFLICT';
  end if;
  return jsonb_build_object('created', false,
    'patient', "pennsync_records".patient_created(p));
end $answer$;

create function "pennsync_records".contract_patient_create(
  p_agency text, p_client_request_id text, p_patient jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_role text; v_user text; v_email text; v_key text; v_id text; v_field text;
  v_constraint text;
  v_row "pennsync_records"."patient"; v_existing "pennsync_records"."patient";
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_PATIENT_AGENCY_NOT_HELD';
  end if;
  -- The original's `PATIENT_CREATE_ROLES`. A social worker or spiritual care
  -- worker opens the charts they are assigned to and does not start one.
  if v_role not in ('agency_admin', 'manager', 'clinician') then
    raise exception using errcode='42501', message='PENNSYNC_PATIENT_FORBIDDEN';
  end if;
  if p_client_request_id is null or p_client_request_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_REQUEST_ID_INVALID';
  end if;
  if p_patient is null or jsonb_typeof(p_patient) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_PAYLOAD_INVALID';
  end if;

  -- Every key the caller sent is one the original lets a client supply, and
  -- none is one this contract decides. Refused rather than ignored: a caller
  -- who names `agency_id` believes it took effect.
  for v_field in select jsonb_object_keys(p_patient) loop
    if "pennsync_records".patient_create_reserved(v_field) then
      raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_RESERVED';
    end if;
    if not "pennsync_records".patient_create_writable(v_field) then
      raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_UNKNOWN';
    end if;
  end loop;
  if coalesce(p_patient->>'first_name', '') = '' or coalesce(p_patient->>'last_name', '') = '' then
    raise exception using errcode='22023', message='PENNSYNC_PATIENT_NAME_REQUIRED';
  end if;

  v_user := "pennsync_records".caller_user_id();
  v_email := "pennsync_records".caller_email();
  if v_user is null or v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_PATIENT_AGENCY_NOT_HELD';
  end if;
  -- The original's key, exactly: the agency and the user are in it, so one
  -- caller's request id can never collide with another's.
  v_key := p_agency || ':' || v_user || ':' || p_client_request_id;

  -- A retry answers the chart it already made. Read under the same policies as
  -- everything else, so a key belonging to a chart this caller can no longer
  -- open is not found — which is the honest answer, since they cannot be shown
  -- it either.
  select * into v_existing from "pennsync_records"."patient" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."patient_creation_key" = v_key;
  if found then
    return "pennsync_records".patient_creation_answer(v_existing,
      p_patient->>'first_name', p_patient->>'last_name', v_user);
  end if;

  -- Claim the chart, write the row, and hold BOTH inside one block so that a
  -- lost idempotency race rolls the claim back with the insert. `begin … end`
  -- is a savepoint in plpgsql, which is the whole reason the claim is inside
  -- it: unwinding to before the claim is what keeps a grant from being left
  -- behind pointing at a chart that was never written.
  begin
    v_id := pennsync_private.claim_new_chart(p_agency);

    -- The payload becomes a row by column name rather than by a list this
    -- contract would have to keep in step with the extracted one. Unknown keys
    -- cannot reach here — the loop above refused them — so nothing is silently
    -- dropped, and a value the column cannot hold raises rather than truncating.
    begin
      v_row := jsonb_populate_record(null::"pennsync_records"."patient", p_patient);
    exception when others then
      raise exception using errcode='22023', message='PENNSYNC_PATIENT_FIELD_INVALID';
    end;
    v_row."source_app_id" := "pennsync_records".deployment_app();
    v_row."id" := v_id;
    v_row."agency_id" := p_agency;
    v_row."created_by_user_id" := v_user;
    v_row."created_by_user_email_normalized" := v_email;
    v_row."created_by" := v_email;
    v_row."client_request_id" := p_client_request_id;
    v_row."patient_creation_key" := v_key;
    v_row."status" := 'active';
    v_row."is_sample" := false;
    v_row."is_archived" := false;
    v_row."created_date" := clock_timestamp();
    v_row."updated_date" := v_row."created_date";

    insert into "pennsync_records"."patient" select (v_row).*;
  exception when unique_violation then
    -- The lookup above found nothing and the insert found a duplicate, so a
    -- concurrent request carrying the SAME key committed in between. Without
    -- the index this contract would have made a second chart for one request
    -- and neither caller would know — which is precisely what the entity
    -- schema means by "best-effort until Base44 exposes a datastore uniqueness
    -- constraint". We own the datastore, so it is not best-effort here.
    --
    -- The constraint is read rather than assumed: any other unique violation
    -- is a different defect and is re-raised untouched.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'patient_patient_creation_key_unique' then raise; end if;
    select * into v_existing from "pennsync_records"."patient" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."patient_creation_key" = v_key;
    -- Read committed takes a fresh snapshot per statement, so the winner's row
    -- is visible here. If it is not, the caller cannot be shown the chart its
    -- own request made, and answering anything else would be a guess.
    if not found then
      raise exception using errcode='22023', message='PENNSYNC_PATIENT_REQUEST_CONFLICT';
    end if;
    return "pennsync_records".patient_creation_answer(v_existing,
      p_patient->>'first_name', p_patient->>'last_name', v_user);
  end;
  return jsonb_build_object('created', true,
    'patient', "pennsync_records".patient_created(v_row));
end $contract$;

reset role;

revoke all on function "pennsync_records".patient_created("pennsync_records"."patient"),
  "pennsync_records".patient_creation_answer("pennsync_records"."patient",text,text,text),
  "pennsync_records".contract_patient_create(text,text,jsonb)
  from public, anon, authenticated, service_role;

grant execute on function "pennsync_records".contract_patient_create(text,text,jsonb) to authenticated;

create function "public"."pennsync_contract_patient_create"(
  p_agency text, p_client_request_id text, p_patient jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_patient_create(p_agency, p_client_request_id, p_patient)
$contract$;

revoke all on function "public"."pennsync_contract_patient_create"(text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_patient_create"(text,text,jsonb) to authenticated;

commit;
