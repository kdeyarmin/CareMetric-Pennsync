# PennSync — Complete Domain Review & Gap Analysis (2026-06-20)

Scope: a logical/functional review of the whole application, domain by domain, to
identify gaps that would break functionality or compliance. Every finding below
was verified against the actual entity schemas (`base44/entities/*.jsonc`),
backend function source (`base44/functions/*`), and component code — not inferred.

## Remediation status

All actionable findings were fixed across three commits on this branch, each
verified green (build + lint 0-errors + util tests + 83 component tests):

- **Round 1** — the six domain clusters below (comms entity schemas + enums,
  DocumentSignature pipeline, patient/referral, clinical error-handling, training,
  admin/platform orphans + offline).
- **Round 1b** — security honesty + compliance enforcement + incident/report integrity.
- **Round 2** — a deeper second pass found the *same* contract-drift class in code
  paths the first pass didn't cover: more Notification/PatientAlert/Task writers
  with invalid enums/fields (sendExpirationNotifications, monitorClinicalDataForCarePlanUpdates,
  sendFaxStatusNotification, pollFaxStatuses, analyzeVisitForSupplyUsage,
  reconcileMedications, predictiveRiskAnalysis), CallLog missing `note`/`disposition`,
  HospitalizationRiskWidget's broken PatientAlert create, Task creates missing
  required `assigned_to`, UserActivity RLS too narrow, and three signature
  components still on the old DocumentSignature shape.

**Known remaining (deliberately not auto-fixed):**
1. **PDGM calculation** — the orphaned `groupPeriod` grouper and the hardcoded
   case-mix weights in `calculatePDGM` need official CMS 2026 rate/grouping tables,
   not invented numbers. The live path already discloses `isEstimate` until an admin
   loads official values. Needs a real CMS data source / product decision.
2. **`SignatureAuditTrail.jsx`** — filters `DocumentSignature` by `document_id`,
   a field that has never existed on that entity (pre-existing; the viewer already
   returned nothing). Fixing it properly needs an intended document↔signature
   linkage decision rather than a mechanical change.

## How this review was run

1. **Objective health gates** — production build, ESLint, and the full test suite
   were run first to establish a mechanical baseline.
2. **Domain-by-domain logical review** — six domain clusters were reviewed for
   broken logic, contract mismatches (UI ↔ function ↔ schema), error-handling
   holes, missing wiring, and compliance/calculation risk.
3. **Spot verification** — the highest-severity findings in each domain were
   re-checked directly against schema/source before inclusion (false positives
   were dropped — see "Corrections" at the end).

## Objective baseline — PASS

| Gate | Result |
|------|--------|
| `npm run build` | ✅ exit 0 |
| `npm run lint` | ✅ 0 errors, **149 warnings** (148 `react-hooks/exhaustive-deps`, 1 unused var) |
| `npm run test:utils` (node) | ✅ pass |
| `npm run test:components` (vitest) | ✅ 83 passed |

The app is mechanically sound: it builds, lints clean of errors, and all tests
pass. There is **no widespread stub/dead-feature problem** — the 303 "TODO"
string matches are almost entirely setup-step status enums (`'todo'|'done'`),
with one genuine `TODO(verify)` in `voice/onCall.js`. Routing is healthy too:
routes derive from a single source of truth (`src/lib/nav.manifest.js` →
`src/routes.jsx`), retired pages have `REDIRECTS`, so the old dual-route drift is
resolved and the 42 non-manifest page files are intentionally redirected, not
broken links.

**The gaps are not mechanical — they are contract/data-model drift.** The single
dominant theme across the whole app: **code writes entity shapes (status values,
field names) that the `.jsonc` schemas do not define, so writes are silently
dropped or rejected and the dependent logic is dead** even though the build and
tests are green (tests don't exercise the live entity layer).

---

## Domain 1 — Communications (SMS / Voice / Fax / Telehealth)

**Highest-risk domain.** The SMS/voice layer was ported Twilio→Telnyx but the
entity schemas and the Notification contract never caught up.

### Missing entity schemas — whole subsystems have no data model (High)
Verified: no schema file exists for any of these (only `Message.jsonc`, a
different internal-messaging entity, and `ScheduledFax.jsonc` exist).

- **`SmsMessage`** — written/read by `sendSms`, `dispatchScheduledSms`,
  `redriveFailedSms`, `handleTelnyxStatusWebhook`, `getCommsDashboard`,
  `getUserActivityLog`, and frontend (`SmsConversationList.jsx:26`, `Layout.jsx:147`).
- **`SmsConsent`** — TCPA opt-out/consent ledger; referenced in 8 functions +
  `PatientContactActions.jsx:42`, `SmsConversationList.jsx:40`.
- **`ScheduledSms`** — `scheduleSms`/`dispatchScheduledSms`/`cancelScheduledSms`,
  `ScheduledSmsList.jsx:34`. (`ScheduledFax` exists but not the SMS twin.)
- **`CallLog`** — ~15 refs in `handleTelnyxStatusWebhook` + `startMaskedCall`,
  `getCommsDashboard`, `CallHistoryList.jsx`. Entire voice/voicemail feature.

→ **Fix:** add the four `*.jsonc` schemas with the exact fields the code writes.
Until then, SMS threading, the consent ledger, scheduled SMS, call logging, and
voicemail are non-functional or silently lossy at runtime.

### Notification contract mismatch — alerts silently dropped (High)
Verified `Notification.jsonc` `type` enum = `report_ready, compliance_alert,
critical_alert, patient_alert, task_assigned, task_due_soon, new_referral,
referral_urgent, training_due, system_update, message_received, info`.

- `handleTelnyxStatusWebhook` + `autoRetryFailedFaxes/entry.ts:232` create
  notifications with types `sms_failed, sms_urgent, sms_received, fax_delivered,
  fax_failed, voicemail, error` — **none in the enum** → every delivery/failure/
  voicemail alert is dropped.
- Same writes use `related_entity`/`related_entity_id` (not in schema; schema has
  `metadata`) and `priority: 'normal'/'urgent'` (enum is `low/medium/high/critical`).

→ **Fix:** extend the Notification `type` enum (or map to existing types); move
related-entity data into `metadata`; map `normal→medium`, `urgent→critical`.

### Fax retry is functionally broken (High)
Verified `FaxLog.jsonc` `status` enum = `queued, sending, sent, delivered, failed`
and it has **no** `retry_claimed_by`/`retry_claimed_at` fields.

- `retryFailedFax` writes `status:'retrying'`/`'retried'` (out-of-enum → dropped)
  and sets `retry_claimed_by/at` (no such fields → dropped), then re-reads them
  for the concurrency claim. The re-read returns `undefined ≠ runId`, so **every
  manual retry returns 409 "already in progress" and every auto-retry is skipped.**

→ **Fix:** add `retrying`/`retried` to the enum and `retry_claimed_by`/`_at`
fields to `FaxLog.jsonc`.

### Medium
- `retryFailedFax`/`autoRetryFailedFaxes` resolve the fax from-number only from
  `Deno.env.get('TELNYX_FAX_NUMBER')`, ignoring `AgencySettings.office_fax_number_e164`
  that `sendFax` honors → in-app-configured agencies fail retry or send from the
  wrong number; and they omit `webhook_url`, so retried faxes never get DLR status.
- `dispatchScheduledSms` quiet-hours check (`entry.ts:229`) is not wrap-past-midnight
  aware (unlike `sendSms:216`), and skips `isAllowedDestination` + `monthly_sms_cap`
  → scheduled sends bypass cost controls and mis-gate around midnight.
- `startMaskedCall` applies no consent/quiet-hours gate to outbound voice calls.

### Low
- `handleTelnyxStatusWebhook` has unverified `TODO(verify)` Telnyx Call-Control
  field names (`record_start`, `transcription_start`) — voicemail capture may no-op.

**Clean:** TelehealthSession schema matches `createTelehealthToken`; guest token
time-bounding + Ed25519 webhook verification are solid; all frontend→function
names resolve.

---

## Domain 2 — Compliance / Security / Signatures

### DocumentSignature contract drift — signature completion pipeline is dead (High)
Verified `DocumentSignature.jsonc`: `status` enum = `pending, in_progress,
completed, rejected`; signers live in a `signers[]` array; `document_title`
exists. There is **no** `signed` status and **no** flat `signer_name`,
`signer_email`, `signed_at`, `package_id`, `document_name`, or
`last_reminder_sent_at`. Yet across the stack the code writes `status:'signed'`
and those flat fields and gates completion on `status==='signed'`:

- `submitSignerSignature/entry.ts:54,69,85` — writes `status:'signed'`, compares
  `'signed'` → **packages never reach `completed`.**
- `onDocumentSigned`, `notifyAdminOfSignedDocument` — gate on `'signed'`, read
  `package_id`/`document_name` → trigger never fires; admin email would read
  "Signed: undefined".
- `InteractivePDFSigner.jsx:259`, `PDFSignatureCapture.jsx:101` — filter on
  non-existent `original_pdf_url`, write `status:'signed'` + flat fields.
- `sendAutomatedSignatureReminders`/`scheduleSignatureReminders` — idempotency
  guard reads/writes `last_reminder_sent_at` (not in schema) → guard never trips,
  **patients re-emailed every cron tick.**
- `archiveSignedDocument` writes `status:'archived'` (not in enum).
- `embedSignatureToPDF`/`stampSignatureOnPDF` exist but **no submit path calls
  them** → signatures recorded with no stamped/archived PDF artifact.

→ **Fix (one change, broad payoff):** standardize on the schema — `status:'completed'`,
record signers in `signers[]`, use `document_title`; add `last_reminder_sent_at`
(or store it on `DocumentPackage`) and an `archived` flag; wire the PDF-embed step
into the submit flow.

### Unscoped global `.list()` of PHI on non-admin views (High)
These tabs are reachable by any authenticated nurse and fall back to a global
list when no patient is selected — relying entirely on RLS as the only boundary:

- `DocumentSignatures.jsx:40` (`DocumentSignature.list(200)`),
  `DocumentAnalytics.jsx:13,19`, `DocumentManagementDashboard.jsx:51,58`,
  `SignatureTracking.jsx:46`, `SignatureTracker.jsx:23`.
- `Incidents.jsx:31` + `IncidentReportingModule.jsx:76` — global `Incident.list()`
  labeled "my incidents" with no owner filter (`_isAdmin` computed but unused).

→ **Fix:** require patient scope or admin gate before any unscoped list; add
defense-in-depth client filters (`created_by`/caseload). Server RLS remains the
real boundary, but these are the client-side holes.

### Security theater — unverifiable posture presented as real (High/Med)
- `PHIDeIdentifier.jsx:75` — banner asserts "HIPAA Safe Harbor / all 18 identifiers
  removed" but the name regex catches two capitalized words and most of the 18
  classes (URLs, IPs, account/device/biometric IDs) are unhandled.
- `VulnerabilityAssessment.jsx:29` — `setTimeout(3000)` fake "scan" with hardcoded
  passing results; cookie `HttpOnly` check via `document.cookie` is impossible.
- `EncryptionStatusIndicator.jsx:42` — hardcoded `status:true` "100% Compliant"
  (commented "platform handles this") with no real check.
- `RegulatoryMonitor.jsx:81` — LLM prompt "Generate realistic recent regulatory
  updates" **fabricates** CMS/OSHA regs that admins then "implement" into live
  `ComplianceRule` rows (with no `rule_code`, so auditors never match them).

→ **Fix:** soften claims to best-effort/manual-review or implement the real checks;
never auto-mutate compliance rules from fabricated AI content.

### Gates that don't gate / silent failures (High/Med)
- `MandatoryComplianceGate.jsx:152,184,189` — renders no `children` and never
  blocks; "override" only `console.log`s yet still calls `onCompliancePassed(true)`.
- `SecureDocumentShare.jsx:54` — "secure" token generated client-side, never
  persisted/validated/expired; the `/shared-document/<token>` route doesn't exist.
- `EventReport.jsx:106` — `patient_name = formData.patient_id` (raw ID stored/
  emailed/PDF'd as the patient's name).
- `GuidedIncidentReporting.jsx:174` — `Incident.create()` directly (bypasses the
  admin-alert path), rendered with no patient props → `patient_id: undefined`
  violates the required schema, fails silently; photos never uploaded.
- `sendSignatureReminder/entry.ts:6` — only requires `auth.me()`; any authenticated
  user can email any patient (PHI in subject) for any signature_id.
- `UnifiedComplianceEngine.jsx:122…` — failed analyzers coerce to `{score:0}` then
  filter `score===0` out → a failed Medicare check is indistinguishable from a
  clean pass, inflating the overall score.
- `ComplianceReportGenerator.jsx:27` — computes `startDate` but never filters by
  it; `avgScore` is `0/0=NaN` with no audits.
- `GuidelineComplianceChecker.jsx:430` — "Apply Enhancement" never inserts the
  suggested text (only calls a diagnostics callback).

**Clean:** `submitIncidentReport`/`submitStateReportableIncident`, `generateSignerToken`
(admin-gated, CSPRNG, expiry), `validateSignerToken`, the three PDF functions' SSRF
guards, and the DocumentHub *audit* tab's admin gate are all sound.

---

## Domain 3 — Patient Operations (Patient / Referral / Triage / Risk)

### High
- `PendingPatientUpdates.jsx:243,333` — reads `change.oldValue`/`newValue` but the
  schema field is `field_changes[].old_value`/`new_value` → **every before/after
  diff renders `undefined`; reviewers approve blind.**
- `deduplicatePatients` merge step writes `merged_into_id`/`merged_at`/`merged_by`
  and `status:'merged'` — verified none exist on `Patient.jsonc` and `merged` isn't
  in the status enum → merge-archive markers silently dropped.
- `PatientForm.jsx:~154` — submits `validation_overrides` (not in `Patient.jsonc`)
  → override audit trail lost.
- `PendingPatientUpdates.jsx:47` — approve/reject mutations have no `onError`/
  try-catch → a failed update is swallowed; reviewer sees false success.
- `ReferralTriage.jsx:34` — `Patient.create` omits required `phone`, `address`,
  `emergency_contact_name`, `emergency_contact_phone` (verified required) with no
  fallbacks → "Create Patient from Triage" is rejected/broken.
- `ReferralIntake.jsx:692` — bulk task creation omits `assigned_to` → orphaned tasks;
  and (`:222,836,863`) writes 5 Referral fields not in schema (`page_range`,
  `detection_confidence`, `manually_confirmed`, `rejection_date`, `rejected_by` —
  all verified missing) → rejection audit + split metadata lost.
- `monitorComplianceRisks` creates `PatientAlert` with `alert_type:'documentation_risk'`
  — verified not in the `PatientAlert.jsonc` enum → compliance alerts rejected,
  never surface.

### Medium
- `DuplicatePatientManager.jsx:87` — merge reassigns Visits/CarePlans but not
  PatientAlerts/PendingPatientUpdates → orphaned children pointing at archived patient.
- `DuplicateScanner.jsx:194` — auto-merge takes first non-empty value with no
  recency/conflict resolution → newer data can be discarded for stale survivor data.
- `EarlyWarningSystem.jsx:59` — `setIsAnalyzing(true)` with no matching reset →
  spinner hangs forever on completion/error.
- `AIPatientRiskAssessor.jsx`, `AICarePlanSuggestionEngine.jsx` — no try/catch around
  the LLM call → silent failure + permanent spinner.

**Note on invoke shape:** several "shows zero results" suspicions trace to the
`base44.functions.invoke` response contract. **Verified from the SDK source**
(`functions.js` → `return axios.post(...)`): invoke returns an **Axios response,
so the body is under `.data`.** That makes `PatientAlertsDashboard`'s
`res?.data?.alerts` **correct** (the patient-ops draft's finding here was a false
positive). The real systemic risk is the inverse — any site that reads the bare
body without `.data` is the broken one; `PatientRiskPredictor.jsx:31`'s
`response.data || response` is the safe pattern to standardize on.

---

## Domain 4 — Clinical Core (OASIS / PDGM / SmartNote / Visit / Medication / Care Plan)

### PDGM — payment/compliance risk (High)
- **The safe grouper is orphaned.** `pdgmGrouper.js` (`groupPeriod`) is a
  deterministic, unit-tested, "no-fabrication" grouping engine — verified called
  **nowhere** in production (only by its own test).
- **The live path uses hardcoded weights.** `calculatePDGM/entry.ts` ships
  case-mix weights/functional thresholds/comorbidity multipliers hardcoded
  (e.g. `0.9234`) — exactly what the grouper's header warns against. Mitigation:
  results are flagged `isEstimate: true` until an admin loads official CMS numbers
  (`rateBasis.isOfficial`), so it discloses estimate status rather than silently
  billing fake figures — but the verified, safer engine sits dead.
- Clinical-group keys are mislabeled `MMTA_*` for non-MMTA groups (Wounds, Neuro
  Rehab, Complex Nursing, Behavioral Health, MS Rehab); ICD-10→group fallback
  guesses by single-letter chapter prefix → mis-grouping that changes payment.

→ **Fix:** wire `groupPeriod` into the live path (or delete it so it doesn't imply
safety); require official CMS tables before emitting dollar figures; fix group naming.

### Other clinical (High/Med)
- `CarePlanProposalReviewer.jsx:50` — approve/reject mutations have **no `onError`**
  → failed proposal update gives no feedback, can leave the button stuck.
- `OASISActionWorkflow.jsx:124`, `AIEducationRecommender.jsx`, `AICarePlanSuggestionEngine.jsx`
  — async create-loops / LLM calls with no try/catch → partial writes or permanent spinner.
- `drugInteractions.js` ↔ `checkDrugInteractions/entry.ts` — the interaction
  GROUPS/RULES are **manually duplicated** in JS and TS, parity enforced only by a
  test → drift would silently degrade the safety net. (The matching logic itself
  is solid — token-based, no substring false positives.)
- Duplicate/near-duplicate components: `OASISScrubber` **and** `EnhancedOASISScrubber`
  both imported in `DocumentVisit.jsx`; `carePlan/AICarePlanGenerator.jsx` is an
  orphaned divergent copy of the used `clinical/` one.
- Unguarded `navigator.clipboard.writeText()` (toasts "Copied" even on reject) in
  `VoiceClinicalNoteRecorder.jsx:119`, `WhisperTranscriber.jsx:152`.

---

## Domain 5 — Training / Learning

### High
- `AutoAssignTraining.jsx:125` — `training_module_id: moduleTitle` stores a **title
  string in an id reference field** → every auto-assigned `TrainingCompletion` is
  unjoinable; progress/grading lookups break. Line 127 also writes `due_date`, which
  is **verified not in the `TrainingCompletion` schema** (only completion/expiration
  dates exist) → reminder/overdue UI renders blank.
- `AdminTrainingAssignment.jsx:30,99,193` — queries/reads `is_active`, `category`,
  `duration_minutes` that don't exist on `TrainingModule` (schema has `type`,
  `estimated_minutes`, `is_required`) → module list empty and "auto-assign by
  performance" assigns nothing while still showing an all-success toast.
- `MicroLearningModule.jsx:184` / `InteractiveQuizModule.jsx:131` — score
  `correct/results.length` with no length guard → empty LLM quiz array yields
  `0/0=NaN`, which propagates into the saved progress record. (Pass thresholds also
  differ: 70 vs 80.)

### Medium
- `LearningPathProgress.jsx:54` — `completedCount/totalCourses` mixes domains
  (completed *assignments* over all *plan courses*) → progress can exceed 100% or
  understate.
- `TrainingProgressTracker.jsx:21` — hardcoded `totalTutorials = 3` denominator;
  `improvementTrend` assumes newest-first ordering with no sort → can invert sign.
- `CompletionCertificate.jsx:18` — `new Blob([response.data])` assumes raw PDF bytes
  from invoke (which returns a parsed body) → corrupt cert download; `completion.id.slice`
  throws if id missing.
- Many training async writes only `console.error` with no user-facing toast.

---

## Domain 6 — Admin / Reports / Analytics / Platform / Offline

**The most solid cluster.** Function wrappers all resolve to real backends,
entity-field contracts line up, TimeOff and training-grading flows are robust end
to end, financial reports are admin-gated (`ReportsAnalytics.jsx:111`), and the
offline-PHI logout purge is derived from a single key registry. Gaps here are
concentrated in **orphaned/legacy code** and **offline-sync fragmentation**.

### High
- `admin/AdminUserSetup.jsx:54,59` — **orphaned** duplicate of the routed
  `pages/AdminUserSetup.jsx`. Verified imported nowhere. It invokes
  `createUserWithTempPassword` passing a **client-generated `temporary_password`**
  and destructures a non-existent `_user`, but the backend
  (`createUserWithTempPassword/entry.ts:13,22`) only reads
  `{email, full_name, role, care_scope, phone, credentials}` and sends a platform
  **invite link** (no password is ever set). It then emails the user a bogus
  password that won't log them in. → **Fix:** delete the orphan (the routed page
  uses the correct invite model), or rewrite to the invite model.

### Medium
- `gamification/GamificationDashboard.jsx` — **orphaned/dead.** Verified imported
  nowhere; maintains a parallel **device-local** localStorage points/streak/badge
  system (`gamification_<email>`) that never touches the server-backed
  `Leaderboard`/`UserBadge` entities used by the live `training/GamificationDashboard.jsx`.
  → **Fix:** delete to prevent divergence.
- **Offline sync is fragmented across two storage backends + three queues** with no
  shared id-map: `offline/OfflineSyncService.jsx` (LS `offline_sync_queue`),
  `mobile/OfflineStorage.jsx` (LS `penn_sync_offline_pending_visits`), and
  `offline/OfflineManager.jsx` (IndexedDB `sync_queue`). Only the first and third
  resolve `offline_`→real ids. A visit written through one queue is invisible to
  the others' conflict/id-resolution logic. → **Fix:** consolidate onto one queue +
  id-map, or document the boundaries and forbid cross-queue parent/child refs.

### Low
- `mobile/OfflineStorage.jsx:431` — on sync, `Visit.create(dataToSync)` discards the
  returned server id (no id-mapping); a later `saveUpdate('offline_…')` would 404.
  Latent today (the one caller passes a real id) but fragile.
- `offline/OfflineSyncService.jsx:330` — auto-sync `useEffect` deps list only
  `[isOnline]` (stale closure); won't re-trigger when items are queued while already
  online (a 5s poll partially covers it). [One of the 148 exhaustive-deps warnings.]
- `gamification_<email>` is not registered in `src/lib/offlineKeys.js`, so it would
  escape the logout purge if the orphan were revived (non-PHI; registry gap).
- `SystemJobMonitor.jsx:85` — `scheduledGuidelineSync` failure swallowed with
  `console.error` only (stripped in prod); add a toast.

**Clean:** all `@/functions/*` imports resolve; TimeOff submit/review/cancel +
self-approval guard + `timeOffUtils` correct; `gradeTrainingAttempt` ↔
`TrainingCoursePlayer` contract and Notification training enums line up; unrouted
admin/training pages are intentional `REDIRECTS`.

---

## Cross-cutting themes (ranked)

1. **Entity-contract drift is the #1 systemic risk.** Communications (SmsMessage/
   SmsConsent/ScheduledSms/CallLog missing; Notification & FaxLog enums), Signatures
   (`'signed'` vs `completed`, flat fields vs `signers[]`), Patient/Referral (merge
   markers, 5 Referral fields, `documentation_risk` alert), and Training
   (`due_date`, title-as-id) all share one root cause: **code writes shapes the
   schema doesn't define, and the platform silently drops them.** Build + tests stay
   green because tests don't hit the live entity layer. **Recommended:** a CI check
   that cross-validates every `entities.<E>.create/update(...)` payload and every
   `Notification`/status enum literal against the `.jsonc` schemas.

2. **Error-handling holes on async writes.** Approve/reject mutations and LLM calls
   across patient, care-plan, training, risk, and compliance domains lack `onError`/
   try-catch, producing silent failures and stuck spinners. **Recommended:** a
   shared `useEntityMutation` wrapper with mandatory error toast + loading reset.

3. **Security posture is partly theater.** Fake scans, hardcoded "compliant"
   indicators, a non-enforcing compliance "gate", a client-only "secure share", and
   AI-fabricated regulations. These actively mislead. **Recommended:** label
   unverifiable platform assertions honestly and remove/implement the fake checks.

4. **Lint debt:** 148 `react-hooks/exhaustive-deps` warnings — individually low, but
   collectively a source of stale-closure bugs (several spinner/refresh issues above
   are exhaustive-deps-adjacent). Worth burning down in the high-churn domains.

## Corrections / false positives dropped during verification

- **Routing orphans** — the 42 non-manifest pages are intentionally redirected
  (`REDIRECTS` in `routes.jsx`); links resolve. *Not a gap.*
- **"~18 missing backend functions"** (reported by over-reaching sweeps) — all
  verified to **exist** (`analyzeReferralPriority`, `getDashboardData`,
  `createUserWithTempPassword`, `sendSms`, etc.). *Not a gap.*
- **`PatientAlertsDashboard` "always shows zero"** — `res.data.alerts` is correct
  because invoke returns an Axios response. *Not a gap.*

## Suggested remediation order

1. **Comms entity schemas + Notification/FaxLog enums** (Domain 1) — unblocks SMS,
   consent, scheduled SMS, call logging, voicemail, and fax retry in one batch.
2. **DocumentSignature standardization** (Domain 2) — revives the entire signature/
   reminder/archive pipeline with one contract fix.
3. **Patient/Referral required-field + schema-field fixes** (Domain 3) — restores
   patient creation from triage/intake and the pending-update review diff.
4. **PDGM grouper wiring + group naming** (Domain 4) — revenue/compliance correctness.
5. **Training id/field fixes** (Domain 5), then the error-handling wrapper and the
   security-honesty cleanup as cross-cutting passes.
