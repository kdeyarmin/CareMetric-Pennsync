-- Scheduling a visit: the second ported capability that creates a clinical row.
--
-- HAND WRITTEN, like the contracts beside it. The five fields a client may
-- supply are extracted from `createAuthorizedVisit`'s own `CLIENT_VISIT_FIELDS`
-- into `20260920070000_visit_purpose_policy.sql`.
--
-- **A visit is scheduling input and nothing else.** The original's comment
-- above that declaration says why: documentation, workflow status, handoff
-- history and review acknowledgement are server-owned and move only through
-- `updateAuthorizedVisit`'s transition-checked actions. So a create takes a
-- date, a type and three optional times, and everything else about the row is
-- this contract's.
--
-- What the contract decides rather than the caller:
--
-- - **The chart.** `patient_id` is a parameter, not a payload field, because
--   it is what the authorization is ABOUT. A payload naming it is refused
--   rather than ignored, along with `agency_id`, `client_request_id` and
--   `status` — the same rule the patient create follows.
-- - **Who may schedule against that chart.** Two checks, and they are
--   different questions. The role gate is the original's
--   `AGENCY_WIDE_VISIT_ROLES` plus `clinician`: a `social_worker` or
--   `spiritual_care` worker opens a chart and does not schedule on it. Then
--   D24 decides the chart itself, through the `patient` and `visit` policies
--   rather than through anything written here — an `agency_admin` or `manager`
--   reaches every chart in the agency and a `clinician` reaches the ones they
--   are assigned, which is exactly the original's `loadExactActiveAssignment`.
-- - **Lifecycle.** `status` is `scheduled`, `emr_handoff_status` is
--   `not_started`, the handoff history is empty and the review
--   acknowledgement is null. The original refuses any other status on a new
--   visit and so does this.
-- - **Provenance and tenancy.** Stamped from the caller helpers and from the
--   chart's own agency.
-- - **The identity.** Minted here and retried against the primary key rather
--   than checked beforehand: a `select` for a free id runs under the policies
--   and cannot see a row in another agency, so the key itself is the only
--   honest test of whether an id is taken.
--
-- DIVERGENCES from the original, each a narrowing, each deliberate:
--
-- 1. `platform_owner` is not a scheduling role; D14 and D22 removed the tier.
-- 2. A payload carrying `status: 'scheduled'` is refused where the original
--    accepted that one value. The field is the contract's either way, and
--    refusing it is how a caller learns that rather than believing it took
--    effect. Same rule, same reason, as the patient create.
-- 3. The original re-resolves the caller's authority four times around the
--    write and DELETES the visit it just created if anything changed. One
--    statement in one transaction has no such window, so there is nothing to
--    compensate and no delete path at all.
--
-- **A limitation kept rather than fixed, deliberately.** The original's
-- idempotency is a lookup on `(client_request_id, agency_id,
-- created_by_user_id)` followed by an insert, and two concurrent retries of
-- one offline queue item can both miss it. D30 closed exactly that race for
-- `createAuthorizedPatient` — but it closed it because the entity schema SAYS
-- `patient_creation_key` would be unique if the datastore allowed one. `Visit`
-- says no such thing about `client_request_id`; it calls it an "offline
-- idempotency key (queue id)" and stops there, and the uniqueness that would
-- matter is of a triple rather than of a column. Inventing that constraint
-- here would be the move D30 refused for `medical_record_number`. It is a
-- decision to take deliberately, with a migration of its own.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.visit_create_writable(text)') is null
    or to_regprocedure('pennsync_records.visit_create_reserved(text)') is null then
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

-- The original's own narrow projection of a created visit.
create function "pennsync_records".visit_created(p "pennsync_records"."visit") returns jsonb
  language sql stable set search_path = '' as $projection$
  select jsonb_build_object(
    'id', p."id",
    'patient_id', p."patient_id",
    'agency_id', p."agency_id",
    'created_by_user_id', p."created_by_user_id",
    'created_by_user_email_normalized', p."created_by_user_email_normalized",
    'visit_date', p."visit_date",
    'visit_time', nullif(coalesce(p."visit_time", ''), ''),
    'visit_type', p."visit_type",
    'status', coalesce(p."status", 'scheduled'),
    'client_request_id', nullif(coalesce(p."client_request_id", ''), ''))
$projection$;

create function "pennsync_records".contract_visit_create(
  p_agency text, p_patient_id text, p_client_request_id text, p_visit jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_role text; v_user text; v_email text; v_field text; v_date date;
  v_patient "pennsync_records"."patient"; v_existing "pennsync_records"."visit";
  v_row "pennsync_records"."visit"; v_count integer; v_attempt integer;
  v_constraint text; v_written boolean := false;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_VISIT_AGENCY_NOT_HELD';
  end if;
  -- The original's `AGENCY_WIDE_VISIT_ROLES` plus `clinician`, which is the
  -- whole of its `loadVisitCreateAccess` role branch. A social worker or
  -- spiritual care worker opens a chart and does not schedule on it — D24
  -- would let them reach the chart, so this gate is doing real work.
  if v_role not in ('agency_admin', 'manager', 'clinician') then
    raise exception using errcode='42501', message='PENNSYNC_VISIT_FORBIDDEN';
  end if;
  if p_patient_id is null or p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_PATIENT_INVALID';
  end if;
  -- Optional, unlike the patient create's: the original accepts a visit with
  -- no request id at all and simply does not dedupe it.
  if p_client_request_id is not null and p_client_request_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_REQUEST_ID_INVALID';
  end if;
  if p_visit is null or jsonb_typeof(p_visit) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_PAYLOAD_INVALID';
  end if;

  for v_field in select jsonb_object_keys(p_visit) loop
    if "pennsync_records".visit_create_reserved(v_field) then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_RESERVED';
    end if;
    if not "pennsync_records".visit_create_writable(v_field) then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_UNKNOWN';
    end if;
    if jsonb_typeof(p_visit->v_field) <> 'string' then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
    end if;
    if pg_catalog.length(p_visit->>v_field) > 200 then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
    end if;
  end loop;

  -- Both required by the original, and neither is a column default.
  if coalesce(p_visit->>'visit_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_DATE_INVALID';
  end if;
  begin
    v_date := (p_visit->>'visit_date')::date;
  exception when others then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_DATE_INVALID';
  end;
  -- `2026-02-30` matches the shape and is not a day.
  if pg_catalog.to_char(v_date, 'YYYY-MM-DD') <> p_visit->>'visit_date' then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_DATE_INVALID';
  end if;
  if coalesce(p_visit->>'visit_type', '') not in
    ('skilled_nursing', 'admission', 'recertification', 'discharge', 'routine_visit', 'prn') then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_TYPE_INVALID';
  end if;

  -- The chart, read under the same policies as every other read, so D24
  -- decides whether this caller reaches it. A chart they cannot open is
  -- indistinguishable from one that does not exist.
  select * into v_patient from "pennsync_records"."patient" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."id" = p_patient_id and p."agency_id" = p_agency;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_VISIT_PATIENT_NOT_VISIBLE';
  end if;
  -- `active`, not merely live: the original schedules against an active chart
  -- and against nothing else, so a hospitalized or discharged one is refused.
  if v_patient."status" is distinct from 'active'
    or v_patient."is_archived" is not false or v_patient."is_sample" is not false then
    raise exception using errcode='42501', message='PENNSYNC_VISIT_PATIENT_UNAVAILABLE';
  end if;

  v_user := "pennsync_records".caller_user_id();
  v_email := "pennsync_records".caller_email();
  if v_user is null or v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_VISIT_AGENCY_NOT_HELD';
  end if;

  -- The original's replay check, on its own triple: the request id, the
  -- agency, and the caller. Another caller's identical queue id is a different
  -- request and makes its own visit.
  if p_client_request_id is not null then
    select count(*) into v_count from "pennsync_records"."visit" v
    where v."source_app_id" = "pennsync_records".deployment_app()
      and v."agency_id" = p_agency and v."created_by_user_id" = v_user
      and v."client_request_id" = p_client_request_id;
    if v_count > 1 then
      raise exception using errcode='22023', message='PENNSYNC_VISIT_REQUEST_AMBIGUOUS';
    end if;
    if v_count = 1 then
      select * into v_existing from "pennsync_records"."visit" v
      where v."source_app_id" = "pennsync_records".deployment_app()
        and v."agency_id" = p_agency and v."created_by_user_id" = v_user
        and v."client_request_id" = p_client_request_id;
      -- Everything the original compares, which is every field it stamped.
      -- A visit whose handoff has since moved is no longer the same request,
      -- and answering it would tell the caller their queue item took effect
      -- as sent when it did not.
      if v_existing."patient_id" is distinct from p_patient_id
        or v_existing."visit_date" is distinct from v_date
        or v_existing."visit_type" is distinct from p_visit->>'visit_type'
        or v_existing."visit_time" is distinct from p_visit->>'visit_time'
        or v_existing."start_time" is distinct from p_visit->>'start_time'
        or v_existing."end_time" is distinct from p_visit->>'end_time'
        or v_existing."status" is distinct from 'scheduled'
        or v_existing."emr_handoff_status" is distinct from 'not_started'
        or v_existing."emr_handoff_history" is distinct from '[]'::jsonb
        or v_existing."documentation_review_ack" is not null then
        raise exception using errcode='22023', message='PENNSYNC_VISIT_REQUEST_CONFLICT';
      end if;
      return jsonb_build_object('created', false,
        'visit', "pennsync_records".visit_created(v_existing));
    end if;
  end if;

  begin
    v_row := jsonb_populate_record(null::"pennsync_records"."visit", p_visit);
  exception when others then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_FIELD_INVALID';
  end;
  v_row."source_app_id" := "pennsync_records".deployment_app();
  v_row."patient_id" := p_patient_id;
  v_row."agency_id" := p_agency;
  v_row."created_by_user_id" := v_user;
  v_row."created_by_user_email_normalized" := v_email;
  v_row."created_by" := v_email;
  v_row."client_request_id" := p_client_request_id;
  v_row."status" := 'scheduled';
  v_row."emr_handoff_status" := 'not_started';
  v_row."emr_handoff_history" := '[]'::jsonb;
  v_row."documentation_review_ack" := null;
  v_row."is_sample" := false;
  v_row."created_date" := clock_timestamp();
  v_row."updated_date" := v_row."created_date";

  -- Mint and insert, retrying on the primary key rather than looking for a
  -- free id first. A `select` for a free id runs under the policies and cannot
  -- see a row it is not entitled to, so it would report an id free that is
  -- taken; the key itself is the only honest test. Twenty-four hex characters
  -- is ninety-six bits, so a retry here is a formality rather than a plan.
  for v_attempt in 1..8 loop
    v_row."id" := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
    begin
      insert into "pennsync_records"."visit" select (v_row).*;
      v_written := true;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- Anything other than the identity is a different defect entirely.
      if v_constraint is distinct from 'visit_pkey' then raise; end if;
    end;
    exit when v_written;
  end loop;
  if not v_written then
    raise exception using errcode='53400', message='PENNSYNC_VISIT_IDENTITY_EXHAUSTED';
  end if;

  return jsonb_build_object('created', true,
    'visit', "pennsync_records".visit_created(v_row));
end $contract$;

reset role;

revoke all on function "pennsync_records".visit_created("pennsync_records"."visit"),
  "pennsync_records".contract_visit_create(text,text,text,jsonb)
  from public, anon, authenticated, service_role;

grant execute on function
  "pennsync_records".contract_visit_create(text,text,text,jsonb) to authenticated;

create function "public"."pennsync_contract_visit_create"(
  p_agency text, p_patient_id text, p_client_request_id text, p_visit jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_visit_create(
    p_agency, p_patient_id, p_client_request_id, p_visit)
$contract$;

revoke all on function "public"."pennsync_contract_visit_create"(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_visit_create"(text,text,text,jsonb) to authenticated;

commit;
