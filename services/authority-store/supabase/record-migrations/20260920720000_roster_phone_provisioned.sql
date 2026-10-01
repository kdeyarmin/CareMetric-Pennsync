-- The roster says whether a nurse is provisioned, and never their mobile number.
--
-- Three admin screens read `work_phone_number` and `personal_cell_e164`, and
-- measuring what each one DOES with them collapses most of the question:
--
--   `TelnyxSetupProgress.jsx:125-127` and `phoneAnalytics.js:99-100` only COUNT
--   — total, with a work number, missing a bridge cell. Neither renders a
--   number anywhere. Two booleans serve them completely.
--
--   `PhoneProvisioningPanel.jsx` renders the work number in full (:683) and the
--   personal cell MASKED (:689, `maskPhone`, last four digits only). Its edit
--   inputs start empty from local state and are never pre-filled, so it needs no
--   full cell for the write either.
--
--   `NumberPoolPanel.jsx` — nested inside that panel (:635), so the same
--   audience — tested presence in one place and was the ONLY place that read a
--   full cell, pre-filling it into an editable assign input. That pre-fill goes
--   in this change; its own call site carries why.
--
-- So nothing any screen DISPLAYS is lost, and a full personal mobile number
-- stops travelling through a projection shared by every roster consumer.
--
-- WHY THE MASK IS NOT PRE-FILLED INTO THAT INPUT, which is the obvious
-- alternative. `managePhoneNumberPool`'s assign omits `personal_cell_e164` when
-- the field is BLANK, not when it is unchanged
-- (`...(cell && cell.trim() ? { personal_cell_e164: cell.trim() } : {})`), and a
-- mask is a truthy string — so the submission would carry it.
--
-- What it would then do was measured rather than assumed, because the obvious
-- answer is the wrong one. It is NOT written over the real number:
-- `normalizeE164` (`src/components/voice/phoneUtils.js:10-26`) sees four digits,
-- matches none of its three length branches and answers null, so the handler
-- refuses the whole call with 400 `Invalid personal cell number.` before it
-- claims the inventory row. The pre-fill would therefore break REASSIGNMENT
-- outright for every nurse who already has a cell on file, which a loud failure
-- makes discoverable and a silent one would not — and it is still a defect, so
-- the input is left empty, which is what `PhoneProvisioningPanel`'s own edit
-- inputs already do.
--
-- Recorded because the first draft of this header asserted the corruption
-- instead, having reasoned from the truthiness alone and stopped before the
-- function that consumes it. The conclusion survived the measurement and the
-- reason did not.
--
-- THE REDUCTION, recorded rather than left to be discovered: an administrator no
-- longer sees the full stored cell in that one input, and sees the last four
-- digits and whether a cell is on file instead. The write is unaffected — a
-- blank submission still keeps the nurse's existing number, and a test pins
-- that. Whether anybody currently holds `role = 'admin'` in the hosted app, and
-- so whether any real person notices, is NOT measurable from this tree, because
-- we hold no credential for that store.
--
-- AUDIENCE. Both rendering panels gate on `isAdminLike`, whose whole body is
-- `user.role === "admin"` (`src/lib/superAdmin.js:58-61`) — the platform tier D14
-- and D22 removed and D40 replaced with an `agency_admin` scoped to their own
-- agency, which is narrower in reach than the deployment-wide tier it succeeds.
-- All four keys are therefore privileged-only, beside `phone` and `credentials`,
-- and null rather than absent for everybody else so the shape does not tell a
-- handler which kind of caller it is serving.
--
-- WHY THE MASKED KEY IS NOT NAMED `personal_cell_e164`, which looks like
-- needless indirection and is load-bearing. `personal_cell_e164` IS on
-- `20260920530000_profile_self_write.sql`'s allowlist — a nurse may set their
-- own — so a projection carrying that key would join the seven columns
-- `contract-roster.test.mjs` pins as ROUND-TRIPPABLE: a screen that mirrors a
-- roster row into a form and posts it back would write a MASK over the nurse's
-- real number through the write side, which is batch E's shape arriving by a
-- different door. `work_phone_number` is safe under its own name because it is
-- NOT on that allowlist; the cell is not, so the masked value travels under a
-- key no column answers to. Do not rename it back.
--
-- D88: a FORWARD migration, because `20260920030000_contract_roster.sql` and
-- `20260920630000_roster_display_name.sql` have been applied and an edit to
-- either would reach no store that ran it. `create or replace` is enough here
-- where the display-name migration needed drop-and-create: the signature does
-- not move, so the owner, the ACL and both callers' name resolution are
-- untouched.
--
-- NOT RETYPED. The projection below is LIFTED from the migration named above
-- with one substitution at its tail, because retyping a thirty-key projection to
-- add four is the transcription D12 settled against.
-- `roster-phone-provisioned.test.mjs` re-derives this file from that one and
-- fails if they stop agreeing.
begin;

set local role "pennsync_records_owner";

-- A byte-for-byte port of `maskPhone` (`src/components/voice/phoneUtils.js`),
-- with ONE recorded divergence: an absent number answers null here and
-- `"unknown"` there. The browser never reaches that branch — its only call is
-- inside `{u.personal_cell_e164 && (...)}` — and null is this projection's
-- convention for a value that is not there, so a literal `"unknown"` would be a
-- string a screen could print. Narrowing, and recorded.
--
-- `[^0-9]` rather than a character class shorthand: JavaScript's `\d` is exactly
-- `[0-9]`, and POSIX classes are not, so spelling the digits out is what makes
-- the two the same function. `pennsync_contract_*` it is not — no caller may
-- reach it, so the revoke below is not tidiness.
create or replace function "pennsync_records".phone_masked(p_raw text)
  returns text language sql immutable set search_path = '' as $mask$
  select case
    when coalesce(p_raw, '') = '' then null
    when pg_catalog.length(digits.value) < 4 then '••••'
    else '(•••) •••-' || pg_catalog.right(digits.value, 4)
  end
  from (select pg_catalog.regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g')) as digits(value)
$mask$;

create or replace function "pennsync_records".roster_entry(
  p_user_id text, p_email text, p_full_name text, p_agency_id text, p_agency_name text,
  p_tenant_role text, p_is_active boolean, p_profile "pennsync_records"."user",
  p_privileged boolean)
  returns jsonb language sql immutable set search_path = '' as $projection$
  select jsonb_build_object(
    -- Authority, from the authority store. Never the carried row's copy.
    'id', p_user_id,
    'email', p_email,
    -- PennSync's own, from `pennsync_private.identity_map`. Projected for every
    -- caller rather than only a privileged one, because the ADDRESS beside it
    -- already is: a colleague's name is not personnel detail, and making it one
    -- would tell a handler which kind of caller it is serving.
    'full_name', p_full_name,
    'agency_id', p_agency_id,
    'agency_name', p_agency_name,
    'tenant_role', p_tenant_role,
    'is_active', p_is_active,
    -- Derived, because the stored booleans are self-editable.
    'is_manager', p_tenant_role in ('agency_admin', 'manager'),
    'is_approved', p_is_active,
    -- The carried row, for what only it knows. `created_date` is null for a
    -- colleague who holds a membership and has no profile row at all, which is
    -- the same null the rest of this block already answers for that person.
    'created_date', p_profile."created_date",
    'staff_role', p_profile."staff_role",
    'service_type', p_profile."service_type",
    'care_scope', p_profile."care_scope",
    'credential_type', p_profile."credential_type",
    'duty_status', p_profile."duty_status",
    'duty_on_since', p_profile."duty_on_since",
    'off_duty_message', p_profile."off_duty_message",
    'scheduled_off_duty_start', p_profile."scheduled_off_duty_start",
    'scheduled_off_duty_end', p_profile."scheduled_off_duty_end",
    'scheduled_off_duty_recurring', p_profile."scheduled_off_duty_recurring",
    -- Administrative. Null rather than absent for a caller who may not see it,
    -- so the shape does not tell a handler which kind of caller it is serving.
    'phone', case when p_privileged then p_profile."phone" end,
    'credentials', case when p_privileged then p_profile."credentials" end,
    'license_number', case when p_privileged then p_profile."license_number" end,
    'manager_email', case when p_privileged then p_profile."manager_email" end,
    'profile_completeness_score', case when p_privileged then p_profile."profile_completeness_score" end,
    'ai_content_agreement_accepted',
      case when p_privileged then p_profile."ai_content_agreement_accepted" end,
    -- Telecom provisioning, for the three admin screens that read it.
    --
    -- The two PRESENCE booleans carry the whole of what two of those screens
    -- need: `TelnyxSetupProgress.jsx` and `phoneAnalytics.js` only ever COUNT,
    -- never render a number, so a boolean serves them and no number travels.
    --
    -- Compared against the empty string and deliberately NOT trimmed. The
    -- browser's test is bare truthiness — `users.filter((u) =>
    -- u.work_phone_number)` — and `'   '` is truthy in JavaScript. `btrim` here
    -- would make this store stricter than the screen it answers, which is a
    -- disagreement rather than an improvement.
    'has_work_phone',
      case when p_privileged then coalesce(p_profile."work_phone_number", '') <> '' end,
    'has_personal_cell',
      case when p_privileged then coalesce(p_profile."personal_cell_e164", '') <> '' end,
    -- The WORK line in full, because it is a number the product assigns and
    -- `PhoneProvisioningPanel.jsx` prints it in full today.
    'work_phone_number', case when p_privileged then p_profile."work_phone_number" end,
    -- The personal cell MASKED, and never in full. That panel already shows only
    -- `maskPhone(u.personal_cell_e164)` — last four digits — so the masked form
    -- is every digit the product displays, and the full number was travelling
    -- through a shared roster projection so that one input could be pre-filled.
    -- What it cost was not that input; it was every future consumer of this
    -- projection.
    'personal_cell_masked',
      case when p_privileged then "pennsync_records".phone_masked(p_profile."personal_cell_e164") end)
$projection$;

reset role;

-- `phone_masked` is new, and PostgreSQL grants EXECUTE on a new function to
-- PUBLIC by default — which is how the nine helpers in
-- `20260920650000_revoke_nonauthorizing_helpers.sql` came to be reachable. It
-- does no authorization and takes no table, but a reachable helper nobody
-- intended is the pattern, not the risk level. `roster_entry` keeps the ACL it
-- already has, because `create or replace` does not reset one.
revoke all on function "pennsync_records".phone_masked(text)
  from public, anon, authenticated, service_role;

commit;
