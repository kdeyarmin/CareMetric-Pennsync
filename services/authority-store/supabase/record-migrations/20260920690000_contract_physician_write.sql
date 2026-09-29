-- The referral-source directory's three writes, for the two screens that make
-- them.
--
-- `contract_physician_list` (D-reference-reads) already serves the directory's
-- READ. These are its writes: `PhysicianForm.jsx` creates and edits a provider,
-- and `PhysicianDirectory.jsx` deletes one and records a referral against one.
-- Four call sites, both screens reachable from the router.
--
-- THE GATE IS D40's, AND THE ORIGINAL HAD NO OTHER. `Physician`'s own schema
-- declares `create`, `update` and `delete` as `{user_condition: {role: admin}}`
-- -- the built-in platform tier D14 and D22 removed -- and nothing else. So
-- this is D40's standing case exactly: the successor is an `agency_admin`
-- SCOPED TO THEIR OWN AGENCY. `contract_provider_import` is the same entity
-- under the same rule and raises the same shape, so the gate here is copied
-- from it rather than reasoned out a second time.
--
-- Re-read what the platform tier was STRUCTURALLY preventing, which D40 asks
-- for: nothing, here. The import port had to add a self-approval refusal
-- because a platform owner holds no credentials and an `agency_admin` does. A
-- provider is not a person in this system -- it is a referral source with a fax
-- number -- so there is no relationship between the caller and the row that the
-- old tier was keeping apart. The widening is the whole change.
--
-- THE UPDATE IS TWO ACTIONS BECAUSE THE TWO CALL SITES ARE TWO STATEMENTS, and
-- naming them is what lets the second one be correct:
--
--   * `profile` is `PhysicianForm`'s save. Twenty fields, every one of them the
--     form's own state, and `referral_count`, `last_referral_date`, `id`,
--     `agency_id`, `created_by` and `created_date` are REFUSED BY NAME rather
--     than filtered. D39's rule: a silent filter is what keeps a caller away
--     from a field it must not set AND what loses a misspelled one without
--     telling anybody.
--
--   * `record_referral` is `PhysicianDirectory`'s increment. The original reads
--     a count into the browser, adds one and writes the sum back
--     (`referral_count: count + 1`), so two people recording a referral against
--     one provider in the same minute produce one increment. **The sum is
--     computed in SQL here and the caller sends no count at all.** That is
--     D58's deletion: a browser-side running total is a compensation for having
--     no transaction, and it is the one thing SQL can fix without changing
--     anything a user sees.
--
-- WHAT IS DELIBERATELY *NOT* FIXED, AND WHY. `last_referral_date` stays a
-- caller-supplied date. The original sends `toLocalISODate()` -- the operator's
-- LOCAL date -- and for anyone west of UTC that is not the server's date. Using
-- `current_date` here would read as tidier and would silently move a late-
-- evening referral to the next day on the report. Restoring what Base44 already
-- does is engineering; quietly doing something different is a change, so the
-- date is the caller's and the arithmetic is the store's.
--
-- THE DELETE IS A HARD DELETE, as the original is. `is_active` exists and the
-- directory's read already filters on it, so a soft delete was available and
-- was not what the screen does -- `Physician.delete(id)` removes the row and
-- the toast says "removed from directory". Substituting a deactivation would
-- leave a provider the operator believes is gone visible to anything reading
-- without that filter.
--
-- Tenancy is stamped from the envelope and re-checked in every predicate, never
-- taken from the request, and the agency is named in the predicate as well as
-- reached through the gate because `caller_agencies()` returns every agency the
-- caller holds (D51).
begin;

do $guard$
begin
  if to_regprocedure('pennsync_records.caller_tenant_role(text)') is null
    or to_regprocedure('pennsync_records.caller_email()') is null then
    raise exception 'PENNSYNC_PHYSICIAN_WRITE_REQUIRES_RECORD_STORE';
  end if;
end $guard$;

-- The fields a caller may set on a provider, in one place so the create and the
-- profile update cannot drift apart. It is a FUNCTION rather than a constant so
-- both contracts and both tests read the same list; a second copy is how a
-- field added to one path becomes silently unwritable on the other.
create function "pennsync_records".physician_writable_fields()
  returns text[] language sql immutable set search_path = '' as $helper$
  select array[
    'full_name','credentials','provider_type','specialty','subspecialty',
    'practice_name','company','top_unit','parent_unit','sub_unit',
    'office_address','office_city','office_state','office_zip',
    'phone_number','fax_number','email','npi_number','state_license',
    'accepts_home_health','accepts_hospice','preferred_contact_method',
    'office_hours','notes','tags','is_active']
$helper$;

-- The gate, once. Both write contracts call it and the failure is one code, so
-- a screen cannot tell a create refusal from an update refusal and learn
-- something about the directory from the difference.
create function "pennsync_records".physician_write_role(p_agency text)
  returns void language plpgsql stable security definer set search_path = '' as $helper$
begin
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_PHYSICIAN_WRITE_FORBIDDEN';
  end if;
end $helper$;

-- Every key the caller sent is checked against the allowlist and an unknown one
-- is REFUSED, never dropped (D39).
create function "pennsync_records".physician_check_fields(p_fields jsonb)
  returns void language plpgsql immutable set search_path = '' as $helper$
declare v_field text;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_PHYSICIAN_WRITE_INVALID';
  end if;
  for v_field in select k from jsonb_object_keys(p_fields) k loop
    if not (v_field = any("pennsync_records".physician_writable_fields())) then
      raise exception using errcode='22023',
        message='PENNSYNC_PHYSICIAN_FIELD_UNSUPPORTED';
    end if;
  end loop;
end $helper$;

-- CREATE. `full_name` and `fax_number` are the schema's own `required` pair and
-- are required here, as KEYS that are present and not null. They are NOT
-- required to be non-empty: the form validates only the name ("Provider name is
-- required") and submits `fax_number: ''` happily, so refusing an empty string
-- would break a save that works today. The import port refuses that same row
-- and is right to -- a CSV row with no fax is not a directory entry somebody
-- typed -- but this is a person at a keyboard who will see the row appear.
create function "pennsync_records".contract_physician_create(
  p_agency text, p_fields jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_id text; v_now timestamptz;
begin
  perform "pennsync_records".physician_write_role(p_agency);
  perform "pennsync_records".physician_check_fields(p_fields);
  if p_fields->>'full_name' is null or p_fields->>'fax_number' is null then
    raise exception using errcode='22023', message='PENNSYNC_PHYSICIAN_REQUIRED_MISSING';
  end if;

  v_now := clock_timestamp();
  v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
  insert into "pennsync_records"."physician" as p
    ("source_app_id","id","agency_id","created_by","created_date","updated_date",
     "full_name","credentials","provider_type","specialty","subspecialty",
     "practice_name","company","top_unit","parent_unit","sub_unit",
     "office_address","office_city","office_state","office_zip",
     "phone_number","fax_number","email","npi_number","state_license",
     "accepts_home_health","accepts_hospice","preferred_contact_method",
     "office_hours","notes","tags","is_active")
  values ("pennsync_records".deployment_app(), v_id, p_agency,
     "pennsync_records".caller_email(), v_now, v_now,
     p_fields->>'full_name', p_fields->>'credentials', p_fields->>'provider_type',
     p_fields->>'specialty', p_fields->>'subspecialty', p_fields->>'practice_name',
     p_fields->>'company', p_fields->>'top_unit', p_fields->>'parent_unit',
     p_fields->>'sub_unit', p_fields->>'office_address', p_fields->>'office_city',
     p_fields->>'office_state', p_fields->>'office_zip', p_fields->>'phone_number',
     p_fields->>'fax_number', p_fields->>'email', p_fields->>'npi_number',
     p_fields->>'state_license',
     coalesce((p_fields->>'accepts_home_health')::boolean, true),
     coalesce((p_fields->>'accepts_hospice')::boolean, false),
     coalesce(p_fields->>'preferred_contact_method', 'fax'),
     p_fields->>'office_hours', p_fields->>'notes', p_fields->'tags',
     coalesce((p_fields->>'is_active')::boolean, true));
  return jsonb_build_object('success', true, 'id', v_id);
end $contract$;

-- UPDATE. The SET list is built from the keys the caller SUPPLIED rather than
-- from a column list of its own, which is `contract_patient_update`'s rule: a
-- hand-kept list lets a field pass the allowlist and then silently not be
-- written. `p_action` decides which statement this is and an unknown one is
-- refused, so a third shape arriving upstream fails here instead of becoming a
-- silent no-op.
create function "pennsync_records".contract_physician_update(
  p_agency text, p_physician_id text, p_action text, p_fields jsonb,
  p_referral_date date)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_found boolean; v_count double precision;
begin
  perform "pennsync_records".physician_write_role(p_agency);
  if p_physician_id is null or p_physician_id = '' then
    raise exception using errcode='22023', message='PENNSYNC_PHYSICIAN_WRITE_INVALID';
  end if;
  if p_action is null or p_action not in ('profile', 'record_referral') then
    raise exception using errcode='22023', message='PENNSYNC_PHYSICIAN_ACTION_UNKNOWN';
  end if;

  if p_action = 'profile' then
    perform "pennsync_records".physician_check_fields(p_fields);
    if p_fields = '{}'::jsonb then
      raise exception using errcode='22023', message='PENNSYNC_PHYSICIAN_WRITE_EMPTY';
    end if;
    update "pennsync_records"."physician" p set
      "full_name" = case when p_fields ? 'full_name' then p_fields->>'full_name' else p."full_name" end,
      "credentials" = case when p_fields ? 'credentials' then p_fields->>'credentials' else p."credentials" end,
      "provider_type" = case when p_fields ? 'provider_type' then p_fields->>'provider_type' else p."provider_type" end,
      "specialty" = case when p_fields ? 'specialty' then p_fields->>'specialty' else p."specialty" end,
      "subspecialty" = case when p_fields ? 'subspecialty' then p_fields->>'subspecialty' else p."subspecialty" end,
      "practice_name" = case when p_fields ? 'practice_name' then p_fields->>'practice_name' else p."practice_name" end,
      "company" = case when p_fields ? 'company' then p_fields->>'company' else p."company" end,
      "top_unit" = case when p_fields ? 'top_unit' then p_fields->>'top_unit' else p."top_unit" end,
      "parent_unit" = case when p_fields ? 'parent_unit' then p_fields->>'parent_unit' else p."parent_unit" end,
      "sub_unit" = case when p_fields ? 'sub_unit' then p_fields->>'sub_unit' else p."sub_unit" end,
      "office_address" = case when p_fields ? 'office_address' then p_fields->>'office_address' else p."office_address" end,
      "office_city" = case when p_fields ? 'office_city' then p_fields->>'office_city' else p."office_city" end,
      "office_state" = case when p_fields ? 'office_state' then p_fields->>'office_state' else p."office_state" end,
      "office_zip" = case when p_fields ? 'office_zip' then p_fields->>'office_zip' else p."office_zip" end,
      "phone_number" = case when p_fields ? 'phone_number' then p_fields->>'phone_number' else p."phone_number" end,
      "fax_number" = case when p_fields ? 'fax_number' then p_fields->>'fax_number' else p."fax_number" end,
      "email" = case when p_fields ? 'email' then p_fields->>'email' else p."email" end,
      "npi_number" = case when p_fields ? 'npi_number' then p_fields->>'npi_number' else p."npi_number" end,
      "state_license" = case when p_fields ? 'state_license' then p_fields->>'state_license' else p."state_license" end,
      "accepts_home_health" = case when p_fields ? 'accepts_home_health' then (p_fields->>'accepts_home_health')::boolean else p."accepts_home_health" end,
      "accepts_hospice" = case when p_fields ? 'accepts_hospice' then (p_fields->>'accepts_hospice')::boolean else p."accepts_hospice" end,
      "preferred_contact_method" = case when p_fields ? 'preferred_contact_method' then p_fields->>'preferred_contact_method' else p."preferred_contact_method" end,
      "office_hours" = case when p_fields ? 'office_hours' then p_fields->>'office_hours' else p."office_hours" end,
      "notes" = case when p_fields ? 'notes' then p_fields->>'notes' else p."notes" end,
      "tags" = case when p_fields ? 'tags' then p_fields->'tags' else p."tags" end,
      "is_active" = case when p_fields ? 'is_active' then (p_fields->>'is_active')::boolean else p."is_active" end,
      "updated_date" = clock_timestamp()
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."id" = p_physician_id and p."agency_id" = p_agency
    returning true into v_found;
  else
    -- The increment, in SQL. The caller sends no count: `referral_count + 1` is
    -- read and written inside one statement, so two concurrent referrals are
    -- two increments rather than one. The date is the caller's, per the header.
    update "pennsync_records"."physician" p set
      "referral_count" = coalesce(p."referral_count", 0) + 1,
      "last_referral_date" = coalesce(p_referral_date, p."last_referral_date"),
      "updated_date" = clock_timestamp()
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."id" = p_physician_id and p."agency_id" = p_agency
    returning true, p."referral_count" into v_found, v_count;
  end if;

  if not coalesce(v_found, false) then
    raise exception using errcode='42501', message='PENNSYNC_PHYSICIAN_NOT_FOUND';
  end if;
  return jsonb_build_object('success', true, 'id', p_physician_id,
    'referral_count', v_count);
end $contract$;

-- DELETE. Hard, as the original is, and scoped twice.
create function "pennsync_records".contract_physician_delete(
  p_agency text, p_physician_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_found boolean;
begin
  perform "pennsync_records".physician_write_role(p_agency);
  if p_physician_id is null or p_physician_id = '' then
    raise exception using errcode='22023', message='PENNSYNC_PHYSICIAN_WRITE_INVALID';
  end if;
  delete from "pennsync_records"."physician" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."id" = p_physician_id and p."agency_id" = p_agency
    returning true into v_found;
  if not coalesce(v_found, false) then
    raise exception using errcode='42501', message='PENNSYNC_PHYSICIAN_NOT_FOUND';
  end if;
  return jsonb_build_object('success', true, 'deleted', true, 'id', p_physician_id);
end $contract$;

-- The record owner alone, then the public wrappers. A helper a policy never
-- asks is granted to nobody: `physician_writable_fields`, `physician_write_role`
-- and `physician_check_fields` are this file's own and stay unreachable.
revoke all on function "pennsync_records".physician_writable_fields() from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".physician_write_role(text) from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".physician_check_fields(jsonb) from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_physician_create(text,jsonb) from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_physician_update(text,text,text,jsonb,date) from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_physician_delete(text,text) from public, anon, authenticated, service_role;
grant execute on function "pennsync_records".contract_physician_create(text,jsonb) to authenticated;
grant execute on function "pennsync_records".contract_physician_update(text,text,text,jsonb,date) to authenticated;
grant execute on function "pennsync_records".contract_physician_delete(text,text) to authenticated;

-- PostgREST resolves `/rest/v1/rpc/<name>` by the names of the body's keys, so
-- these signatures are pinned by `service-rpc-signatures.test.mjs` against the
-- request each capability's own code path builds.
create function "public"."pennsync_contract_physician_create"(
  p_agency text, p_fields jsonb) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_physician_create(p_agency, p_fields)
$c$;

create function "public"."pennsync_contract_physician_update"(
  p_agency text, p_physician_id text, p_action text, p_fields jsonb,
  p_referral_date date) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_physician_update(
    p_agency, p_physician_id, p_action, p_fields, p_referral_date)
$c$;

create function "public"."pennsync_contract_physician_delete"(
  p_agency text, p_physician_id text) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_physician_delete(p_agency, p_physician_id)
$c$;

commit;
