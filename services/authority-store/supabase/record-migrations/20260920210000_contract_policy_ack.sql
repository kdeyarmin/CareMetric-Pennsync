-- Signing off a policy acknowledgment.
--
-- HAND WRITTEN, like every contract, and the THIRD partial port. The original
-- has two actions and this serves one: `acknowledge`. `list` is refused by
-- name.
--
-- **`list` has no performer left.** Its gate is `isAdminLike(user)`, which is
-- `u.role === 'admin'` — the Base44 built-in admin, the platform tier D14 and
-- D22 removed. D31 named this exact case for `set_ai_tags` and the answer is
-- the same: dropping the gate would not narrow the action, it would OPEN it.
--
-- Worth recording because it is tempting to read the function's own comment as
-- permission to widen. The comment says the list exists "so account_type-based
-- admins (agency_admin/super_admin) are honored", and the body then scopes
-- non-super_admin callers to `user.agency_name`. But `isAdminLike` admits
-- neither: every caller without `role === 'admin'` is refused before that code
-- is reached, so the agency-scoping branch is unreachable. Porting the COMMENT
-- would hand an agency administrator a capability the code never gave them.
-- That is a widening dressed as a bug fix, and it is a decision for the product
-- rather than for a port.
--
-- Two more things the original cannot do here, both deliberate:
--
-- * **No `ip_address`, and no `device_metadata`.** The original reads
--   `x-forwarded-for` and `user-agent` from the request. A contract cannot see
--   a request, and taking them as PARAMETERS would let the person signing
--   choose what the audit trail says about them. For a compliance record, a
--   forgeable field is worse than an absent one. The signature, the name and
--   the server-stamped moment are all real.
-- * **The ownership check reads the authoritative address.** The original
--   compares `ack.user_id` to `user.email` from the Base44 profile. This
--   compares it to `caller_email()`, which is `identity_map.expected_email` —
--   D23's rule that a carried row's self-editable label must never decide
--   anything.
--
-- `policy_acknowledgment.user_id` holds an EMAIL, not an id. That is the
-- carried column's actual content — the original's own comparison is
-- `sameEmail(ack.user_id, user.email)` — and renaming it here would make the
-- contract disagree with the rows.
begin;

do $$
begin
  if to_regclass('pennsync_records.policy_acknowledgment') is null
    or to_regprocedure('pennsync_records.caller_email()') is null then
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
 * The signed name, bounded.
 *
 * The original requires it to be a non-empty string after `String(...).trim()`
 * and bounds it nowhere. A signature on a compliance record is stored and
 * displayed, so it is bounded here and control characters are refused —
 * narrower than the original, which is the only direction a port may take.
 */
create function "pennsync_records".signed_name(p_value text) returns text
  language sql immutable set search_path = '' as $name$
  select case
    when t = '' or pg_catalog.length(t) > 200
      or t ~ '[\u0001-\u001f\u007f]' then null
    else t end
  from (select pg_catalog.btrim(coalesce(p_value, '')) as t) trimmed
$name$;

create function "pennsync_records".contract_policy_acknowledge(
  p_agency text, p_acknowledgment_id text, p_signed_name text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_row record; v_name text; v_email text; v_now timestamptz;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_POLICY_ACK_AGENCY_NOT_HELD';
  end if;
  if p_acknowledgment_id is null or p_acknowledgment_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_POLICY_ACK_SUBJECT_INVALID';
  end if;
  v_name := "pennsync_records".signed_name(p_signed_name);
  if v_name is null then
    raise exception using errcode='22023', message='PENNSYNC_POLICY_ACK_NAME_REQUIRED';
  end if;
  v_email := "pennsync_records".caller_email();
  if v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_POLICY_ACK_AGENCY_NOT_HELD';
  end if;

  -- Read under the policies, which already scope the row to an agency the
  -- caller holds, so this adds no tenant predicate of its own. `for update`
  -- because the acknowledged-already branch below is a read followed by a
  -- write and must not be torn.
  select a."id", a."user_id", a."acknowledged", a."acknowledged_at", a."signed_name",
    a."policy_id", a."status"
    into v_row
  from "pennsync_records"."policy_acknowledgment" a
  where a."source_app_id" = "pennsync_records".deployment_app()
    and a."id" = p_acknowledgment_id and a."agency_id" = p_agency
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_POLICY_ACK_NOT_FOUND';
  end if;
  -- The original's ownership rule, against the authoritative address. The
  -- column holds an email; see the header.
  if pg_catalog.lower(pg_catalog.btrim(coalesce(v_row."user_id", '')))
    is distinct from pg_catalog.lower(v_email) then
    raise exception using errcode='42501', message='PENNSYNC_POLICY_ACK_FORBIDDEN';
  end if;
  -- Idempotent, and deliberately does NOT overwrite the original stamp: an
  -- acknowledgment records when somebody signed, and signing twice does not
  -- move that moment.
  if v_row."acknowledged" is true then
    return jsonb_build_object('success', true, 'already_acknowledged', true,
      'acknowledgment', jsonb_build_object('id', v_row."id", 'policy_id', v_row."policy_id",
        'status', v_row."status", 'acknowledged_at', v_row."acknowledged_at",
        'signed_name', v_row."signed_name"));
  end if;

  v_now := clock_timestamp();
  update "pennsync_records"."policy_acknowledgment" a set
    "acknowledged" = true,
    "status" = 'acknowledged',
    "acknowledged_at" = v_now,
    "signed_name" = v_name,
    "updated_date" = v_now
  where a."source_app_id" = "pennsync_records".deployment_app()
    and a."id" = p_acknowledgment_id and a."agency_id" = p_agency;
  return jsonb_build_object('success', true, 'already_acknowledged', false,
    'acknowledgment', jsonb_build_object('id', v_row."id", 'policy_id', v_row."policy_id",
      'status', 'acknowledged', 'acknowledged_at', v_now, 'signed_name', v_name));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".signed_name(text),
  "pennsync_records".contract_policy_acknowledge(text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_policy_acknowledge(text,text,text) to authenticated;

create function "public"."pennsync_contract_policy_acknowledge"(
  p_agency text, p_acknowledgment_id text, p_signed_name text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_policy_acknowledge(p_agency, p_acknowledgment_id, p_signed_name)
$contract$;

revoke all on function "public"."pennsync_contract_policy_acknowledge"(text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_policy_acknowledge"(text,text,text)
  to authenticated;

commit;
