# Base44 scheduler (Railway)

Calls the nine frequent PennSync Base44 scheduled functions on Railway's clock,
in place of the Base44 workflows that call them.

## Why

Each Base44 workflow run bills about 0.2 integration credits even when it finds
no work. On 2026-10-10 the production app ran about 1,450 such runs a day,
roughly 8,700 credits a month. Base44 bills a direct backend function call at
about 1 credit per 100, so the same calls at the same times should cost about
450. That 0.01 figure is Base44's published estimate. Compare the Credit Usage
page before and after rather than trusting it.

## What runs

| Function | Every |
| --- | --- |
| `dispatchScheduledSms` | 5 min |
| `copyInboundSmsMedia` | 5 min |
| `redriveFailedSms` | 10 min |
| `processScheduledFaxes` | 10 min |
| `processInboundFaxes` | 10 min |
| `pollFaxStatuses` | 15 min |
| `autoRetryFailedFaxes` | 15 min |
| `dispatchScheduledSignatureReminders` | 15 min |
| `checkPendingSignatureRequests` | 60 min |

The four daily workflows stay on Base44. `scheduler.mjs` is the source of
truth for this table.

## One scheduler only

`dispatchScheduledSms` claims a row by writing it and reading it back. Two
overlapping runs can both win the same row and text a patient twice. Treat all
nine the same way, so at any moment exactly one of these drives them:

- the Base44 workflows, with `SCHEDULER_ENABLED` anything but `true` here; or
- this service, with the nine workflows paused on Base44.

Never let both run.

## Where it runs

- Railway project "CareMetric Train", service `base44-scheduler`, a Railway
  Function with cron `*/5 * * * *` (UTC).
- Railway runs this file as `index.tsx` under Bun.
- Railway skips a run while the previous one is still going.
- Each call times out after four minutes, so a run ends before the next one is
  due.

Variables:

- `INTERNAL_FN_SECRET`: must equal the Base44 app secret of the same name as
  the PUBLISHED app sees it. Setting a Base44 secret reaches production only
  when the app is next published (the "Deploy production backend functions"
  workflow). Until then the live functions refuse the new value with 401.
- `SCHEDULER_ENABLED`: `true` to call anything. Any other value makes each run
  a no-op.

## Switching over

1. Publish the app, so production holds the secret this service has. Confirm
   with one call carrying the secret: anything but 401.
2. Pause the nine workflows on Base44 (toggle-status, or the dashboard). Check
   that all nine read `inactive`.
3. Set `SCHEDULER_ENABLED=true` on this service.
4. Read the next run's log: one `ok` line per due function.

After any later publish, confirm the nine workflows still read `inactive`.

To switch back, reverse the order: set `SCHEDULER_ENABLED=false` first, then
re-enable the workflows.

## Changing the code

Edit `scheduler.mjs` and run its test
(`node --test services/base44-scheduler/scheduler.test.mjs`, also in
`pnpm run test:utils`). Then paste the file into the Railway function.

A run exits non-zero when any call fails, so Railway marks it failed. A failed
run is the signal to look. The log has one line per call with the status and
the function's own generic error string, never a response body.
