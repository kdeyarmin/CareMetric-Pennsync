-- The authority envelope, in one place, and the roster it is stamped from.
--
-- HAND WRITTEN, and a FACILITY rather than an endpoint — the shape
-- `contract_activity_append` has under D37, and for the same reason: a
-- contract that must write a notification inside its own transaction cannot
-- make a second round trip to do it.
--
-- It exists because of D45. `manageMyNotifications` filters every row it shows
-- on SIX authority columns, `contract_incident_submit`'s urgent-alert fan-out
-- stamped three of them, and every alert it wrote was addressed to nobody
-- while both contracts' own suites passed. Inlining the envelope a second time
-- would have been the same bet again, so there is now one place to get it
-- wrong and two callers that cannot.
--
-- It applies BEFORE both of them on purpose. A plpgsql body resolves the
-- functions it calls at run time rather than at creation, so a later migration
-- could have supplied this — and a store that applied half its migrations
-- would then have a fan-out that fails on its first call instead of at
-- migration time. Ordering it first is what makes each caller's own guard able
-- to refuse.
begin;

do $$
begin
  if to_regclass('pennsync_records.notification') is null
    or to_regprocedure('pennsync_records.caller_tenant_role(text)') is null then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_STORE_REQUIRED';
  end if;
end $$;

/*
 * The agency's roster, as the authority store holds it.
 *
 * `agency_colleague`, `agency_member` and `agency_admin_recipients` are all
 * special cases of this — by address, by id, and by role — written one at a
 * time as each port needed one. This is the general form, and the next change
 * to any of those three should collapse it into this.
 */
create function pennsync_private.agency_roster(p_agency text)
  returns table(base44_user_id text, tenant_role text, expected_email text,
    membership_id text, membership_version integer)
  language plpgsql stable security definer set search_path = '' as $roster$
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_NOTIFICATION_AGENCY_NOT_HELD';
  end if;
  return query
    select m.base44_user_id, m.tenant_role, im.expected_email,
      m.id::text, m.version::integer
    from pennsync_private.membership m
    join pennsync_private.agency ag on ag.app_id = m.app_id and ag.id = m.agency_id
    join pennsync_private.identity_map im
      on im.app_id = m.app_id and im.auth_user_id = m.auth_user_id
     and im.base44_user_id = m.base44_user_id
    where m.app_id = pennsync_private.deployment_app_id()
      and m.agency_id = p_agency and m.status = 'active'
      and ag.status in ('active', 'trial')
      and im.enabled and im.revoked_at is null;
end $roster$;

revoke all on function pennsync_private.agency_roster(text)
  from public, anon, authenticated, service_role;
-- The same grant `claim_new_chart` makes. NEVER pair it with a blanket revoke
-- over this schema: every `pennsync_staging_*` wrapper is an invoker calling an
-- inner function granted to `authenticated`.
grant usage on schema pennsync_private to "pennsync_records_owner";
grant execute on function pennsync_private.agency_roster(text)
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

/*
 * THE FACILITY. One place that knows the authority envelope.
 *
 * `createNotification` mints through it, and so does
 * `contract_incident_submit`'s urgent-alert fan-out, which inlined it until
 * this migration — and got three of its six columns, which is how D45 found
 * the defect. It returns the new id so a caller can name what it wrote.
 */
create function "pennsync_records".notification_mint(
  p_agency text, p_recipient_user_id text, p_recipient_email text,
  p_membership_id text, p_membership_version integer,
  p_title text, p_message text, p_type text, p_priority text,
  p_action_url text, p_action_label text, p_metadata jsonb, p_dedupe_key text)
  returns text language plpgsql security definer set search_path = '' as $mint$
declare v_id text; v_now timestamptz;
begin
  v_now := clock_timestamp();
  v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
  insert into "pennsync_records"."notification"
    ("source_app_id", "id", "agency_id", "dedupe_key",
     "recipient_user_id", "recipient_membership_id", "recipient_membership_version",
     "authority_version", "authority_state", "version",
     "user_email", "title", "message", "type", "priority",
     "action_url", "action_label", "metadata",
     "is_read", "read_at", "dismissed", "dismissed_at", "email_sent", "push_sent",
     "created_by", "created_date", "updated_date")
  values ("pennsync_records".deployment_app(), v_id, p_agency, nullif(p_dedupe_key, ''),
    p_recipient_user_id, p_membership_id, p_membership_version,
    1, 'active', 1,
    p_recipient_email, p_title, p_message, p_type, p_priority,
    nullif(p_action_url, ''), nullif(p_action_label, ''),
    coalesce(p_metadata, '{}'::jsonb),
    false, null, false, null, false, false,
    "pennsync_records".caller_email(), v_now, v_now);
  return v_id;
end $mint$;

reset role;

revoke all on function
  "pennsync_records".notification_mint(text,text,text,text,integer,text,text,text,text,text,text,jsonb,text)
  from public, anon, authenticated, service_role;

commit;
