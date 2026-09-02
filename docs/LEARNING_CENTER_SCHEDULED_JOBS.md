# Learning Center — Scheduled Jobs

These Deno functions are plain HTTP endpoints (`Deno.serve`). They have no
in-repo cron schedule — **registration happens on the Base44 platform
dashboard (Functions → schedule/trigger), not in this repo**. Because Base44
does not automatically block unauthenticated HTTP callers for sensitive
functions, each privileged scheduled job must require the shared scheduler
secret: the scheduler sends `x-internal-secret: <INTERNAL_FN_SECRET>`. Most
shared-scheduler jobs also admit the protected built-in admin role;
`computeOutcomeMeasures` is stricter and is internal-secret-only.

The table also carries the two clinical-quality jobs (`computeOutcomeMeasures`,
`monitorComplianceRisks`) — they are not Learning Center functions, but they are
registered the same way, on the platform dashboard.

| Function | Purpose | Suggested cadence |
|---|---|---|
| `autoEnrollAnnualPlans` | Enroll active staff into the current-year required in-service plan matching their line + role tier. Scheduled runs use `scope: "auto"` (only plans with `auto_enroll: true`). | Daily |
| `sendRenewalReminders` | Tiered learner + manager nudges (60/30/14/7/1 days, then overdue) for required training. Idempotent via `TrainingAssignment.reminder_offsets_sent`. | Daily |
| `processTrainingRenewals` | Create renewal assignment + notification 30 days before a certificate expires (non-annual). | Daily (existing) |
| `processAnnualEducationRenewals` | Same, for annual-cycle certificates (rolls to next `annual_cycle_year`). | Daily (existing) |
| `syncTrainingVideoStatuses` | Finalize in-flight HeyGen presenter videos (modules stuck `video_status: 'processing'`) so they complete even when no admin has Video Studio open. No-op unless `HEYGEN_API_KEY` is set. | Every 10–15 min |
| `computeOutcomeMeasures` | **PAUSED — do not register a global schedule.** The candidate is internal-secret-only and requires one explicit `agency_id`, stable `period_start`/`period_end` ISO dates, and an explicit `period_type` (`daily`, `weekly`, `monthly`, `quarterly`, `yearly`, or `custom`) on every invocation. Use `custom` whenever the dates do not match the named calendar period. Browser reads and recomputation are disabled pending hosted tenant-bound read RLS/server-broker proof. Legacy unscoped rows remain excluded. Complete every blocker in `REPOSITORY_CONSOLIDATION_2026-09-02.md` before any nonproduction schedule is registered. | Per-agency, per-stable-period only after release gates pass |
| `monitorComplianceRisks` | **PAUSED — do not register or invoke.** The current implementation performs platform-wide service-role Patient/OASIS reads and can write critical alerts from unverified keyword heuristics. Keep it disabled until a server-owned tenant broker, per-agency scope, and clinically validated rules exist. | Only after release gates pass |

## Registration steps (Base44 dashboard)
1. Set `INTERNAL_FN_SECRET` in the app's function environment.
2. For each approved function other than `computeOutcomeMeasures` and
   `monitorComplianceRisks`, add its
   scheduled trigger with header
   `x-internal-secret: <INTERNAL_FN_SECRET>` and the function's documented body
   (the existing jobs default to `{}`).
3. Do **not** register `computeOutcomeMeasures` or `monitorComplianceRisks` yet.
   After the outcome job's release gates pass,
   orchestrate separate one-agency, stable-period requests such as
   `{ "agency_id": "...", "period_start": "YYYY-MM-DD", "period_end": "YYYY-MM-DD", "period_type": "daily|weekly|monthly|quarterly|yearly|custom" }`.
   Never send `{}` and never expose the internal secret to a browser.
4. `autoEnrollAnnualPlans` defaults to `scope: "auto"`. To opt a plan into the
   daily auto-enroll, set its `LearningPlan.auto_enroll = true` (the seeded
   plans ship with it `false`). The admin **"Enroll All Staff"** button in
   *Admin Training → Annual → Annual Learning Plans* runs `scope: "all"`
   on demand regardless of the flag.

## Manual invocation
- **Seed the curriculum:** *Admin Training → Annual* → **Create Required
  In-Services** (`seedYearlyRequiredInServices`).
- **Enroll everyone now:** *Annual Learning Plans* tab → **Enroll All Staff**
  (`autoEnrollAnnualPlans` with `scope: "all"`).
