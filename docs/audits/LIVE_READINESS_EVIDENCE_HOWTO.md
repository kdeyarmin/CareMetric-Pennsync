# Live-Readiness Evidence Packet — How to Fill (LR-01 / LR-02)

_Companion to `docs/audits/live-readiness-evidence.draft.json` and `docs/audits/LIVE_READINESS_CHECKLIST_LR01_LR02.md`._

## Goal

Turn the gated live-readiness matrix into real hosted evidence so
`pnpm run readiness:report` can exit 0.

## Steps

1. **Copy the draft** (do not edit the committed draft with secrets/PHI):

   ```bash
   cp docs/audits/live-readiness-evidence.draft.json tmp/live-readiness-evidence.json
   ```

2. **Replace every `FILL_ME`** in `tmp/live-readiness-evidence.json` with real values:
   - Staging Base44 app URL / id
   - Canonical fixture emails (not passwords): protected Platform-Owner; Admin-A/Admin-B; Clinician-A/Clinician-A-empty
   - Fictional patient ids A1/A2/B1 and the reviewed active assignment of A1 to Clinician-A
   - Ticket or external doc links for V1–V6 and S1–S9
   - Named owners and reviewer approvals

3. **Run LR-01 first** (isolation before deep workflow smoke):
   - Apply RLS matrix from `docs/SECURITY-RLS-CHECKLIST.md`
   - Run V1–V6 and T1–T4 against **raw reviewed-broker responses**
   - Record evidence refs (screenshots outside the repo if they contain PHI)

4. **Run LR-02** smoke flows S1–S4 minimum (S5–S9 recommended).

5. **Set reviewers** to `"approved"` only after human review.

6. **Generate the report**:

   ```bash
   pnpm run readiness:report -- tmp/live-readiness-evidence.json
   ```

   Exit code `0` = pass; `1` = blocked; `2` = invalid input.

## Rules

- Never commit real evidence JSON with credentials, tokens, or PHI.
- Never put production PHI in staging seeds.
- Exclude the protected platform owner from tenant-isolation assertions.
- Every tenant actor must have built-in `User.role=user` plus one valid, active, server-owned `AgencyMembership`; mutable User claims are never authority.
- Only raw responses from reviewed authenticated brokers count as positive tenant evidence; a tenant actor receiving PHI or authority rows from direct entity reads is a failure.
- Platform-level `is_active` rejection of deactivated sessions is part of LR-01
  verification (repo Layout already blocks the browser shell).
