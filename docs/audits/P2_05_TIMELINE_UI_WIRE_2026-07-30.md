# P2-05 Patient Timeline UI Wire — 2026-07-30

| Item | Status |
|---|---|
| Pure helper | `buildPatientTimeline` (existing) |
| UI strip | `PatientTimelineStrip.jsx` |
| Mount | `ClinicalEventsTimeline` (Events tab on PatientDetails) |

## Behavior

- Unified cross-entity timeline (visits, incidents, tasks; documents/messages/referrals when passed)
- Newest-first; links to source routes
- Uses react-query keys seeded by `getPatientContext` when available (no extra PHI fetch on warm cache)
- Distinct from `ClinicalEvent` entity timeline (medication/fall/wound events) — both surface on the Events tab

## Still optional

- Overview-tab mount
- Document/message/referral feeds when product prioritizes them
- Permission-sensitive hosted validation (LR-01)

PR: #107
