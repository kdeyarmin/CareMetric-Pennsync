-- A person's own notifications: list them, mark one read, dismiss one, mark
-- them all read.
--
-- HAND WRITTEN, like every contract.
--
-- **This is the second contract where tenancy is not ownership (D36), and the
-- first where the gap is visible in the policy itself.** `notification_read`
-- and `notification_update` are agency-WIDE — every member of the agency
-- matches them — so a port that trusted the policies would have let anybody in
-- the agency read and dismiss anybody else's notifications. The predicate that
-- makes a row THIS caller's is the contract's own, and it is two columns, not
-- one: `recipient_user_id` is the identity, and `user_email` is what the
-- original's own integrity check requires to agree with it.
--
-- **The authority envelope is KEPT, and it is not a scope reconstruction.**
-- The original filters, and then re-checks, on six columns:
-- `recipient_user_id`, `recipient_membership_id`,
-- `recipient_membership_version`, `authority_version`, `authority_state` and
-- `user_email`. That looks like the derived scope D41 and D43 delete, and it is
-- the opposite: it does not ASK a self-editable field who the caller is, it
-- records which membership, at which version, a notification was minted for,
-- so a person whose membership changed stops seeing what was addressed to the
-- grant they no longer hold. The list filters on it exactly as the original
-- filters on it, which is what hides those rows rather than failing on them.
-- `recipient_membership_id` and `_version` are THIS store's membership
-- (`pennsync_private.caller_membership`), as D34 settled, never Base44's
-- `AgencyMembership` id.
--
-- **What IS deleted is the compensation around it.** `manageMyNotifications`
-- calls `revalidateScope` three to five times per request — before the read,
-- after the read, after each transition — and then re-reads the transitioned
-- row and asserts the new version, because between any two of its service-role
-- calls the caller's membership could have changed and nothing would have
-- noticed. In one transaction the scope cannot change underneath the work, so
-- the revalidation loop, the re-read and the `updateMany`
-- `{success, updated, has_more}` verification all go. `mark_all_read` becomes
-- one statement rather than one transition per row, each with three scope
-- reloads.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. The gate is membership in the named agency. The original additionally
--    admits a protected platform owner; D14 and D22 removed that tier.
-- 2. The optimistic `expected_version` is kept and is now real: the row is
--    taken `for update` and the version compared inside the transaction, so
--    the "read it back and check it moved by one" block is unnecessary.
-- 3. A `dismiss` marks the row read as well, which is the original's own
--    behaviour, and keeps the earlier `read_at` if there was one.
-- 4. An already-applied transition is `idempotent`, not an error — also the
--    original's, and it is checked BEFORE the version compare, so a retry of a
--    request that succeeded does not fail on a version it already bumped.
begin;

do $$
begin
  if to_regclass('pennsync_records.notification') is null
    or to_regprocedure('pennsync_private.caller_membership(text)') is null then
    raise exception using errcode='42501',message='PENNSYNC_CALLER_MEMBERSHIP_REQUIRED';
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
 * The original's `safeActionUrl`. A same-origin path and nothing else: a
 * notification's link is rendered as a button, so an absolute URL, a
 * protocol-relative `//host` or a backslash would be an open redirect out of
 * the product.
 */
create function "pennsync_records".notification_action_url(p_value text)
  returns text language sql immutable set search_path = '' as $url$
  select case
    when p_value is null then null
    when pg_catalog.left(p_value, 1) <> '/' then null
    when pg_catalog.left(p_value, 2) = '//' then null
    -- `position(x in y)` is a SQL construct rather than a `pg_catalog`
    -- function and cannot be schema-qualified; `strpos` is the function.
    when pg_catalog.strpos(p_value, '\') > 0 then null
    when pg_catalog.length(p_value) > 1000 then null
    -- The original's control-character class, which `chr(0)` cannot express in
    -- a PostgreSQL literal at all, so the range starts at 1 and the NUL is
    -- excluded by `notification_text` and by the column never holding one.
    when p_value ~ '[\u0001-\u001f\u007f]' then null
    else p_value end
$url$;

/* The original's `boundedText`: non-empty, bounded, and no NUL or DEL. */
create function "pennsync_records".notification_text(p_value text, p_max integer)
  returns text language sql immutable set search_path = '' as $text$
  select case
    when p_value is null then null
    when pg_catalog.length(p_value) = 0 then null
    when pg_catalog.length(p_value) > p_max then null
    when p_value ~ '[\u007f]' then null
    else p_value end
$text$;

/*
 * The original's `validateNotification`, minus the parts the envelope filter
 * already decided. A row that matched the filter can still be malformed —
 * an empty title, an unknown type, a read row with no `read_at` — and the
 * original refuses the whole answer rather than showing it, which in this
 * store can only mean a contract wrote a bad row.
 */
create function "pennsync_records".notification_sound(r "pennsync_records"."notification")
  returns boolean language sql immutable set search_path = '' as $sound$
  select "pennsync_records".notification_text(r."title", 500) is not null
    and "pennsync_records".notification_text(r."message", 5000) is not null
    and r."type" is not null and r."priority" is not null
    and r."created_date" is not null
    and r."version" is not null and r."version" >= 1
    and r."is_read" is not null and r."dismissed" is not null
    and (case when r."is_read" then r."read_at" is not null else r."read_at" is null end)
    and (case when r."dismissed" then r."dismissed_at" is not null
      else r."dismissed_at" is null end)
    and (r."action_url" is null
      or "pennsync_records".notification_action_url(r."action_url") is not null)
    and (r."action_label" is null
      or "pennsync_records".notification_text(r."action_label", 200) is not null)
$sound$;

/* The original's `projectNotification`. No `metadata`, no `user_email`, no
 * recipient identity: the caller already knows who they are, and the envelope
 * columns are authority rather than content. */
create function "pennsync_records".notification_row(r "pennsync_records"."notification")
  returns jsonb language sql stable set search_path = '' as $row$
  select jsonb_build_object(
    'id', r."id", 'agency_id', r."agency_id",
    'title', r."title", 'message', r."message",
    'type', r."type", 'priority', r."priority",
    'created_date', r."created_date",
    'is_read', r."is_read", 'read_at', r."read_at",
    'dismissed', r."dismissed", 'dismissed_at', r."dismissed_at",
    'action_url', "pennsync_records".notification_action_url(r."action_url"),
    'action_label', "pennsync_records".notification_text(r."action_label", 200),
    'version', r."version")
$row$;

/*
 * A preference this migration cannot yet read.
 *
 * The recipient's in-app preference is honoured by the READER, because
 * `notification_preference_read` is `user_email = caller_email()` and the
 * SENDER therefore cannot ask. The function that reads it arrives with the
 * create contract; until then this answers false, which is what an absent
 * preference row means anyway.
 */
create function "pennsync_records".notification_in_app_off_safe(p_type text)
  returns boolean language plpgsql stable security definer set search_path = '' as $safe$
declare v_off boolean;
begin
  if to_regprocedure('pennsync_records.notification_in_app_off(text)') is null then
    return false;
  end if;
  execute 'select "pennsync_records".notification_in_app_off($1)'
    into v_off using p_type;
  return coalesce(v_off, false);
end $safe$;

create function "pennsync_records".contract_notification_list(p_agency text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_member record; v_rows "pennsync_records"."notification"[]; v_row "pennsync_records"."notification";
  v_answer jsonb := '[]'::jsonb; v_complete boolean;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_NOTIFICATION_AGENCY_NOT_HELD';
  end if;
  select membership_id, membership_version into v_member
  from pennsync_private.caller_membership(p_agency);

  -- The original's scan limit is one more than it will show, so it can say
  -- whether the answer is the whole of it.
  select array_agg(n order by n."created_date" desc, n."id") into v_rows
  from (
    select * from "pennsync_records"."notification" n
    where n."source_app_id" = "pennsync_records".deployment_app()
      and n."agency_id" = p_agency
      and n."recipient_user_id" = "pennsync_records".caller_user_id()
      and n."user_email" = "pennsync_records".caller_email()
      and n."recipient_membership_id" = v_member.membership_id
      and n."recipient_membership_version" = v_member.membership_version
      and n."authority_version" = 1 and n."authority_state" = 'active'
      and n."dismissed" is not true
      -- The recipient's own in-app preference, honoured HERE because the
      -- sender cannot read it: `notification_preference_read` is
      -- `user_email = caller_email()`, so only this session can ask. It is
      -- also the more correct place — the preference that decides what
      -- somebody sees is the one they hold now, not the one they held when it
      -- was sent — and the row is retained either way, so what was sent stays
      -- answerable. Added by the create contract's migration; until that
      -- applies the function does not exist and every row is shown, which is
      -- the same answer an absent preference row gives.
      and not "pennsync_records".notification_in_app_off_safe(n."type")
    order by n."created_date" desc, n."id"
    limit 101
  ) n;
  v_complete := coalesce(array_length(v_rows, 1), 0) <= 100;
  foreach v_row in array coalesce(v_rows, array[]::"pennsync_records"."notification"[]) loop
    if v_answer > '[]'::jsonb and jsonb_array_length(v_answer) >= 100 then exit; end if;
    if not "pennsync_records".notification_sound(v_row) then
      raise exception using errcode='22023', message='PENNSYNC_NOTIFICATION_INTEGRITY';
    end if;
    v_answer := v_answer || "pennsync_records".notification_row(v_row);
  end loop;
  return jsonb_build_object('success', true, 'action', 'list',
    'agency_id', p_agency, 'notifications', v_answer, 'complete', v_complete);
end $contract$;

create function "pennsync_records".contract_notification_transition(
  p_agency text, p_notification_id text, p_expected_version bigint, p_action text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_member record; v_row "pennsync_records"."notification"; v_now timestamptz;
  v_applied boolean;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_NOTIFICATION_AGENCY_NOT_HELD';
  end if;
  if p_action is null or p_action not in ('mark_read', 'dismiss') then
    raise exception using errcode='22023', message='PENNSYNC_NOTIFICATION_ACTION_INVALID';
  end if;
  if p_notification_id is null or p_notification_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_NOTIFICATION_SUBJECT_INVALID';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode='22023', message='PENNSYNC_NOTIFICATION_VERSION_INVALID';
  end if;
  select membership_id, membership_version into v_member
  from pennsync_private.caller_membership(p_agency);

  -- The whole envelope in the predicate, so a notification addressed to a
  -- membership the caller no longer holds is simply not found — the same
  -- answer the original's filter gives it.
  select * into v_row from "pennsync_records"."notification" n
  where n."source_app_id" = "pennsync_records".deployment_app()
    and n."id" = p_notification_id
    and n."agency_id" = p_agency
    and n."recipient_user_id" = "pennsync_records".caller_user_id()
    and n."user_email" = "pennsync_records".caller_email()
    and n."recipient_membership_id" = v_member.membership_id
    and n."recipient_membership_version" = v_member.membership_version
    and n."authority_version" = 1 and n."authority_state" = 'active'
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_NOTIFICATION_NOT_FOUND';
  end if;
  if not "pennsync_records".notification_sound(v_row) then
    raise exception using errcode='22023', message='PENNSYNC_NOTIFICATION_INTEGRITY';
  end if;

  -- Divergence 4: already applied is idempotent, and is answered BEFORE the
  -- version compare, so retrying a request that succeeded does not fail on the
  -- version it itself moved.
  v_applied := case when p_action = 'mark_read' then v_row."is_read" else v_row."dismissed" end;
  if v_applied then
    return jsonb_build_object('success', true, 'action', p_action, 'idempotent', true,
      'notification', "pennsync_records".notification_row(v_row));
  end if;
  if v_row."version" <> p_expected_version then
    raise exception using errcode='40001', message='PENNSYNC_NOTIFICATION_STALE';
  end if;

  v_now := clock_timestamp();
  update "pennsync_records"."notification" n set
    -- Divergence 3: a dismiss marks it read too, and keeps the earlier moment
    -- if it already was.
    "is_read" = true,
    "read_at" = case when n."is_read" then n."read_at" else v_now end,
    "dismissed" = case when p_action = 'dismiss' then true else n."dismissed" end,
    "dismissed_at" = case when p_action = 'dismiss' then v_now else n."dismissed_at" end,
    "version" = n."version" + 1,
    "updated_date" = v_now
  where n."source_app_id" = v_row."source_app_id" and n."id" = v_row."id"
  returning * into v_row;
  return jsonb_build_object('success', true, 'action', p_action, 'idempotent', false,
    'notification', "pennsync_records".notification_row(v_row));
end $contract$;

create function "pennsync_records".contract_notification_mark_all(p_agency text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_member record; v_now timestamptz; v_marked integer;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_NOTIFICATION_AGENCY_NOT_HELD';
  end if;
  select membership_id, membership_version into v_member
  from pennsync_private.caller_membership(p_agency);
  v_now := clock_timestamp();
  -- One statement. The original runs a full transition per row, each with its
  -- own three scope reloads and a read-back, which is why it also has to
  -- report how much of the page it got through.
  with marked as (
    update "pennsync_records"."notification" n set
      "is_read" = true, "read_at" = v_now,
      "version" = n."version" + 1, "updated_date" = v_now
    where n."source_app_id" = "pennsync_records".deployment_app()
      and n."agency_id" = p_agency
      and n."recipient_user_id" = "pennsync_records".caller_user_id()
      and n."user_email" = "pennsync_records".caller_email()
      and n."recipient_membership_id" = v_member.membership_id
      and n."recipient_membership_version" = v_member.membership_version
      and n."authority_version" = 1 and n."authority_state" = 'active'
      and n."dismissed" is not true and n."is_read" is not true
      and not "pennsync_records".notification_in_app_off_safe(n."type")
    returning 1)
  select count(*)::integer into v_marked from marked;
  return jsonb_build_object('success', true, 'action', 'mark_all_read',
    'agency_id', p_agency, 'marked', v_marked, 'complete', true);
end $contract$;

reset role;

revoke all on function
  "pennsync_records".notification_in_app_off_safe(text),
  "pennsync_records".notification_action_url(text),
  "pennsync_records".notification_text(text,integer),
  "pennsync_records".notification_sound("pennsync_records"."notification"),
  "pennsync_records".notification_row("pennsync_records"."notification"),
  "pennsync_records".contract_notification_list(text),
  "pennsync_records".contract_notification_transition(text,text,bigint,text),
  "pennsync_records".contract_notification_mark_all(text)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_notification_list(text),
  "pennsync_records".contract_notification_transition(text,text,bigint,text),
  "pennsync_records".contract_notification_mark_all(text)
  to authenticated;

create function "public"."pennsync_contract_notification_list"(p_agency text)
  returns jsonb language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_notification_list(p_agency)
$contract$;

create function "public"."pennsync_contract_notification_transition"(
  p_agency text, p_notification_id text, p_expected_version bigint, p_action text)
  returns jsonb language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_notification_transition(
    p_agency, p_notification_id, p_expected_version, p_action)
$contract$;

create function "public"."pennsync_contract_notification_mark_all"(p_agency text)
  returns jsonb language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_notification_mark_all(p_agency)
$contract$;

revoke all on function
  "public"."pennsync_contract_notification_list"(text),
  "public"."pennsync_contract_notification_transition"(text,text,bigint,text),
  "public"."pennsync_contract_notification_mark_all"(text)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_notification_list"(text),
  "public"."pennsync_contract_notification_transition"(text,text,bigint,text),
  "public"."pennsync_contract_notification_mark_all"(text)
  to authenticated;

commit;
