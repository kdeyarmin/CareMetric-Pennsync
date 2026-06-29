# PennSync — Go-Live Readiness Review (2026-06-26)

Scope: a launch-readiness assessment of the whole application. This pass re-ran the
objective health gates, then **verified against the current source tree** that the
fixes described in the prior review docs (`DOMAIN_REVIEW_2026-06-20.md`,
`AI_TRUSTWORTHINESS_AUDIT.md`, `SECURITY-RLS-CHECKLIST.md`, the June code reviews)
actually landed — rather than re-reporting them. It then separates what is **blocking
go-live** from what can ship and be fixed forward.

---

## Verdict: **CONDITIONAL GO**

The **code is launch-ready.** It builds clean, lints clean of errors, and the full
test suite passes. The widespread issues called out in the June reviews
(entity-contract drift, fabricated AI scores, security-theater banners, the dead
signature pipeline) have been **fixed and verified in this tree**.

What stands between the app and a safe production launch is **not code** — it is
**operational configuration that lives in the Base44 dashboard and backend secrets,
not in this repo**, plus two product decisions. Those items are concrete and listed
below. Until they are done and verified (especially RLS), **do not go live with real
PHI.**

---

## 1. Objective health baseline — PASS (re-verified 2026-06-26)

| Gate | Result |
|------|--------|
| `npm run build` | ✅ exit 0 |
| `npm run lint` | ✅ 0 errors (warnings only — `react-hooks/exhaustive-deps`, per AGENTS.md treated as passing) |
| `npm run test:utils` (node `--test`) | ✅ pass |
| `npm run test:components` (Vitest) | ✅ 130 passed / 23 files |

Surface area: **82 page routes, ~117 entities, ~215 backend Deno functions, 77 test
files.** Routing derives from a single source of truth (`src/lib/nav.manifest.js` →
`src/routes.jsx`); retired pages redirect rather than 404. No dead-feature problem.

### Verified-landed fixes (spot-checked against source, not just docs)

- **Signature pipeline** — `submitSignerSignature` no longer writes the non-schema
  `status:'signed'`; it embeds the signature into the PDF (`embedSignatureToPDF`
  wired into the submit path) and the reminder-idempotency field
  `last_reminder_sent_at` now exists on `DocumentSignature`. The completion pipeline
  is live, not dead.
- **AI trustworthiness** — fabricated `data_quality_score`/`quality_score` writes are
  gone; LLM-generated clinical content is gated behind nurse review before persist.
- **Security honesty** — `EncryptionStatusIndicator` now separates *verified* vs
  *asserted* checks (only verifiable ones drive the banner); `PHIDeIdentifier` is
  labeled "best-effort redaction — manual review required" (no false Safe-Harbor
  guarantee); `RegulatoryMonitor` never auto-mutates `ComplianceRule` and gates on
  human confirmation; `VulnerabilityAssessment` labels platform/manual-review items
  honestly.
- **PDGM honesty** — the grouper returns `null` rather than guessing for unknown
  codes and discloses `isEstimate` until an admin loads official CMS tables
  (`isOfficial`/`is_official` path in `calculatePDGM`).

---

## 2. Go-live BLOCKERS (P0 — must complete before real PHI)

These are **not in this repo** — they are platform/operations configuration. The code
already assumes they are done.

### 2.1 Row-Level Security (the single most important item)
Client-side role checks and query filters in this app are **cosmetic (UX only)**. The
real access boundary is **Base44 RLS, configured per-entity in the dashboard.**
Several PHI views fall back to a global `.list()` when no patient is selected
(`DocumentSignatures`, `SignatureTracking`, `Incidents`, etc.) and rely **entirely**
on RLS as the boundary.

- Apply the per-entity read/write matrix in `docs/SECURITY-RLS-CHECKLIST.md` §2 and
  the relation-based rules in `docs/RLS-REMEDIATION-SPEC-2026-06-19.md` (patient-
  clinical entities scope "by patient access"; training attestation writes go
  service-role-only so completions/scores aren't forgeable; private fields like
  `User.personal_cell_e164`, `CallLog`, `SmsMessage` bodies are service-role/admin).
- **Verify** with the multi-role test (checklist §7): a non-admin with no assigned
  patients must see **nothing** in the *raw network responses* (not just the rendered
  UI) for Dashboard, Patient Alerts, SMS inbox, fax history; an IDOR probe with
  another patient's id must return 403/404/empty.

### 2.2 Backend secrets (set in the platform, never `VITE_*`)
Per `.env.example` and the checklist:
- **`INTERNAL_FN_SECRET`** — set at launch; otherwise `issueCertificate` lockdown is
  inactive and certificates are forgeable.
- **`FILE_URL_ALLOWED_HOSTS`** (+ consider `FILE_URL_STRICT=true`) — closes SSRF /
  DNS-rebinding on server-side file fetches.
- **Telnyx** (`TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, messaging/voice/fax connection
  ids, `TELNYX_FAX_NUMBER`) — powers SMS, masked voice, telehealth video, fax.
  `TELNYX_PUBLIC_KEY` is required for inbound webhooks to be accepted (fail-closed).
  Can also be set in-app at Admin → Super Admin.
- **`OPENAI_API_KEY`** (transcription, SOAP-from-audio, training generation/grading),
  **`ANTHROPIC_API_KEY`** (fax cover pages), **`HEYGEN_API_KEY`** (training video) —
  each feature shows a clear "not configured" notice until set, so these gate
  *features*, not launch.
- `SIGNUP_WEBHOOK_SECRET` (optional) locks `onUserSignup` to the trusted trigger.

### 2.3 Webhooks + signature verification
- Point Telnyx (and any Twilio legacy) inbound SMS / delivery-status / inbound-voice /
  call-status / fax-status webhooks at the deployed function URLs.
- Confirm inbound signature verification works (good signature → 200, bad → 401/
  rejected). Idempotency de-dups on provider message/call ids, so retries can't
  double-process.

### 2.4 Scheduled functions — exactly one dispatcher each
Privileged cron functions run `asServiceRole` with no `auth.me()` — confirm the
platform restricts who can invoke function endpoints. **Enable only one** scheduled-
fax processor (`processScheduledFaxes` **or** `processScheduledFaxesByPriority`) and
**only one** `dispatchScheduledSms` schedule — the pending→sending claim is
best-effort, not atomic, so overlapping runs double-send.

### 2.5 PDGM rates — product decision (payment/compliance risk)
PDGM grouping/case-mix weights need **official CMS 2026 tables**, not invented
numbers. The live path correctly discloses `isEstimate` until an admin loads official
values. **Decide before billing relies on it:** load the agency's official CMS files
(then results flip to `isOfficial`), or keep PDGM output explicitly labeled as an
estimate and not used for claims.

---

## 3. Known code gaps

### Features removed by product decision (2026-06-26)

- **Clinical-note signing — removed.** The visit/clinical-note e-signature components
  (`VisitNoteSignatureWorkflow`, `ClinicalDocumentSigningFlow`, `DocumentSignatureManager`,
  `SignatureAuditTrail`, `SecureESignatureCapture`) were deleted. These were all latent
  (not route-wired), so no live screen changed. The separate **Documents & E-Signing**
  back-office (patient consent forms, document packets, the external `/signer` portal)
  and the `DocumentSignature` entity are **retained** — only clinical-note signing was
  cut. (This supersedes the earlier audit-trail bug-fix in this branch, which fixed
  those components before they were removed.)
- **Medication records & drug interactions — removed.** Deleted the `Medication` and
  `MedicationReconciliation` entity schemas, the drug-interaction backstop
  (`drugInteractions.js`) and its backend function (`checkDrugInteractions`) + parity
  tests, the medication reads in `HospitalizationRiskWidget` and
  `PersonalizedMaterialSender`, and the AI drug-interaction sections from the three CDS
  panels (`RealTimeClinicalDecisionSupport`, `EnhancedClinicalDecisionSupport`, SmartNote
  `ClinicalDecisionSupport`). The CDS panels' distinct contraindication / allergy /
  vital-sign checks were kept. **Platform follow-up:** the `Medication` /
  `MedicationReconciliation` entities and the `checkDrugInteractions` deployed function
  still exist in the live Base44 app until removed in the dashboard; incidental
  references to "medications" in other AI prompts/OASIS items were intentionally left.

### Still open (non-blocking — fix forward)

- **`voice/onCall.js`** — `TODO(verify)`: confirm the Telnyx `hangup_cause`
  vocabulary against a live account. Telnyx publishes no authoritative public
  enumeration, so this genuinely needs live verification; the matching set is a
  reasonable best-effort and the fallback is conservative (unknown cause → treat as
  caller hangup → stop ringdown). Verify during webhook smoke-testing (§2.3); do not
  change the set speculatively (risks an on-call escalation regression).

---

## 4. Recommended launch sequence

1. Apply RLS (§2.1) and set backend secrets (§2.2) in the platform.
2. Configure webhooks + verify signatures (§2.3); smoke-test SMS/voice/fax round-trip.
3. Enable exactly one of each scheduled dispatcher (§2.4).
4. Run the multi-role RLS verification (checklist §7) against **raw network
   responses** — this is the launch gate for a PHI app.
5. Decide the PDGM rate posture (§2.5).
6. Launch. Track §3 as fast-follow.

**Bottom line:** the application itself is in strong, launch-ready condition — the
remaining work is platform configuration and verification, dominated by RLS. Get RLS
right and verified, set the secrets and webhooks, pick exactly one cron per
dispatcher, and settle the PDGM-rate posture, and PennSync is ready to go live.

---

## Appendix A — Configuration audit (verified in-repo, 2026-06-26)

This appendix records what is **wired and correct in the code** vs. what is
**outstanding platform configuration** (the latter cannot be set or verified from
this repo). It does not assert what is configured in the live environment.

### Webhooks — code is sound; fail-closed verified
`handleTelnyxStatusWebhook` is the **single** inbound handler for the whole Telnyx
integration: inbound SMS + delivery status, fax status, and voice (Call Control IVR,
masked-bridge, call status). Verified in source:
- **Ed25519 signature verification** (`verifyTelnyxSignature`) over the raw body, and
  it **fails closed** — a missing `TELNYX_PUBLIC_KEY`, missing/invalid signature, or a
  stale timestamp all return `false` → the event is rejected (no PHI delivery-state
  mutation on an unverified event).
- **Replay guard** — `isFreshTimestamp` enforces a timestamp tolerance window.
- **Idempotency** — status mapping de-dups by provider message/call id (per checklist
  §5), so Telnyx retries can't double-process.

→ **Outstanding (platform):** set `TELNYX_PUBLIC_KEY`; point each Telnyx number's
messaging/voice/fax webhooks at this function URL; run the good-/bad-signature smoke
test.

### Secrets — every documented secret is referenced in code
`Deno.env.get` references confirmed for all launch-relevant secrets: `TELNYX_API_KEY`,
`TELNYX_PUBLIC_KEY`, `TELNYX_VOICE_CONNECTION_ID` (+`TELNYX_CONNECTION_ID` alias),
`TELNYX_MESSAGING_PROFILE_ID`, `TELNYX_FAX_CONNECTION_ID`, `TELNYX_FAX_NUMBER`,
`INTERNAL_FN_SECRET` (13 sites), `FILE_URL_ALLOWED_HOSTS` (+`FILE_URL_STRICT`),
`SIGNATURE_HMAC_SECRET` (keyed signature MAC), `SIGNUP_WEBHOOK_SECRET`,
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `HEYGEN_API_KEY`. Telnyx creds also fall back to
the in-app `IntegrationSecret` record when the env var is unset.

→ **Outstanding (platform):** the actual values cannot be verified from the repo — set
them per §2.2. Note `SIGNATURE_HMAC_SECRET`: without it the signature integrity MAC
falls back to an unkeyed `sha256` (detects corruption, **not** forgery) — set it so
the tamper-evidence is forgery-resistant.

### RLS — 47 of 117 entities carry an in-repo block; the rest are dashboard-by-design
- **In-repo `rls` blocks (47):** includes `Patient`, `Visit`, `CarePlan`, `Incident`,
  `CallLog`, `SmsMessage`, `SmsConsent`, `ScheduledSms`, `ScheduledFax`,
  `SecurityLog`, `UserActivity`, `TelehealthSession`, `DocumentPackageToken`, the
  scoped training entities (`TrainingAttempt/Attestation/Certificate/Assignment`),
  etc.
- **No in-repo block (~70) — expected, not a repo bug:** dominated by patient-clinical
  PHI entities whose correct rule is *"by patient access"* (caller ∈
  `Patient.assigned_nurses`). Per `RLS-REMEDIATION-SPEC-2026-06-19.md`, the repo RLS
  DSL has **no cross-entity join**, so these **must** be applied as relation rules in
  the Base44 dashboard: `DocumentSignature`, `FaxLog`,
  `OASISUpload`, `OASISAssessment`, `DischargeSummary`,
  `Document`, `Referral`, `ClinicalEvent`, `PatientAlert`, `PatientRiskAssessment`,
  `CareCoordinationAlert`, `CarePlanProposal`, `PatientRecommendation`,
  `NoteConversion`, `SentEducationMaterial`, `PatientEducation*`, `TrainingCompletion`,
  `MicroLearningProgress`, `User`, `ComplianceAudit`, … This is the **#1 blocker** and
  the largest single body of outstanding work.

→ **Outstanding (platform):** apply the dashboard relation rules per the remediation
spec, then run the checklist §7 multi-role test against **raw network responses** —
this is the launch gate.
