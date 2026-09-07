# PennSync — Go-Live Readiness Review (2026-06-26)

Scope: a launch-readiness assessment of the whole application. This pass re-ran the
objective health gates, then **verified against the current source tree** that the
fixes described in the prior review docs (`DOMAIN_REVIEW_2026-06-20.md`,
`AI_TRUSTWORTHINESS_AUDIT.md`, `SECURITY-RLS-CHECKLIST.md`, the June code reviews)
actually landed — rather than re-reporting them. It then separates what is **blocking
go-live** from what can ship and be fixed forward.

---

## Verdict: **NO GO FOR PRODUCTION — STAGING VALIDATION ONLY**

> **Safety correction (2026-09-07):** this historical June review is superseded by
> the current staging hardening work. The source tree builds and its automated
> checks pass, but that is not sufficient to call the system launch-ready. Hosted
> Base44 behavior is still unproven for datastore uniqueness, strict conditional
> updates, queue filters, and native workflow authentication. FaxLog browser RLS
> also cannot express the required live membership join. Exact credential parity,
> multi-role tenant tests, and provider delivery have not been verified. Keep every
> workflow and outbound/domain release gate closed; do not deploy this state to
> production or use real PHI.

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

- **Signature pipeline (superseded posture)** — the retained implementation has
  stricter provenance and reminder-idempotency protections, but signing and reminder
  paths are intentionally fail-closed. Reminder scheduling and dispatch each also
  require a separate literal atomic-uniqueness proof gate that remains `false`.
- **AI trustworthiness** — fabricated `data_quality_score`/`quality_score` writes are
  gone; LLM-generated clinical content is gated behind nurse review before persist.
- **Security honesty** — `EncryptionStatusIndicator` now separates *verified* vs
  *asserted* checks (only verifiable ones drive the banner); `PHIDeIdentifier` is
  labeled "best-effort redaction — manual review required" (no false Safe-Harbor
  guarantee); `RegulatoryMonitor` never auto-mutates `ComplianceRule` and gates on
  human confirmation; `VulnerabilityAssessment` labels platform/manual-review items
  honestly.
- **PDGM honesty (superseded posture)** — payment is now globally unavailable,
  and the legacy factorized approximation is independently retirement-locked.
  An admin-loaded table or stored `is_official` flag cannot enable or
  authenticate payment output. See `docs/pdgm-cy2026.md`.

---

## 2. Go-live BLOCKERS (P0 — must complete before real PHI)

These include both hosted platform behavior and operations configuration. The code
fails closed where the required behavior has not yet been proven.

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
- **Telnyx** — powers SMS, masked voice, telehealth video, fax. Configure it
  **in-app at Admin → Telnyx**, which stores the values on the `IntegrationSecret`
  row every Telnyx function reads. The API key, public key and the
  messaging/voice/fax connection ids all live there.
  > **Not environment variables.** `TELNYX_API_KEY` and friends are retired and
  > are **not read by any backend function**. This bullet used to list them as
  > launch secrets and state the resolution order backwards ("falls back to the
  > in-app record when the env var is unset"), which is how operators came to set
  > env vars, watch sends keep failing, and report Telnyx as broken — twice ending
  > in an env-fallback patch that had to be reverted. The public key is required
  > for inbound webhooks, which are fail-closed without it.
- **`APP_PUBLIC_URL`** — required non-secret configuration set to this
  environment's exact HTTPS origin. Outbound account/invitation/notification
  links fail closed when it is missing or malformed; there is no `APP_URL` or
  production-host fallback.
- **`OPENAI_API_KEY`** (direct audio transcription, including the transcription
  stage of SOAP-from-audio), **`ANTHROPIC_API_KEY`** (direct SOAP-note
  structuring), **`HEYGEN_API_KEY`** (training video) —
  each feature shows a clear "not configured" notice until set, so these gate
  *features*, not launch.
- Most application AI and email use Base44-managed `Core.InvokeLLM` and
  `Core.SendEmail`. Fax-cover formatting is deterministic. Gemini, Deepgram,
  Resend, Notifyre, and Twilio environment keys are not current runtime
  requirements and are not launch blockers.
- `SIGNUP_WEBHOOK_SECRET` (optional) locks `onUserSignup` to the trusted trigger.

### 2.3 Webhooks + signature verification
- Point Telnyx (and any Twilio legacy) inbound SMS / delivery-status / inbound-voice /
  call-status / fax-status webhooks at the deployed function URLs.
- Confirm inbound signature verification works (good signature → 200, bad → 401/
  rejected). Idempotency de-dups on provider message/call ids, so retries can't
  double-process.

### 2.4 Scheduled functions — keep inactive pending hosted proof
All migrated workflows and legacy function automations must remain inactive. Before
any later activation, prove in staging that native workflow ticks carry the expected
protected authority, `$exists`/`$lte` filters behave as assumed, and exact one-row
`updateMany` claims are single-winner. Establish datastore-enforced uniqueness for
signature reminder schedule keys and validate scheduled-fax idempotency across the
lease boundary. Never enable a migrated workflow and its legacy automation at the
same time.

### 2.5 PDGM grouper — active payment/compliance blocker
PDGM payment is **unavailable**, not estimated and not $0. Loading tables or
setting `is_official` is insufficient: the app must integrate a date-effective
official CMS HHGS implementation, match the pinned CMS fixtures, and pass the
tenant/provenance/operational gates in `docs/pdgm-cy2026.md`. Use the official
EMR/CMS-approved grouper meanwhile.

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

1. Apply RLS (§2.1) and establish hosted uniqueness/CAS/filter behavior while all
   release gates and workflows remain closed (§2.4).
2. Set and independently verify the required environment-specific backend secrets
   (§2.2); never infer parity from matching secret names.
3. Configure webhooks and verify signatures with non-PHI fixtures (§2.3). Perform
   delivery tests only as a separately approved controlled operation.
4. Run the multi-role RLS verification (checklist §7) against **raw network
   responses** — this is the launch gate for a PHI app.
5. Complete the verified CMS HHGS integration and parity gate (§2.5).
6. Obtain a new security and production go/no-go review. Activation and production
   deployment are separate changes and are not authorized by a staging validation.

**Bottom line:** this source state is suitable for fail-closed staging validation,
not production launch. Keep workflows and outbound/domain gates inactive until the
hosted datastore, scheduler-auth, RLS, credential, and controlled-provider evidence
above is complete and independently reviewed.

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
  it **fails closed** — a missing configured Telnyx public key, missing/invalid
  signature, or a stale timestamp all return `false` → the event is rejected
  (no PHI delivery-state mutation on an unverified event).
- **Replay guard** — `isFreshTimestamp` enforces a timestamp tolerance window.
- **Idempotency** — status mapping de-dups by provider message/call id (per checklist
  §5), so Telnyx retries can't double-process.

→ **Outstanding (platform):** store the Telnyx public key in the in-app
`IntegrationSecret`; point each staging-owned Telnyx number's
messaging/voice/fax webhooks at this function URL; run the good-/bad-signature
smoke test without directing production numbers to staging.

### Current configuration boundaries
Telnyx credentials and resource identifiers are read only from the in-app
`IntegrationSecret` record; retired Telnyx/Twilio environment variables are not
fallbacks. `APP_PUBLIC_URL`, `INTERNAL_FN_SECRET`, `SIGNATURE_HMAC_SECRET`, and
`SUPER_ADMIN_EMAIL` are backend configuration/security inputs. Direct-provider
feature keys are limited to OpenAI audio transcription, Anthropic SOAP-note
structuring, and HeyGen training-video generation. Platform-managed LLM and
email capabilities require no separate provider secret, and deterministic fax
covers require none.

→ **Outstanding (platform):** the actual values cannot be verified from the repo — set
them per §2.2. Signature token issuance and verification fail closed when
`SIGNATURE_HMAC_SECRET` is missing or too short.

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
