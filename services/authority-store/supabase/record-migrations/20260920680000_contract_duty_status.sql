-- The self-service duty toggle: the first capability to WRITE a profile row
-- through a contract, and the port D82 named as the next one.
--
-- HAND WRITTEN, like every contract.
--
-- The filename's suffix is 680000 because `planMigration` sorts each
-- directory's filenames and refuses `MIGRATE_OUT_OF_ORDER` the moment an
-- APPLIED file sorts after a PENDING one. `assertNewestRecordMigration` moves
-- to this suite with this file, and the compliance-writes suite drops the call
-- rather than widening it, which is the documented handover: a suite whose
-- migration has merged is no longer the newest pending name.
--
-- ============================================================ authorization
--
-- This contract carries NO ownership check, and that is the decision rather
-- than an omission. D82 gave `pennsync_records.user` one update policy —
-- `id = caller_user_id()`, the same predicate in `using` and `with check` —
-- and one `before update` trigger admitting only `PROFILE_SELF_WRITABLE`.
-- Forced RLS binds `pennsync_records_owner`, so a SECURITY DEFINER contract is
-- bound by both. Tenancy IS ownership on this table, which is D37's reading of
-- `ai_content_agreement_attestation` and the opposite of D36's and D45's; the
-- policy is read before deciding which case applies, as those two require.
--
-- So the contract names the caller's own row because that is how a row is
-- selected, and the policy independently refuses anything else. A second
-- predicate here would be a second answer to keep in agreement with the first.
--
-- =============================================== a PARTIAL port, and which half
--
-- `setNurseDutyStatus` has two legs. The SELF leg is served whole. The leg that
-- names somebody else — `target_user_email` different from the caller's own
-- address — is REFUSED BY NAME as `PENNSYNC_DUTY_TARGET_FORBIDDEN`, because the
-- original gates it on `isProtectedSuperAdmin`: the `SUPER_ADMIN_EMAIL` holder,
-- the platform tier D14 and D22 removed. D40's widening reaches a capability
-- whose only gate is the built-in `role === 'admin'` and does NOT reach this
-- one, so naming an `agency_admin` as the successor would be a widening nobody
-- has taken. This is D81's shape: the leg that has a performer ships, the leg
-- that lost its performer answers by name rather than silently.
--
-- A `target_user_email` EQUAL to the caller's own address is accepted, because
-- the original accepts it — its guard is `target_user_email && target_user_email
-- !== user.email`, so naming yourself is a no-op there and is one here.
--
-- ================================================== divergences, all narrowings
--
-- 1. **`blockedActor` is not ported, because it is already the floor.** The
--    original refuses a caller whose `User` row is inactive, disabled, a
--    service account or unverified. Every one is a carried, self-editable label
--    D23 says must never authorize, and it does not have to here:
--    `pennsync_private.actor` admits an identity only while
--    `enabled and revoked_at is null`, so a revoked person has no caller
--    identity and every `caller_*` helper answers null. D37's rule.
--
-- 2. **`hasExactActiveAgencyMembership` DISAPPEARS.** That helper reads
--    `AgencyMembership` twice, asks for two rows so it can refuse ambiguity,
--    and re-compares the normalized address — all compensations for having no
--    transaction over an entity any writer could corrupt (D68). Membership is
--    `caller_tenant_role(p_agency)` here, which is one question with one answer.
--
-- 3. **The audit entry carries no `user_name`.** The original stamps
--    `user.full_name`, and the carried `user` table has no name column (D38
--    found the same). Read that half narrowly, because "no column at all"
--    reads as a property of the STORE and is not one: the store does hold a
--    name, `pennsync_private.staff_name`, keyed per person. It is force-RLS
--    with NO policy, so nobody reads or writes it by any path, the record
--    owner included, and its `like 'Synthetic %'` check keeps the real-names
--    hold in the database rather than by hand. So that leg rests on a HOLD,
--    which can lift, and not on an absence, which reads as permanent.
--    The leg that does not move either way is D25's: the trail stamps its
--    actor from the caller helpers and refuses a payload naming one, so there
--    is nothing to pass whatever becomes of the hold.
--
-- 4. **The off-duty message's cap folds UTF-16 CODE UNITS.** The original does
--    `slice(0, 320)`, which counts code units, so an astral character costs two
--    — D33's `bounded_reason` lesson and D31's `note_fnv1a` lesson in the same
--    place. `duty_message_clean` below reproduces it, and never splits a
--    surrogate pair: PostgreSQL cannot store a lone surrogate, so a message
--    ending exactly on the boundary loses that one character rather than
--    becoming unstorable. That is the only respect in which it is not
--    byte-exact, and it is a narrowing.
--
-- 5. **The date validation is a text parse, not a `timestamptz` parameter.**
--    D38's reason: taking a `date` or `timestamptz` parameter would let the
--    client's driver decide what an impossible value means, and the original
--    answers `Scheduled start and end must both be valid dates` for one. The
--    payload arrives as jsonb and is cast under an exception handler.
--
-- 6. **`UserActivity` is `retire`; the audit goes to D25's trail.** The
--    original's `.catch(() => {})` around it is not carried — in one
--    transaction the write and its record cannot disagree, which is D37's
--    reading, so there is no `audit_recorded` flag either (D53's rule: it
--    belongs wherever a transaction does not).
--
-- What this does NOT decide: the ADMINISTRATIVE write path on this table stays
-- unbuilt, exactly as D82's own generated comment says. Nothing here widens
-- `PROFILE_SELF_WRITABLE`, adds a policy, or touches the guard.
begin;

do $$
begin
  if to_regclass('pennsync_records.user') is null
    or to_regprocedure('pennsync_records.contract_activity_append(text,text,text,text,jsonb)') is null then
    raise exception using errcode='42501',message='PENNSYNC_ACTIVITY_TRAIL_REQUIRED';
  end if;
end $$;

-- D82's two objects are what this contract writes THROUGH. A store missing
-- either would accept every write this makes and enforce neither half, so the
-- contract refuses to install rather than running unbound. The policy is named
-- rather than inferred, because "some update policy exists" is the thing that
-- would be true of an administrative one too.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pennsync_records' and c.relname = 'user' and p.polname = 'user_update')
    or not exists (
      select 1 from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'pennsync_records' and c.relname = 'user'
        and t.tgname = 'user_self_write_guard' and not t.tgisinternal
        and t.tgenabled <> 'D') then
    raise exception using errcode='42501',message='PENNSYNC_PROFILE_SELF_WRITE_REQUIRED';
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
 * The original's sanitizer, in its own order.
 *
 *   value.replace(/[<>]/g, "")
 *        .replace(/[\u0000-\u001F\u007F]/g, " ")
 *        .slice(0, 320)
 *
 * The order matters and is preserved: stripping the angle brackets first means
 * a control character between them survives as a space rather than being eaten
 * with them. The message is spoken to callers by TTS and sent as an SMS
 * auto-reply, which is why the original sanitizes on WRITE rather than on read.
 *
 * `[[:cntrl:]]` is deliberately NOT used: in a multibyte encoding its meaning
 * follows the server's locale, and on some it also matches U+0080-U+009F, which
 * the original leaves alone. The explicit range is the original's own.
 *
 * The cap counts UTF-16 CODE UNITS, because `String.prototype.slice` does. A
 * character above U+FFFF costs two, so a message of 200 emoji is cut at 160
 * characters here exactly as it is there. The one divergence: where the cut
 * would fall BETWEEN the two halves of a surrogate pair, the character is
 * dropped whole. PostgreSQL will not store a lone surrogate, so reproducing
 * that byte-for-byte is not available; losing the character is the narrowing.
 */
create function "pennsync_records".duty_message_clean(p_value text)
  returns text language plpgsql immutable set search_path = '' as $clean$
declare
  v_text text; v_units int := 0; v_out text := ''; v_ch text; v_cost int;
begin
  if p_value is null then return null; end if;
  v_text := pg_catalog.regexp_replace(p_value, '[<>]', '', 'g');
  v_text := pg_catalog.regexp_replace(v_text, '[\u0000-\u001F\u007F]', ' ', 'g');
  -- Fast path: no astral character, so characters and code units agree.
  if v_text !~ '[\U00010000-\U0010FFFF]' then
    return pg_catalog.left(v_text, 320);
  end if;
  for v_ch in select c from pg_catalog.regexp_split_to_table(v_text, '') as c loop
    v_cost := case when pg_catalog.ascii(v_ch) > 65535 then 2 else 1 end;
    exit when v_units + v_cost > 320;
    v_units := v_units + v_cost;
    v_out := v_out || v_ch;
  end loop;
  return v_out;
end $clean$;

/*
 * A jsonb value that must be an ISO timestamp or json null, as the original's
 * `new Date(x).getTime()` sees it. Returns the parsed value; `p_ok` says
 * whether it parsed at all, so a caller can tell an unparseable string from a
 * deliberate null — which the original's `Number.isNaN` check is doing.
 *
 * `::timestamptz` is WIDER than `new Date()` in one direction that matters, so
 * the widening is closed here rather than inherited. PostgreSQL accepts eight
 * special inputs no JavaScript Date parses — `infinity` and `-infinity`, and
 * the context-dependent `now`, `today`, `tomorrow`, `yesterday`, `epoch` and
 * `allballs` — every one of which is `NaN` to the original and refused. Left
 * alone, `infinity` persists a window that never ends and `tomorrow` persists
 * one that means something different on the day it is read. They are refused
 * by name before the cast, and a non-finite result is refused after it, because
 * a value that is a duty window forever is the failure worth catching twice.
 */
create function "pennsync_records".duty_parse_moment(p_value jsonb, out ok boolean, out at timestamptz)
  language plpgsql immutable set search_path = '' as $parse$
begin
  ok := false; at := null;
  if p_value is null or pg_catalog.jsonb_typeof(p_value) = 'null' then
    ok := true; return;
  end if;
  if pg_catalog.jsonb_typeof(p_value) <> 'string' then return; end if;
  if pg_catalog.lower(pg_catalog.btrim(p_value #>> '{}')) in (
    'infinity', '+infinity', '-infinity',
    'now', 'today', 'tomorrow', 'yesterday', 'epoch', 'allballs') then
    return;
  end if;
  begin
    at := (p_value #>> '{}')::timestamptz;
    ok := true;
  exception when others then
    ok := false; at := null;
  end;
  if ok and (at = 'infinity'::timestamptz or at = '-infinity'::timestamptz) then
    ok := false; at := null;
  end if;
end $parse$;

/*
 * JavaScript truthiness over a jsonb value, because the original writes
 * `!!scheduled_off_duty_recurring` and reads `if (target_user_email …)`.
 *
 * `(x ->> 'k')::boolean` is NOT that test and disagrees in both directions:
 * the string `"false"` is truthy in JavaScript and false to PostgreSQL, the
 * string `"0"` likewise, and an object or array raises `invalid_text_
 * representation` rather than answering — which would leave a malformed body
 * arriving as an undeclared error instead of a refusal the boundary can name.
 * So the rule is reproduced rather than approximated: false for json null,
 * `false`, zero and the empty string; true for everything else, arrays and
 * objects included.
 */
create function "pennsync_records".duty_truthy(p_value jsonb) returns boolean
  language sql immutable set search_path = '' as $truthy$
  select case
    when p_value is null then false
    when pg_catalog.jsonb_typeof(p_value) = 'null' then false
    when pg_catalog.jsonb_typeof(p_value) = 'boolean' then (p_value #>> '{}') = 'true'
    when pg_catalog.jsonb_typeof(p_value) = 'number' then (p_value #>> '{}')::numeric <> 0
    when pg_catalog.jsonb_typeof(p_value) = 'string' then (p_value #>> '{}') <> ''
    else true
  end
$truthy$;

/*
 * `setNurseDutyStatus`, self leg.
 *
 * `p_updates` is the request body as jsonb rather than a parameter per field,
 * because the original distinguishes a key that is ABSENT from one whose value
 * is `null`: absent means "leave it", null means "clear it". A SQL parameter
 * list cannot express that difference, and collapsing it would make clearing a
 * schedule indistinguishable from not touching one.
 *
 * The checks run in the original's own order, so a body with two faults gets
 * the same refusal it gets today.
 */
create function "pennsync_records".contract_duty_status_set(p_agency text, p_updates jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_user text; v_email text; v_now timestamptz; v_details jsonb;
  v_status text; v_message text; v_has_message boolean;
  v_start_key boolean; v_end_key boolean; v_clearing boolean := false;
  v_start_ok boolean; v_start_at timestamptz;
  v_end_ok boolean; v_end_at timestamptz; v_recurring boolean;
  v_set jsonb := '{}'::jsonb; v_row record;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_DUTY_AGENCY_NOT_HELD';
  end if;
  v_user := "pennsync_records".caller_user_id();
  v_email := "pennsync_records".caller_email();
  if v_user is null or v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_DUTY_AGENCY_NOT_HELD';
  end if;
  if p_updates is null or pg_catalog.jsonb_typeof(p_updates) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_DUTY_BODY_INVALID';
  end if;

  -- duty_status. The original tests truthiness, so json null and the empty
  -- string both mean "not supplied" rather than "invalid".
  if p_updates ? 'duty_status'
    and pg_catalog.jsonb_typeof(p_updates -> 'duty_status') = 'string'
    and (p_updates ->> 'duty_status') <> '' then
    v_status := p_updates ->> 'duty_status';
    if v_status not in ('on_duty', 'off_duty') then
      raise exception using errcode='22023', message='PENNSYNC_DUTY_STATUS_INVALID';
    end if;
  elsif p_updates ? 'duty_status'
    and pg_catalog.jsonb_typeof(p_updates -> 'duty_status') not in ('null', 'string') then
    -- A non-string truthy value (a number, an object) reaches the original's
    -- `includes` check and fails it.
    raise exception using errcode='22023', message='PENNSYNC_DUTY_STATUS_INVALID';
  end if;

  -- The scheduled window. Start and end move together: both absent leaves it,
  -- both null clears it, both strings set it. A one-sided body is refused
  -- rather than half-persisted.
  v_start_key := p_updates ? 'scheduled_off_duty_start';
  v_end_key := p_updates ? 'scheduled_off_duty_end';
  if v_start_key <> v_end_key then
    raise exception using errcode='22023', message='PENNSYNC_DUTY_SCHEDULE_PAIR_REQUIRED';
  end if;
  if v_start_key then
    if pg_catalog.jsonb_typeof(p_updates -> 'scheduled_off_duty_start') = 'null'
      and pg_catalog.jsonb_typeof(p_updates -> 'scheduled_off_duty_end') = 'null' then
      v_clearing := true;
    elsif pg_catalog.jsonb_typeof(p_updates -> 'scheduled_off_duty_start') = 'null'
      or pg_catalog.jsonb_typeof(p_updates -> 'scheduled_off_duty_end') = 'null' then
      raise exception using errcode='22023', message='PENNSYNC_DUTY_SCHEDULE_INCOMPLETE';
    else
      select ok, at into v_start_ok, v_start_at
        from "pennsync_records".duty_parse_moment(p_updates -> 'scheduled_off_duty_start');
      select ok, at into v_end_ok, v_end_at
        from "pennsync_records".duty_parse_moment(p_updates -> 'scheduled_off_duty_end');
      if not v_start_ok or not v_end_ok or v_start_at is null or v_end_at is null then
        raise exception using errcode='22023', message='PENNSYNC_DUTY_SCHEDULE_INVALID';
      end if;
      if v_end_at <= v_start_at then
        raise exception using errcode='22023', message='PENNSYNC_DUTY_SCHEDULE_BACKWARDS';
      end if;
      if "pennsync_records".duty_truthy(p_updates -> 'scheduled_off_duty_recurring')
        and v_end_at - v_start_at >= interval '7 days' then
        raise exception using errcode='22023', message='PENNSYNC_DUTY_SCHEDULE_TOO_LONG';
      end if;
    end if;
  end if;

  -- Whose row. The original accepts an address equal to the caller's own and
  -- gates anything else on the platform owner D14 and D22 removed, so that leg
  -- is refused by name rather than silently dropped.
  --
  -- The comparison is EXACT, because the original's is: `target_user_email !==
  -- user.email` sends an address that differs only in case or padding down the
  -- protected-owner branch, where an ordinary caller is refused. Folding case
  -- here would accept a body the original rejects, which is a widening and not
  -- this port's to take. A non-string that is truthy is refused for the same
  -- reason — it can never be `===` a string, so the original refuses it too.
  if "pennsync_records".duty_truthy(p_updates -> 'target_user_email') then
    if pg_catalog.jsonb_typeof(p_updates -> 'target_user_email') <> 'string'
      or (p_updates ->> 'target_user_email') <> v_email then
      raise exception using errcode='42501', message='PENNSYNC_DUTY_TARGET_FORBIDDEN';
    end if;
  end if;

  -- The off-duty message. `undefined` leaves it; null clears it; anything not a
  -- string is refused, as the original refuses it.
  v_has_message := p_updates ? 'off_duty_message';
  if v_has_message then
    if pg_catalog.jsonb_typeof(p_updates -> 'off_duty_message') = 'null' then
      v_message := null;
    elsif pg_catalog.jsonb_typeof(p_updates -> 'off_duty_message') = 'string' then
      v_message := "pennsync_records".duty_message_clean(p_updates ->> 'off_duty_message');
    else
      raise exception using errcode='22023', message='PENNSYNC_DUTY_MESSAGE_INVALID';
    end if;
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_status is not null then
    -- The stamp is what makes an on-duty toggle expire on its own overnight:
    -- the inbound webhook treats a toggle set on an earlier day as off, so the
    -- column is cleared when toggling off rather than left pointing at a day
    -- nobody is working.
    v_set := v_set || pg_catalog.jsonb_build_object(
      'duty_status', v_status,
      'duty_on_since', case when v_status = 'on_duty' then pg_catalog.to_jsonb(v_now) else 'null'::jsonb end);
  end if;
  if v_has_message then
    v_set := v_set || pg_catalog.jsonb_build_object('off_duty_message', v_message);
  end if;
  if v_start_key then
    v_set := v_set || pg_catalog.jsonb_build_object(
      'scheduled_off_duty_start', case when v_clearing then 'null'::jsonb else pg_catalog.to_jsonb(v_start_at) end,
      'scheduled_off_duty_end', case when v_clearing then 'null'::jsonb else pg_catalog.to_jsonb(v_end_at) end);
  end if;
  if p_updates ? 'scheduled_off_duty_recurring' then
    v_recurring := "pennsync_records".duty_truthy(p_updates -> 'scheduled_off_duty_recurring');
    v_set := v_set || pg_catalog.jsonb_build_object('scheduled_off_duty_recurring', v_recurring);
  end if;
  -- Clearing the window drops any recurrence with it, so a repeat cannot
  -- outlive the dates it was repeating.
  if v_clearing then
    v_set := v_set || pg_catalog.jsonb_build_object('scheduled_off_duty_recurring', false);
  end if;
  if v_set = '{}'::jsonb then
    raise exception using errcode='22023', message='PENNSYNC_DUTY_NOTHING_TO_UPDATE';
  end if;

  -- The row is named by `caller_user_id()` because that is how a row is
  -- selected; D82's policy is what refuses anything else, and its guard is what
  -- refuses a column. Nothing here re-answers either.
  update "pennsync_records"."user" u
  set "duty_status" = coalesce(v_set ->> 'duty_status', u."duty_status"),
      "duty_on_since" = case when v_set ? 'duty_status'
        then (v_set ->> 'duty_on_since')::timestamptz else u."duty_on_since" end,
      "off_duty_message" = case when v_set ? 'off_duty_message'
        then v_set ->> 'off_duty_message' else u."off_duty_message" end,
      "scheduled_off_duty_start" = case when v_set ? 'scheduled_off_duty_start'
        then (v_set ->> 'scheduled_off_duty_start')::timestamptz else u."scheduled_off_duty_start" end,
      "scheduled_off_duty_end" = case when v_set ? 'scheduled_off_duty_end'
        then (v_set ->> 'scheduled_off_duty_end')::timestamptz else u."scheduled_off_duty_end" end,
      "scheduled_off_duty_recurring" = case when v_set ? 'scheduled_off_duty_recurring'
        then (v_set ->> 'scheduled_off_duty_recurring')::boolean else u."scheduled_off_duty_recurring" end,
      "updated_date" = v_now
  where u."source_app_id" = "pennsync_records".deployment_app()
    and u."id" = v_user
  returning u."duty_status", u."off_duty_message", u."scheduled_off_duty_start",
    u."scheduled_off_duty_end", u."scheduled_off_duty_recurring"
  into v_row;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_DUTY_AGENCY_NOT_HELD';
  end if;

  -- D25's trail, in the same transaction as the write it records. The original
  -- writes `UserActivity` behind a `.catch(() => {})`, which is a compensation
  -- for two round trips; here neither half can exist without the other, so
  -- there is no `audit_recorded` flag to report (D53).
  --
  -- The recurrence key is present only when this call WROTE recurrence. The
  -- original records `update.scheduled_off_duty_recurring`, which is
  -- `undefined` when the field was not supplied and no window was cleared, and
  -- `JSON.stringify` drops an undefined value rather than storing it. Recording
  -- the row's standing value instead would make a duty-status-only change read
  -- as though recurrence took part in it.
  v_details := pg_catalog.jsonb_build_object(
    'duty_status', v_row."duty_status",
    'off_duty_message_set', v_has_message,
    'severity', 'info');
  if v_set ? 'scheduled_off_duty_recurring' then
    v_details := v_details || pg_catalog.jsonb_build_object(
      'scheduled_off_duty_recurring', v_row."scheduled_off_duty_recurring");
  end if;
  perform "pennsync_records".contract_activity_append(
    p_agency, 'duty_status_changed', 'user', v_user, v_details);

  return pg_catalog.jsonb_build_object(
    'success', true,
    'duty_status', v_row."duty_status",
    'off_duty_message', v_row."off_duty_message",
    'scheduled_off_duty_start', v_row."scheduled_off_duty_start",
    'scheduled_off_duty_end', v_row."scheduled_off_duty_end",
    'scheduled_off_duty_recurring', v_row."scheduled_off_duty_recurring");
end $contract$;

reset role;

revoke all on function
  "pennsync_records".duty_message_clean(text),
  "pennsync_records".duty_parse_moment(jsonb),
  "pennsync_records".duty_truthy(jsonb),
  "pennsync_records".contract_duty_status_set(text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_duty_status_set(text,jsonb)
  to authenticated;

create function "public"."pennsync_contract_duty_status_set"(p_agency text, p_updates jsonb)
  returns jsonb language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_duty_status_set(p_agency, p_updates)
$contract$;

revoke all on function "public"."pennsync_contract_duty_status_set"(text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_duty_status_set"(text,jsonb)
  to authenticated;

commit;
