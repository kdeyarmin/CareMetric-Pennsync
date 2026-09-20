-- Sweeping an agency's pending invitations.
--
-- HAND WRITTEN, like every contract, and the fourth port under D40.
--
-- **Its two gates are both gone, and only one has a successor.** The original
-- admits either the built-in `role === 'admin'` — the platform tier D14 and D22
-- removed — or a shared secret in a header, which is how the scheduler calls
-- it. The human path's successor is D40's: an `agency_admin`, scoped to their
-- own agency. The MACHINE path has none, and cannot simply be recreated: the
-- original sweeps every pending invitation in the deployment, and nothing in
-- this store is cross-tenant, because nothing holds `BYPASSRLS` and every
-- policy asks `caller_agencies()`. WHO runs this on a schedule is an open
-- decision (see the exit decisions), and this contract is the per-agency half
-- that decision will call either way.
--
-- **The paused branch is the original's own, not an invention.** The original
-- already returns
--
--     { success, expired, expiring_soon, notifications_sent: 0,
--       delivery_paused: true, code: 'OUTBOUND_DELIVERY_RELEASE_PAUSED' }
--
-- whenever `outboundDeliveryReleased()` is false, and in that branch it
-- deliberately does NOT stamp `expiring_soon_notified_at` — in its own words,
-- *"Preserve expiration maintenance while the environment-wide delivery gate is
-- closed, but do not claim an email tier that was never sent."* The digest is
-- `Core.SendEmail`, which nothing here brokers, so this port IS that branch:
-- expiry maintenance happens, the expiring-soon tier is counted and not
-- claimed, and the answer says so. When a send exists, the stamp and the digest
-- return together.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. The scope is the agency, from the policies. The original scopes its
--    digest by comparing the invitation's `agency_name` STRING to each
--    admin's, and records the failure that caused: *"Unscoped fan-out emailed
--    invitee names/emails to every tenant's admins."* That is the sixth
--    original whose own comments document a derived-scope bug (D41, D42, D43,
--    D44).
-- 2. A missing expiry is expired, which is the original's fail-closed rule for
--    an unparseable one: *"Fail closed: treat a malformed expiry as expired so
--    it can't remain actionable indefinitely."* An UNPARSEABLE one cannot occur
--    here, because the column is `timestamptz` rather than a string.
-- 3. The original's explicit 5000-row limit — added because *"an unlimited
--    filter() only returns the server's default page (~50), so past that this
--    sweep leaves the overflow pending"* — is not ported, because a SQL
--    `update … where` has no page to overflow. That comment is the clearest
--    statement in the tree of what these ports keep deleting.
begin;

do $$
begin
  if to_regclass('pennsync_records.user_invitation') is null then
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

create function "pennsync_records".contract_invitation_sweep(p_agency text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_now timestamptz; v_expired integer; v_soon integer; v_rows jsonb;
begin
  -- D40's gate. The original admits the built-in admin, or a shared secret.
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_INVITATION_FORBIDDEN';
  end if;
  v_now := clock_timestamp();

  -- Divergences 1, 2 and 3: the agency's own pending invitations, a null
  -- expiry counted as expired, and no page to overflow.
  with swept as (
    update "pennsync_records"."user_invitation" i set
      "status" = 'expired', "updated_date" = v_now
    where i."source_app_id" = "pennsync_records".deployment_app()
      and i."agency_id" = p_agency and i."status" = 'pending'
      and (i."expires_at" is null or i."expires_at" < v_now)
    returning i."id", i."email", i."full_name", i."expires_at")
  select count(*)::integer, coalesce(jsonb_agg(jsonb_build_object(
      'id', swept."id", 'email', swept."email", 'full_name', swept."full_name",
      'expires_at', swept."expires_at") order by swept."id"), '[]'::jsonb)
  into v_expired, v_rows from swept;

  -- Counted, NOT stamped. The original claims the tier only when it is about
  -- to send, so that a paused run leaves the next one able to.
  select count(*)::integer into v_soon
  from "pennsync_records"."user_invitation" i
  where i."source_app_id" = "pennsync_records".deployment_app()
    and i."agency_id" = p_agency and i."status" = 'pending'
    and i."expires_at" is not null
    and i."expires_at" >= v_now and i."expires_at" < v_now + interval '24 hours'
    and i."expiring_soon_notified_at" is null;

  return jsonb_build_object('success', true,
    'expired', v_expired, 'expiring_soon', v_soon,
    'expired_invitations', v_rows,
    'notifications_sent', 0, 'delivery_paused', true,
    'code', 'OUTBOUND_DELIVERY_RELEASE_PAUSED');
end $contract$;

reset role;

revoke all on function "pennsync_records".contract_invitation_sweep(text)
  from public, anon, authenticated, service_role;
grant execute on function "pennsync_records".contract_invitation_sweep(text)
  to authenticated;

create function "public"."pennsync_contract_invitation_sweep"(p_agency text) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_invitation_sweep(p_agency)
$c$;
revoke all on function "public"."pennsync_contract_invitation_sweep"(text)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_invitation_sweep"(text)
  to authenticated;

commit;
