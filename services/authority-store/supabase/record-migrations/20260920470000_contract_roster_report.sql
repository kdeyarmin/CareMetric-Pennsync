-- The roster report: D22's roster, gated for an administrator, with the
-- summary counted over the whole agency rather than over a page.
--
-- HAND WRITTEN, like every contract, and SHORT because it delegates. The body
-- of the paging — the keyset over `(email, user_id)`, the two cursor refusals
-- and the projection that decides which columns a privileged caller sees — is
-- `contract_roster_list`'s and is reviewed there. Copying it would be a second
-- thing to keep in agreement with the first, which is exactly the objection
-- D12 settled against.
--
-- WHY IT EXISTS AT ALL, since the roster already answers who is in an agency:
-- the gate. `contract_roster_list` admits every member, because 35
-- capabilities want the working roster. Reusing it here would have handed a
-- clinician the agency's staff report — which discloses nothing they cannot
-- already read one row at a time, and is still a widening nobody decided.
--
-- AND THE ORIGINAL'S GATE IS NARROWER THAN IT READS, which was worth measuring
-- rather than assuming. It says
-- `role === 'admin' || account_type === 'agency_admin' || account_type === 'super_admin'`,
-- and `account_type` has already been through `withTrustedClaims`, which
-- STRIPS a claimed `agency_admin` or `super_admin` back to `'user'` unless a
-- canonical ACTIVE `AgencyMembership` says otherwise. So:
--
-- - `account_type === 'super_admin'` can never be true. `super_admin` is in
--   `PRIVILEGED_PROFILE_ACCOUNT_TYPES`, so a profile claiming it is demoted,
--   and the trusted branch only ever writes `'agency_admin'` or the
--   non-privileged base. The test is dead code.
-- - `account_type === 'agency_admin'` means "holds an `agency_admin`
--   membership in the one agency they belong to" — which is what this contract
--   gates on.
-- - `role === 'admin'` is the built-in platform tier D14 and D22 removed.
--
-- So this is NOT one of D40's widenings. An `agency_admin` could already run
-- the report; what leaves is the platform admin, and the three-way test that
-- looked like a wider gate was one live branch and two that could not fire.
-- D36's rule with the polarity reversed: read what the code can reach, not
-- what it appears to offer.
--
-- Two of the original's three role tests were also reading a SELF-EDITABLE
-- label: `account_type` is one of the four fields D23 names in the entity
-- schema as never to authorize from. The tenant role answers it instead.
--
-- THE SUMMARY IS COUNTED OVER THE WHOLE ROSTER, not over the page, because the
-- original's is: it counts `users`, which is its entire (unpaged) list. A
-- handler that summed pages would agree only after the last one, and the first
-- page of a report that says "Total Users: 25" when the agency has 600 is
-- worse than no total at all.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. **The derived scope goes, for the fourth time.** The original lists 5,000
--    `User` rows across every tenant and then keeps the ones whose
--    `agency_name` STRING matches the caller's, plus every row whose
--    `account_type` is `super_admin`. That is the reconstruction D41 and D43
--    delete — two of the three bugs those decisions record came from exactly
--    this shape — and `caller_roster(agency)` is the answer the authority
--    store already holds. The `super_admin` clause additionally put the
--    platform tier D14 and D22 removed into every agency's report.
-- 2. **`is_approved` is derived, not read.** The original's status column is
--    `u.is_approved || u.role === 'admin'`, and both are self-editable. The
--    roster derives it from the identity being enabled, which is a real and
--    authoritative distinction: a colleague whose login is disabled while
--    their membership stands is exactly the person a roster report should show
--    as pending.
-- 3. **The `role` column is the TENANT role.** The original prints
--    `u.role || 'user'`, which is the Base44 built-in and is `'user'` for
--    everybody who is not the removed platform admin — a column of one value.
-- 4. **There is no name.** The carried `user` table has no name column (D38,
--    D46), so the original's `full_name || 'N/A'` has no source here. The
--    document drops that column rather than printing 'N/A' down the page or
--    repeating the address beside the Email column — D46 substituted the
--    address for a name because there was no adjacent email there to
--    duplicate.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.contract_roster_list(text,integer,text)') is null
    or to_regprocedure('pennsync_records.caller_roster(text)') is null then
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

create function "pennsync_records".contract_roster_report(
  p_agency text, p_limit integer default 500, p_after text default null)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_role text; v_page jsonb; v_summary jsonb;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_ROSTER_REPORT_AGENCY_NOT_HELD';
  end if;
  -- D40. A `manager` is admitted by the roster's own privileged projection and
  -- is NOT admitted here, because the original's gate was the platform tier
  -- and two self-editable labels — never a manager.
  if v_role <> 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_ROSTER_REPORT_FORBIDDEN';
  end if;

  -- Delegated, so the keyset, the two cursor refusals and the projection stay
  -- in one place. Those refusals CAN reach a caller through here, which is why
  -- the capability declares them: `PENNSYNC_ROSTER_CURSOR_INVALID` and
  -- `PENNSYNC_ROSTER_CURSOR_UNKNOWN` are this contract's too, by delegation.
  -- `PENNSYNC_ROSTER_AGENCY_NOT_HELD` is not: the gate above asks the same
  -- question first, in the same transaction, and answers with its own code.
  v_page := "pennsync_records".contract_roster_list(p_agency, p_limit, p_after);

  -- Over the WHOLE roster. `caller_roster` is the audited population (D41),
  -- and the carried row contributes only the credential, which the authority
  -- store has no column for.
  select jsonb_build_object(
    'total', pg_catalog.count(*),
    'approved', pg_catalog.count(*) filter (where m.is_active),
    'pending', pg_catalog.count(*) filter (where not m.is_active),
    'rn', pg_catalog.count(*) filter (where u."credential_type" = 'RN'),
    'lpn', pg_catalog.count(*) filter (where u."credential_type" = 'LPN'))
  into v_summary
  from "pennsync_records".caller_roster(p_agency) m
  left join "pennsync_records"."user" u
    on u."source_app_id" = "pennsync_records".deployment_app() and u."id" = m.user_id;

  return v_page || jsonb_build_object('summary', v_summary);
end $contract$;

reset role;

revoke all on function "pennsync_records".contract_roster_report(text,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function "pennsync_records".contract_roster_report(text,integer,text)
  to authenticated;

create function "public"."pennsync_contract_roster_report"(
  p_agency text, p_limit integer default 500, p_after text default null) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_roster_report(p_agency, p_limit, p_after)
$contract$;

revoke all on function "public"."pennsync_contract_roster_report"(text,integer,text)
  from public, anon, service_role;
grant execute on function "public"."pennsync_contract_roster_report"(text,integer,text)
  to authenticated;

commit;
