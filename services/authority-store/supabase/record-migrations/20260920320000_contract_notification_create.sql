-- Creating a notification for somebody else, and the facility that stamps one.
--
-- HAND WRITTEN, like every contract. This is the OTHER half of D45: that one
-- ported the reader and proved the incident fan-out was writing rows nobody
-- could see, and this one ports the canonical writer and makes its envelope a
-- facility every other contract calls instead of inlining.
--
-- It mints through `notification_mint`, the facility that now owns the
-- authority envelope, and so does `contract_incident_submit`'s urgent-alert
-- fan-out — which inlined it until this change, and got three of its six
-- columns, which is how D45 found the defect. There is one place left to get
-- it wrong.
--
-- `pennsync_private.agency_roster` moves there with it, and is the general form
-- of three helpers written one at a time as each port needed one:
-- `agency_colleague` (by address), `agency_member` (by id) and
-- `agency_admin_recipients` (by role). The last of those is deleted here; the
-- other two should collapse into it the next time either changes.
--
-- **The recipient's in-app preference moves from the writer to the reader, and
-- that is forced rather than chosen.** The original reads the recipient's
-- `NotificationPreference` to decide whether to create an in-app row at all.
-- In this store `notification_preference_read` is `user_email =
-- caller_email()` — the policy that makes a preference the RECIPIENT's own
-- makes it unreadable by the sender, and no role escapes it, because the table
-- is force-RLS and even its owner is bound. So the sender cannot ask, and the
-- reader is the only session that can: `contract_notification_list` and
-- `contract_notification_mark_all` honour it instead. That is also the more
-- correct place — the preference that decides what somebody sees is the one
-- they hold now, not the one they held when it was sent — and the row is
-- retained either way, so what was sent stays answerable.
--
-- **The email half is not ported.** `Core.SendEmail` is not in the runtime's
-- brokered set, so the handler reports `delivery_paused` as the invitation,
-- time-off and credential ports do. Everything gating the EMAIL goes with it:
-- quiet hours, `digest_mode`, and the `email_notifications_enabled`
-- preference are not evaluated here, because there is nothing for them to
-- gate. The original's own fix to that default — *"a user who never opened
-- Notification Settings got NO emails at all, including priority:'critical'
-- patient alerts"* — is recorded here so it is not lost when the send returns.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. The platform-owner branch of `resolveScope` closes with the tier (D14,
--    D22). What is left is the rule that mattered: the caller and the
--    recipient must both hold the named agency.
-- 2. The agency is the ENVELOPE's. The original intersects the caller's and
--    the recipient's membership sets and refuses unless exactly one agency is
--    shared, because a legacy caller names none; every request to this service
--    names its tenant, which is the same invariant D34 settled for
--    `getMyTenantContext`.
-- 3. `loadMemberships`'s canonical-lifecycle re-proof goes, as it did in D34,
--    D35 and D46: `pennsync_private.membership` holds it with CHECK
--    constraints.
-- 4. **"Has the recipient charted on this patient" becomes "does the recipient
--    open this chart".** The original answers it by filtering `Visit` for a row
--    the recipient created, which is an act rather than an authority; D24 made
--    care-team membership the authority for chart access, and
--    `pennsync_private.member_opens_chart` asks that. It is asked of the
--    RECIPIENT, so the policies cannot answer it — they bind the caller — and
--    a helper is the only thing that can.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.contract_notification_list(text)') is null
    or to_regprocedure('pennsync_private.caller_membership(text)') is null
    or to_regprocedure('pennsync_records.notification_mint(text,text,text,text,integer,'
      || 'text,text,text,text,text,text,jsonb,text)') is null then
    raise exception using errcode='42501',message='PENNSYNC_CALLER_MEMBERSHIP_REQUIRED';
  end if;
end $$;

/*
 * Divergence 4: does this MEMBER open that chart?
 *
 * The caller-side pair is `caller_opens_every_chart` and
 * `caller_assigned_patients` (D24); this asks the same question about somebody
 * else, which no policy can, because a policy binds the caller.
 */
create function pennsync_private.member_opens_chart(
  p_agency text, p_membership_id text, p_patient_id text)
  returns boolean language plpgsql stable security definer set search_path = '' as $opens$
declare v_role text;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_NOTIFICATION_AGENCY_NOT_HELD';
  end if;
  select m.tenant_role into v_role from pennsync_private.membership m
  where m.app_id = pennsync_private.deployment_app_id()
    and m.agency_id = p_agency and m.id = p_membership_id and m.status = 'active';
  if v_role is null then return false; end if;
  if v_role in ('agency_admin', 'manager') then return true; end if;
  return exists (select 1 from pennsync_private.chart_assignment a
    where a.app_id = pennsync_private.deployment_app_id()
      and a.agency_id = p_agency and a.membership_id = p_membership_id
      and a.patient_id = p_patient_id and a.status = 'active');
end $opens$;

revoke all on function pennsync_private.member_opens_chart(text,text,text)
  from public, anon, authenticated, service_role;
-- The same grant `claim_new_chart` makes. NEVER pair it with a blanket revoke
-- over this schema: every `pennsync_staging_*` wrapper is an invoker calling an
-- inner function granted to `authenticated`.
grant usage on schema pennsync_private to "pennsync_records_owner";
grant execute on function pennsync_private.member_opens_chart(text,text,text)
  to "pennsync_records_owner";

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

create function "pennsync_records".contract_notification_create(
  p_agency text, p_notification jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_role text; v_key text; v_email text; v_type text; v_priority text;
  v_title text; v_message text; v_url text; v_label text; v_patient text;
  v_recipient record; v_admin boolean; v_id text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_NOTIFICATION_AGENCY_NOT_HELD';
  end if;
  if p_notification is null or jsonb_typeof(p_notification) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_NOTIFICATION_INVALID';
  end if;
  for v_key in select k from jsonb_object_keys(p_notification) k loop
    if v_key not in ('user_email', 'title', 'message', 'type', 'priority',
      'action_url', 'action_label', 'metadata', 'patient_id') then
      raise exception using errcode='22023', message='PENNSYNC_NOTIFICATION_FIELD_UNSUPPORTED';
    end if;
  end loop;

  v_email := pg_catalog.lower(pg_catalog.btrim(coalesce(p_notification->>'user_email', '')));
  v_title := "pennsync_records".notification_text(p_notification->>'title', 500);
  v_message := "pennsync_records".notification_text(p_notification->>'message', 5000);
  v_type := p_notification->>'type';
  if v_email = '' or pg_catalog.strpos(v_email, '@') = 0
    or v_title is null or v_message is null or v_type is null
    or v_type not in ('report_ready', 'compliance_alert', 'critical_alert', 'patient_alert',
      'task_assigned', 'task_due_soon', 'new_referral', 'referral_urgent',
      'training_due', 'system_update', 'message_received', 'sms_failed',
      'sms_urgent', 'sms_received', 'fax_delivered', 'fax_failed', 'voicemail',
      'info', 'expiration_warning', 'credential_expiration',
      'admin_expiration_summary', 'care_plan_proposal', 'signature_request') then
    raise exception using errcode='22023', message='PENNSYNC_NOTIFICATION_REQUIRED';
  end if;
  -- The original defaults an unknown priority rather than refusing it.
  v_priority := coalesce(p_notification->>'priority', '');
  if v_priority not in ('low', 'medium', 'high', 'critical') then v_priority := 'medium'; end if;
  -- The same same-origin rule the reader projects by; an absolute or
  -- protocol-relative link would be an open redirect out of the product.
  v_url := "pennsync_records".notification_action_url(p_notification->>'action_url');
  if p_notification->>'action_url' is not null and v_url is null then
    raise exception using errcode='22023', message='PENNSYNC_NOTIFICATION_ACTION_URL_INVALID';
  end if;
  v_label := "pennsync_records".notification_text(p_notification->>'action_label', 200);
  if p_notification->>'action_label' is not null and v_label is null then
    raise exception using errcode='22023', message='PENNSYNC_NOTIFICATION_FIELD_UNSUPPORTED';
  end if;
  if p_notification ? 'metadata' and jsonb_typeof(p_notification->'metadata')
    not in ('object', 'null') then
    raise exception using errcode='22023', message='PENNSYNC_NOTIFICATION_FIELD_UNSUPPORTED';
  end if;
  v_patient := nullif(p_notification->>'patient_id', '');
  if v_patient is not null and v_patient !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_NOTIFICATION_SUBJECT_INVALID';
  end if;

  -- Divergences 1, 2 and 3: both parties hold the agency the envelope names,
  -- and membership says so.
  select r.base44_user_id, r.tenant_role, r.expected_email,
    r.membership_id, r.membership_version
  into v_recipient
  from pennsync_private.agency_roster(p_agency) r where r.expected_email = v_email;
  if v_recipient.base44_user_id is null then
    raise exception using errcode='42501', message='PENNSYNC_NOTIFICATION_RECIPIENT_UNKNOWN';
  end if;

  v_admin := v_role in ('agency_admin', 'manager');
  if not v_admin and v_type not in ('system_update', 'info', 'message_received',
    'task_assigned', 'task_due_soon') then
    raise exception using errcode='42501', message='PENNSYNC_NOTIFICATION_TYPE_FORBIDDEN';
  end if;
  -- The original's second non-admin rule, with membership in place of the
  -- built-in `role === 'admin'` it asks about the recipient.
  if not v_admin and v_recipient.expected_email <> "pennsync_records".caller_email()
    and v_recipient.tenant_role not in ('agency_admin', 'manager') then
    raise exception using errcode='42501', message='PENNSYNC_NOTIFICATION_RECIPIENT_FORBIDDEN';
  end if;

  -- Divergence 4: the chart, asked of the RECIPIENT. The three types the
  -- original exempts are the ones that name a patient without being about one.
  if v_patient is not null
    and v_type not in ('compliance_alert', 'report_ready', 'training_due')
    and not pennsync_private.member_opens_chart(
      p_agency, v_recipient.membership_id, v_patient) then
    raise exception using errcode='42501', message='PENNSYNC_NOTIFICATION_PATIENT_FORBIDDEN';
  end if;

  v_id := "pennsync_records".notification_mint(
    p_agency, v_recipient.base44_user_id, v_recipient.expected_email,
    v_recipient.membership_id, v_recipient.membership_version,
    v_title, v_message, v_type, v_priority, v_url, v_label,
    case when jsonb_typeof(p_notification->'metadata') = 'object'
      then p_notification->'metadata' else '{}'::jsonb end,
    null);
  return jsonb_build_object('success', true, 'notification_id', v_id,
    -- The email half is `Core.SendEmail`, which nothing here brokers.
    'delivery_paused', true);
end $contract$;

/*
 * The reader honours the recipient's in-app preference, because the sender
 * cannot: `notification_preference_read` is `user_email = caller_email()`.
 * Only an explicit `false` disables, as the original's default does.
 */
create function "pennsync_records".notification_in_app_off(p_type text)
  returns boolean language sql stable security definer set search_path = '' as $off$
  select coalesce(bool_or(
    p."in_app_notifications_enabled" is false
    or (p."preferences" -> p_type -> 'in_app') = 'false'::jsonb), false)
  from "pennsync_records"."notification_preference" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."user_email" = "pennsync_records".caller_email()
$off$;

reset role;

revoke all on function
  "pennsync_records".notification_in_app_off(text),
  "pennsync_records".contract_notification_create(text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_notification_create(text,jsonb) to authenticated;

create function "public"."pennsync_contract_notification_create"(
  p_agency text, p_notification jsonb) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_notification_create(p_agency, p_notification)
$c$;
revoke all on function "public"."pennsync_contract_notification_create"(text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_notification_create"(text,jsonb)
  to authenticated;

commit;
