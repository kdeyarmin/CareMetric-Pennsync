# Base44 backend sync — what must be built on the platform (2026-07-03)

> **RESOLVED (same day):** production is the **CareMetric AI** app
> (`694ec16e72e01b60d22f7cbf`, https://caremetricai.base44.app), which is
> GitHub-synced to this repo — NOT the older PENNSync app this doc originally
> diffed against. All 8 entities and 16 functions below were verified present
> on CareMetric AI, and the three §3 scheduled triggers were registered there
> via the Base44 builder. The old hardcoded `hub.base44.app/apps/68ee80d9…`
> (PENNSync) links in ten backend functions were repointed to
> `https://caremetricai.base44.app`, and `base44/.app.jsonc` now carries the
> CareMetric AI app id. The gap analysis below is kept for the record; §5's
> drift numbers apply to the retired PENNSync app, not production.

This repo is the source of truth for backend code, but the Deno functions and
entity schemas only *run* on the hosted Base44 platform. This doc lists exactly
what exists in the repo but **not** on the live PENNSync app, and provides a
paste-ready prompt for the Base44 AI builder.

**How the delta was computed:** the live app's sandbox (`PENNSync`, app id
`68ee80d98929370f9e8f2932`) was listed file-by-file via the Base44 connector and
diffed against this repo at `main` (commit `feb7d5c`). The gap below is the
net-new work; broader drift is called out at the end.

---

## 1. New entities to create first (8) — the functions depend on them

| Entity | Feature | Required fields | Write access |
|---|---|---|---|
| `ProviderFollowUpToken` | Referral follow-up portal | `referral_id`, `token`, `expires_at` | service-role only; reads admin-only |
| `FollowUpRuleConfig` | Follow-up review rules | — (single config row) | service-role only; reads open |
| `Timesheet` | Timesheets/payroll | `service_type`, `pay_period_start`, `pay_period_end`, `status` | admin only; reads: owner, `employee_email`, `manager_email`, admin |
| `EmployeePayrollProfile` | Timesheets/payroll | `employee_email` | admin only; reads: own row or admin |
| `VisitPointConfig` | Timesheets/payroll | — (single active config row) | admin only; reads open |
| `ScheduledSignatureReminder` | E-signature reminders | `document_id`, `send_at` | admin only; reads: creator, `requested_by`, admin |
| `PatientOutcomeMetric` | CMS outcome measures | `patient_id`, `episode_start` | default |
| `AgencyKPI` | CMS outcome measures | `metric_name`, `metric_category`, `period_start`, `period_end`, `metric_value` | default |

Full JSON schemas (fields, enums, defaults, RLS) live in this repo at
`base44/entities/<Name>.jsonc` — copy them verbatim.

## 2. New backend functions to create (16)

Exact reference implementations live at `base44/functions/<name>/entry.ts`.
Function names must match exactly — the deployed frontend already invokes them.

**Referral provider follow-up loop** (frontend: `ReferralFollowUp.jsx`, `ProviderFollowUpPortal.jsx`)
- `generateFollowUpPortalToken` — admin-gated; mints a single-use capability
  link for the public provider response portal (mirrors `generateSignerToken`).
- `validateFollowUpToken` — public, token-authenticated; returns only the open
  follow-up items + minimal patient identifiers (never insurance/revenue data);
  fails closed on expiry.
- `submitFollowUpResponse` — public, token-authenticated, single-use; merges
  provider answers into the matching follow-up items server-side and notifies
  the referral owner.
- `checkStaleFollowUpRequests` — **cron (daily)**; escalates requests `sent`
  with no answer for N days (default 4) via a high-priority Notification.
- `saveFollowUpRuleConfig` — admin-gated; only write path for
  `FollowUpRuleConfig` (mirrors `savePDGMRateConfig`).

**Timesheets / payroll** (frontend: `src/components/timesheet/*`)
- `submitTimesheet` — nurse submits own timesheet (bulk or daily entry);
  validates against `VisitPointConfig` points, approved `TimeOffRequest` PTO,
  and `EmployeePayrollProfile` reimbursements; notifies + emails the manager.
  No wage/pay-rate math anywhere — hours/points/reimbursements only.
- `reviewTimesheet` — approve/reject; only admins or the timesheet's
  `manager_email`; self-review is always rejected, even for admins.
- `savePayrollProfile` — admin upsert of one profile per employee (recurring
  phone reimbursement, `earns_points`, service type).
- `saveVisitPointConfig` — admin upsert of the single active per-visit-type
  point config (SOC/ROC/Recert/Routine/Discharge).

**Personnel credentials** (frontend: `src/components/personnel/*`; entities already on platform)
- `submitPersonnelCredential` — user submits/renews own credential →
  `pending_approval`; notifies admins.
- `reviewPersonnelCredential` — admin approve/reject; approval supersedes the
  old active row; sends a branded email to the employee.

**Learning center** (frontend: `TrainingCoursePlayer.jsx`, `CourseQuizBuilder.jsx`; entities already on platform)
- `getCoursePlayerQuestions` — authenticated; serves `TrainingQuestion` rows
  **without** `correct_answer_json`/`rationale`/`rubric` (answer-key leak fix —
  grading stays in `gradeTrainingAttempt`). For matching questions only the
  left prompts are returned.
- `generateCourseQuiz` — admin-gated; LLM-drafts quiz questions from course +
  module content in the exact persisted `TrainingQuestion` shape; unmatched
  correct answers return `null` so the authoring UI forces a manual pick.
  Returns drafts; does not persist.

**Clinical documentation**
- `appendPatientNoteHistory` — the ONE write path for a patient's
  `enhanced_notes_history` (+ `clinical_notes` mirror); replaces the browser
  read-modify-write that lost concurrent note saves. User-scoped (patient RLS
  applies), unique `entry_id`, verify-and-retry (up to 4 attempts); mode
  `update` targets its entry by `visit_id`.

**Quality / outcomes**
- `computeOutcomeMeasures` — **cron (nightly)**; pairs each Discharge OASIS
  with its SOC/ROC, computes CMS improvement measures (M1860/M1850/M1830/
  M1400/M2020), GG discharge function, readmission/ER proxies; writes one
  `PatientOutcomeMetric` per episode (idempotent upsert) and rolls up
  `AgencyKPI` rows per measure. Cron path unauthenticated-allowed,
  authenticated non-admin rejected.

**E-signature reminders**
- `dispatchScheduledSignatureReminders` — **cron (every 15 min)**; delivers due
  `ScheduledSignatureReminder` rows queued by `scheduleSignatureReminders`:
  claims with a per-run token (re-read to confirm ownership), re-derives
  recipients from the document's *current* pending signers, cancels when fully
  signed.

## 3. Scheduled triggers to register on the Base44 dashboard (3 new)

| Function | Cadence |
|---|---|
| `dispatchScheduledSignatureReminders` | every 15 min |
| `checkStaleFollowUpRequests` | daily |
| `computeOutcomeMeasures` | nightly |

(Existing cron roster: `docs/SECRETS-WEBHOOKS-LAUNCH-RUNBOOK.md` §5 — the
one-fax-processor-only and single-`dispatchScheduledSms` rules still apply.)

No new secrets are needed: the four-secret list in the runbook
(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `HEYGEN_API_KEY`,
`SIGNATURE_HMAC_SECRET`) is unchanged.

## 4. Do NOT touch (platform-only work)

The live app has four functions and three entities that were built directly on
Base44 and never mirrored into this repo — leave them as they are:
`generateCarePlanFromReferral`, `generateCarePlanSuggestions`,
`generateCarePlansFromReferral`, `monitorClinicalDataForCarePlanUpdates`;
entities `CarePlan`, `CarePlanProposal`, `AutomaticCarePlanTrigger`.
(Follow-up: mirror them back into this repo so the drift stops growing.)

## 5. Known broader drift (separate task — not in the prompt below)

Beyond the net-new items, **144 existing functions**, **56 existing entity
schemas**, and `_shared/backendHelpers.mjs` differ between the repo and the
platform (drift in *both* directions — the platform also has its own edits,
e.g. `DocumentSignature`). Recent hardening PRs (#46, #50) are part of that
gap. Reconciling it is a bigger, file-by-file job and should be done as a
dedicated sync pass, ideally by copying repo file contents verbatim rather
than re-prompting behavior.

---

## 6. Paste-ready prompt for the Base44 AI builder

> Copy everything inside the block below into the PENNSync app's Base44 chat.
> If the builder times out or truncates, paste it one numbered section at a
> time (entities first). Where a spec here is ambiguous, the exact reference
> code is in GitHub `kdeyarmin/CareMetric-Pennsync` under
> `base44/functions/<name>/entry.ts` and `base44/entities/<Name>.jsonc` —
> replicate those files verbatim when possible.

```text
Add the following backend to this app. Create the entities in section 1 first,
then the backend functions in section 2, then register the scheduled triggers
in section 3. Do NOT modify or delete any existing entity or function —
especially generateCarePlanFromReferral, generateCarePlanSuggestions,
generateCarePlansFromReferral, monitorClinicalDataForCarePlanUpdates and the
CarePlan/CarePlanProposal/AutomaticCarePlanTrigger entities. Function names
must match EXACTLY (camelCase, no renames): the deployed frontend already
calls them by these names.

SECTION 1 — NEW ENTITIES (8)

1. ProviderFollowUpToken — capability token for the public provider follow-up
   portal. Fields: referral_id (string, required), token (string, required),
   provider_name (string), expires_at (ISO string, required), is_active
   (boolean, default true), access_count (number, default 0),
   last_accessed_at (string), submitted_at (string).
   RLS: read admin-only; write service-role only (tokens are bearer secrets).

2. FollowUpRuleConfig — single agency-wide config row for follow-up review
   rules. Fields: disabled_rules (array of strings), severity_overrides
   (object mapping rule key -> critical|high|medium), custom_items (array of
   {title, question}), updated_by_email (string).
   RLS: read open to authenticated users; write service-role only.

3. Timesheet — pay-period timesheet. NO pay rates or wages anywhere — only
   hours, visit points, and reimbursements. Fields: employee_email,
   employee_name, service_type (home_health|hospice, default home_health,
   required), pay_period_start (required), pay_period_end (required),
   regular_points (number, default 0), visit_counts (object),
   emergency_visit_points, regular_hours, overtime_hours, vacation_hours,
   holiday_hours, on_call_hours, on_call_visits, miles, reimbursement,
   auto_pto_hours, phone_reimbursement (all numbers, default 0), notes,
   entry_mode (bulk|daily, default bulk), daily_entries (array of objects),
   manager_email, manager_name, status (draft|submitted|approved|rejected,
   default draft, required), submitted_at, reviewed_by, reviewer_name,
   reviewed_at, review_notes.
   RLS: read allowed for creator, employee_email match, manager_email match,
   or admin; direct write admin-only (all writes go through the functions).

4. EmployeePayrollProfile — one standing profile per employee. Fields:
   employee_email (required), employee_name, service_type
   (home_health|hospice, default home_health), earns_points (boolean, default
   false), phone_reimbursement (number, default 0), active (boolean, default
   true), notes. RLS: read own row or admin; write admin-only.

5. VisitPointConfig — single active row of per-visit-type point values.
   Fields: soc_points, roc_points, recert_points, routine_points,
   discharge_points (numbers, default 0), active (boolean, default true),
   notes. RLS: read open; write admin-only.

6. ScheduledSignatureReminder — queued signature reminder deliveries. Fields:
   document_id (required), document_name, deadline_date, send_at (ISO string,
   required), requested_by, status (pending|sending|sent|failed|canceled,
   default pending), attempts (number, default 0), claimed_by, claimed_at,
   sent_at, reminder_count (number), failure_reason, canceled_by, canceled_at.
   RLS: read for creator, requested_by, or admin; write admin-only.

7. PatientOutcomeMetric — one row per completed episode with CMS outcome
   results. Fields: patient_id (required), episode_start (required),
   episode_end, admission_source (hospital|community|snf|other),
   discharge_disposition (remained_home|hospital|snf|deceased|other),
   length_of_service (number), total_visits_provided (number),
   readmission_30_day, readmission_60_day, er_visit_30_day (booleans),
   functional_improvement (object), gg_discharge_function_score (number),
   measure_results (array of objects), outcome_measure_source (string),
   pph_prevention (object), care_plan_goals_achieved,
   care_plan_goals_total, goal_achievement_rate (numbers),
   wound_healing_outcome (healed|improved|stable|deteriorated|n/a),
   pain_improvement, patient_satisfaction_score (numbers), complications
   (array of objects), adverse_events (array of strings),
   outcome_quality_score (number), primary_diagnosis (string),
   comorbidities_count (number).

8. AgencyKPI — agency-level KPI rollups. Fields: agency_id, metric_name
   (required), metric_category
   (financial|clinical|operational|compliance|quality, required), period_type
   (daily|weekly|monthly|quarterly|yearly), period_start (required),
   period_end (required), metric_value (number, required), target_value,
   benchmark_value (numbers), unit (string), trend (up|down|stable),
   variance_percentage (number), status (on_target|warning|critical),
   contributing_factors, improvement_actions (arrays of strings).

SECTION 2 — NEW BACKEND FUNCTIONS (16)

All are Deno functions using createClientFromRequest from
npm:@base44/sdk@0.8.31, returning Response.json. "Admin" everywhere means
user.role === 'admin' OR user.account_type === 'agency_admin' OR
user.account_type === 'super_admin'. "Cron auth convention" means: an
unauthenticated request (the platform scheduler) is allowed, but an
authenticated NON-admin gets 403.

Referral provider follow-up loop:

1. generateFollowUpPortalToken — admin-only. Input {referral_id (required),
   provider_name, expires_in_days=30}. Verifies the referral exists,
   generates a 32-char cryptographically random URL-safe token, creates a
   ProviderFollowUpToken row via service role, and returns {success, token,
   portalLink} where portalLink points at the app's public
   ProviderFollowUpPortal page with ?token=. Mirrors generateSignerToken.

2. validateFollowUpToken — PUBLIC (no login; the token IS the authorization).
   Input {token}. Looks up ProviderFollowUpToken via service role; rejects
   missing/inactive tokens (401), treats unparseable expires_at as expired
   (fail closed, deactivates row), rejects already-submitted tokens.
   Increments access_count and stamps last_accessed_at. Returns {valid:true}
   plus ONLY: the referral's OPEN follow-up items and minimal patient
   identifiers (name, DOB). Never return insurance identifiers, full
   extracted_data, analysis results, or any revenue/coding data.

3. submitFollowUpResponse — PUBLIC, token-authenticated, single-use. Input
   {token, responses (non-empty array of {item_id, answer}), completed_by,
   credential}. Validates the token exactly like validateFollowUpToken, then
   server-side merges each response into the MATCHING follow_up_requests
   items of the token's own referral only, stamps submitted_at, deactivates
   the token (no replay), and creates a Notification for the referral's
   created_by. Returns {success, answered}.

4. checkStaleFollowUpRequests — scheduled job (cron auth convention). Input
   {stale_days} optional, default 4, clamped 1-30. Scans the 300 most recent
   Referrals via service role; for each with follow_up_requests.status ===
   'sent' whose generated_at is older than the cutoff and not already
   escalated for this send (stale_notified_at >= generated_at guard), creates
   a high-priority Notification to the referral's created_by and stamps
   follow_up_requests.stale_notified_at. Returns {success, escalated,
   stale_days}.

5. saveFollowUpRuleConfig — admin-only; the ONLY write path for
   FollowUpRuleConfig (the entity is service-role-write). Sanitizes:
   disabled_rules to max 100 strings; severity_overrides values must be
   critical|high|medium; custom_items max 50, each requiring non-empty title
   (max 200 chars) and question (max 1000 chars). Upserts the single config
   row, stamps updated_by_email, returns {success, id}.

Timesheets / payroll (NO wage or pay-rate math anywhere in these):

6. submitTimesheet — authenticated user submits their OWN timesheet for a pay
   period. Validates service_type and period dates; supports entry_mode
   'bulk' (totals) or 'daily' (daily_entries array, totals derived
   server-side). Computes visit points by multiplying the nurse's visit
   counts by the active VisitPointConfig values (only when the employee's
   EmployeePayrollProfile has earns_points); pulls auto_pto_hours from
   approved TimeOffRequest rows overlapping the period; applies
   phone_reimbursement from the profile. Rejects overlapping duplicate
   submissions for the same period. Saves the Timesheet (status 'submitted',
   submitted_at now) via service role, notifies the manager in-app and with a
   branded HTML email (same brand kit as the existing emails: navy #213a76,
   gold #c7901f, PennSync logo). Returns {success, timesheet}.

7. reviewTimesheet — input {timesheet_id, decision ('approved'|'rejected'),
   note}. Only an admin or the timesheet's manager_email may review; a
   reviewer may NEVER act on their own timesheet (even an admin). Sets
   status, reviewed_by, reviewer_name, reviewed_at, review_notes via service
   role; notifies the employee in-app + branded email. Returns {success,
   timesheet}.

8. savePayrollProfile — admin-only upsert keyed by employee_email (find
   existing row by email, update it, else create). Input {employee_email
   (required), phone_reimbursement>=0, earns_points, service_type, active,
   notes}. Numbers clamped non-negative, rounded to cents. Returns {success,
   profile}.

9. saveVisitPointConfig — admin-only upsert of the single active config row.
   Input {soc_points, roc_points, recert_points, routine_points,
   discharge_points, notes}; numbers clamped non-negative. Returns {success,
   config}.

Personnel credentials (PersonnelCredential entity already exists):

10. submitPersonnelCredential — authenticated user submits or renews their
    OWN credential (license/certification) with file upload reference; the
    new row gets status 'pending_approval' via service role; all admins get
    an in-app Notification. Returns {success, credential_id,
    status:'pending_approval'}.

11. reviewPersonnelCredential — admin-only. Input {credential_id, action
    ('approve'|'reject'), note}. Approval activates the credential and
    supersedes any previous active row for the same user+credential type;
    rejection records the reason. Logs to UserActivity and sends the employee
    a branded HTML email. Returns {success, action, credential_id,
    superseded, emailed}.

Learning center (TrainingCourse/TrainingModule/TrainingQuestion already exist):

12. getCoursePlayerQuestions — authenticated. Input {course_id (required)}.
    Fetches active TrainingQuestion rows for the course via service role
    ordered by order_index, and returns them WITH THE ANSWER KEY STRIPPED:
    only id, course_id, type, prompt, options_json, difficulty, points,
    order_index, active. NEVER include correct_answer_json, rationale, or
    rubric (grading happens server-side in gradeTrainingAttempt). For
    matching questions keep only the left-side prompts. Returns {success,
    questions}.

13. generateCourseQuiz — admin-only. Input {course_id, count, types,
    difficulty}. Loads the TrainingCourse and its TrainingModules, prompts
    the platform LLM to draft quiz questions strictly as JSON (tolerant
    parser for fenced/prose-wrapped output), allowed types: mcq, true_false,
    multi_select, short_answer, scenario_based. Normalizes each draft into
    the exact persisted TrainingQuestion shape; when the AI's correct answer
    can't be matched to an option value/label, set it to null so the
    authoring UI forces the admin to pick one. Returns {success, questions}
    (drafts only — does NOT persist).

Clinical documentation:

14. appendPatientNoteHistory — authenticated, USER-scoped (use the caller's
    client, not service role, so patient RLS applies). The single write path
    for a patient's enhanced_notes_history array plus the clinical_notes
    mirror field. Input {patient_id, mode ('append'|'update'),
    clinical_notes?, entry:{entry_id?, visit_id?, date?, visit_type?, note
    (required), compliance_score?}}; mode 'update' also requires visit_id and
    targets the matching history entry (never blindly the last element).
    Concurrency: give each append a unique entry_id, re-read after write to
    verify the entry survived, retry up to 4 times with a small randomized
    settle delay (convergence-by-verification; Base44 has no
    compare-and-swap). Returns {success, entry_id, attempts}.

Quality / outcomes:

15. computeOutcomeMeasures — scheduled job (cron auth convention; admins may
    also invoke manually with optional {period_start, period_end,
    benchmark}). Pairs every Discharge OASIS assessment with its matching
    SOC/ROC for the same patient episode and computes the CMS home-health
    outcome measures: improvement in Ambulation (M1860, 0-6 scale),
    Bed Transferring (M1850), Bathing (M1830, exclude start-or-end 6),
    Dyspnea (M1400), Oral Medication Management (M2020) — each excluding
    start value 0; plus GG self-care/mobility discharge function score
    (GG0130 a,b,c,e,f,g,h + GG0170 a-f,i-m; codes 7/9/10/88 = not attempted),
    deceased dispositions excluded. Writes one PatientOutcomeMetric per
    discharged episode (idempotent upsert on patient+episode so reruns don't
    duplicate) and rolls up AgencyKPI rows per measure (star eligibility:
    >=20 episodes and >=5 reportable measures). Returns {success,
    discharges_evaluated, patient_outcome_metrics_written,
    skipped_missing_episode_date, agency_kpis_written,
    star_eligible_measure_count, star_eligible, measures}.
    IMPORTANT: this scoring must mirror the unit-tested engine in the repo at
    src/components/oasis/outcomeMeasureEngine.js — copy the repo's
    base44/functions/computeOutcomeMeasures/entry.ts verbatim if possible.

E-signature reminders:

16. dispatchScheduledSignatureReminders — scheduled job (cron auth
    convention; strict admin for authenticated callers). Processes up to 100
    pending ScheduledSignatureReminder rows whose send_at has passed: claims
    each row pending->sending with a per-run random token and RE-READS to
    confirm ownership (overlapping runs must not double-notify), re-loads the
    DocumentSignature and re-derives recipients from the document's CURRENT
    pending signers (completed signers are not reminded; a fully-signed
    document cancels the reminder), creates in-app Notification rows, stamps
    reminder bookkeeping on the document, marks the row sent/failed/canceled.
    Message wording adapts to overdue deadlines. Returns {success, processed,
    sent, failed, canceled, skipped, checked_at}.

SECTION 3 — SCHEDULED TRIGGERS

Register these scheduled triggers (POST with empty body):
- dispatchScheduledSignatureReminders: every 15 minutes
- checkStaleFollowUpRequests: daily
- computeOutcomeMeasures: nightly (daily)

Do not add a second schedule for any existing cron, and keep the existing
rules: only ONE of processScheduledFaxes / processScheduledFaxesByPriority
enabled, and only one dispatchScheduledSms schedule.
```
