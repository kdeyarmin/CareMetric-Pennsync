-- The first reviewed per-capability contract, and the pattern for the rest.
--
-- HAND WRITTEN, deliberately, unlike the two migrations before it. The record
-- store's tables and the broker family are generated because every table gets
-- the same treatment and every brokered entity the same five operations. A
-- contract is the opposite: it exists precisely because a capability's
-- authorization is its own, so there is nothing to generate from. D2 calls this
-- "a reviewed, contract-per-capability transfer" and means it literally.
--
-- What a contract is for, stated once here because 94 more follow:
--
-- 1. **A capability the generic family must not serve.** `PolicyLibrary`
--    carries `doc_url` — "URL to policy document", an object in our own
--    storage — so D16's ceiling refuses it a place in the family: handing a
--    locator to every caller of a generic surface is how an uploaded file
--    leaves. This contract hands the same locator to the callers of THIS
--    capability, which is a reviewed decision about one endpoint rather than a
--    property of a generic one.
-- 2. **An authorization decision about the caller, not about a row.** The
--    original gives the full catalog — drafts and archived included — only to a
--    platform-protected built-in admin. A policy cannot express that: a policy
--    decides whether a row belongs to the caller. So the decision lives here,
--    in the database, where the rest of this design puts authorization rather
--    than trusting a service to have got it right.
-- 3. **A projection, not a row.** The contract selects the fifteen columns the
--    original returns and normalizes them the way the original does. Returning
--    the row instead would mean a column added later is exposed by default,
--    which is the opposite of what a reviewed contract is for.
--
-- The row set is still the policies' to decide. This contract adds no tenant
-- predicate of its own: `policy_library_read` already restricts to
-- `caller_agencies()`, and a contract that restated it would be a second copy
-- to keep in agreement with the first. What it adds is the mode, the
-- administrator check, and the projection.
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

-- Owned by the record owner, so `force row level security` binds it exactly as
-- it binds the brokers. A contract is not an exemption from the policies.
set local role "pennsync_records_owner";

create function "pennsync_records".contract_policy_library_list(p_agency text, p_mode text)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_role text; v_rows jsonb;
begin
  -- The original answers 400 for any mode but these two, before it reads
  -- anything. Checked first here for the same reason.
  if p_mode is null or p_mode not in ('active', 'all') then
    raise exception using errcode='22023', message='PENNSYNC_CONTRACT_MODE_INVALID';
  end if;
  -- Membership is asked of the roster, never of the request. Null means the
  -- caller holds nothing in this agency, which is a refusal rather than an
  -- empty list: an empty list would say the agency exists and is empty.
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_CONTRACT_AGENCY_NOT_HELD';
  end if;
  -- The original requires a platform-protected built-in admin for the full
  -- catalog. This deployment issues no platform-owner context at all — the
  -- authority store's own contract pins `is_platform_owner` false — so the
  -- nearest reviewed equivalent is the agency's own administrator. That is a
  -- NARROWING: a Base44 platform admin saw every agency's drafts, and an
  -- agency_admin sees only their own.
  if p_mode = 'all' and v_role <> 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_CONTRACT_FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(projected.row order by projected.ordinal), '[]'::jsonb) into v_rows
  from (
    select
      row_number() over (
        order by case when p_mode = 'all' then l."created_date" end desc nulls last,
                 case when p_mode = 'active' then l."title" end asc nulls last,
                 l."id") as ordinal,
      jsonb_build_object(
        'id', l."id",
        'title', coalesce(l."title", ''),
        'policy_number', coalesce(l."policy_number", ''),
        'category', l."category",
        'content', coalesce(l."content", ''),
        'doc_url', coalesce(l."doc_url", ''),
        'version', coalesce(l."version", ''),
        'effective_date', l."effective_date",
        'review_date', l."review_date",
        -- The original keeps only the string members of these arrays and
        -- answers [] for anything that is not an array at all.
        'tags', coalesce((select jsonb_agg(t) from jsonb_array_elements(
            case when jsonb_typeof(l."tags") = 'array' then l."tags" else '[]'::jsonb end) t
          where jsonb_typeof(t) = 'string'), '[]'::jsonb),
        'applies_to_roles', coalesce((select jsonb_agg(r) from jsonb_array_elements(
            case when jsonb_typeof(l."applies_to_roles") = 'array' then l."applies_to_roles" else '[]'::jsonb end) r
          where jsonb_typeof(r) = 'string'), '[]'::jsonb),
        'status', coalesce(l."status", 'active'),
        'created_date', l."created_date",
        'updated_date', l."updated_date") as row
    from "pennsync_records"."policy_library" l
    where l."agency_id" = p_agency
      -- `active` filters; `all` does not. The original also re-filters after
      -- its query, which changes nothing and is not reproduced as a second
      -- pass here — one predicate says the same thing.
      and (p_mode = 'all' or l."status" = 'active')
    -- The original asks for 200 in both modes.
    order by case when p_mode = 'all' then l."created_date" end desc nulls last,
             case when p_mode = 'active' then l."title" end asc nulls last,
             l."id"
    limit 200
  ) projected;
  return jsonb_build_object('policies', v_rows);
end $contract$;

reset role;

-- EXECUTE on a function is granted to PUBLIC by default, so it is revoked
-- before anything is granted back.
revoke all on function "pennsync_records".contract_policy_library_list(text,text)
  from public, anon, authenticated, service_role;

grant execute on function "pennsync_records".contract_policy_library_list(text,text) to authenticated;

-- A SECURITY INVOKER wrapper in an exposed schema, as the broker family has,
-- so PostgREST can reach it without the project exposing `pennsync_records`.
create function "public"."pennsync_contract_policy_library_list"(p_agency text, p_mode text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_policy_library_list(p_agency, p_mode)
$contract$;

revoke all on function "public"."pennsync_contract_policy_library_list"(text,text)
  from public, anon, authenticated, service_role;

grant execute on function "public"."pennsync_contract_policy_library_list"(text,text) to authenticated;

commit;
