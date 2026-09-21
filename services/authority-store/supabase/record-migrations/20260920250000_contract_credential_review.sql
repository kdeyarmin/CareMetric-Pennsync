-- Approving or rejecting a staff credential.
--
-- HAND WRITTEN, like every contract, and the first one written under D40 —
-- the owner's decision that an `agency_admin`, scoped to their own agency, is
-- the successor to Base44's built-in `role === 'admin'` for a capability that
-- has no performer left without it.
--
-- **This is a WIDENING, and it is the first one in the port.** Every earlier
-- decision refused exactly this move: D31 left `set_ai_tags` unported, D35
-- left `provision`, D36 left `list`, and D39 left this whole endpoint. The
-- difference is that a widening is the product owner's to grant and they have
-- granted it. It is recorded as a decision rather than dressed up as a
-- narrowing, and the scope is the narrowest reading of it: the agency's own
-- administrator, over the agency's own rows, which the table's policy enforces
-- without a predicate here.
--
-- **The widening brings back a risk the original did not have, and this closes
-- it.** The original's own header explains why the approval lives in a
-- function at all:
--
--     "if [staff] had row-level write access they could set status='approved'
--      on their own credential; the approval decision therefore lives here,
--      behind a server-side admin check"
--
-- Under Base44 the reviewer was a platform admin, who holds no credentials in
-- any agency, so self-approval was impossible by construction. An
-- `agency_admin` is a member of staff with credentials of their own, so it is
-- possible now — and refused here explicitly, the way
-- `contract_time_off_review` refuses self-review. Do not remove that check
-- believing it is redundant with the role gate; the role gate is what makes it
-- necessary.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. The reviewer is an `agency_admin` rather than `role === 'admin'` (D40),
--    and the cross-agency and `super_admin` branches close with the tier.
-- 2. Nobody reviews their own credential. New, and required by 1.
-- 3. The supersede step matches on the employee and the TITLE, as the original
--    matches, and is bounded to this agency by the policy. The original
--    catches and ignores a failure there; here it is one transaction, so
--    either the approval and the supersede both happen or neither does.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.contract_credential_submit(text,text,text,jsonb)') is null then
    raise exception using errcode='42501',message='PENNSYNC_CREDENTIAL_SUBMIT_REQUIRED';
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

create function "pennsync_records".contract_credential_review(
  p_agency text, p_credential_id text, p_action text, p_rejection_reason text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_row "pennsync_records"."personnel_credential"; v_email text; v_reason text;
  v_now timestamptz; v_superseded integer;
begin
  -- D40: the agency's own administrator, and nobody wider. The original's gate
  -- was the built-in platform admin, which no longer exists.
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_CREDENTIAL_FORBIDDEN';
  end if;
  if p_credential_id is null or p_credential_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_CREDENTIAL_SUBJECT_INVALID';
  end if;
  if p_action is null or p_action not in ('approve', 'reject') then
    raise exception using errcode='22023', message='PENNSYNC_CREDENTIAL_ACTION_INVALID';
  end if;
  if p_action = 'reject' then
    v_reason := "pennsync_records".bounded_reason(p_rejection_reason);
    if v_reason is null then
      raise exception using errcode='22023', message='PENNSYNC_CREDENTIAL_REASON_REQUIRED';
    end if;
  elsif p_rejection_reason is not null and pg_catalog.btrim(p_rejection_reason) <> '' then
    raise exception using errcode='22023', message='PENNSYNC_CREDENTIAL_REASON_UNEXPECTED';
  end if;
  v_email := "pennsync_records".caller_email();
  if v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_CREDENTIAL_FORBIDDEN';
  end if;

  select * into v_row from "pennsync_records"."personnel_credential" c
  where c."source_app_id" = "pennsync_records".deployment_app()
    and c."id" = p_credential_id and c."agency_id" = p_agency
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_CREDENTIAL_NOT_FOUND';
  end if;
  -- The check D40's widening makes necessary. Under Base44 the reviewer was a
  -- platform admin who holds no credentials in any agency, so this could not
  -- happen; an `agency_admin` is a member of staff with credentials of their
  -- own, so it can.
  if pg_catalog.lower(coalesce(v_row."user_id", '')) = pg_catalog.lower(v_email) then
    raise exception using errcode='42501', message='PENNSYNC_CREDENTIAL_SELF';
  end if;
  if v_row."status" is distinct from 'pending_approval' then
    raise exception using errcode='22023', message='PENNSYNC_CREDENTIAL_TRANSITION';
  end if;

  v_now := clock_timestamp();
  if p_action = 'approve' then
    update "pennsync_records"."personnel_credential" c set
      "status" = 'approved', "approved_by" = v_email, "approved_at" = v_now,
      "rejection_reason" = null, "updated_date" = v_now
    where c."source_app_id" = v_row."source_app_id" and c."id" = v_row."id"
    returning * into v_row;
    -- Supersede the employee's previously approved copy of the SAME
    -- credential, so a compliance report does not count both. The original
    -- catches and ignores a failure here; one transaction makes that moot.
    with superseded as (
      update "pennsync_records"."personnel_credential" c set
        "status" = 'expired',
        "notes" = pg_catalog.left(pg_catalog.btrim(coalesce(c."notes", '') || chr(10)
          || '[Superseded by renewal on ' || pg_catalog.to_char(v_now, 'YYYY-MM-DD') || ']'), 4000),
        "updated_date" = v_now
      where c."source_app_id" = v_row."source_app_id" and c."agency_id" = p_agency
        and c."user_id" = v_row."user_id" and c."title" = v_row."title"
        and c."status" = 'approved' and c."id" <> v_row."id"
      returning 1)
    select count(*)::integer into v_superseded from superseded;
  else
    update "pennsync_records"."personnel_credential" c set
      "status" = 'rejected', "rejection_reason" = v_reason,
      "approved_by" = v_email, "approved_at" = v_now, "updated_date" = v_now
    where c."source_app_id" = v_row."source_app_id" and c."id" = v_row."id"
    returning * into v_row;
    v_superseded := 0;
  end if;

  return jsonb_build_object('success', true, 'superseded', v_superseded,
    'credential', "pennsync_records".credential_row(v_row));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".contract_credential_review(text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_credential_review(text,text,text,text) to authenticated;

create function "public"."pennsync_contract_credential_review"(
  p_agency text, p_credential_id text, p_action text, p_rejection_reason text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_credential_review(p_agency, p_credential_id,
    p_action, p_rejection_reason)
$contract$;

revoke all on function "public"."pennsync_contract_credential_review"(text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_credential_review"(text,text,text,text)
  to authenticated;

commit;
