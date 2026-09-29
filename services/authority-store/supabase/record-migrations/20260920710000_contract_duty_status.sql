-- The duty toggle, the scheduled time-off window and the off-duty message:
-- `setNurseDutyStatus`, and the FIRST caller of D82's profile-write path.
--
-- That is the thing to know before reading anything else here. D82 gave
-- `pennsync_records.user` an update policy naming `caller_user_id()` and a
-- trigger admitting only `PROFILE_SELF_WRITABLE`, and until now nothing in the
-- store wrote that table at all -- the write path was built and had no caller.
-- So this contract is the first thing that exercises both halves against a real
-- database, and its suite is the first evidence either works.
--
-- HOW IT GOT HERE IS WORTH A LINE, because the capability was never blocked.
-- It sat in the port queue's `entity_authorization` bucket, which is where a
-- module lands when it writes a column outside D82's allowlist. All six columns
-- it writes are ON that allowlist. `writtenColumns` knew one shape of a write
-- payload -- an object literal at the call -- and this module builds `update`
-- by member assignment and hands it over, so the reader answered `null` and the
-- classifier reads unknown as outside the narrowing. A fail-closed blind spot
-- costs work rather than correctness, which is why it lasted: nothing it did
-- looked like a defect.
--
-- THE CROSS-USER LEG IS REFUSED BY NAME, and it is D14 and D22's tier rather
-- than a choice made here. The original lets a caller set somebody else's duty
-- status if `isProtectedSuperAdmin(user)` -- the platform owner, read from
-- `SUPER_ADMIN_EMAIL` -- and that tier is gone. It is refused in SQL rather
-- than dropped, because `user_update` would refuse the write anyway and a
-- policy refusal reaches the caller as a row that did not update: a silent
-- no-op where the original changed a colleague's status. D39's rule.
--
-- Note also what the tier's removal does to the OTHER gate. The original
-- accepts the platform owner INSTEAD of an active agency membership; here
-- membership is the only way in, for every caller. That is a narrowing and it
-- is the one D40 does not widen back, because the capability is self-service:
-- there is no agency-scoped successor to "may set anyone's duty status" that
-- the store's own policy would admit.
--
-- WHAT THE CALLER MAY SET IS NAMED, AND `duty_on_since` IS NOT ON THE LIST.
-- The original stamps it itself -- set when toggling on, cleared when toggling
-- off -- because the inbound call and SMS webhooks treat a toggle stamped on an
-- earlier day as expired. A caller who could send it could hold themselves
-- on duty indefinitely. D73's rule: a field the server decides is not made the
-- caller's by adding an endpoint that wants it set.
--
-- THE MESSAGE SANITIZER IS IN SQL AND NOT IN THE SERVICE, which is the one
-- place this departs from D67's split. That split puts text arithmetic over
-- caller input in the service and what may be STORED in the contract, and the
-- original's own comment says why this one is neither: the off-duty message is
-- spoken to callers by TTS and sent as an SMS auto-reply, so stripping markup
-- is a disclosure control rather than shaping. A control the service applies is
-- a control a direct RPC call skips.
--
-- Its one unportable detail is recorded rather than approximated. JavaScript's
-- `slice(0, 320)` counts UTF-16 CODE UNITS and will cut between the halves of a
-- surrogate pair; PostgreSQL text cannot hold a lone surrogate, so that exact
-- output does not exist here. `duty_message_bounded` counts code units the way
-- D33's `bounded_reason` does -- an astral character weighs two -- and drops a
-- character whose second unit would cross the bound rather than splitting it.
-- The result is identical to the original's for every message that does not cut
-- mid-pair, and one character shorter for one that does. A NARROWING, recorded.
--
-- ONE MORE DIVERGENCE, AND IT IS THE TRAIL. The original writes `UserActivity`
-- with `.catch()`, so a failed audit leaves the duty change made and unrecorded.
-- Here the append is `contract_activity_append` inside the same transaction, so
-- neither half can exist without the other -- D37's shape, which is available
-- because this is one round trip and the original was two. Stricter than the
-- original, and recorded as such.
--
-- AND ONE WIDENING, which is D68's shape rather than a decision taken here.
-- `hasExactActiveAgencyMembership` refuses unless the caller holds EXACTLY ONE
-- active membership, so a person in two agencies cannot use this capability in
-- Base44 at all. That check is how a handler with no envelope establishes a
-- tenant; the business API's invariant is that every request names its tenant,
-- so the compensation is deleted rather than reimplemented and a two-agency
-- caller is served. Its whole blast radius: the row written is the caller's own
-- profile, which carries no agency, so the only agency-scoped effect is which
-- agency's activity trail the entry lands in -- and they hold both.
--
-- The agency is named in the contract's own predicate as well as reached
-- through the gate, because `caller_agencies()` returns every agency the caller
-- holds (D51).
begin;

do $guard$
begin
  if to_regprocedure('pennsync_records.caller_tenant_role(text)') is null
    or to_regprocedure('pennsync_records.caller_user_id()') is null
    or to_regprocedure('pennsync_records.caller_email()') is null
    or to_regprocedure('pennsync_records.contract_activity_append(text,text,text,text,jsonb)') is null then
    raise exception 'PENNSYNC_DUTY_STATUS_REQUIRES_RECORD_STORE';
  end if;
end $guard$;

-- The five keys a caller may send, in one place so the validator and the
-- update cannot drift. `duty_on_since` is absent deliberately; see the header.
create function "pennsync_records".duty_status_writable_fields()
  returns text[] language sql immutable set search_path = '' as $helper$
  select array['duty_status', 'off_duty_message', 'scheduled_off_duty_start',
    'scheduled_off_duty_end', 'scheduled_off_duty_recurring']
$helper$;

-- The original's sanitizer, in its own order: strip angle brackets, replace
-- control characters with a space, then cut to 320 UTF-16 code units. The cut
-- never splits a surrogate pair; see the header for why that is a narrowing
-- rather than a transcription.
create function "pennsync_records".duty_message_bounded(p_value text)
  returns text language sql immutable set search_path = '' as $helper$
  with stripped as (
    select pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(coalesce(p_value, ''), '[<>]', '', 'g'),
      '[\u0000-\u001f\u007f]', ' ', 'g') as t
  ), units as (
    select ch, n,
      pg_catalog.sum(case when ch ~ '[\U00010000-\U0010FFFF]' then 2 else 1 end)
        over (order by n rows between unbounded preceding and current row) as upto
    from stripped, pg_catalog.regexp_split_to_table(stripped.t, '') with ordinality as s(ch, n)
  )
  select coalesce(pg_catalog.string_agg(ch, '' order by n), '') from units where upto <= 320
$helper$;

create function "pennsync_records".contract_duty_status_set(
  p_agency text, p_target_user_email text, p_patch jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_role text; v_user text; v_field text;
  v_status text; v_message text; v_recurring boolean;
  v_start timestamptz; v_end timestamptz;
  v_start_given boolean; v_end_given boolean; v_clearing boolean := false;
  v_set jsonb := '{}'::jsonb; v_effective text; v_written bigint;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_DUTY_STATUS_AGENCY_NOT_HELD';
  end if;
  v_user := "pennsync_records".caller_user_id();
  if v_user is null then
    raise exception using errcode='42501', message='PENNSYNC_DUTY_STATUS_SUBJECT_INVALID';
  end if;

  -- The cross-user leg. Compared against the caller's own address rather than
  -- ignored, so a client that always sends it keeps working and one that names
  -- a colleague is told why.
  if p_target_user_email is not null
    and pg_catalog.lower(pg_catalog.btrim(p_target_user_email))
      is distinct from "pennsync_records".caller_email() then
    raise exception using errcode='42501', message='PENNSYNC_DUTY_STATUS_TARGET_UNSUPPORTED';
  end if;

  if p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_DUTY_STATUS_PATCH_INVALID';
  end if;
  for v_field in select key from pg_catalog.jsonb_each(p_patch) loop
    if not (v_field = any("pennsync_records".duty_status_writable_fields())) then
      raise exception using errcode='22023', message='PENNSYNC_DUTY_STATUS_FIELD_UNSUPPORTED';
    end if;
  end loop;

  if p_patch ? 'duty_status' then
    v_status := p_patch ->> 'duty_status';
    if v_status is null or v_status not in ('on_duty', 'off_duty') then
      raise exception using errcode='22023', message='PENNSYNC_DUTY_STATUS_VALUE_INVALID';
    end if;
    -- Stamped here and never taken from the caller: set on the toggle ON so the
    -- webhooks can expire it nightly, cleared on the toggle OFF.
    v_set := v_set || pg_catalog.jsonb_build_object('duty_status', v_status,
      'duty_on_since', case when v_status = 'on_duty' then pg_catalog.now() else null end);
  end if;

  if p_patch ? 'off_duty_message' then
    if pg_catalog.jsonb_typeof(p_patch -> 'off_duty_message') not in ('string', 'null') then
      raise exception using errcode='22023', message='PENNSYNC_DUTY_STATUS_VALUE_INVALID';
    end if;
    v_message := case when p_patch ->> 'off_duty_message' is null then null
      else "pennsync_records".duty_message_bounded(p_patch ->> 'off_duty_message') end;
    v_set := v_set || pg_catalog.jsonb_build_object('off_duty_message', v_message);
  end if;

  -- The window is paired. Both null clears it; both present set it; one of
  -- either is refused rather than half-persisted, as the original has it.
  v_start_given := p_patch ? 'scheduled_off_duty_start';
  v_end_given := p_patch ? 'scheduled_off_duty_end';
  if v_start_given <> v_end_given then
    raise exception using errcode='22023', message='PENNSYNC_DUTY_STATUS_WINDOW_INCOMPLETE';
  end if;
  if v_start_given then
    if pg_catalog.jsonb_typeof(p_patch -> 'scheduled_off_duty_start') = 'null'
      and pg_catalog.jsonb_typeof(p_patch -> 'scheduled_off_duty_end') = 'null' then
      v_clearing := true;
    elsif pg_catalog.jsonb_typeof(p_patch -> 'scheduled_off_duty_start') = 'null'
      or pg_catalog.jsonb_typeof(p_patch -> 'scheduled_off_duty_end') = 'null' then
      raise exception using errcode='22023', message='PENNSYNC_DUTY_STATUS_WINDOW_INCOMPLETE';
    else
      -- Parsed from TEXT rather than taken as a `timestamptz` parameter, so an
      -- impossible date is this contract's refusal rather than PostgREST's.
      -- D38's reason, and the original's `Number.isNaN` check.
      begin
        v_start := (p_patch ->> 'scheduled_off_duty_start')::timestamptz;
        v_end := (p_patch ->> 'scheduled_off_duty_end')::timestamptz;
      exception when others then
        raise exception using errcode='22023', message='PENNSYNC_DUTY_STATUS_WINDOW_INVALID';
      end;
      if v_end <= v_start then
        raise exception using errcode='22023', message='PENNSYNC_DUTY_STATUS_WINDOW_INVALID';
      end if;
    end if;
    v_set := v_set || pg_catalog.jsonb_build_object(
      'scheduled_off_duty_start', v_start, 'scheduled_off_duty_end', v_end);
  end if;

  if p_patch ? 'scheduled_off_duty_recurring' then
    -- The original writes `!!x`, so a string coerces. Refused here instead: a
    -- repeating time-off window created by sending "false" is not a request
    -- anybody made. A NARROWING, recorded.
    if pg_catalog.jsonb_typeof(p_patch -> 'scheduled_off_duty_recurring') <> 'boolean' then
      raise exception using errcode='22023', message='PENNSYNC_DUTY_STATUS_VALUE_INVALID';
    end if;
    v_recurring := (p_patch -> 'scheduled_off_duty_recurring')::boolean;
    v_set := v_set || pg_catalog.jsonb_build_object('scheduled_off_duty_recurring', v_recurring);
  end if;
  -- Checked after both are known, because the bound is on a RECURRING window
  -- and the two arrive as separate keys. The original checks it inside the
  -- window branch using the recurrence from the same request.
  if v_start is not null and v_end is not null
    and coalesce(v_recurring, false)
    and v_end - v_start >= interval '7 days' then
    raise exception using errcode='22023', message='PENNSYNC_DUTY_STATUS_WINDOW_TOO_LONG';
  end if;
  -- Clearing the window drops the recurrence with it, so it cannot linger on a
  -- window that no longer exists.
  if v_clearing then
    v_set := v_set || pg_catalog.jsonb_build_object('scheduled_off_duty_recurring', false);
  end if;

  if v_set = '{}'::jsonb then
    raise exception using errcode='22023', message='PENNSYNC_DUTY_STATUS_PATCH_INVALID';
  end if;

  -- The write. `user_update` admits the caller's own row and the self-write
  -- trigger admits only the allowlisted columns, so both of D82's halves have
  -- to hold for this to affect a row; `id` is named as well, because a policy
  -- is not a predicate this contract may leave unstated.
  update "pennsync_records"."user" as u
  set "duty_status" = case when v_set ? 'duty_status'
        then v_set ->> 'duty_status' else u."duty_status" end,
    "duty_on_since" = case when v_set ? 'duty_on_since'
        then (v_set ->> 'duty_on_since')::timestamptz else u."duty_on_since" end,
    "off_duty_message" = case when v_set ? 'off_duty_message'
        then v_set ->> 'off_duty_message' else u."off_duty_message" end,
    "scheduled_off_duty_start" = case when v_set ? 'scheduled_off_duty_start'
        then (v_set ->> 'scheduled_off_duty_start')::timestamptz else u."scheduled_off_duty_start" end,
    "scheduled_off_duty_end" = case when v_set ? 'scheduled_off_duty_end'
        then (v_set ->> 'scheduled_off_duty_end')::timestamptz else u."scheduled_off_duty_end" end,
    "scheduled_off_duty_recurring" = case when v_set ? 'scheduled_off_duty_recurring'
        then (v_set ->> 'scheduled_off_duty_recurring')::boolean else u."scheduled_off_duty_recurring" end
  where u."id" = v_user
  returning u."duty_status" into v_effective;
  get diagnostics v_written = row_count;
  if v_written <> 1 then
    raise exception using errcode='22023', message='PENNSYNC_DUTY_STATUS_NOT_FOUND';
  end if;

  -- The original's trail entry, with its own field names, in this transaction.
  perform "pennsync_records".contract_activity_append(
    p_agency, 'duty_status_changed', 'user', v_user,
    pg_catalog.jsonb_build_object(
      'duty_status', v_effective,
      'off_duty_message_set', p_patch ? 'off_duty_message',
      'scheduled_off_duty_recurring',
        case when v_set ? 'scheduled_off_duty_recurring'
          then (v_set ->> 'scheduled_off_duty_recurring')::boolean else null end));

  return pg_catalog.jsonb_build_object('success', true, 'duty_status', v_effective);
end $contract$;

revoke all on function
  "pennsync_records".duty_status_writable_fields(),
  "pennsync_records".duty_message_bounded(text),
  "pennsync_records".contract_duty_status_set(text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_duty_status_set(text,text,jsonb)
  to authenticated;

create function "public"."pennsync_contract_duty_status_set"(
  p_agency text, p_target_user_email text, p_patch jsonb) returns jsonb
  language sql security invoker set search_path = '' as $wrapper$
  select "pennsync_records".contract_duty_status_set(p_agency, p_target_user_email, p_patch)
$wrapper$;

revoke all on function
  "public"."pennsync_contract_duty_status_set"(text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_duty_status_set"(text,text,jsonb)
  to authenticated;

commit;
