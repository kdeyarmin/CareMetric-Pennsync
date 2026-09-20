-- Sweeping an agency's personnel credentials for expiry and renewal reminders.
--
-- HAND WRITTEN, like every contract. Two Base44 capabilities —
-- `sendPersonnelExpirationNotifications` and `sendCredentialRenewalReminders`
-- — ported together because they are the same sweep over the same rows with
-- different tiers, and because the reason they are SEPARATE is the most
-- important thing either of them records.
--
-- **Three crons, three marker fields, and the bug that taught them apart.**
-- The renewal capability says it in its own comment:
--
--     "Use a marker field dedicated to THIS job. The three credential-reminder
--      crons previously shared `reminder_offsets_sent` with different tier
--      sets, so whichever fired a shared tier first consumed it for the others
--      (e.g. sendExpirationNotifications marking tier 30 suppressed this
--      renewal email)."
--
-- So `reminder_offsets_sent`, `renewal_email_offsets_sent` and
-- `expiration_note_offsets_sent` are three columns on purpose, and the two
-- contracts here read one each. Do not merge them, and do not give a third
-- caller either of theirs.
--
-- **Both are scheduler capabilities under D49.** Their human gate is the
-- built-in `role === 'admin'` that D14 and D22 removed, whose successor is
-- D40's `agency_admin` scoped to their own agency; their machine gate is a
-- shared secret over every tenant, which has no successor here because nothing
-- in this store is cross-tenant. These are the per-agency halves.
--
-- **Both are the originals' own paused branch.** Each writes
-- `if (!deliveryReleased) continue;` after the status maintenance and before
-- the claim, and says why: *"Status expiry above remains active while staging
-- delivery is paused, but do not claim a reminder tier, create a sent-looking
-- notification, or enqueue email work that did not run."* The send is
-- `Core.SendEmail`, which nothing here brokers, so that is exactly what these
-- do: expiry is maintained, the due tiers are COUNTED and not claimed, and the
-- answer says so. When a send exists, the claim and the send return together —
-- and the claim must stay BEFORE the send, which is the originals' other scar:
-- *"Prior code stamped offsets in a bulk `updates` array before emails ran — if
-- send failed, the tier was still marked sent and the reminder was permanently
-- lost."*
--
-- DIVERGENCES from the originals, each deliberate:
--
-- 1. **The ±90-day window is gone, and every past-due credential is flipped.**
--    The original constrains to that window *"BEFORE the row cap"*, because
--    otherwise *"a historical backlog of already-expired credentials (which
--    accumulates without bound over time) [would] fill the 1000-row cap and
--    starve the upcoming expirations this job exists to notify about."* A SQL
--    `update … where` has no cap to starve, so the window has nothing left to
--    protect — and keeping it would leave a credential that expired 200 days
--    ago permanently un-flipped, which is the artefact rather than the rule.
-- 2. A tier fires AT OR BELOW its offset, not on an exact-day match. That is
--    the originals' rule and its reason is theirs: *"so a missed cron run
--    (downtime/deploy/DST) doesn't skip a tier permanently."*
-- 3. Today is the agency's calendar day, because the originals compare
--    *"on local calendar days, not UTC midnight"* — a credential expiring today
--    is not overdue because UTC has rolled over.
-- 4. The scope is the agency, from the policies. The originals read
--    `agency_name` off the credential row and off a 5000-row `User` list to
--    decide whose it is; D23 says that row decides nothing.
begin;

do $$
begin
  if to_regclass('pennsync_records.personnel_credential') is null then
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
 * Divergence 3: the agency's calendar day.
 *
 * `fleet_today` is the same function under a domain name, written first
 * because the fleet port needed it first; it should collapse into this the
 * next time either changes.
 */
create function "pennsync_records".agency_today() returns date
  language sql stable set search_path = '' as $today$
  select (clock_timestamp() at time zone 'America/New_York')::date
$today$;

/*
 * Divergence 2: which reminder tiers a credential has newly crossed.
 *
 * At or below an unsent offset, never an exact-day match, and only before
 * expiry — the status flip covers what is already past.
 */
create function "pennsync_records".credential_due_offsets(
  p_expiration date, p_sent jsonb, p_tiers integer[])
  returns integer[] language sql immutable set search_path = '' as $due$
  select coalesce(array_agg(tier order by tier desc), array[]::integer[])
  from unnest(p_tiers) as tier
  where p_expiration is not null
    and (p_expiration - "pennsync_records".agency_today()) >= 0
    and (p_expiration - "pennsync_records".agency_today()) <= tier
    and not coalesce(
      (select bool_or((value #>> '{}')::integer = tier)
       from jsonb_array_elements(case when jsonb_typeof(p_sent) = 'array'
         then p_sent else '[]'::jsonb end)), false)
$due$;

/*
 * The shared body. The two capabilities differ in exactly two things — which
 * marker column they read and which tiers they use — and keeping them one
 * function with those as parameters is what stops a future change giving one
 * of them the other's column, which is the bug the header quotes.
 */
create function "pennsync_records".credential_sweep(
  p_agency text, p_marker text, p_tiers integer[])
  returns jsonb language plpgsql security definer set search_path = '' as $sweep$
declare v_now timestamptz; v_expired integer; v_due integer; v_rows jsonb;
begin
  -- D40's gate. The originals admit the built-in admin, or a shared secret.
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_CREDENTIAL_FORBIDDEN';
  end if;
  v_now := clock_timestamp();

  -- Divergence 1: every past-due credential, not a ninety-day window.
  with swept as (
    update "pennsync_records"."personnel_credential" c set
      "status" = 'expired', "updated_date" = v_now
    where c."source_app_id" = "pennsync_records".deployment_app()
      and c."agency_id" = p_agency
      and c."expiration_date" is not null
      and c."expiration_date" < "pennsync_records".agency_today()
      and c."status" is distinct from 'expired'
    returning c."id")
  select count(*)::integer into v_expired from swept;

  -- Counted, NOT claimed. The tier belongs to the send, and there is none.
  select count(*)::integer, coalesce(jsonb_agg(jsonb_build_object(
      'id', d."id", 'user_id', d."user_id", 'title', d."title",
      'item_type', d."item_type", 'expiration_date', d."expiration_date",
      'days_until_expiration', d."expiration_date" - "pennsync_records".agency_today(),
      'due_offsets', to_jsonb(d."offsets")) order by d."expiration_date", d."id"),
    '[]'::jsonb)
  into v_due, v_rows
  from (
    select c."id", c."user_id", c."title", c."item_type", c."expiration_date",
      "pennsync_records".credential_due_offsets(c."expiration_date",
        case p_marker
          when 'reminder_offsets_sent' then c."reminder_offsets_sent"
          when 'renewal_email_offsets_sent' then c."renewal_email_offsets_sent"
          when 'expiration_note_offsets_sent' then c."expiration_note_offsets_sent"
        end, p_tiers) as "offsets"
    from "pennsync_records"."personnel_credential" c
    where c."source_app_id" = "pennsync_records".deployment_app()
      and c."agency_id" = p_agency
      and c."expiration_date" is not null
      and c."status" is distinct from 'expired'
  ) d
  where array_length(d."offsets", 1) > 0;

  return jsonb_build_object('success', true,
    'marked_expired', v_expired, 'reminders_due', v_due,
    'credentials', v_rows,
    'notifications_sent', 0, 'emails_sent', 0, 'delivery_paused', true,
    'code', 'OUTBOUND_DELIVERY_RELEASE_PAUSED');
end $sweep$;

create function "pennsync_records".contract_credential_expiration_sweep(p_agency text)
  returns jsonb language sql security definer set search_path = '' as $c$
  -- `sendPersonnelExpirationNotifications`: the in-app tier set and its own
  -- marker column.
  select "pennsync_records".credential_sweep(
    p_agency, 'reminder_offsets_sent', array[90, 60, 30, 14])
$c$;

create function "pennsync_records".contract_credential_renewal_sweep(p_agency text)
  returns jsonb language sql security definer set search_path = '' as $c$
  -- `sendCredentialRenewalReminders`: one more tier, and a DIFFERENT marker
  -- column, which is the whole point — see the header.
  select "pennsync_records".credential_sweep(
    p_agency, 'renewal_email_offsets_sent', array[90, 60, 30, 14, 7])
$c$;

reset role;

revoke all on function
  "pennsync_records".agency_today(),
  "pennsync_records".credential_due_offsets(date,jsonb,integer[]),
  "pennsync_records".credential_sweep(text,text,integer[]),
  "pennsync_records".contract_credential_expiration_sweep(text),
  "pennsync_records".contract_credential_renewal_sweep(text)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_credential_expiration_sweep(text),
  "pennsync_records".contract_credential_renewal_sweep(text)
  to authenticated;

create function "public"."pennsync_contract_credential_expiration_sweep"(p_agency text)
  returns jsonb language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_credential_expiration_sweep(p_agency)
$c$;
create function "public"."pennsync_contract_credential_renewal_sweep"(p_agency text)
  returns jsonb language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_credential_renewal_sweep(p_agency)
$c$;

revoke all on function
  "public"."pennsync_contract_credential_expiration_sweep"(text),
  "public"."pennsync_contract_credential_renewal_sweep"(text)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_credential_expiration_sweep"(text),
  "public"."pennsync_contract_credential_renewal_sweep"(text)
  to authenticated;

commit;
