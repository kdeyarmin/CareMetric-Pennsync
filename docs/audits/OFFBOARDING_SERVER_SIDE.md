# Offboarding server-side implementation (2026-07-30)

## Implemented in-repo

`base44/functions/offboardUser/entry.ts` performs full cleanup when an admin
offboards a user from User Management:

1. **User record** — `is_active: false`, duty off, clear routing fields
   (`personal_cell_e164`, scheduled off-duty, `work_phone_number`,
   `twilio_phone_number_sid`), stamp `offboarded_at` / `offboarded_by` /
   `offboarding_reason`
2. **Patient unassign** — remove the email from every
   `Patient.assigned_nurses` (Patient RLS keys off this)
3. **Work number release** — `PhoneNumber` pool rows set to `available` and
   `assigned_to_email` cleared
4. **On-call clear** — clear `OnCallShift.assigned_user_email` /
   `assigned_user_name` for the offboarded user
5. **Pending invitations** — mark pending `UserInvitation` rows as `cancelled`

Reactivate path (`action: 'reactivate'`) restores `is_active` and clears
offboarding markers (does not re-assign patients/numbers).

**Client wired:** `UserManagement.confirmToggleActive` calls
`base44.functions.invoke('offboardUser', buildOffboardInvokeArgs(...))` so the
full cleanup always runs with service role (not a bare `User.update`).

## Still platform-dependent

**Entity-API rejection of `is_active: false` sessions** — Layout already
blocks the browser shell. Base44 must still enforce inactive users at the
entity API boundary (or every backend function must gate on `is_active`).
Until that platform policy is confirmed, treat LR-01 verification as the
evidence path for inactive-user isolation.

## Hosted blockers (unchanged)

- **LR-01** RLS tenant evidence — requires staging Base44 app + multi-role
  network tests (V1–V6)
- **LR-02** seeded staging E2E — requires authenticated smoke (S1–S9)

See `docs/audits/LIVE_READINESS_CHECKLIST_LR01_LR02.md`,
`docs/audits/LIVE_READINESS_EVIDENCE_HOWTO.md`, and
`docs/audits/live-readiness-evidence.draft.json`.
