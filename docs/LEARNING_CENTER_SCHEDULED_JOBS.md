# Learning Center — Scheduled Jobs

These Deno functions are plain HTTP endpoints (`Deno.serve`). They have no
in-repo cron schedule — **registration happens on the Base44 platform
dashboard (Functions → schedule/trigger), not in this repo**. Because Base44
does not automatically block unauthenticated HTTP callers for sensitive
functions, each privileged scheduled job must require the shared scheduler
secret: the scheduler sends `x-internal-secret: <INTERNAL_FN_SECRET>`, and an
admin session also passes.

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
| `computeOutcomeMeasures` | Pair every Discharge OASIS with its SOC/ROC, write a `PatientOutcomeMetric` per episode, and roll the CMS outcome measures up into `AgencyKPI` rows — the data behind the OASIS Center Quality tab "Outcome Measures" section and the Reports KPI summary card. Read/compute only, idempotent upserts: it alerts no one, so partial EMR coverage can't create false alarms. Admins can also run it on demand via the dashboard's "Recompute now" button. | Nightly |
| `monitorComplianceRisks` | Patient compliance-risk sweep writing `PatientAlert`s. **Companion-mode gated:** the absence-based rules (high-risk dx not seen in 7 days, missing vitals, missing Discharge OASIS) only fire when `AgencySettings.pennsync_is_system_of_record` is true (default **off**) — in a companion-EMR deployment those data live in the EMR and alerting on their absence here would be false alarms. Rules keyed to in-app artifacts (e.g. homebound wording missing from a note that exists in PennSync) always run. The pre-PDGM LUPA alert was removed. | Daily |

## Registration steps (Base44 dashboard)
1. Set `INTERNAL_FN_SECRET` in the app's function environment.
2. For each function above, add a scheduled trigger (daily) that POSTs the
   endpoint with header `x-internal-secret: <INTERNAL_FN_SECRET>` and an empty
   JSON body `{}`.
3. `autoEnrollAnnualPlans` defaults to `scope: "auto"`. To opt a plan into the
   daily auto-enroll, set its `LearningPlan.auto_enroll = true` (the seeded
   plans ship with it `false`). The admin **"Enroll All Staff"** button in
   *Admin Training → Annual → Annual Learning Plans* runs `scope: "all"`
   on demand regardless of the flag.

## Manual invocation
- **Seed the curriculum:** *Admin Training → Annual* → **Create Required
  In-Services** (`seedYearlyRequiredInServices`).
- **Enroll everyone now:** *Annual Learning Plans* tab → **Enroll All Staff**
  (`autoEnrollAnnualPlans` with `scope: "all"`).
