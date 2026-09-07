# Learning Center — Scheduled Jobs

These Deno functions are plain HTTP endpoints (`Deno.serve`). Approved native
Base44 schedules belong in the target function's `function.jsonc` `automations`
array and deploy with that function; a dashboard-created automation has the
same identity model. Base44 runs an automation as **the user who created the
automation**, so `base44.auth.me()` returns that creator — not a scheduler
service account or the user whose entity change triggered a hook. Create/deploy
privileged schedules only as the intended protected platform admin and verify
that creator identity in staging before activation.

The shared scheduler gate admits that protected built-in admin identity. It
also admits an external/no-session scheduler that sends
`x-internal-secret: <INTERNAL_FN_SECRET>`; the secret is required for that
external path, not for a native automation owned by an active protected admin.
`computeOutcomeMeasures` remains stricter and accepts only the dedicated
internal-secret or signed-dispatcher authority described below.

The table also carries the two clinical-quality jobs (`computeOutcomeMeasures`,
`monitorComplianceRisks`) — they are not Learning Center functions, but any
eventual automation uses the same deployment and creator-identity model.

| Function | Purpose | Suggested cadence |
|---|---|---|
| `autoEnrollAnnualPlans` | Enroll active staff into the current-year required in-service plan matching their line + role tier. Scheduled runs use `scope: "auto"` (only plans with `auto_enroll: true`). | Daily |
| `sendRenewalReminders` | Tiered learner + manager nudges (60/30/14/7/1 days, then overdue) for required training. Idempotent via `TrainingAssignment.reminder_offsets_sent`. | Daily |
| `processTrainingRenewals` | Create renewal assignment + notification 30 days before a certificate expires (non-annual). | Daily (existing) |
| `processAnnualEducationRenewals` | Same, for annual-cycle certificates (rolls to next `annual_cycle_year`). | Daily (existing) |
| `syncTrainingVideoStatuses` | Finalize in-flight HeyGen presenter videos (modules stuck `video_status: 'processing'`) so they complete even when no admin has Video Studio open. No-op unless `HEYGEN_API_KEY` is set. | Every 10–15 min |
| `computeOutcomeMeasures` | **PAUSED — do not register a global schedule.** The candidate is internal-secret-only and requires one explicit `agency_id`, stable `period_start`/`period_end` ISO dates, and an explicit `period_type` (`daily`, `weekly`, `monthly`, `quarterly`, `yearly`, or `custom`) on every invocation. Use `custom` whenever the dates do not match the named calendar period. Browser reads and recomputation are disabled pending hosted tenant-bound read RLS/server-broker proof. Legacy unscoped rows remain excluded. Complete every blocker in `REPOSITORY_CONSOLIDATION_2026-09-02.md` before any nonproduction schedule is registered. | Per-agency, per-stable-period only after release gates pass |
| `monitorComplianceRisks` | **PAUSED — do not register or invoke.** The current implementation performs platform-wide service-role Patient/OASIS reads and can write critical alerts from unverified keyword heuristics. Keep it disabled until a server-owned tenant broker, per-agency scope, and clinically validated rules exist. | Only after release gates pass |

## Registration and creator-identity validation
1. Create/deploy each approved native automation from the intended protected
   platform-admin account, preferably from a reviewed `function.jsonc`. If an
   external scheduler will call the HTTP endpoint without a user session, also
   set `INTERNAL_FN_SECRET` and send it as `x-internal-secret`.
2. In isolated staging, list the deployed workflow, run one canary, and inspect
   the function response/logs. Confirm that the native run resolves
   `auth.me()` to the expected active protected admin and returns the expected
   success payload. A schedule created by a non-admin will be rejected; a
   schedule whose creator is later deactivated or demoted can stop running and
   must be recreated under the approved owner.
3. Negative-test the public endpoint without an admin session or scheduler
   header (`401`, or `500` when the external-scheduler secret is intentionally
   unset), and with an authenticated non-admin (`403`). Never put
   `INTERNAL_FN_SECRET` in browser code or `function_args`.
4. Do **not** register `computeOutcomeMeasures` or `monitorComplianceRisks` yet.
   After the outcome job's release gates pass,
   orchestrate separate one-agency, stable-period requests such as
   `{ "agency_id": "...", "period_start": "YYYY-MM-DD", "period_end": "YYYY-MM-DD", "period_type": "daily|weekly|monthly|quarterly|yearly|custom" }`.
   Never send `{}` and never expose the internal secret to a browser.
5. `autoEnrollAnnualPlans` defaults to `scope: "auto"`. To opt a plan into the
   daily auto-enroll, set its `LearningPlan.auto_enroll = true` (the seeded
   plans ship with it `false`). The admin **"Enroll All Staff"** button in
   *Admin Training → Annual → Annual Learning Plans* runs `scope: "all"`
   on demand regardless of the flag.

## Manual invocation
- **Seed the curriculum:** *Admin Training → Annual* → **Create Required
  In-Services** (`seedYearlyRequiredInServices`).
- **Enroll everyone now:** *Annual Learning Plans* tab → **Enroll All Staff**
  (`autoEnrollAnnualPlans` with `scope: "all"`).
