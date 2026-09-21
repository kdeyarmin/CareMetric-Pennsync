-- Reminding an agency about its ADR response deadlines.
--
-- HAND WRITTEN, like every contract, and the FIRST sweep under D49 with
-- nothing paused: its reminder is a `Notification` ROW rather than an email, so
-- there is no `Core.SendEmail` to broker and the capability ports whole.
--
-- **It is also the evidence for why `notification_mint` exists.** This original
-- creates its reminder with `user_email`, `title`, `message`, `type`,
-- `priority`, `metadata`, `is_read`, `action_url` and `action_label` — and none
-- of `recipient_user_id`, `recipient_membership_id`,
-- `recipient_membership_version`, `authority_version` or `version`.
-- `manageMyNotifications` FILTERS on all of those, so in Base44 today an ADR
-- deadline reminder matches no reader's filter and is never shown.
-- `submitIncidentReport` has the same shape and the same result. That is a
-- defect in the product, not in the port, and it is why the envelope is a
-- facility here rather than a thing each caller remembers: minting through
-- `notification_mint` makes it impossible to repeat.
--
-- The planning rules are the original's `planAdrDeadlineReminders`, which is a
-- pure function it already factored out, so they are ported rather than
-- reinvented: the open statuses, the `[7, 3, 1, 0]` pre-window, the seven-day
-- overdue window, the once-a-day claim, and the two message shapes with their
-- exact wording — *"Documentation not received by the deadline is treated as
-- missing and the claim is denied."*
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. D40's gate for the human path; the machine path is D49's open decision.
-- 2. **The scope is the CHART, because this table has no agency of its own.**
--    `adr_audit_case` carries its own `agency_id` since D61 — its only tenant
--    path had been an OPTIONAL `patient_id`, so a case filed before a chart
--    existed was in no tenant at all — and D24 still narrows it to the chart
--    wherever a subject is named.
--    The contract still names the agency in its own predicate rather than
--    leaning on the policy alone: `caller_agencies()` returns EVERY agency the
--    caller holds, so a caller holding two would otherwise sweep the other's
--    cases while asking about this one.
--
--    One consequence to know, and it is the schema's rather than this
--    contract's: a case with a null `patient_id` is in no chart and therefore
--    in no tenant, so it is invisible to everyone — the same shape D27 found
--    for a `Document` bound to an agency and no patient. Such a case is
--    reminded by nobody, and no predicate here can reach it.
--
--    The original scans the 300 newest open cases across every tenant.
-- 3. **The recipient must still be a member.** The original notifies whatever
--    address is on `created_by`; here it is resolved through
--    `pennsync_private.agency_roster`, so a case created by somebody who has
--    left the agency reminds nobody rather than minting a row addressed to an
--    identity that no longer exists. Those cases are RETURNED in the answer as
--    `unreachable`, because a deadline with no owner is the thing an
--    administrator most needs to see.
-- 4. The claim is the original's `last_notified_date` — once a day per case —
--    and it is written here because the notification really is created. Its
--    `claimed_by` run token and the release-on-failure path go with the
--    transaction: a reminder and its claim cannot now disagree. A SECOND
--    enforcement sits under it, and the two CAN disagree: the claim is a field
--    on the case that anything may edit, while `notification_dedupe_key_unique`
--    is an index. When they disagree the index wins, the case is counted
--    `already_reminded`, and the `unique_violation` is caught BY NAME so any
--    other one still raises.
-- 5. The 300-row cap goes, for the reason the original's own comment gives for
--    filtering inside it: *"an unfiltered newest-300 scan let an older
--    still-open case fall off the window as closed/submitted cases accumulated
--    — and silently stop receiving reminders."* A SQL `where` has no window to
--    fall off.
begin;

do $$
begin
  if to_regclass('pennsync_records.adr_audit_case') is null
    or to_regprocedure('pennsync_private.agency_roster(text)') is null
    or to_regprocedure('pennsync_records.notification_mint(text,text,text,text,integer,'
      || 'text,text,text,text,text,text,jsonb,text)') is null then
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

/* The original's title, word for word including its two emoji. */
create function "pennsync_records".adr_reminder_title(p_days integer)
  returns text language sql immutable set search_path = '' as $title$
  select case
    when p_days > 0 then '⏰ ADR response due in ' || p_days || ' day'
      || case when p_days = 1 then '' else 's' end
    when p_days = 0 then '⏰ ADR response due TODAY'
    else '🚨 ADR response overdue by ' || (-p_days) || ' day'
      || case when p_days = -1 then '' else 's' end end
$title$;

/* And its message, which says what a missed deadline costs. */
create function "pennsync_records".adr_reminder_message(
  p_name text, p_due date, p_days integer)
  returns text language sql immutable set search_path = '' as $message$
  select case when p_days >= 0
    then p_name || ': the documentation response is due '
      || pg_catalog.to_char(p_due, 'YYYY-MM-DD')
      || '. Documentation not received by the deadline is treated as missing '
      || 'and the claim is denied.'
    else p_name || ': the response deadline ('
      || pg_catalog.to_char(p_due, 'YYYY-MM-DD')
      || ') has passed. Submit immediately and contact the contractor — '
      || 'late documentation is treated as missing.' end
$message$;

create function "pennsync_records".contract_adr_deadline_sweep(p_agency text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_today date; v_case record; v_owner record; v_days integer; v_name text;
  v_notified integer := 0; v_unreachable jsonb := '[]'::jsonb; v_sent jsonb := '[]'::jsonb;
  v_now timestamptz; v_id text; v_already integer := 0; v_constraint text;
begin
  -- Divergence 1. The original admits the built-in admin, or a shared secret.
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_ADR_FORBIDDEN';
  end if;
  v_today := "pennsync_records".agency_today();
  v_now := clock_timestamp();

  for v_case in
    -- Divergences 2 and 5: this agency's open cases, with no window to fall
    -- off. The planner's own filters are here as the WHERE clause.
    select c."id", c."created_by", c."case_name", c."patient_name",
      c."response_due_date", c."deadline_reminders"
    from "pennsync_records"."adr_audit_case" c
    where c."source_app_id" = "pennsync_records".deployment_app()
      -- Divergence 2: the agency is NAMED rather than left to
      -- `caller_agencies()`, which returns every agency the caller holds.
      -- Since D61 the case carries its own `agency_id`; before it, its only
      -- tenant path was an optional `patient_id`, so a case filed before a
      -- chart existed belonged to nobody.
      and c."agency_id" = p_agency
      and c."status" in ('letter_uploaded', 'checklist_ready', 'packet_uploaded',
        'packet_verified', 'packet_generated')
      and c."created_by" is not null and c."created_by" <> ''
      and c."response_due_date" is not null
      -- The pre-window and the seven-day overdue window, as the planner has
      -- them. Anything else is not a reminder day.
      and ((c."response_due_date" - v_today) in (7, 3, 1, 0)
        or ((c."response_due_date" - v_today) < 0
          and (c."response_due_date" - v_today) >= -7))
      -- Divergence 4: once a day per case, which is the original's claim.
      and coalesce(c."deadline_reminders" ->> 'last_notified_date', '')
        <> pg_catalog.to_char(v_today, 'YYYY-MM-DD')
    order by c."response_due_date", c."id"
  loop
    v_days := v_case."response_due_date" - v_today;
    v_name := coalesce(nullif(v_case."case_name", ''),
      nullif(v_case."patient_name", ''), 'an ADR case');

    -- Divergence 3: the owner must still be a member of this agency.
    select r.base44_user_id, r.expected_email, r.membership_id, r.membership_version
    into v_owner
    from pennsync_private.agency_roster(p_agency) r
    where r.expected_email = pg_catalog.lower(pg_catalog.btrim(v_case."created_by"));
    if v_owner.base44_user_id is null then
      v_unreachable := v_unreachable || jsonb_build_object(
        'case_id', v_case."id", 'created_by', v_case."created_by",
        'days_left', v_days, 'response_due_date', v_case."response_due_date");
      continue;
    end if;

    -- The once-a-day rule is enforced TWICE on purpose, and the two can
    -- disagree: the claim below is a field on the case, which anything may
    -- edit, while the dedupe key is a unique index. When they disagree the
    -- index wins and the case is counted as already reminded, because a
    -- second reminder is the thing the rule exists to prevent. The catch is
    -- BY NAME, as D30 and D44 require, so any other violation still raises.
    begin
      v_id := "pennsync_records".notification_mint(
        p_agency, v_owner.base44_user_id, v_owner.expected_email,
        v_owner.membership_id, v_owner.membership_version,
        "pennsync_records".adr_reminder_title(v_days),
        "pennsync_records".adr_reminder_message(v_name, v_case."response_due_date", v_days),
        'compliance_alert',
        case when v_days <= 1 then 'critical' else 'high' end,
        '/ADRCenter', 'Open ADR Center',
        jsonb_build_object('related_entity', 'AdrAuditCase',
          'related_entity_id', v_case."id"),
        'adr:' || v_case."id" || ':' || pg_catalog.to_char(v_today, 'YYYY-MM-DD'));
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'notification_dedupe_key_unique' then
        raise;
      end if;
      v_already := v_already + 1;
      continue;
    end;

    -- The claim, in the same transaction as the reminder it claims. The
    -- original's `claimed_by` token and its release-on-failure path are what
    -- one transaction removes: neither half can exist without the other.
    update "pennsync_records"."adr_audit_case" c set
      "deadline_reminders" = coalesce(c."deadline_reminders", '{}'::jsonb)
        || jsonb_build_object(
          'last_notified_date', pg_catalog.to_char(v_today, 'YYYY-MM-DD'),
          'last_days_left', v_days),
      "updated_date" = v_now
    where c."source_app_id" = "pennsync_records".deployment_app() and c."id" = v_case."id";

    v_notified := v_notified + 1;
    v_sent := v_sent || jsonb_build_object('case_id', v_case."id",
      'notification_id', v_id, 'days_left', v_days,
      'user_email', v_owner.expected_email);
  end loop;

  return jsonb_build_object('success', true, 'notified', v_notified,
    'already_reminded', v_already,
    'reminders', v_sent,
    'unreachable', v_unreachable,
    'unreachable_count', jsonb_array_length(v_unreachable));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".adr_reminder_title(integer),
  "pennsync_records".adr_reminder_message(text,date,integer),
  "pennsync_records".contract_adr_deadline_sweep(text)
  from public, anon, authenticated, service_role;
grant execute on function "pennsync_records".contract_adr_deadline_sweep(text)
  to authenticated;

create function "public"."pennsync_contract_adr_deadline_sweep"(p_agency text) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_adr_deadline_sweep(p_agency)
$c$;
revoke all on function "public"."pennsync_contract_adr_deadline_sweep"(text)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_adr_deadline_sweep"(text)
  to authenticated;

commit;
