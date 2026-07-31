# P2-07 Admin Onboarding Checklist UI Wire — 2026-07-30

| Item | Status |
|---|---|
| Pure helper | `buildAdminOnboardingChecklist` (existing) |
| UI strip | `AdminOnboardingChecklistStrip.jsx` |
| Mount | `AgencySettings` (top of page) |

## Signals used

| Check | Source |
|---|---|
| App configured | Always true when SPA is running |
| Agency profile | `AgencySettings.office_name` + `office_zip_code` |
| Staff invites | `User` / `UserInvitation` list length |
| Telnyx secret | Left incomplete (server-only; no client secret probe) |
| Clinical templates | `ClinicalTemplate` or `Template` list |
| Required training | `TrainingAssignment` or `RequiredTraining` list |

## Remaining

- Safe server probe for communications secret status
- Optional Dashboard mount for admins only
- Product copy review

PR: #107
