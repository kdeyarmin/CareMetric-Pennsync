-- Resending a staff invitation.
--
-- HAND WRITTEN, like every contract, and the third port under D40.
--
-- **It serves TWO Base44 capabilities with ONE contract**, because they are
-- the same file. `resendInvitation` and `resendInvitationV2` are byte-identical
-- apart from a trailing line in the second:
--
--     // Production replacement endpoint: resendInvitationV2 (registered 2026-09-09)
--
-- Porting them separately would put two identical endpoints in the new service
-- and give a future reader two places to keep in agreement. Both handler names
-- stay — a migrating caller of either gets the behaviour it had — and both
-- reach this one contract. That is the inverse of `listAuthorizedPatients`,
-- which is one capability reaching two contracts because its two modes are two
-- different queries.
--
-- **The invitation EMAIL is not ported, and that is more than a paused send.**
-- The original calls `base44.users.inviteUser(...)`, which is the Base44
-- platform's own invitation service: it mints the account and delivers the
-- link. There is no platform here to call. So this contract does the record
-- half — a resend marks the invitation pending again, extends it by seven days,
-- stamps the moment and increments the count — and the handler reports
-- `delivery_paused`, the same shape the time-off and credential ports report.
-- Until an owned invitation path exists, a resend records the intent and the
-- invitee receives nothing. That is stated rather than implied, because it is
-- the one part of this capability a caller would notice missing.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. The gate is `agency_admin` (D40); the built-in admin and `super_admin`
--    branches close with the tier.
-- 2. The agency check is the table's policy. The original resolves the
--    invitation's agency from its own `agency_name` string and, failing that,
--    by looking up the INVITER's `User` row and reading THEIR `agency_name` —
--    two self-editable labels and a second answer to a question the policy
--    already answers (D41).
-- 3. The audit entry goes to D25's trail rather than `UserActivity`, in the
--    same transaction as the update (D37), so a recorded resend and the resend
--    itself cannot disagree.
begin;

do $$
begin
  if to_regclass('pennsync_records.user_invitation') is null
    or to_regprocedure('pennsync_records.contract_activity_append(text,text,text,text,jsonb)') is null then
    raise exception using errcode='42501',message='PENNSYNC_ACTIVITY_TRAIL_REQUIRED';
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

create function "pennsync_records".contract_invitation_resend(
  p_agency text, p_invitation_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_row "pennsync_records"."user_invitation"; v_now timestamptz; v_expires timestamptz;
  v_count integer; v_event text;
begin
  -- D40's gate. The original admits the built-in admin and nobody else.
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_INVITATION_FORBIDDEN';
  end if;
  if p_invitation_id is null or p_invitation_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_INVITATION_SUBJECT_INVALID';
  end if;

  -- Read under the policy, which already scopes this to the caller's agency.
  -- The original resolves the agency from the invitation's own `agency_name`
  -- and then from the INVITER's profile; neither is an authority (D41).
  select * into v_row from "pennsync_records"."user_invitation" i
  where i."source_app_id" = "pennsync_records".deployment_app()
    and i."id" = p_invitation_id and i."agency_id" = p_agency
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_INVITATION_NOT_FOUND';
  end if;
  -- The original's two terminal states, each with its own answer: an accepted
  -- invitation has already done its job, and a cancelled one was withdrawn on
  -- purpose. An EXPIRED one is exactly what a resend is for.
  if v_row."status" = 'accepted' then
    raise exception using errcode='22023', message='PENNSYNC_INVITATION_ACCEPTED';
  end if;
  if v_row."status" = 'cancelled' then
    raise exception using errcode='22023', message='PENNSYNC_INVITATION_CANCELLED';
  end if;

  v_now := clock_timestamp();
  v_expires := v_now + interval '7 days';
  /*
   * NOTHING WAS SENT, SO NOTHING RECORDS A SEND.
   *
   * D42 ported this capability knowing its delivery has no successor — the
   * original calls `base44.users.inviteUser`, which MINTS the account and
   * delivers the link, and nothing here does either. The audit entry was given
   * `delivery_paused: true` for exactly that reason, and then the row was
   * updated as though a message had gone out anyway: `last_sent_at` set to
   * now, `resend_count` incremented. D73's standard is the one that applies —
   * a paused half is reported as paused so the RECORD cannot read as though it
   * happened — and it was applied to the trail and not to the table.
   *
   * `last_sent_at` and `resend_count` therefore do not move. What does move is
   * the part a resend legitimately means and which does not claim a delivery:
   * an EXPIRED invitation returns to `pending` with a fresh window, so an
   * operator who sends the link by hand is not fighting a stale row.
   */
  v_count := coalesce(v_row."resend_count", 0)::integer;
  update "pennsync_records"."user_invitation" i set
    "status" = 'pending',
    "expires_at" = v_expires,
    "updated_date" = v_now
  where i."source_app_id" = v_row."source_app_id" and i."id" = v_row."id"
  returning * into v_row;

  -- D25's trail, in the same transaction (D37). The original writes a
  -- `UserActivity` row and catches its failure, so a resend could happen with
  -- nothing recording it.
  v_event := "pennsync_records".contract_activity_append(
    p_agency, 'invitation_resent', 'other', v_row."id",
    jsonb_build_object(
      'invited_email', v_row."email",
      -- The UNCHANGED count, so the trail does not imply a send either.
      'resend_count', v_count,
      'new_expires_at', v_expires,
      -- Recorded on the entry itself, so the trail does not read as though a
      -- message went out.
      'delivery_paused', true));

  -- `delivery_paused` at the TOP LEVEL, not only inside the audit detail: a
  -- caller cannot read the trail, and `UserManagement.jsx` reported
  -- "Invitation resent successfully!" precisely because nothing in the answer
  -- told it otherwise.
  return jsonb_build_object('success', true, 'audit_event_id', v_event,
    'delivery_paused', true,
    'invitation', jsonb_build_object(
      'id', v_row."id", 'email', v_row."email", 'status', v_row."status",
      'expires_at', v_row."expires_at", 'last_sent_at', v_row."last_sent_at",
      'resend_count', v_count));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".contract_invitation_resend(text,text)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_invitation_resend(text,text) to authenticated;

create function "public"."pennsync_contract_invitation_resend"(
  p_agency text, p_invitation_id text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_invitation_resend(p_agency, p_invitation_id)
$contract$;

revoke all on function "public"."pennsync_contract_invitation_resend"(text,text)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_invitation_resend"(text,text)
  to authenticated;

commit;
