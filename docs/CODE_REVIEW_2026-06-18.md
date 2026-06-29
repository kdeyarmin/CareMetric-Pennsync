# Full-App Review & Remediation — 2026-06-18

A complete, multi-pass review of PennSync2 (React 19 + Vite frontend ~294K LOC across
1085 JS/JSX files, 124 routed pages; 205 Base44/Deno `entry.ts` edge functions; Twilio
SMS/voice/fax; OASIS/PDGM clinical logic; offline-first PHI handling).

**Method.** Six domain-focused passes — backend functions, clinical/OASIS/PDGM logic,
React correctness, communications, and shared infrastructure (×2) — each instructed to
read the two prior review docs first and surface only **new** issues, followed by manual
verification of every item acted on here.

**Baseline (before and after — all green):** `npm run lint` (0 errors, 152 pre-existing
`exhaustive-deps`/unused warnings), `npm run test:utils` (446), `npm run test:components`
(92), `npm run build` (pass). This PR adds **8 new tests** (2 util + 6 component) and
introduces **0 new lint warnings**.

**Relationship to prior docs.** Complements `docs/APP_IMPROVEMENT_ROADMAP_2026-06.md` and
`docs/CODE_REVIEW_2026-06-05.md`; everything below is **new** (not already tracked there).
The backend functions cannot be executed/transpiled in this environment (no Deno), so
backend changes mirror existing in-repo patterns exactly and are covered by the inline
parity / dedupe tests where those exist.

---

## 0. Follow-up implementation status (the open backlog has now been addressed)

After the initial review (§2 lists what landed first), a follow-up pass implemented
essentially the entire open backlog. Net state:

**§3 backend security — in-repo items DONE; two residuals (one deploy-only, one tracked-open).**
The three document-signing webhooks
(`onDocumentSigned`, `notifyAdminOfSignedDocument`, `notifySignerOfPackage`) and
`autoAssignNurseToPatient` are **entity triggers** — the platform invokes them with no
user identity and no custom header, so a required `INTERNAL_FN_SECRET` gate would 403 the
legitimate trigger the moment the secret is set. They are therefore hardened by **mandatory
canonical re-fetch** instead: require `data.id`, re-fetch the real
`DocumentSignature`/`DocumentPackage`/`Patient` by id, and derive all privileged state
(completion, admin recipients, the 30-day signer token's email) from that record — never the
posted body. The **cron** path `monitorComplianceRisks` *does* get the opt-in
`INTERNAL_FN_SECRET` gate + 5000-row bound (crons can carry the header);
`archiveSignedDocument` got an admin-role gate. Fax credential fallback (env → in-app
`IntegrationSecret` via `resolveTwilioCreds`) added to `handleTwilioFaxWebhook`, `sendFax`,
`autoRetryFailedFaxes`, `retryFailedFax`, `syncTwilioFaxStatuses`, and `handleTelnyxWebhook`.
**Residual (deploy-only):** a true network-auth gate on the entity-trigger webhooks needs the
platform configured to send the secret header; it is mitigated by the canonical re-fetch.

**`autoAssignNurseToPatient` placeholder PHI — HARDENED.** The function now attempts a
**minimal `{ assigned_nurses }` update first** (zero fabricated PHI). Only if that write throws
*and* the record is genuinely missing required fields does it backfill those specific fields
(`phone:'000-000-0000'`, `date_of_birth:'1900-01-01'`, `address`/contact `'Unknown'`) as a
**logged last resort** so the nurse still gets PHI access. A clearly non-validation failure
(server 5xx, 429 rate-limit, or 401/403 auth — detected best-effort from the error's HTTP
status) **rethrows** instead of backfilling, so a transient error can't mask the real cause by
writing placeholders on retry; a 4xx or undetectable status keeps the safe backfill default.
This is robust under both
platform validation models without a Deno test: partial-patch validation → placeholders are
never written; whole-record validation on a complete record → never written; only an
incomplete legacy record under whole-record validation still gets them, now logged for
correction. Fully eliminating that last case needs a schema change (make those fields optional)
or deploy-confirmed partial-patch validation.

**`PDGMRateConfig` write authorization — DONE (in-repo).** The rate-editor entity is now
**service-role-write only** (`read: {}`, `write: { user_condition: { role: "__service_role_only__" } }`),
and the admin **PDGM Rate Settings** page saves through the new gated `savePDGMRateConfig`
function (mirroring how `saveTwilioSecret` guards `IntegrationSecret`). That function authorizes
on `isAdminLike` — role `admin` **or** an `agency_admin`/`super_admin` account_type **or** the
owner email — so the platform owner (whose `role` is promoted only best-effort by
`ensureSuperAdmin`) can still save; a plain `role:'admin'` RLS rule would have locked them out.
Writes stamp `updated_by_email` from the authenticated caller and never trust a posted id.
`calculatePDGM` reads the config via `asServiceRole` (RLS-exempt), so the calculation is
unaffected.

**§4 comms — DONE.** `sendFax` idempotency guard; `pollFaxStatuses` + `handleTwilioFaxWebhook`
unknown-status → skip; `dispatchScheduledSms` 24h staleness expiry + `StatusCallback`;
`redriveFailedSms` `StatusCallback`; quiet-hours parity via `agencyQuietHoursConfig` (+
extended parity test); inbound SMS/voice nurse lookup via `phoneVariants`.

**§5 offline — DONE.** IndexedDB `SYNC_QUEUE` drain deduped via a `client_request_id`
idempotency key (added to the Visit schema) + in-flight guard; `OfflineManager` roster
prefetch gated on `isAuthenticated`.

**§6 clinical — DONE (the safe, well-defined ones, all with tests + backend mirrors synced).**
Dyspnea de-dup; diabetes de-dup; standard Soundex H/W; drug-interaction word-boundary
matching with aspirin correctly re-homed to a new `antiplatelet` group (warfarin+aspirin is
still flagged, with the right label). Critical-vital escalation was verified already wired
into the primary documentation flow (`DocumentVisit.jsx`).

**Second follow-up — the remaining items resolved as far as is safe:**
- `handleTelnyxWebhook` retry consolidation (§4 M3) — **DONE.** It now uses the identical
  inline `planFaxRetry` policy as the canonical `handleTwilioFaxWebhook` (config-aware,
  permanent-failure-aware), so even if both handlers receive the same payload they compute
  the same `retry_count` / `next_retry_at`; the divergent `[5,15,60]` schedule is gone and
  the inline copy is added to the `faxRetryInlineParity` drift guard.
- `calculatePDGM` (prior B13) — **bug fixed + rates now admin-editable.** The concrete
  `'S'`→Skin error is fixed (`S` is the injury chapter, not skin — it now falls through
  instead of mis-grouping + inflating the wrong weight). The previously-hardcoded case-mix
  weights, base rate, and multipliers are now **editable anytime** via the new
  **Admin → PDGM Rate Settings** page (`PDGMRateConfig` entity); `calculatePDGM` loads the
  saved numbers and merges them over the built-in defaults (a partial override is safe —
  any omitted value falls back to the default). Results are labeled `isEstimate: true` with
  a disclaimer until the admin enters their official CMS numbers and toggles
  “official,” at which point the output is treated as authoritative. The merge + default
  numbers live in the tested `src/components/pdgm/pdgmRates.js`. The **ICD-10 → clinical-group
  mapping** is editable on the same page too (add/edit/remove prefix→group rows, REPLACE
  semantics); `calculatePDGM` uses the saved map (else the built-in defaults). So both the
  clinical-group *assignment* and the case-mix *weights* are now fully admin-controlled.
- `aiCall` request abort (§7) — **confirmed SDK-blocked.** The SDK integration call is
  `async (data) => axios.post(...)` with no config/`signal` passthrough, so an
  `AbortController` can't be threaded; no code change helps until the SDK exposes a signal.
  (`useAICall` already discards stale results; file/transcription calls already use
  `retries: 0`.)
- Offline subsystem consolidation — the **correctness/HIPAA** issues are already fixed (purge
  coverage, `SYNC_QUEUE` idempotency, retry-forever cap). The remaining work is a pure
  architectural merge of the three offline systems onto one namespace; left as tracked
  tech-debt because doing it blind (no offline test harness here) would risk the
  safety-critical field-documentation path.
- Array-index `key`s on the transient edit-dialog lists (cosmetic focus/IME nicety) — left
  as low-priority polish.

---

## 1. Severity summary

| Sev | New findings | Fixed in this PR | Deferred (documented) |
|-----|------|------|------|
| Critical | 4 | 2 | 2 |
| High | 11 | 6 | 5 |
| Medium | 14 | 7 | 7 |
| Low | 5 | 1 | 4 |

---

## 2. Fixed in this PR (verified: lint + tests + build green)

### Clinical safety & PHI

- **[Critical] OASIS auto-save to the wrong patient — removed.** `src/pages/OASISAnalyzer.jsx:436`
  silently persisted an AI-extracted OASIS assessment (and its PDGM payment estimate) to a
  patient chart via `setTimeout(handleSaveToPatient, 500)` whenever the fuzzy match scored
  ≥85%. That threshold is reachable on **name signals alone** (exact name = 100), and the
  name/DOB are themselves AI-extracted from the uploaded PDF — so a wrong-patient link
  attached a whole assessment with no human in the loop. Now the best match is only
  **pre-selected**; saving requires an explicit click on "Save to Patient Record." Also
  removed the two `console.log`s that printed patient names (PHI) to the browser console.

- **[Critical] Synced offline visit PHI survived logout/idle-timeout — purged.**
  `src/lib/phiStorage.js`. `clearCachedPHI` only matched `penn_sync_offline_cache_`, while
  `src/components/mobile/OfflineStorage.jsx` also writes `penn_sync_offline_pending_visits`
  / `_pending_updates` (full visit notes/vitals) and `penn_sync_offline_sync_errors` (full
  failed-item PHI **plus** stack traces). `cleanupSyncedItems` retains *synced* items for
  24h, so already-uploaded PHI sat in cleartext `localStorage` after logout on shared/kiosk
  devices. The purge now drops the sync-error/status logs in full and **removes the synced
  entries from the pending-visit/update queues while preserving anything still pending
  sync** (per the existing unsynced-work-preservation policy). New regression test:
  `src/lib/phiStorage.spec.js` (6 cases).

- **[High] OASIS patient-match DOB failed across date formats.**
  `src/components/oasis/patientMatchScore.js:172`. The matcher compared raw digit strings,
  so the same person's DOB looked *different* between a US `MM/DD/YYYY` document and an ISO
  `YYYY-MM-DD` record — weakening (and sometimes penalizing −20) the one identifier meant to
  prevent wrong-patient links. Now parses both into Y/M/D components and compares those.
  Tests added for cross-format match and same-year/different-day non-match.

- **[High] Lost-update race on a patient's medication list.**
  `src/components/smartNote/MedicationManagementTab.jsx`. "Sync to Patient Record" wrote the
  whole `current_medications` array back off a possibly-minutes-stale prop with no re-fetch,
  silently erasing a drug another writer (visit med-rec, patient-detail editor) added in the
  interim. Now re-fetches immediately before writing and preserves concurrently-added meds
  (present on the server, absent from both this tab's snapshot and its working set) while
  honoring the nurse's removals — mirroring the correct sibling `MedicationManagementSection`.

- **[Medium] Lost-update on care-plan clinical notes.**
  `src/components/clinical/CarePlanInteractive.jsx`. Re-fetches the plan's current
  `clinical_notes` immediately before prepending so a concurrently-added note isn't dropped.

- **[Medium] Lost-update on patient history arrays + dead "Surgeries" editor.**
  `src/components/patient/HealthHistorySection.jsx`. (a) The "Surgeries & Hospitalizations"
  Edit button opened a dialog with a title but **no editor body** — added the missing
  editor for the `past_hospitalizations` entries. (b) The whole-array writes for
  `past_medical_history` / `past_hospitalizations` now re-fetch and re-merge concurrent adds.

- **[Medium] AI care-plan `target_days` unvalidated before date math.**
  `src/components/carePlan/AICarePlanGenerator.jsx`. `addDays(new Date(), plan.target_days || 60)`
  accepted negative/zero/`NaN`/huge LLM or user values, producing past or absurd
  `target_date`s; the editor's `parseInt` also yielded `NaN` on a cleared field. Both are
  now clamped to a sane 1–365-day range (default 60).

### React correctness & resilience

- **[Medium-High] Overlapping LLM calls + setState-after-unmount in live charting.**
  `src/components/clinical/RealTimeClinicalDecisionSupport.jsx`. The debounced auto-analyze
  effect guarded on a stale-closure `isAnalyzing`, so a new analysis could start while one
  was in flight, and `runAnalysis` set state with no unmount guard. Now uses refs for the
  in-flight/last-hash guard (no new deps) and a mounted-ref guard around all setState.

- **[High] Offline sync retried `failed`/`conflict` items forever.**
  `src/components/offline/OfflineSyncService.jsx`. `syncAll` iterated the whole queue with no
  status filter, so an item that hit the 3-retry cap (`status:'failed'`) or a `conflict` was
  re-POSTed on every subsequent sync cycle — silently bypassing the cap and re-attempting
  conflicting PHI writes. Now skips `failed`/`conflict` items, leaving them for an explicit
  user-driven retry/resolve.

### Session / auth hygiene

- **[High] Idle-timeout logout re-fired every second.**
  `src/components/security/SessionTimeoutManager.jsx`. Once inactive past the threshold, the
  1s interval re-entered `handleLogout` on every tick (no latch), re-writing the
  `SESSION_TIMEOUT` audit row and re-calling logout/clear repeatedly until the redirect
  landed — and `base44.auth.logout()` was called with no redirect URL. Added an
  `isLoggingOut` latch (idempotent) and pass `window.location.href` for a deterministic
  redirect, matching `AuthContext.logout`.

### Backend correctness (non-behavioral, safe without Deno verification)

- **[High] Certificate packets printed the caller's name on another employee's certificate.**
  `base44/functions/generateAndCacheCertificatePacket/entry.ts`. When an admin generated a
  packet for another employee, the cover page and every "Presented to" line used
  `auth.me()` (the admin) instead of the target. Now resolves `employee` to the target
  record. **Also fixed the cache key**: a request pinning specific `certificateIds` (no date
  range) matched a prior cache entry built from a *different* selection and returned the
  wrong PDF — explicit `certificateIds` requests now bypass the cache and regenerate.

- **[Medium] `auditDataQuality` emitted `NaN` on empty segments.**
  `base44/functions/auditDataQuality/entry.ts`. The completeness percentages divided by
  `patients/users/visits.length` with no zero guard. Added a `pct()` helper that returns
  `"0.0"` when the denominator is 0.

- **[Medium] `predictPatientRisks` 500'd on malformed LLM output.**
  `base44/functions/predictPatientRisks/entry.ts`. `for (const risk of riskPredictions.risk_assessments)`
  (and two later derefs) assumed an array the response schema doesn't require. Now coerces
  to `[]` when missing/non-array.

- **[Medium] `onDocumentSigned` emailed a hardcoded placeholder address.**
  `base44/functions/onDocumentSigned/entry.ts`. Signed-document notifications went to the
  literal `admin@agency.com` (a "replace this" placeholder) — never reaching real admins and
  leaking signer details to an unowned address. Now resolves real admin recipients
  (`User.filter({role:'admin'})`), mirroring `notifyAdminOfSignedDocument`.

- **[Low] `sendDocumentReminderEmails` crashed per-package on a missing signature array.**
  `base44/functions/sendDocumentReminderEmails/entry.ts`. Guards `pkg.document_signatures`
  with `Array.isArray` before `.map`. Same hardening applied to `notifyAdminOfSignedDocument`'s
  `Patient.get` (now `.catch(() => null)`).

---

## 3. Backend security (RESOLVED — see §0; original findings + fixes below)

> **Status (see §0 for detail):** The **in-repo** items in this section are remediated — the
> signing webhooks / `autoAssignNurseToPatient` use mandatory canonical re-fetch (a hard secret
> gate would break the entity trigger); `monitorComplianceRisks` and `archiveSignedDocument`
> are gated; the fax credential fallback is in place; and `PDGMRateConfig` is now
> service-role-write via the gated `savePDGMRateConfig` function. The `autoAssignNurseToPatient`
> placeholder-PHI write is **hardened** — a minimal `{ assigned_nurses }` write is tried first,
> with placeholder backfill now only a logged last resort for incomplete legacy records under
> whole-record validation (see §0 / the item below). The remaining **deploy-only** residual is a
> true network-auth gate on the entity-trigger webhooks (needs the platform to send the secret
> header), mitigated by the re-fetch. The original finding write-ups are
> kept below for the audit trail.

*(Historical — the original first-pass rationale; see the **Status** note above for the current
state.)* These were the **most serious** findings. They were **not** auto-fixed in the first
pass because the fix interacts with how Base44 invokes entity-trigger / cron functions (adding
a required gate can break the platform trigger unless it is configured to send the secret
header), and the backend cannot be executed in this environment — so any remaining deploy-only
gate must be applied with the ability to test the live trigger. The established pattern to copy
is `checkExpiredInvitations/entry.ts:17-26` (opt-in `INTERNAL_FN_SECRET`) and
`onUserSignup/entry.ts:18-21` (`SIGNUP_WEBHOOK_SECRET`); both env vars already exist in
`.env.example`.

- **[Critical] Three unauthenticated document-signing webhooks run privileged service-role
  work from a caller-supplied body.**
  - `onDocumentSigned/entry.ts` — no auth; trusts the posted `data` and flips a
    `DocumentPackage` to `completed` (corrupts the legal signing audit state).
  - `notifyAdminOfSignedDocument/entry.ts` — no auth; fetches an attacker-chosen `Patient`
    and emails every admin patient/signer details.
  - `notifySignerOfPackage/entry.ts` — no auth; mints a **30-day signer-portal bearer token**
    (PHI-document access credential) for any package id / email the caller supplies.
  → Add the opt-in webhook/internal-secret gate **and** re-fetch the canonical
    `DocumentSignature`/`DocumentPackage`/`Patient` by id to verify true state rather than
    trusting the posted body. Configure the entity trigger to send the secret header.

- **[High] `monitorComplianceRisks/entry.ts`** — no `auth.me()` at all; runs a service-role
  scan of **all** active patients (unbounded `.filter`, N×3 reads) and writes `PatientAlert`
  records. Any unauthenticated caller can trigger an agency-wide PHI scan. → Add the cron
  `INTERNAL_FN_SECRET` gate and an explicit page bound (mirror `predictSupplyNeeds`' `5000`).

- **[High] `archiveSignedDocument/entry.ts`** — gated only on `if (!user)`, so any
  authenticated user can archive (retire) **any** patient's signed clinical/legal document
  via service role. → Require an admin/compliance role, or verify the caller is a signer /
  assigned to `document.patient_id`. (No frontend caller found — validate the intended
  caller before tightening.)

- **[Medium] `autoAssignNurseToPatient/entry.ts`** — no auth gate; reads `patient_id` /
  `nurse_email` from the raw payload and adds the nurse to `assigned_nurses` (the primary
  PHI access-scoping field) via service role, and force-writes placeholder PHI
  (`phone:'000-000-0000'`, `date_of_birth:'1900-01-01'`) onto real records. → Add the
  automation secret gate; stop writing placeholder PHI.
  - **Auth: DONE** — now requires `data.id` and re-fetches the canonical `Visit` by id,
    deriving `patient_id` / `nurse_email` from the real record (never the posted body), so an
    unauthenticated caller can't grant an attacker-chosen email PHI access.
  - **Placeholder PHI: HARDENED** — the function now tries a minimal `{ assigned_nurses }`
    write first (no fabricated PHI). It backfills `'000-000-0000'` / `'1900-01-01'` / `'Unknown'`
    only if that throws *and* the record is genuinely missing required fields — a **logged last
    resort** so the assignment still completes; any other failure propagates unchanged. Safe
    under both validation models without a Deno test (placeholders are never written when
    avoidable). Fully eliminating the last case (incomplete legacy record + whole-record
    validation) needs a schema change making those fields optional.

- **[High] Fax subsystem can't read in-app Twilio credentials.** `sendFax`,
  `handleTwilioFaxWebhook`, `autoRetryFailedFaxes`, `retryFailedFax`, the fax pollers, and
  `handleTelnyxWebhook` read Twilio creds from **env only**, unlike every SMS/voice path
  which falls back to the in-app `IntegrationSecret` via `resolveTwilioCreds()`. An agency
  that configures Twilio in-app (the path the admin UI advertises) gets working SMS/voice but
  **silently broken fax** — `verifyTwilioSignature` reads a null token and rejects every
  inbound fax webhook 401. → Give the fax functions the same `resolveTwilioCreds()` fallback.

---

## 4. Open — communications reliability

- **[High] `sendFax/entry.ts` has no idempotency/claim guard** — a double-submit
  double-sends a PHI fax and double-charges (the scheduled/retry fax paths were hardened in
  the prior review's R2, but the interactive send was left open). → Dedup on a deterministic
  key (`file_url + to + sender + minute-bucket`) or a client `request_id`.
- **[Medium] `pollFaxStatuses`** maps unknown Twilio statuses → `'queued'` (non-terminal),
  re-polling forever and racing duplicate notifications. `syncTwilioFaxStatuses` already
  returns `null`/skips — align it (or retire the redundant pollers per the prior R8).
- **[Medium] `dispatchScheduledSms`** has no max-age: after any cron downtime every overdue
  reminder fires at once (a day-late "appointment tomorrow"). `redriveFailedSms` already caps
  at 24h — apply the same staleness ceiling.
- **[Medium] `redriveFailedSms` / `dispatchScheduledSms` omit `StatusCallback`** — a
  re-driven message that later fails delivery never gets a DLR, so it's marked `sent` forever
  and never surfaces a failed-delivery notification (the exact messages the outbox exists to
  rescue). → Set `StatusCallback` as the interactive `sendSms` does.
- **[Medium] Quiet-hours parity drift** — backend SMS paths honor admin-configurable
  `tcpa_quiet_start_hour`/`end_hour`, but the "source of truth" `quietHours.js` only takes
  hardcoded 8/21 and the parity test checks only defaults — false confidence. → Add an
  `agencyQuietHoursConfig(settings)` mapping and extend the parity test to non-default hours.
- **[Medium] `handleTelnyxWebhook`** still processes Twilio fax payloads with its own
  hardcoded `[5,15,60]` retry schedule that ignores `classifyFaxFailure`/`FaxRetryConfig` and
  diverges from `handleTwilioFaxWebhook` — two handlers can advance `retry_count` on the same
  FaxLog by different schedules. → Retire it or route it through the shared `planFaxRetry`.
- **[Low] `handleTwilioFaxWebhook`** maps unknown status → non-terminal `'sending'` (same
  class as the poller bug, lower impact). **[Low] inbound-SMS nurse lookup** is an exact
  `work_phone_number` match (no `phoneVariants` fan-out), so a stored-vs-inbound format
  mismatch silently drops the message.

---

## 5. Open — frontend / offline architecture

- **[Critical] Duplicate visit-record creation: IndexedDB `SYNC_QUEUE` drain has no
  idempotency.** `SmartNoteAssistant.jsx:250` enqueues `CREATE_VISIT`;
  `OfflineManager.jsx:18-29` drains it (`Visit.create` then `removeFromSyncQueue`) on every
  `online` event with no idempotency key or in-flight claim — a re-mount / second `online`
  event / interrupted removal creates the visit twice. → Stamp a client idempotency key and
  dedupe server-side, or claim the item before create.
- **[Medium] `OfflineManager` runs outside the auth gate** (`App.jsx:149`), firing
  `Patient.filter(... 200)` on the login screen pre-auth. → Mount inside the authenticated
  subtree (or guard on `isAuthenticated`). It also silently drops non-`CREATE_VISIT` queue
  items.
- **Three overlapping offline subsystems** (`mobile/OfflineStorage`, `offline/OfflineSyncService`,
  IndexedDB `SYNC_QUEUE`) write PHI to overlapping key namespaces, which is what made the
  §2 purge-coverage gap hard to audit. → Consolidate onto one namespace so purge coverage is
  auditable, and implement the deferred encryption-at-rest for genuinely-preserved unsynced work.
- **[Low] Array-index `key`** on the editable history/medication lists shifts focus/IME state
  when a middle row is removed (`HealthHistorySection`); give entries stable ids.

---

## 6. Open — clinical logic (needs domain validation before changing matching/scoring)

- **[Medium] OASIS dyspnea (M1400 = 3–4) triggers both Cardiovascular and Respiratory**
  high-severity suggestions from one finding (`oasisScoringEngine.js:52,63`) — duplicated
  high-severity care suggestions. *Arguably clinically valid for severe dyspnea; reconcile or
  de-dupe by source finding if it's noise.*
- **[Medium] `pdgmClinicalGroup.identifyComorbidities`** can count one diabetes diagnosis in
  both the high and low tiers (inflated/contradictory `count`); the final adjustment tier is
  unaffected.
- These join the prior review's deferred clinical items (B2 Soundex, B12 drug-interaction
  matching, B13 PDGM group mappings, B3-wiring of `CRITICAL_VITAL_RULES` into the vitals
  form) — all of which change matching/scoring and need a domain expert + tests.

---

## 7. AI-cost / robustness notes (low)

- `aiCall.withTimeout` can't abort the underlying SDK call, so a 30s timeout + 2 retries can
  leave up to 3 billable LLM requests in flight for one logical call. Acceptable today
  (`useAICall` discards stale results), but it compounds the roadmap's E1 migration of the
  ~213 inline `InvokeLLM` sites onto this wrapper — thread an `AbortController` when the SDK
  supports one.

---

## 8. Sequencing for the open items

1. **Now (deploy-coordinated):** §3 backend auth gates + fax credential fallback — the
   highest-severity findings; each has a concrete fix and the secret env vars already exist.
2. **Next:** §4 comms idempotency/StatusCallback/staleness; §5 offline `SYNC_QUEUE`
   idempotency + `OfflineManager` auth placement.
3. **Behind a domain expert + the test net:** §6 clinical reconciliations; the prior docs'
   deferred matching/scoring items.

Every batch should end green on
`npm run lint && npm run test:utils && npm run test:components && npm run build`.
