-- Two agency configuration rows: visit point values, and a payroll profile.
--
-- HAND WRITTEN, like every contract. Both are ports under D40 — their gate is
-- `user.role === 'admin'`, the built-in platform admin, so neither had a
-- performer left until the owner made an `agency_admin` its successor.
--
-- They share a file because they share a shape and a bug: each is a
-- **single-row-per-scope upsert whose scope the original reconstructs in
-- JavaScript**, and each carries scar tissue in its own comments from having
-- got that reconstruction wrong.
--
-- `saveVisitPointConfig` reads its agency from `user.agency_name`, lists up to
-- fifty rows matching that string, and — when none match — falls back to
-- scanning the fifty newest rows for an UNSCOPED legacy one. Its own comment
-- records the bug that fallback caused:
--
--     "The removed `length <= 1` arm also adopted a lone TENANT-scoped row, so
--      a platform admin (no agency) saving config silently overwrote that
--      agency's point math."
--
-- `savePayrollProfile` looks the target employee up by address in `User`, reads
-- THEIR `agency_name`, compares it to the caller's, then filters up to five
-- thousand profiles by address and — after creating one — re-reads them to
-- collapse duplicates it may just have made.
--
-- Here `visit_point_config` and `employee_payroll_profile` are both
-- agency-tenanted, so "the caller's row" is what the policy returns. The
-- legacy-row scan, the duplicate collapse and the `agency_name` comparison all
-- have nothing left to do. This is D41's finding again, and the third time an
-- original's own comments have documented a bug that a derived scope caused
-- and a policy cannot.
--
-- DIVERGENCES from the originals, each deliberate:
--
-- 1. The gate is `agency_admin` (D40). The `super_admin` and unscoped
--    platform-admin branches close with the tier — which also removes the
--    "no agency" caller that the legacy-row fallback existed to serve.
-- 2. A payroll profile's employee must be a colleague, proved through
--    membership rather than by reading the target's `agency_name`. The
--    original's check is a string comparison on a self-editable field.
-- 3. `agency_name` is still written on a visit point config because the column
--    exists and the app reads it, but it is taken from the CARRIED agency row
--    rather than from the caller's profile.
--
-- AND ONE CORRECTION TO THIS PORT, recorded because the shape recurs (D78).
-- The point-schedule save was written as a lookup with `for update` followed by
-- an insert when it found nothing, which reads like a lock and is not one when
-- the row does not exist — the trap D33 wrote down about `chart_assignment`.
-- An agency setting its schedule for the first time from two sessions ended up
-- with two active configs, and which one paid its nurses then depended on an
-- `order by`. `visit_point_config_active_agency_unique` is what holds it now:
-- the save catches that constraint BY NAME and retries onto the winner's row
-- rather than beside it, and `record-contract-postgres.test.mjs` proves it with
-- two real connections rather than asserting it. The index is PARTIAL over
-- active rows, so a deactivated schedule is still history this entity may keep.
begin;

do $$
begin
  if to_regclass('pennsync_records.visit_point_config') is null
    or to_regclass('pennsync_records.employee_payroll_profile') is null
    or to_regprocedure('pennsync_private.agency_colleague(text,text)') is null then
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
 * The originals' `toNonNegativeNumber`: anything that is not a finite number
 * at or above zero becomes zero rather than refusing the save.
 */
create function "pennsync_records".config_amount(p_value jsonb)
  returns double precision language sql immutable set search_path = '' as $amount$
  select case
    when p_value is null or jsonb_typeof(p_value) <> 'number' then 0::double precision
    when (p_value #>> '{}')::double precision < 0 then 0::double precision
    when (p_value #>> '{}')::double precision = 'NaN'::double precision then 0::double precision
    else (p_value #>> '{}')::double precision end
$amount$;

create function "pennsync_records".contract_visit_points_save(
  p_agency text, p_config jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_row "pennsync_records"."visit_point_config"; v_key text; v_now timestamptz;
  v_id text; v_email text; v_agency_name text; v_attempt integer; v_constraint text;
begin
  -- D40's gate. The originals admit the built-in admin and nobody else.
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_CONFIG_FORBIDDEN';
  end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_CONFIG_INVALID';
  end if;
  -- The original's own guard, and the reason it exists: "an accidental
  -- invocation with no body would overwrite the facility's point config with
  -- all zeros."
  if p_config = '{}'::jsonb then
    raise exception using errcode='22023', message='PENNSYNC_CONFIG_EMPTY';
  end if;
  for v_key in select k from jsonb_object_keys(p_config) k loop
    if v_key not in ('soc_points', 'roc_points', 'recert_points', 'routine_points',
      'discharge_points', 'notes') then
      raise exception using errcode='22023', message='PENNSYNC_CONFIG_FIELD_UNSUPPORTED';
    end if;
  end loop;

  v_email := "pennsync_records".caller_email();
  v_now := clock_timestamp();
  -- Divergence 3: the display name comes from the carried agency row, not
  -- from the caller's own profile.
  select a."agency_name" into v_agency_name from "pennsync_records"."agency" a
  where a."source_app_id" = "pennsync_records".deployment_app() and a."id" = p_agency;

  -- The caller's agency row is whatever the POLICY returns, so the legacy-row
  -- scan the original needs has nothing to scan. Active preferred, then
  -- newest, which is the original's `find(active !== false) || [0]`.
  --
  -- ONE ATTEMPT AND ONE RETRY, and the retry is not defensive padding (D78).
  -- `select … for update` **locks nothing when the row does not exist** — D33
  -- wrote that down about `chart_assignment` and this port walked into it
  -- anyway: an agency saving its point schedule for the first time from two
  -- sessions had both lookups find nothing and both inserts succeed, leaving
  -- two active schedules where every reader takes `limit 1`. Which one paid
  -- the nurses then depended on an `order by`.
  --
  -- `visit_point_config_active_agency_unique` is what actually serializes it,
  -- and this is where the loser joins the winner's row instead of adding a
  -- second one beside it: read committed takes a fresh snapshot per statement,
  -- so the second pass sees the committed winner and updates it with the values
  -- this caller sent. The whole find-or-create is inside the handler because
  -- either half can raise — the insert when the winner committed first, and the
  -- update when it flips a deactivated schedule back on while a concurrent
  -- insert is minting a new one.
  <<attempt>>
  for v_attempt in 1..2 loop
  begin
  select * into v_row from "pennsync_records"."visit_point_config" c
  where c."source_app_id" = "pennsync_records".deployment_app()
    and c."agency_id" = p_agency
  order by (c."active" is not false) desc, c."updated_date" desc nulls last, c."id"
  limit 1
  for update;

  if found then
    update "pennsync_records"."visit_point_config" c set
      "soc_points" = "pennsync_records".config_amount(p_config->'soc_points'),
      "roc_points" = "pennsync_records".config_amount(p_config->'roc_points'),
      "recert_points" = "pennsync_records".config_amount(p_config->'recert_points'),
      "routine_points" = "pennsync_records".config_amount(p_config->'routine_points'),
      "discharge_points" = "pennsync_records".config_amount(p_config->'discharge_points'),
      "active" = true,
      "notes" = pg_catalog.left(coalesce(p_config->>'notes', ''), 1000),
      "agency_name" = v_agency_name,
      "updated_date" = v_now
    where c."source_app_id" = v_row."source_app_id" and c."id" = v_row."id"
    returning * into v_row;
  else
    v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
    insert into "pennsync_records"."visit_point_config"
      ("source_app_id", "id", "agency_id", "agency_name", "soc_points", "roc_points",
       "recert_points", "routine_points", "discharge_points", "active", "notes",
       "created_by", "created_date", "updated_date")
    values ("pennsync_records".deployment_app(), v_id, p_agency, v_agency_name,
      "pennsync_records".config_amount(p_config->'soc_points'),
      "pennsync_records".config_amount(p_config->'roc_points'),
      "pennsync_records".config_amount(p_config->'recert_points'),
      "pennsync_records".config_amount(p_config->'routine_points'),
      "pennsync_records".config_amount(p_config->'discharge_points'),
      true, pg_catalog.left(coalesce(p_config->>'notes', ''), 1000),
      v_email, v_now, v_now)
    returning * into v_row;
  end if;
  exit attempt;
  exception when unique_violation then
    -- The constraint is read rather than assumed: any other unique violation is
    -- a different defect and is re-raised untouched.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'visit_point_config_active_agency_unique' then
      raise;
    end if;
    -- Twice means the row the retry was going to adopt was gone again by the
    -- time it looked, which no caller can act on. Say so in this contract's own
    -- vocabulary rather than letting a raw duplicate-key error cross the HTTP
    -- boundary, which cannot classify one.
    if v_attempt = 2 then
      raise exception using errcode='22023', message='PENNSYNC_CONFIG_CONFLICT';
    end if;
  end;
  end loop attempt;

  return jsonb_build_object('success', true, 'config', jsonb_build_object(
    'id', v_row."id", 'agency_id', v_row."agency_id", 'agency_name', v_row."agency_name",
    'soc_points', v_row."soc_points", 'roc_points', v_row."roc_points",
    'recert_points', v_row."recert_points", 'routine_points', v_row."routine_points",
    'discharge_points', v_row."discharge_points",
    'active', v_row."active", 'notes', v_row."notes"));
end $contract$;

create function "pennsync_records".contract_payroll_profile_save(
  p_agency text, p_employee_email text, p_profile jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_row "pennsync_records"."employee_payroll_profile"; v_key text; v_now timestamptz;
  v_id text; v_email text; v_colleague text; v_service text; v_earns boolean;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_CONFIG_FORBIDDEN';
  end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_CONFIG_INVALID';
  end if;
  for v_key in select k from jsonb_object_keys(p_profile) k loop
    if v_key not in ('employee_name', 'service_type', 'earns_points',
      'phone_reimbursement', 'active', 'notes') then
      raise exception using errcode='22023', message='PENNSYNC_CONFIG_FIELD_UNSUPPORTED';
    end if;
  end loop;
  v_email := pg_catalog.lower(pg_catalog.btrim(coalesce(p_employee_email, '')));
  if v_email = '' then
    raise exception using errcode='22023', message='PENNSYNC_CONFIG_EMPLOYEE_REQUIRED';
  end if;
  -- Divergence 2: a colleague proved through membership. The original looks
  -- the target up in `User` and compares THEIR `agency_name` string to the
  -- caller's — a self-editable field deciding who may be paid what.
  select c.expected_email into v_colleague
  from pennsync_private.agency_colleague(p_agency, v_email) c;
  if v_colleague is null then
    raise exception using errcode='42501', message='PENNSYNC_CONFIG_EMPLOYEE_UNKNOWN';
  end if;

  -- The originals' two derived values: hospice earns no points, and anything
  -- but an explicit `true` means it does not either.
  v_service := case when p_profile->>'service_type' = 'hospice' then 'hospice'
    else 'home_health' end;
  v_earns := v_service = 'home_health' and (p_profile->'earns_points') = 'true'::jsonb;
  v_now := clock_timestamp();

  select * into v_row from "pennsync_records"."employee_payroll_profile" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."agency_id" = p_agency
    and pg_catalog.lower(coalesce(p."employee_email", '')) = v_colleague
  order by p."created_date" nulls last, p."id"
  limit 1
  for update;

  if found then
    update "pennsync_records"."employee_payroll_profile" p set
      "employee_name" = p_profile->>'employee_name',
      "service_type" = v_service,
      "earns_points" = v_earns,
      "phone_reimbursement" = "pennsync_records".config_amount(p_profile->'phone_reimbursement'),
      "active" = (p_profile->'active') is distinct from 'false'::jsonb,
      "notes" = pg_catalog.left(coalesce(p_profile->>'notes', ''), 1000),
      "updated_date" = v_now
    where p."source_app_id" = v_row."source_app_id" and p."id" = v_row."id"
    returning * into v_row;
  else
    v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
    insert into "pennsync_records"."employee_payroll_profile"
      ("source_app_id", "id", "agency_id", "employee_email", "employee_name",
       "service_type", "earns_points", "phone_reimbursement", "active", "notes",
       "created_by", "created_date", "updated_date")
    values ("pennsync_records".deployment_app(), v_id, p_agency, v_colleague,
      p_profile->>'employee_name', v_service, v_earns,
      "pennsync_records".config_amount(p_profile->'phone_reimbursement'),
      (p_profile->'active') is distinct from 'false'::jsonb,
      pg_catalog.left(coalesce(p_profile->>'notes', ''), 1000),
      "pennsync_records".caller_email(), v_now, v_now)
    returning * into v_row;
  end if;

  return jsonb_build_object('success', true, 'profile', jsonb_build_object(
    'id', v_row."id", 'employee_email', v_row."employee_email",
    'employee_name', v_row."employee_name", 'service_type', v_row."service_type",
    'earns_points', v_row."earns_points",
    'phone_reimbursement', v_row."phone_reimbursement",
    'active', v_row."active", 'notes', v_row."notes"));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".config_amount(jsonb),
  "pennsync_records".contract_visit_points_save(text,jsonb),
  "pennsync_records".contract_payroll_profile_save(text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_visit_points_save(text,jsonb),
  "pennsync_records".contract_payroll_profile_save(text,text,jsonb)
  to authenticated;

create function "public"."pennsync_contract_visit_points_save"(
  p_agency text, p_config jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_visit_points_save(p_agency, p_config)
$contract$;

create function "public"."pennsync_contract_payroll_profile_save"(
  p_agency text, p_employee_email text, p_profile jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_payroll_profile_save(p_agency, p_employee_email, p_profile)
$contract$;

revoke all on function
  "public"."pennsync_contract_visit_points_save"(text,jsonb),
  "public"."pennsync_contract_payroll_profile_save"(text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_visit_points_save"(text,jsonb),
  "public"."pennsync_contract_payroll_profile_save"(text,text,jsonb)
  to authenticated;

commit;
