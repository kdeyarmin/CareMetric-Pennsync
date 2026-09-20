-- Storing the regulations a CMS sync found.
--
-- HAND WRITTEN, like every contract. The record half of `syncCMSRegulations`;
-- its model half is `Core.InvokeLLM` with `add_context_from_internet`, which is
-- brokered, and the handler sequences the two the way D53 settled.
--
-- **Everything a model returns is checked against the column's own constraint
-- before it is stored.** `regulatory_update` constrains `source`, `category`,
-- `impact_level` and `status`, and a model asked for free text will sooner or
-- later answer outside any of them. The original writes them straight through
-- with `reg.category || 'documentation'` and `reg.impact_level || 'medium'`, so
-- a plausible-but-unlisted answer raises a raw check violation and the row is
-- lost inside a `catch` that only logs. Here an unrecognised value falls back to
-- the same default the original uses for an ABSENT one, and the answer reports
-- how many were adjusted — so a sync that quietly stored nothing is visible
-- rather than a silent zero.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. The gate is `agency_admin` (D40); `isAdminLike` is the tier D14 and D22
--    removed.
-- 2. The rows are this agency's. `RegulatoryUpdate` is `agency`-kinded because
--    *"Its only tenancy signal is reviewed_by, which records who acted rather
--    than whose row it is"*, so a sync stores into the agency that ran it.
-- 3. One transaction for the whole batch. The original creates each row in its
--    own call inside a `try/catch` that logs and continues, so a sync can
--    half-succeed and report a count nobody can reconcile.
--
-- ONE DIVERGENCE DELIBERATELY NOT MADE. The original stores a new row per
-- regulation on every sync, and `RegulatoryUpdate` claims no uniqueness in its
-- own schema, so running it twice stores everything twice. That is the
-- original's behaviour and it is kept: deciding what makes two regulations the
-- same row — title, CMS reference, effective date — is an entity decision, and
-- D30 is where a uniqueness claim belongs.
begin;

do $$
begin
  if to_regclass('pennsync_records.regulatory_update') is null then
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
 * A value the column will accept, or the original's default for an absent one.
 *
 * The point is that these ARE the same case. A model that answers
 * "high-impact" where the enum says "high" has not given an answer the store
 * can hold, and treating it as absent is the only reading that neither loses
 * the regulation nor writes something the constraint refuses.
 */
create function "pennsync_records".regulation_enum(
  p_value text, p_allowed text[], p_default text)
  returns text language sql immutable set search_path = '' as $e$
  select case when pg_catalog.lower(pg_catalog.btrim(coalesce(p_value, '')))
    = any(p_allowed) then pg_catalog.lower(pg_catalog.btrim(p_value))
    else p_default end
$e$;

create function "pennsync_records".contract_regulatory_update_store(
  p_agency text, p_regulations jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_reg jsonb; v_now timestamptz; v_id text; v_stored integer := 0;
  v_adjusted integer := 0; v_rows jsonb := '[]'::jsonb;
  v_source text; v_category text; v_impact text; v_title text; v_date date;
begin
  -- Divergence 1. The original admits the whole admin-like tier.
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_REGULATION_FORBIDDEN';
  end if;
  if p_regulations is null or jsonb_typeof(p_regulations) <> 'array' then
    raise exception using errcode='22023', message='PENNSYNC_REGULATION_INVALID';
  end if;
  if jsonb_array_length(p_regulations) > 200 then
    raise exception using errcode='22023', message='PENNSYNC_REGULATION_TOO_MANY';
  end if;
  v_now := clock_timestamp();

  for v_reg in select value from jsonb_array_elements(p_regulations) loop
    if jsonb_typeof(v_reg) <> 'object' then
      raise exception using errcode='22023', message='PENNSYNC_REGULATION_INVALID';
    end if;
    v_title := pg_catalog.btrim(coalesce(v_reg->>'title', ''));
    -- A regulation with no title is not a regulation; the original would store
    -- a row with a null one.
    if v_title = '' then continue; end if;

    -- The original's own source rule, kept: a CMS reference naming Medicare is
    -- a Medicare row, everything else is CMS.
    v_source := case when pg_catalog.strpos(coalesce(v_reg->>'cms_reference', ''), 'Medicare') > 0
      then 'Medicare' else 'CMS' end;
    v_category := "pennsync_records".regulation_enum(v_reg->>'category',
      array['documentation', 'oasis', 'safety', 'billing', 'quality',
        'infection_control', 'patient_rights', 'hipaa', 'staffing'], 'documentation');
    v_impact := "pennsync_records".regulation_enum(v_reg->>'impact_level',
      array['critical', 'high', 'medium', 'low'], 'medium');
    if (v_reg ? 'category' and v_category is distinct from
        pg_catalog.lower(pg_catalog.btrim(coalesce(v_reg->>'category', ''))))
      or (v_reg ? 'impact_level' and v_impact is distinct from
        pg_catalog.lower(pg_catalog.btrim(coalesce(v_reg->>'impact_level', '')))) then
      v_adjusted := v_adjusted + 1;
    end if;
    -- An effective date the store cannot hold becomes today, which is what the
    -- original does for an absent one.
    v_date := coalesce("pennsync_records".time_off_date(v_reg->>'effective_date'),
      "pennsync_records".agency_today());

    v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
    insert into "pennsync_records"."regulatory_update"
      ("source_app_id", "id", "agency_id", "title", "source", "category",
       "effective_date", "summary", "full_details", "impact_level",
       "affected_areas", "required_actions", "status", "reference_url",
       "reviewed_by", "reviewed_at", "created_by", "created_date", "updated_date")
    values ("pennsync_records".deployment_app(), v_id, p_agency,
      pg_catalog.left(v_title, 2000), v_source, v_category, v_date,
      pg_catalog.left(coalesce(v_reg->>'summary', ''), 20000),
      -- The original's composed detail block, shape for shape.
      pg_catalog.left(coalesce(v_reg->>'summary', '')
        || E'\n\nRequired Actions:\n'
        || coalesce(nullif((select string_agg(value #>> '{}', E'\n- ')
            from jsonb_array_elements(case when jsonb_typeof(v_reg->'required_actions') = 'array'
              then v_reg->'required_actions' else '[]'::jsonb end)), ''), 'None specified')
        || E'\n\nDocumentation Requirements:\n'
        || coalesce(nullif((select string_agg(value #>> '{}', E'\n- ')
            from jsonb_array_elements(case when jsonb_typeof(v_reg->'documentation_requirements') = 'array'
              then v_reg->'documentation_requirements' else '[]'::jsonb end)), ''), 'None specified'),
        40000),
      v_impact, jsonb_build_array(v_category),
      case when jsonb_typeof(v_reg->'required_actions') = 'array'
        then v_reg->'required_actions' else '[]'::jsonb end,
      'pending_review', nullif(v_reg->>'source_url', ''),
      null, null,
      "pennsync_records".caller_email(), v_now, v_now);
    v_stored := v_stored + 1;
    v_rows := v_rows || jsonb_build_object('id', v_id, 'title', v_title,
      'source', v_source, 'category', v_category, 'impact_level', v_impact,
      'effective_date', v_date, 'status', 'pending_review');
  end loop;

  return jsonb_build_object('success', true,
    'regulations_found', jsonb_array_length(p_regulations),
    'regulations_stored', v_stored,
    'regulations_adjusted', v_adjusted,
    'regulations', v_rows);
end $contract$;

reset role;

revoke all on function
  "pennsync_records".regulation_enum(text,text[],text),
  "pennsync_records".contract_regulatory_update_store(text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_regulatory_update_store(text,jsonb) to authenticated;

create function "public"."pennsync_contract_regulatory_update_store"(
  p_agency text, p_regulations jsonb) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_regulatory_update_store(p_agency, p_regulations)
$c$;
revoke all on function "public"."pennsync_contract_regulatory_update_store"(text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_regulatory_update_store"(text,jsonb)
  to authenticated;

commit;
