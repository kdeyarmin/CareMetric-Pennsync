-- The agency's pool of work numbers: a READ, and only a read.
--
-- HAND WRITTEN, like every contract. The read is a port under D40 — the
-- original's `rls` read is `{ "user_condition": { "role": "admin" } }`, the
-- built-in platform tier D14 and D22 removed — so its successor is an
-- `agency_admin` scoped to their own agency, which is also where the screen
-- lives (`NumberPoolPanel.jsx` gates on `isAdminLike(currentUser)` and the
-- query is `enabled: isAdmin`).
--
-- THERE IS NO WRITE HALF, and that is the entity's own doing rather than a
-- deferral. All three write rules read `{ "user_condition": { "role":
-- "__service_role_only__" } }`, which is not a tier D40 can find a successor
-- for: it is the absence of a caller. D39's `reviewPersonnelCredential` is the
-- shape — a capability with no performer left — and the rule there applies
-- here: do NOT add an assign, release or provision path to this file until a
-- decision records who may move a number, because the original gives that to
-- no browser caller at all. A test asserts the absence.
--
-- AND THE ABSENCE IS NOT ONLY ABOUT AUTHORIZATION. Acquiring or porting a
-- number is PAID INFRASTRUCTURE at a carrier, which is the owner's to decide
-- and not this migration's; what this contract restores is a record of the
-- numbers an agency already holds. A reader who sees the entity's Twilio
-- fields should note that nothing here reaches a provider: `twilio_phone_number_sid`
-- is projected as the opaque identifier it is, and no credential, connection or
-- API call is anywhere in this file.
--
-- WHY IT IS AGENCY-TENANTED AND NOT GLOBAL, since the question comes up from
-- the schema: `phone_number` names no agency of its own and is keyed by
-- `assigned_to_email`, a person who works for one. The person is not the
-- tenant — a work number outlives whoever currently holds it — so the entity
-- takes `agency_id` before load. `global` is refused by what the kind MEANS
-- (a reference table read by every agency and written by migration, D83), not
-- by any check: a number pool is operational state staff provision and
-- reassign, and publishing one agency's work numbers to all of them is the
-- opposite of what the pool is.
begin;

do $$
begin
  if to_regclass('pennsync_records.phone_number') is null
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
 * The projection (D64).
 *
 * `creation_claim_token` is NOT projected and the reason is its own
 * description: "Server-generated inventory creation owner for exact
 * lost-acknowledgement recovery." It is a claim token, so it is a credential in
 * the sense D16's ceiling means — which is one of the reasons the generic
 * broker family refuses this entity on its own account — and nothing in the
 * panel reads it. `assigned_to_email` IS projected, because the whole point of
 * the panel is showing which nurse holds which number.
 */
create function "pennsync_records".phone_number_row(
  p_row "pennsync_records"."phone_number")
  returns jsonb language sql immutable set search_path = '' as $row$
  select jsonb_build_object(
    'id', p_row."id",
    'e164', p_row."e164",
    'label', p_row."label",
    'status', p_row."status",
    'assigned_to_email', p_row."assigned_to_email",
    'twilio_phone_number_sid', p_row."twilio_phone_number_sid",
    'notes', p_row."notes",
    'created_date', p_row."created_date",
    'updated_date', p_row."updated_date")
$row$;

create function "pennsync_records".contract_phone_number_list(
  p_agency text, p_limit integer default 500)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_rows jsonb; v_limit integer;
begin
  -- D40's successor to `role === 'admin'`. A `manager` is NOT admitted: the
  -- original's gate is the platform tier and nothing else, and widening past
  -- the one role that replaces it would be adding a performer rather than
  -- replacing one.
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_PHONE_NUMBER_FORBIDDEN';
  end if;
  -- Re-applied in SQL (D71): a bound a caller could raise is not a bound. The
  -- panel asks for 500, which is also the ceiling.
  v_limit := least(greatest(coalesce(p_limit, 500), 1), 500);
  select coalesce(jsonb_agg("pennsync_records".phone_number_row(p.r) order by
      p.ordered_date desc nulls last, p.ordered_id desc), '[]'::jsonb)
    into v_rows
  from (
    select n as r, n."created_date" as ordered_date, n."id" as ordered_id
    from "pennsync_records"."phone_number" n
    where n."source_app_id" = "pennsync_records".deployment_app()
      and n."agency_id" = p_agency
    order by n."created_date" desc nulls last, n."id" desc
    limit v_limit
  ) p;
  return jsonb_build_object('success', true, 'numbers', v_rows);
end $contract$;

reset role;

revoke all on function
  "pennsync_records".phone_number_row("pennsync_records"."phone_number"),
  "pennsync_records".contract_phone_number_list(text,integer)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_phone_number_list(text,integer)
  to authenticated;

create function "public"."pennsync_contract_phone_number_list"(
  p_agency text, p_limit integer default 500) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_phone_number_list(p_agency, p_limit)
$contract$;

revoke all on function
  "public"."pennsync_contract_phone_number_list"(text,integer)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_phone_number_list"(text,integer)
  to authenticated;

commit;
