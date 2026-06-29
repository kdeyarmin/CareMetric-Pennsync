# Learning Center — Scheduled Jobs

These Deno functions are plain HTTP endpoints (`Deno.serve`). They have no
in-repo cron schedule — scheduling is registered on the **Base44 platform**
(dashboard → Functions → schedule/trigger). Each privileged job authorizes with
the same opt-in lockdown: when `INTERNAL_FN_SECRET` is set, the scheduler must
send it as the `x-internal-secret` header; an admin session also passes.

| Function | Purpose | Suggested cadence |
|---|---|---|
| `autoEnrollAnnualPlans` | Enroll active staff into the current-year required in-service plan matching their line + role tier. Scheduled runs use `scope: "auto"` (only plans with `auto_enroll: true`). | Daily |
| `sendRenewalReminders` | Tiered learner + manager nudges (60/30/14/7/1 days, then overdue) for required training. Idempotent via `TrainingAssignment.reminder_offsets_sent`. | Daily |
| `processTrainingRenewals` | Create renewal assignment + notification 30 days before a certificate expires (non-annual). | Daily (existing) |
| `processAnnualEducationRenewals` | Same, for annual-cycle certificates (rolls to next `annual_cycle_year`). | Daily (existing) |
| `syncTrainingVideoStatuses` | Finalize in-flight HeyGen presenter videos (modules stuck `video_status: 'processing'`) so they complete even when no admin has Video Studio open. No-op unless `HEYGEN_API_KEY` is set. | Every 10–15 min |

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
