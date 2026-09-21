-- Importing a provider directory.
--
-- HAND WRITTEN, like every contract. The CSV is parsed in
-- `services/pennsync-api/provider-import.mjs` — text shaping is not
-- authorization and SQL is the wrong place for a character-by-character
-- parser — and everything the STORE decides is here: who may import, which
-- rows are the same provider, and whether a row is a create or an update.
--
-- **This is the second port under D40 to find the widening already half made.**
-- The original's gate is
--
--     const isAdminUser = (user) => user?.role === 'admin'
--       || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';
--
-- Three tiers, of which the built-in `admin` is the one D40 replaces with an
-- `agency_admin` scoped to their own agency, `account_type === 'agency_admin'`
-- is the self-editable label D23 says decides nothing, and `super_admin` is the
-- platform tier D14 and D22 removed. All three collapse onto the one question
-- membership can answer.
--
-- **And the scan D41 and D43 keep deleting is here too, WRITING this time.**
-- The original builds its duplicate map from
-- `Physician.list('-updated_date', 5000)` — every provider in the DEPLOYMENT —
-- and then UPDATES whatever it matched. `Physician` is agency-tenanted (D15),
-- so one agency's import could rewrite another agency's directory entry, and
-- past five thousand providers it would silently create duplicates instead.
-- The policy answers both: the match runs inside `caller_agencies()` and has
-- no page.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. `agency_admin`, scoped to their own agency (D40).
-- 2. The duplicate match is this agency's directory, with no row limit. The
--    5000 was there to survive a paged client, which is the third time a
--    limit has turned out to be the artefact rather than the rule (D49, D50).
-- 3. The whole import is ONE transaction. The original creates and updates in
--    chunks of three with a 150 ms pause between them, so a failure halfway
--    leaves a partly-imported directory and a count nobody can reconcile.
-- 4. A create stamps `agency_id` from the envelope, and a payload naming one
--    is refused rather than ignored.
--
-- NOT DIVERGED. The match order is NPI first and then name-plus-fax, the
-- within-batch key is the same, a row with no name or no fax is skipped rather
-- than refused, and an update writes the same field set a create does —
-- including `notes`, which the original overwrites with 'Imported from
-- provider CSV' on every import.
begin;

do $$
begin
  if to_regclass('pennsync_records.physician') is null
    or to_regprocedure('pennsync_records.caller_tenant_role(text)') is null then
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
 * The fields an import may write, by NAME rather than from a fence, because
 * the original does not fence them either. `agency_id`, `id`, `created_by` and
 * the referral counters are the contract's and are refused to a caller — the
 * same discipline `WRITE_POLICIES` applies to the generated write contracts.
 */
create function "pennsync_records".provider_import_fields()
  returns text[] language sql immutable set search_path = '' as $fields$
  select array['full_name','credentials','provider_type','specialty','practice_name',
    'company','top_unit','parent_unit','sub_unit','phone_number','fax_number',
    'npi_number','state_license']
$fields$;

create function "pennsync_records".contract_provider_import(
  p_agency text, p_rows jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_now timestamptz; v_email text; v_row jsonb; v_key text; v_existing text;
  v_name text; v_fax text; v_npi text; v_seen text[] := '{}';
  v_created integer := 0; v_updated integer := 0; v_id text; v_field text;
begin
  -- Divergence 1: the one question membership can answer.
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_PROVIDER_IMPORT_FORBIDDEN';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode='22023', message='PENNSYNC_PROVIDER_IMPORT_INVALID';
  end if;

  v_now := clock_timestamp();
  v_email := "pennsync_records".caller_email();

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception using errcode='22023', message='PENNSYNC_PROVIDER_IMPORT_INVALID';
    end if;
    -- Divergence 4: a field the contract decides is refused, never dropped.
    for v_field in select k from jsonb_object_keys(v_row) k loop
      if not (v_field = any("pennsync_records".provider_import_fields())) then
        raise exception using errcode='22023',
          message='PENNSYNC_PROVIDER_IMPORT_FIELD_UNSUPPORTED';
      end if;
    end loop;
    v_name := coalesce(v_row->>'full_name', '');
    v_fax := coalesce(v_row->>'fax_number', '');
    v_npi := coalesce(v_row->>'npi_number', '');
    -- The original's own skip, kept: a provider with no name or no fax is not
    -- a directory entry. The service counts these; nothing is written here.
    if v_name = '' or v_fax = '' then continue; end if;

    v_key := case when v_npi <> '' then v_npi
      else pg_catalog.lower(v_name) || '|' || v_fax end;
    if v_key = any(v_seen) then continue; end if;
    v_seen := v_seen || v_key;

    -- Divergence 2: this agency's directory, and all of it. NPI first, then
    -- name and fax, as the original resolves it.
    select p."id" into v_existing from "pennsync_records"."physician" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."agency_id" = p_agency and v_npi <> ''
      and coalesce(pg_catalog.btrim(p."npi_number"), '') = v_npi
    order by p."updated_date" desc nulls last, p."id" limit 1;
    if v_existing is null then
      select p."id" into v_existing from "pennsync_records"."physician" p
      where p."source_app_id" = "pennsync_records".deployment_app()
        and p."agency_id" = p_agency
        and pg_catalog.lower(coalesce(pg_catalog.btrim(p."full_name"), '')) = pg_catalog.lower(v_name)
        and pg_catalog.regexp_replace(coalesce(p."fax_number", ''), '[^0-9]', '', 'g') = v_fax
        and coalesce(pg_catalog.btrim(p."full_name"), '') <> ''
      order by p."updated_date" desc nulls last, p."id" limit 1;
    end if;

    if v_existing is not null then
      update "pennsync_records"."physician" p set
        "full_name" = v_name,
        "credentials" = coalesce(v_row->>'credentials', ''),
        "provider_type" = coalesce(v_row->>'credentials', ''),
        "specialty" = coalesce(v_row->>'specialty', ''),
        "practice_name" = coalesce(v_row->>'practice_name', ''),
        "company" = coalesce(v_row->>'company', ''),
        "top_unit" = coalesce(v_row->>'top_unit', ''),
        "parent_unit" = coalesce(v_row->>'parent_unit', ''),
        "sub_unit" = coalesce(v_row->>'sub_unit', ''),
        "phone_number" = coalesce(v_row->>'phone_number', ''),
        "fax_number" = v_fax, "npi_number" = v_npi,
        "state_license" = coalesce(v_row->>'state_license', ''),
        "preferred_contact_method" = 'fax', "is_active" = true,
        "accepts_home_health" = true, "notes" = 'Imported from provider CSV',
        "updated_date" = v_now
      where p."source_app_id" = "pennsync_records".deployment_app()
        and p."id" = v_existing and p."agency_id" = p_agency;
      v_updated := v_updated + 1;
    else
      v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
      insert into "pennsync_records"."physician"
        ("source_app_id","id","agency_id","full_name","credentials","provider_type",
         "specialty","practice_name","company","top_unit","parent_unit","sub_unit",
         "phone_number","fax_number","npi_number","state_license",
         "preferred_contact_method","is_active","accepts_home_health","notes",
         "created_by","created_date","updated_date")
      values ("pennsync_records".deployment_app(), v_id, p_agency, v_name,
        coalesce(v_row->>'credentials', ''), coalesce(v_row->>'credentials', ''),
        coalesce(v_row->>'specialty', ''), coalesce(v_row->>'practice_name', ''),
        coalesce(v_row->>'company', ''), coalesce(v_row->>'top_unit', ''),
        coalesce(v_row->>'parent_unit', ''), coalesce(v_row->>'sub_unit', ''),
        coalesce(v_row->>'phone_number', ''), v_fax, v_npi,
        coalesce(v_row->>'state_license', ''), 'fax', true, true,
        'Imported from provider CSV', v_email, v_now, v_now);
      v_created := v_created + 1;
    end if;
  end loop;

  return jsonb_build_object('success', true,
    'created_providers', v_created, 'updated_providers', v_updated);
end $contract$;

reset role;

revoke all on function "pennsync_records".provider_import_fields()
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_provider_import(text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "pennsync_records".contract_provider_import(text,jsonb)
  to authenticated;

create function "public"."pennsync_contract_provider_import"(
  p_agency text, p_rows jsonb) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_provider_import(p_agency, p_rows)
$c$;
revoke all on function "public"."pennsync_contract_provider_import"(text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_provider_import"(text,jsonb)
  to authenticated;

commit;
