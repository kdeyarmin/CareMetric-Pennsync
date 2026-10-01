-- An agency's fax retry policy: read it, and save it.
--
-- HAND WRITTEN, like every contract. A port under D40 — the original's gate is
-- `isAdminLike(currentUser)`, i.e. `user.role === 'admin'`, the built-in
-- platform tier D14 and D22 removed — so the successor is an `agency_admin`
-- SCOPED TO THEIR OWN AGENCY, and the panel's own screen is reached only from
-- the admin settings area.
--
-- D40's standing instruction is to re-read what the platform tier was
-- STRUCTURALLY preventing rather than only what it permitted. Here it was
-- preventing nothing an `agency_admin` can newly do: a retry policy is
-- operational configuration for the caller's own agency, there is no second
-- party to it (unlike D40's credential review, where the platform reviewer held
-- no credentials and an `agency_admin` does), and the policies answer the
-- tenancy. So this port adds no refusal of its own beyond the role gate.
--
-- THE DERIVED SCOPE IS DELETED (D41, D43), and this is the FOURTH original
-- whose own comment documents the bug one caused. `FaxRetryConfigPanel.jsx`
-- reads through `fetchCallerScopedConfig`, whose docstring says it "Writes the
-- caller's agency row (or the single legacy unscoped row) — never global newest
-- across tenants" — a rule it has to state because the lookup it guards is a
-- filter on `agency_name`, a SELF-EDITABLE label, with a fallback that lists
-- the five newest rows in the DEPLOYMENT when that filter matches nothing. The
-- panel then writes `agency_name` and never `agency_id`. Here the table is
-- agency-tenanted and the policy already answers "which row is mine", so the
-- `agency_name` filter, the legacy-row scan and the deployment-wide list all
-- have nothing left to do.
--
-- `agency_name` is still WRITTEN, because the column exists and a legacy row
-- carries it, and it is taken from the CARRIED agency row rather than from the
-- caller's profile — divergence 3 of D43's port, for its reason.
--
-- AND THE D78 KEY. The save is the point config's shape exactly: look for the
-- agency's row, update it, insert when there is none. `select … for update`
-- locks nothing when the row does not exist, so two sessions configuring
-- retries for the first time would both insert, and every reader takes one row
-- with a limit of 1 — which would make a fax worker's retry ceiling depend on
-- an `order by`. `fax_retry_config_active_agency_unique` is what serializes it;
-- the save catches that constraint BY NAME, re-raises anything else, and
-- retries ONCE onto the winner's row, because saving your own agency's policy
-- twice is a legitimate second request. The entity asked for this constraint in
-- prose and never got it: `agency_id` is described as "Immutable Agency id for
-- this retry policy. New server-owned policy writes must set it and reject
-- duplicates."
--
-- The schema's own bounds are enforced here rather than trusted from the
-- browser: `max_retries` 0–10, `retry_delay_minutes` 1–360. The panel clamps
-- them in JavaScript and the entity declares them, and neither is a check the
-- store was making. A value outside the range is CLAMPED rather than refused,
-- which is the original's behaviour (its inputs are bounded number fields, so
-- an out-of-range value never comes from the screen) and the safer of the two
-- for a worker reading the result — but the answer SAYS when it clamped, so a
-- caller sending 50 is not told it saved 50.
begin;

do $$
begin
  if to_regclass('pennsync_records.fax_retry_config') is null
    or to_regclass('pennsync_records.agency') is null
    or to_regprocedure('pennsync_records.caller_tenant_role(text)') is null then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_STORE_REQUIRED';
  end if;
  -- The D78 key is read rather than assumed: the save below catches it by name
  -- and would otherwise emulate a constraint that is not there.
  if to_regclass('pennsync_records.fax_retry_config_active_agency_unique') is null then
    raise exception using errcode='42501',message='PENNSYNC_RETRY_CONFIG_KEY_REQUIRED';
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
 * A number clamped into the schema's own range.
 *
 * Returns the default for anything that is not a number, which is the panel's
 * behaviour for an empty field. The schema's defaults are 3 and 15 and are
 * passed in rather than written here, so a default changed in the entity moves
 * one call site instead of hiding inside a helper.
 */
create function "pennsync_records".retry_bounded(
  p_value jsonb, p_default double precision, p_low double precision, p_high double precision)
  returns double precision language sql immutable set search_path = '' as $bounded$
  select case
    when p_value is null or jsonb_typeof(p_value) <> 'number' then p_default
    when (p_value #>> '{}')::double precision = 'NaN'::double precision then p_default
    else least(greatest((p_value #>> '{}')::double precision, p_low), p_high) end
$bounded$;

/*
 * The priority multipliers, as the object the entity declares.
 *
 * Four known keys and nothing else; an unknown one is DROPPED rather than
 * refused, which is the one place in this file that filters. The reason is
 * D54's rather than D39's: these four are read by a worker computing a delay,
 * the object is a nested blob with no schema enforcement behind it, and the
 * original stores whatever the panel's state held. Refusing would make a
 * harmless extra key break a save of the four that matter.
 */
create function "pennsync_records".retry_multipliers(p_value jsonb)
  returns jsonb language sql immutable set search_path = '' as $multipliers$
  select jsonb_build_object(
    'urgent', "pennsync_records".retry_bounded(p_value->'urgent', 0.5, 0.1, 10),
    'high', "pennsync_records".retry_bounded(p_value->'high', 1, 0.1, 10),
    'normal', "pennsync_records".retry_bounded(p_value->'normal', 1, 0.1, 10),
    'low', "pennsync_records".retry_bounded(p_value->'low', 2, 0.1, 10))
$multipliers$;

/* The projection, named column by column (D64). */
create function "pennsync_records".retry_config_row(
  p_row "pennsync_records"."fax_retry_config")
  returns jsonb language sql immutable set search_path = '' as $row$
  select jsonb_build_object(
    'id', p_row."id",
    'agency_id', p_row."agency_id",
    'agency_name', p_row."agency_name",
    'max_retries', p_row."max_retries",
    'retry_delay_minutes', p_row."retry_delay_minutes",
    'auto_retry_enabled', p_row."auto_retry_enabled",
    'priority_multiplier', p_row."priority_multiplier",
    'notify_on_final_failure', p_row."notify_on_final_failure",
    'is_active', p_row."is_active",
    'created_date', p_row."created_date",
    'updated_date', p_row."updated_date")
$row$;

/*
 * The read.
 *
 * Any MEMBER may read it, not only an `agency_admin`, and that is a widening
 * of the entity's `rls` read rule rather than of the capability — because the
 * capability has no read. `check:frontend-destination` lists no read SITE for
 * this entity at all: the panel reaches it through `fetchCallerScopedConfig`,
 * which takes the entity HANDLE out of a map (`src/lib/agencySettings.js:8`)
 * and calls `.filter` and `.list` on the alias, which the shared matcher does
 * not see. So the read is served on the strength of the code rather than of
 * the census, and the census's blind spot is reported rather than worked
 * around.
 *
 * Membership rather than `agency_admin` because a fax worker computing a delay
 * is not an administrator, and the row holds no PHI and names no person: it is
 * four numbers, two flags and the agency's own name. What stays administrative
 * is the SAVE.
 */
create function "pennsync_records".contract_fax_retry_config_read(p_agency text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_row "pennsync_records"."fax_retry_config";
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_RETRY_CONFIG_FORBIDDEN';
  end if;
  -- Active preferred, then newest, which is the original's
  -- `find(active !== false) || [0]` over its own filtered list.
  select * into v_row from "pennsync_records"."fax_retry_config" c
  where c."source_app_id" = "pennsync_records".deployment_app()
    and c."agency_id" = p_agency
  order by (c."is_active" is not false) desc, c."updated_date" desc nulls last, c."id"
  limit 1;
  -- An agency with no policy gets an explicit absence rather than the
  -- deployment's newest row, which is the whole of D43's bug in one line.
  if not found then
    return jsonb_build_object('success', true, 'config', null,
      'reason', 'retry_config_missing');
  end if;
  return jsonb_build_object('success', true,
    'config', "pennsync_records".retry_config_row(v_row));
end $contract$;

create function "pennsync_records".contract_fax_retry_config_save(
  p_agency text, p_config jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_row "pennsync_records"."fax_retry_config"; v_key text; v_now timestamptz;
  v_id text; v_email text; v_agency_name text; v_attempt integer; v_constraint text;
  v_clamped text[] := array[]::text[];
begin
  -- D40's gate. The original admits the built-in admin and nobody else.
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_RETRY_CONFIG_FORBIDDEN';
  end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_RETRY_CONFIG_INVALID';
  end if;
  -- D43's guard, for its reason: an accidental call with no body would reset a
  -- facility's retry policy to the schema's defaults.
  if p_config = '{}'::jsonb then
    raise exception using errcode='22023', message='PENNSYNC_RETRY_CONFIG_EMPTY';
  end if;
  for v_key in select k from jsonb_object_keys(p_config) k loop
    if v_key not in ('max_retries', 'retry_delay_minutes', 'auto_retry_enabled',
      'priority_multiplier', 'notify_on_final_failure', 'is_active') then
      raise exception using errcode='22023', message='PENNSYNC_RETRY_CONFIG_FIELD_UNSUPPORTED';
    end if;
  end loop;
  -- Said rather than hidden (D54's rule about a substitution count): a caller
  -- that sent 50 retries is told the stored value is 10.
  if jsonb_typeof(p_config->'max_retries') = 'number'
    and "pennsync_records".retry_bounded(p_config->'max_retries', 3, 0, 10)
      <> (p_config->>'max_retries')::double precision then
    v_clamped := pg_catalog.array_append(v_clamped, 'max_retries');
  end if;
  if jsonb_typeof(p_config->'retry_delay_minutes') = 'number'
    and "pennsync_records".retry_bounded(p_config->'retry_delay_minutes', 15, 1, 360)
      <> (p_config->>'retry_delay_minutes')::double precision then
    v_clamped := pg_catalog.array_append(v_clamped, 'retry_delay_minutes');
  end if;

  v_email := "pennsync_records".caller_email();
  v_now := clock_timestamp();
  -- The display name comes from the carried agency row, never from the
  -- caller's own profile (D43's divergence 3).
  select a."agency_name" into v_agency_name from "pennsync_records"."agency" a
  where a."source_app_id" = "pennsync_records".deployment_app() and a."id" = p_agency;

  -- ONE ATTEMPT AND ONE RETRY (D78). See the header: the lookup locks nothing
  -- when the row is absent, so the index is what serializes two first saves and
  -- the loser joins the winner's row rather than adding a second beside it.
  <<attempt>>
  for v_attempt in 1..2 loop
  begin
  select * into v_row from "pennsync_records"."fax_retry_config" c
  where c."source_app_id" = "pennsync_records".deployment_app()
    and c."agency_id" = p_agency
  order by (c."is_active" is not false) desc, c."updated_date" desc nulls last, c."id"
  limit 1
  for update;

  if found then
    update "pennsync_records"."fax_retry_config" c set
      "max_retries" = case when p_config ? 'max_retries'
        then "pennsync_records".retry_bounded(p_config->'max_retries', 3, 0, 10)::integer
        else c."max_retries" end,
      "retry_delay_minutes" = case when p_config ? 'retry_delay_minutes'
        then "pennsync_records".retry_bounded(p_config->'retry_delay_minutes', 15, 1, 360)
        else c."retry_delay_minutes" end,
      "auto_retry_enabled" = case when p_config ? 'auto_retry_enabled'
        then "pennsync_records".fax_flag(p_config->'auto_retry_enabled', c."auto_retry_enabled")
        else c."auto_retry_enabled" end,
      "priority_multiplier" = case when p_config ? 'priority_multiplier'
        then "pennsync_records".retry_multipliers(p_config->'priority_multiplier')
        else c."priority_multiplier" end,
      "notify_on_final_failure" = case when p_config ? 'notify_on_final_failure'
        then "pennsync_records".fax_flag(p_config->'notify_on_final_failure', c."notify_on_final_failure")
        else c."notify_on_final_failure" end,
      -- A save makes the row the agency's live policy, as the original's own
      -- update does. Deactivating one is not something the panel can ask for.
      "is_active" = true,
      "agency_name" = v_agency_name,
      "updated_date" = v_now
    where c."source_app_id" = v_row."source_app_id" and c."id" = v_row."id"
    returning * into v_row;
  else
    v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
    insert into "pennsync_records"."fax_retry_config"
      ("source_app_id", "id", "agency_id", "agency_name", "max_retries",
       "retry_delay_minutes", "auto_retry_enabled", "priority_multiplier",
       "notify_on_final_failure", "is_active", "created_by", "created_date", "updated_date")
    values ("pennsync_records".deployment_app(), v_id, p_agency, v_agency_name,
      "pennsync_records".retry_bounded(p_config->'max_retries', 3, 0, 10)::integer,
      "pennsync_records".retry_bounded(p_config->'retry_delay_minutes', 15, 1, 360),
      "pennsync_records".fax_flag(p_config->'auto_retry_enabled', true),
      "pennsync_records".retry_multipliers(p_config->'priority_multiplier'),
      "pennsync_records".fax_flag(p_config->'notify_on_final_failure', true),
      true, v_email, v_now, v_now)
    returning * into v_row;
  end if;
  exit attempt;
  exception when unique_violation then
    -- Read rather than assumed: any other unique violation is a different
    -- defect and is re-raised untouched.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'fax_retry_config_active_agency_unique' then
      raise;
    end if;
    if v_attempt = 2 then
      raise exception using errcode='22023', message='PENNSYNC_RETRY_CONFIG_CONFLICT';
    end if;
  end;
  end loop attempt;

  return jsonb_build_object('success', true,
    'config', "pennsync_records".retry_config_row(v_row),
    'clamped', to_jsonb(v_clamped));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".retry_bounded(jsonb,double precision,double precision,double precision),
  "pennsync_records".retry_multipliers(jsonb),
  "pennsync_records".retry_config_row("pennsync_records"."fax_retry_config"),
  "pennsync_records".contract_fax_retry_config_read(text),
  "pennsync_records".contract_fax_retry_config_save(text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_fax_retry_config_read(text),
  "pennsync_records".contract_fax_retry_config_save(text,jsonb)
  to authenticated;

create function "public"."pennsync_contract_fax_retry_config_read"(p_agency text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_fax_retry_config_read(p_agency)
$contract$;

create function "public"."pennsync_contract_fax_retry_config_save"(
  p_agency text, p_config jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_fax_retry_config_save(p_agency, p_config)
$contract$;

revoke all on function
  "public"."pennsync_contract_fax_retry_config_read"(text),
  "public"."pennsync_contract_fax_retry_config_save"(text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_fax_retry_config_read"(text),
  "public"."pennsync_contract_fax_retry_config_save"(text,jsonb)
  to authenticated;

commit;
