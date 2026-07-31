# P1 Pure-Helper UI Wire — 2026-07-30

Closes the remaining UI gaps for P1-02 / P1-06 / P1-07 that were previously pure-helper-only.

| ID | Status | What landed | PR |
|---|---|---|---|
| **P1-02** Work queues | Implemented repo-side | `CoreWorkQueuesStrip` on Dashboard consuming `buildCoreWorkQueues` (incidents + notes) | #107 |
| **P1-06** Incident lifecycle | Implemented repo-side | `IncidentReviewQueue` transition guards, reviewer/closure stamps, CAP path | #107 |
| **P1-07** Offboarding | Implemented repo-side | `offboardUser` service-role function + `UserManagement` invoke wire (patient unassign, phone release, on-call clear) | #107 |

## Still hosted-blocked (not repo-fixable)

- **LR-01** RLS tenant evidence (V1–V6)
- **LR-02** seeded staging E2E (S1–S9)
- Platform rejection of `is_active:false` sessions at entity API

## Evidence packet

See `docs/audits/LIVE_READINESS_EVIDENCE_HOWTO.md` and `docs/audits/live-readiness-evidence.draft.json`.

**Stop/go:** do not claim production readiness until LR-01 passes.
