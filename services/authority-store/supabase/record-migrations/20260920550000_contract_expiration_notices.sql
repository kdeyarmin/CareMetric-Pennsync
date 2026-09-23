-- Warning an agency's staff that a credential is about to expire.
--
-- HAND WRITTEN, like every contract. `sendExpirationNotifications` is the
-- LAST of D49's four scheduler capabilities and the second with nothing
-- paused, for D51's reason: its reminder is a `Notification` ROW rather than
-- an email, so there is no `Core.SendEmail` to broker.
--
-- **It is a PARTIAL port on two axes, and both were decided elsewhere.**
--
-- 1. The module is two independent sweeps in one handler. The training half
--    reads `TrainingAssignment`, which is dispositioned `hub`, and D84's
--    `uncarried_legs` entry settles that leg by name: `sendTrainingNotifications`
--    already lives on the Support Hub (D9). Only the credential half is here,
--    and the answer says so rather than reporting a zero that reads like
--    "no training expired".
-- 2. Its human gate is the built-in `role === 'admin'` that D14 and D22
--    removed, whose successor is D40's `agency_admin` scoped to their own
--    agency; its machine gate is a shared secret over every tenant, which has
--    no successor because nothing in this store is cross-tenant. This is the
--    per-agency half, exactly as D49 says to take it, and the unattended run
--    waits on a scheduler identity nobody has chosen.
--
-- **The tier arithmetic is D50's, reused rather than rewritten.** That
-- decision's whole finding is that the three credential-reminder crons share
-- a table and must NOT share a marker column, which is why
-- `credential_due_offsets(expiration, sent, tiers)` takes the marker's VALUE
-- and the tiers as parameters. This capability is the third of those three
-- crons — it is the one D50 quotes by name ("sendExpirationNotifications
-- marking tier 30 suppressed this renewal email") — and its column is
-- `expiration_note_offsets_sent`. It does NOT reuse `credential_sweep`,
-- because that body COUNTS the due tiers and deliberately does not claim
-- them: its two capabilities' send is paused and a claim without a send
-- loses the reminder permanently. Here the send exists, so this body claims.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. D40's gate for the human path; the machine path is D49's open decision.
-- 2. **The 500-row cap goes.** The original sorts ASCENDING and caps at 500
--    precisely so the cap cannot starve the imminent expirations the job
--    exists to warn about — its own comment records that a descending sort
--    once dropped them off the tail. A SQL `where` has no tail to fall off,
--    so the cap is the artefact and the ordering is the rule; the ordering is
--    kept because it decides what the answer lists first.
-- 3. **The 5000-row `User` scan is deleted, twice over.** The original builds
--    `agencyByEmail` from every profile in the deployment to attribute the
--    training items, and rebuilds the administrator list from the same scan
--    over `role`, `account_type` and `agency_name`. D23 says that row decides
--    nothing and D41 and D43 say to delete the reconstruction rather than
--    port it: the roster is `pennsync_private.agency_roster`, and the
--    administrators are its `agency_admin` members.
-- 4. **The recipient must still be a member.** The original addresses
--    `credential.user_id` whatever it holds. Here it is resolved through the
--    roster, so a credential belonging to somebody who has left the agency
--    warns nobody rather than minting a row addressed to an identity that no
--    longer exists. Those rows are RETURNED as `unreachable`, because an
--    expiring credential with no owner is what an administrator needs to see.
-- 5. **The claim token and its release path go with the transaction.** The
--    original stamps `expiration_note_claimed_by`, re-reads the row to check
--    the stamp survived, and on a failed notify writes the old offsets back.
--    All three are compensations for having no transaction (D46's lock, D51's
--    release). Here the mint and the claim are one statement pair in one
--    transaction and neither half can exist without the other. The MINT comes
--    first, which is not the order D50 insists on for a send: inside one
--    transaction the order cannot lose a reminder, but the dedupe violation
--    below is caught and swallowed, and a subtransaction rollback reaches only
--    the statements inside its own block — so a claim written first would
--    stand with no notification under it.
-- 6. **Two INDEPENDENT enforcements, and which one answers is measured.** The
--    marker column is a field on the credential that anything may edit; the
--    dedupe key is an index. When they disagree the row is counted
--    `already_warned` and the `unique_violation` is caught BY NAME, so any
--    other one still raises. The row is also taken `for update`, so the WHERE
--    clause is re-evaluated against a concurrent winner's committed row and
--    the loser simply does not see it. `record-contract-postgres.test.mjs`
--    removes each in turn rather than reasoning about them, and the result
--    contradicted this comment's first draft: either one alone holds the race,
--    and only removing BOTH warns the holder twice. That is not D89's shape,
--    where the second index serialized without preventing.
-- 7. **The administrators' summary names nobody.** The original's
--    `metadata: { expirations: scoped }` carries each colleague's name, their
--    credential's title and its date, and `notification_read` is agency-WIDE
--    — D44's rule, arriving here about personnel rather than a patient. No
--    SPA reads that blob (the type appears only in three allowlists), so the
--    summary carries the count and the link and nothing else. Its wording
--    also drops "training certifications or", which this half no longer
--    reaches.
-- 8. **One summary per administrator per day, not per run.** The original
--    mints one on every invocation; with the unattended run still an open
--    decision the caller is a person pressing a button, and a second press
--    should not notify their colleagues twice. The suppressed ones are
--    counted rather than hidden (D54).
--
-- One property inherited rather than chosen: `notification_mint` sets no
-- `expires_at`, so neither do the ADR, incident or policy ports. Nothing in
-- this store reads that column — `contract_notification_list` does not
-- mention it — so the original's 30-day and 7-day expiries are inert here.
begin;

do $$
begin
  if to_regclass('pennsync_records.personnel_credential') is null
    or to_regprocedure('pennsync_records.credential_due_offsets(date,jsonb,integer[])') is null
    or to_regprocedure('pennsync_records.agency_today()') is null
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

/*
 * The original's title and message, word for word.
 *
 * `daysUntilExpiration` is its own `localDaysUntil`, which is a calendar-day
 * difference on the agency's clock — `agency_today()` under D50 divergence 3.
 * It says "days" whatever the count, including one, and the port keeps that:
 * changing it would be a cosmetic edit to a string a nurse has learned to
 * recognise.
 */
create function "pennsync_records".credential_notice_title(p_title text)
  returns text language sql immutable set search_path = '' as $t$
  select 'Credential Expiring Soon: ' || coalesce(p_title, '')
$t$;

create function "pennsync_records".credential_notice_message(
  p_title text, p_days integer)
  returns text language sql immutable set search_path = '' as $m$
  select 'Your ' || coalesce(p_title, '') || ' expires in ' || p_days
    || ' days. Please upload a renewed document.'
$m$;

create function "pennsync_records".contract_expiration_notice_sweep(p_agency text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_tiers constant integer[] := array[30, 14, 7, 3];
  v_today date; v_now timestamptz;
  v_cred record; v_owner record; v_admin record;
  v_days integer; v_tier integer; v_id text; v_constraint text;
  v_notified integer := 0; v_already integer := 0;
  v_summaries integer := 0; v_suppressed integer := 0;
  v_unreachable jsonb := '[]'::jsonb; v_sent jsonb := '[]'::jsonb;
begin
  -- Divergence 1. The original admits the built-in admin, or a shared secret.
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_EXPIRATION_FORBIDDEN';
  end if;
  v_today := "pennsync_records".agency_today();
  v_now := clock_timestamp();

  for v_cred in
    -- Divergences 2 and 6: this agency's approved credentials with a tier
    -- newly due, in the original's order and with no cap to fall off, taken
    -- `for update` so the qual is re-checked against a concurrent winner's
    -- committed row.
    select c."id", c."user_id", c."title", c."expiration_date",
      c."expiration_note_offsets_sent",
      "pennsync_records".credential_due_offsets(c."expiration_date",
        c."expiration_note_offsets_sent", v_tiers) as "offsets"
    from "pennsync_records"."personnel_credential" c
    where c."source_app_id" = "pennsync_records".deployment_app()
      -- The agency is NAMED rather than left to the policy alone:
      -- `caller_agencies()` returns every agency the caller holds.
      and c."agency_id" = p_agency
      -- The original's filter is `status: 'approved'`, which is NARROWER than
      -- `credential_sweep`'s "not expired" — a pending credential gets no
      -- warning there and gets none here.
      and c."status" = 'approved'
      and c."expiration_date" is not null
      and array_length("pennsync_records".credential_due_offsets(c."expiration_date",
        c."expiration_note_offsets_sent", v_tiers), 1) > 0
    order by c."expiration_date", c."id"
    for update
  loop
    v_days := v_cred."expiration_date" - v_today;
    -- The tightest tier this run crosses. Tiers are consumed monotonically, so
    -- it identifies the claim event: a run at five days out claims 30, 14 and
    -- 7 and keys on 7; the next, at two, claims 3 and keys on 3.
    v_tier := (select pg_catalog.min(t) from unnest(v_cred."offsets") as t);

    -- Divergence 4: the holder must still be a member of this agency.
    select r.base44_user_id, r.expected_email, r.membership_id, r.membership_version
    into v_owner
    from pennsync_private.agency_roster(p_agency) r
    where r.expected_email = pg_catalog.lower(pg_catalog.btrim(coalesce(v_cred."user_id", '')));
    if v_owner.base44_user_id is null then
      v_unreachable := v_unreachable || jsonb_build_object(
        'credential_id', v_cred."id", 'user_id', v_cred."user_id",
        'days_until_expiration', v_days,
        'expiration_date', v_cred."expiration_date");
      continue;
    end if;

    -- Divergences 5 and 6: the mint first, then the claim, in one transaction.
    begin
      v_id := "pennsync_records".notification_mint(
        p_agency, v_owner.base44_user_id, v_owner.expected_email,
        v_owner.membership_id, v_owner.membership_version,
        "pennsync_records".credential_notice_title(v_cred."title"),
        "pennsync_records".credential_notice_message(v_cred."title", v_days),
        'credential_expiration',
        case when v_days <= 7 then 'high' else 'medium' end,
        '/PersonnelFile', 'Open personnel file',
        jsonb_build_object('related_entity', 'PersonnelCredential',
          'related_entity_id', v_cred."id",
          'days_until_expiration', v_days),
        'credential-expiry:' || v_cred."id" || ':' || v_tier
          || ':' || v_owner.expected_email);
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'notification_dedupe_key_unique' then
        raise;
      end if;
      v_already := v_already + 1;
      continue;
    end;

    update "pennsync_records"."personnel_credential" c set
      "expiration_note_offsets_sent" = coalesce(
        case when jsonb_typeof(c."expiration_note_offsets_sent") = 'array'
          then c."expiration_note_offsets_sent" else '[]'::jsonb end,
        '[]'::jsonb) || to_jsonb(v_cred."offsets"),
      "updated_date" = v_now
    where c."source_app_id" = "pennsync_records".deployment_app()
      and c."id" = v_cred."id";

    v_notified := v_notified + 1;
    v_sent := v_sent || jsonb_build_object(
      'credential_id', v_cred."id", 'notification_id', v_id,
      'days_until_expiration', v_days,
      'claimed_offsets', to_jsonb(v_cred."offsets"),
      'user_email', v_owner.expected_email);
  end loop;

  -- Divergences 3, 7 and 8: the agency's administrators, from membership,
  -- with a count and no colleague named, once a day each.
  if v_notified > 0 then
    for v_admin in
      select r.base44_user_id, r.expected_email, r.membership_id, r.membership_version
      from pennsync_private.agency_roster(p_agency) r
      where r.tenant_role = 'agency_admin'
      order by r.expected_email
    loop
      begin
        perform "pennsync_records".notification_mint(
          p_agency, v_admin.base44_user_id, v_admin.expected_email,
          v_admin.membership_id, v_admin.membership_version,
          v_notified || ' Upcoming Expirations',
          'There are ' || v_notified || ' credentials expiring soon.',
          'admin_expiration_summary', 'medium',
          '/AdminOperations', 'Open admin operations',
          jsonb_build_object('expiration_count', v_notified),
          'credential-expiry-summary:' || p_agency || ':'
            || pg_catalog.to_char(v_today, 'YYYY-MM-DD')
            || ':' || v_admin.expected_email);
        v_summaries := v_summaries + 1;
      exception when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'notification_dedupe_key_unique' then
          raise;
        end if;
        v_suppressed := v_suppressed + 1;
      end;
    end loop;
  end if;

  return jsonb_build_object('success', true,
    -- The original's three keys. It reports the same number three times,
    -- because it pushes to both of its arrays on every successful notify;
    -- they are kept so a caller reading any of them still reads the count.
    'employee_notifications', v_notified,
    'admin_notifications', v_notified,
    'total_expirations', v_notified,
    'already_warned', v_already,
    'admin_summaries_sent', v_summaries,
    'admin_summaries_suppressed', v_suppressed,
    'notifications', v_sent,
    'unreachable', v_unreachable,
    'unreachable_count', jsonb_array_length(v_unreachable),
    -- Divergence: the training half is not here and is not zero.
    'training_expirations', 'served_by_hub',
    'code', 'PENNSYNC_EXPIRATION_TRAINING_LEG_ON_HUB');
end $contract$;

reset role;

revoke all on function
  "pennsync_records".credential_notice_title(text),
  "pennsync_records".credential_notice_message(text,integer),
  "pennsync_records".contract_expiration_notice_sweep(text)
  from public, anon, authenticated, service_role;
grant execute on function "pennsync_records".contract_expiration_notice_sweep(text)
  to authenticated;

create function "public"."pennsync_contract_expiration_notice_sweep"(p_agency text)
  returns jsonb language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_expiration_notice_sweep(p_agency)
$c$;
revoke all on function "public"."pennsync_contract_expiration_notice_sweep"(text)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_expiration_notice_sweep"(text)
  to authenticated;

commit;
