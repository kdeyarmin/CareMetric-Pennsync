# Code Review 2026-06-28 — Deferred Items (RESOLVED)

This document originally tracked issues from the comprehensive review on branch
`claude/code-review-fixes-8dqc0v` (PR #109) that were deferred because they
needed a **schema change**, a **product/wiring decision**, or a **larger
refactor**. They have since been **addressed** — this file now records what was
decided and done for each.

Baseline after the fixes: `npm run lint` (0 errors), `npm run typecheck`,
`npm test` (612 util + 7 contract + 241 component), `npm run build`,
`npm run check:backend-transpile` (204 functions), `npm run check:shared-helpers`
— all green.

---

## A. Schema-change items — DONE

### A1. `onDocumentSigned` — duplicate "Document Signed" admin emails ✅
Added `admin_notified: boolean` to `base44/entities/DocumentSignature.jsonc`.
`onDocumentSigned` now claims the flag before sending and skips if already set,
so trigger re-fires no longer re-email admins.

### A2. `sendTrainingNotifications` — certificate-renewal block had no dedup ✅
Added `last_renewal_reminder_date` to `base44/entities/TrainingCertificate.jsonc`.
The certificate block now guards on it (same-day cron re-runs no longer re-notify)
and writes it on send.

### A3. `sendTrainingNotifications` — exact-day assignment tiers ✅
No schema change needed — `TrainingAssignment` already has
`reminder_offsets_sent`. The assignment block now fires **at or below** an unsent
tier (`[14,7,3,1]`) and records crossed tiers, so a missed cron run no longer
skips a tier permanently. (`sendPersonnelExpirationNotifications` was fixed
earlier in the PR.)

## B. Product / wiring decisions — DONE

### B1. `onDocumentSigned` vs `notifyAdminOfSignedDocument` — double admin email ✅
Both now share the `admin_notified` flag: whichever trigger fires first claims it
and sends; the other skips. This is robust to either wiring (one or both
registered) without needing to inspect the platform trigger config.

### B2. `embedSignatureToPDF` — broken caller contract (dead code) ✅
**Decision: deleted.** Verified the whole chain was orphaned — `embedSignatureToPDF`
← only `PDFSignatureCapture` ← only `PatientInfoSignatureFlow` ← **nothing**
(no route/page references it). Removed all three files
(`base44/functions/embedSignatureToPDF/`,
`src/components/documents/PDFSignatureCapture.jsx`,
`src/components/documents/PatientInfoSignatureFlow.jsx`). The live signing flow
uses `stampSignatureOnPDF` and is unaffected.

### B3. `awardBadgeOnCompletion` — streak/courses bumped on failed attempts ✅
Gated `current_streak` and `courses_completed` increments (and the streak-badge
check) on a passing result: `attemptData.pass_fail_result === 'passed'`, falling
back to `score >= (assignment.passing_score_required ?? 80)`. A failed attempt no
longer inflates the streak or trips a streak badge.

## C. Larger refactors — DONE

### C1. `assignInService` — dedup capped at newest 1000 assignments ✅
The "already assigned" set is now built from a query scoped to the candidate
emails (`assigned_to_user_id: { $in: candidateEmails }`), removing the 1000-row
cap so a course with >1000 prior assignees can't re-assign older ones.

### C2. `processTrainingRenewals` — existing-renewal guard scanned newest 5000 globally ✅
Replaced the global prefetch with a per-certificate
`filter({ course_id, assigned_to_user_id })`, so a user's existing renewal is
always found (no duplicate renewals in tenants with >5000 assignments) — matching
the clean sibling `processAnnualEducationRenewals`.

## D. Lower severity — DONE (one item intentionally left)

### D1. Fax retry/notification internals ✅ (safe parts)
- `pollFaxStatuses` now sets/honors the webhook's `delivery_confirmation_sent` /
  `final_failure_notified` flags, so the poller and webhook can't both notify the
  sender for the same terminal transition.
- `syncFaxStatuses` now sends a (deduped) failure notification when it reconciles
  a fax to `failed` — previously silent.
- The retry-count / backoff behavior in `autoRetryFailedFaxes` was left as-is by
  design: freezing the count during a Telnyx outage correctly keeps retrying
  until service returns (incrementing would make every fax give up during an
  outage). Documented rather than changed.

### D2. `checkExpiredInvitations` — missing/invalid `expires_at` ✅
**Decision: fail closed.** A pending invitation with an unparseable/missing
expiry is now treated as expired (with a warning log) instead of lingering
forever.

### D3. Caller auth gate inconsistency ✅
Added the opt-in `INTERNAL_FN_SECRET`/admin gate (mirroring `processTrainingRenewals`
/ `syncFaxStatuses`) to `processScheduledFaxes`, `processScheduledFaxesByPriority`,
`sendExpirationNotifications`, and `sendPersonnelExpirationNotifications`. The
no-identity cron path still works while no secret is configured.

### D4. Lower-severity PDF layout/robustness ✅ (mostly)
- `generateCertificatePacketPDF`: added the cover-page list page-break guard its
  sibling already had.
- `generatePatientHandout`: returns 400 when `action === 'email'` but no
  `patientEmail` (was reporting success with no email sent).
- `generateLearningTranscriptPDF`: footer now stamps real page numbers on every
  page (was a hardcoded "Page 1 of 1").
- `enforceDataCompleteness`: returns 404 on a not-found `entity_id` (was a
  confusing caught 500); the unrecognized-`entity_type` 400 was added earlier.
- **Left as-is:** `generatePDGMComparisonPDF` / `generatePDGMNavigatorPDF` have a
  few static section headers/tables drawn without a page-break guard. These only
  clip on unusually long payloads and the fix requires layout changes that can't
  be visually verified in this environment, so they were intentionally not
  touched. Low priority.

---

_All items above except the final D4 note are resolved in the PR's commits. This
file is the record of what was decided._
