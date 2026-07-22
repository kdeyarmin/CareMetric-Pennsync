# Base44 + Apple App Store Compatibility Review — 2026-07-22

Full-codebase review verifying that PennSync works correctly as a Base44-hosted app and as an
Apple App Store (iOS WKWebView wrapper) app. The review combined:

- the local validation suite (lint, typecheck, tests, production build),
- a live comparison against the deployed Base44 **PENNSync** app via the Base44 connector
  (entity schemas, backend functions, pages, sandbox source),
- a deep review of the frontend Base44 integration layer (`src/lib`, `src/api`, `src/functions`),
- a deep review of the backend Deno function layer (`base44/functions`, `base44/_shared`),
- a deep review of the iOS wrapper (`ios/`) against App Store technical and policy requirements.

## Verdict

The codebase itself is in strong shape: all validation gates pass, the backend function layer is
internally consistent and Deno-clean, and the SPA's Base44 integration is largely well-defended.
However, **"works perfectly" is currently blocked by three structural problems**:

1. **The GitHub repo and the live Base44 app have forked.** Each side has features, pages,
   functions, and entities the other lacks. Deploying this repo as-is would delete live features;
   the live app is missing this repo's features and fixes.
2. **The hosted sign-up/OTP/logout path is broken** because the SDK client is created without
   `appBaseUrl`, so platform auth navigations resolve into the SPA itself.
3. **The iOS wrapper is not yet a buildable/submittable app** (no Xcode project, entry point, or
   icon set), and several wrapper behaviors break core document flows inside WKWebView.

## 1. Validation suite — all green

| Gate | Result |
| --- | --- |
| `npm run lint` | 0 errors |
| `npm run typecheck` | exit 0 |
| `npm test` | 46 node tests + 414 Vitest tests, all pass |
| `npm run build` | succeeds; `dist/` ~20 MB, relative `./` asset URLs |
| `node tools-check-backend-transpile.mjs` | 225 functions transpile cleanly; invocations target existing functions |
| `node tools-sync-shared-helpers.mjs --check` | 69 consumers in sync |
| `node tools-sync-dedupe-engine.mjs --check` | in sync |
| `base44/schemaContract.test.js`, `entityReferenceContract.test.js` | 8/8 pass |
| `base44/securityGuardrails.test.js` | 48/48 pass |

## 2. CRITICAL — Repo ↔ live Base44 app drift

Verified via the Base44 connector against app `PENNSync` (`68ee80d98929370f9e8f2932`). The live
app's source snapshot corresponds to the commit "chore: stop committing base44/.app.jsonc", but
its tree has diverged far beyond the 3 dependency-only commits GitHub has added since — these are
effectively two forked codebases sharing commit messages.

| Dimension | Live app | GitHub repo |
| --- | --- | --- |
| Registered/defined entities | 117 | 233 |
| Backend functions | 214 | 231 |
| Pages | 82 | 81 |

**Only in the live app (missing from this repo):**

- Pages: `AutomaticCarePlans`, `CarePlanBuilder`, `CarePlanManagement`, `ClinicalChart`,
  `ClinicalInsightsDashboard`, `MyLearning`, `NurseEducationVideos`
- Functions: `generateCarePlanFromReferral`, `generateCarePlanSuggestions`,
  `generateCarePlansFromReferral`, `monitorClinicalDataForCarePlanUpdates`
- Entities: `CarePlan`, `CarePlanProposal`, `AutomaticCarePlanTrigger`

**Only in this repo (never deployed to the live app):**

- Pages: `ADRCenter`, `DocumentationImpact`, `FacilityDocumentationRules`,
  `ProviderFollowUpPortal`, `ReferralFollowUp`, `Timesheets`
- Functions (21): `appendPatientNoteHistory`, `checkAdrDeadlines`, `checkStaleFollowUpRequests`,
  `computeOutcomeMeasures`, `dispatchScheduledSignatureReminders`, `generateAdrPacket`,
  `generateCourseQuiz`, `generateFollowUpPortalToken`, `getCoursePlayerQuestions`,
  `processInboundFaxes`, `reviewPersonnelCredential`, `reviewTimesheet`, `saveFollowUpRuleConfig`,
  `savePayrollProfile`, `saveVisitPointConfig`, `submitFollowUpResponse`,
  `submitPersonnelCredential`, `submitSignerSignature`*, `submitTimesheet`,
  `updateScopedPatientAlert`, `validateFollowUpToken` (*present live; retained here for the
  follow-up feature set the live app lacks)
- ~116 entity schema files, of which **10 are actively used by this repo's frontend but not
  registered in the live app**: `AdrAuditCase`, `AgencyKPI`, `EmployeePayrollProfile`,
  `FaceToFaceEncounter`, `FacilityDocumentationRule`, `FollowUpRuleConfig`,
  `PatientOutcomeMetric`, `PolicyAcknowledgment`, `Timesheet`, `VisitPointConfig` — the ADR
  Center, Timesheets, Follow-Up Portal, and related pages would fail at runtime against the
  current live backend.
- Schema content also drifts on shared entities: e.g. repo `Patient` has 7 fields the live app
  lacks (`active_alerts`, `chronic_conditions`, `current_medications`, `is_sample`,
  `past_surgeries`, `risk_assessment`, `social_determinants`); the repo is a strict superset here.

**Required action:** reconcile before any deploy. Port the live-only Care Plan / Clinical Chart /
My Learning / Nurse Education Videos features into this repo (or consciously deprecate them),
then make this repo the single source of truth and sync the Base44 app from it. Deploying either
direction without reconciliation loses features.

## 3. Frontend Base44 integration (`src/`)

**HIGH — Hosted sign-up/OTP/logout unreachable: `createClient` has no `appBaseUrl`**
(`src/api/base44Client.js:7-13`; consumed in `src/lib/AuthContext.jsx:139-150`). The SDK
normalizes `appBaseUrl` to `""`, so `redirectToLogin` navigates to `/login` **on the frontend
origin**, which the SPA-fallback serves back as the SPA — invited users needing the platform
sign-up/OTP/captcha page can never complete onboarding. `logout` similarly POSTs to the frontend
origin instead of the configured backend (`VITE_BASE44_BACKEND_URL`), so the server-side session
may never be cleared (client token removal still works). Fix: pass the backend base URL as
`appBaseUrl` when creating the client.

**HIGH — `window.open('', '_blank')` print/PDF-view flows fail in WKWebView**
(`src/pages/Features.jsx:619,1238`, `src/pages/PDFTools.jsx:135`,
`src/components/training/MyAnnualEducationDashboard.jsx:69`,
`src/components/learning/AnnualTranscriptCenter.jsx:36`, `EmployeeTranscriptCenter.jsx:42`,
plus document.write print flows in `src/components/adr/AdrChecklistPanel.jsx:44` and education
generators). The wrapper returns `nil` for URL-less popups and cannot open `blob:` externally, so
these features show "Please allow pop-ups" — meaningless in a native app. Fix on both sides:
support popup WKWebViews / route to `UIPrintInteractionController`, and prefer the
`<a download>` path (already handled) over `window.open` for viewing.

**MEDIUM — SDK broadcasts request/response data to `window.parent` with `targetOrigin: '*'` when
framed** (`@base44/sdk` axios client; also `src/lib/NavigationTracker.jsx:14-17` posts full URLs
with `?patientId=` params). Not triggered in top-level hosting or the iOS shell, but there is no
`frame-ancestors`/`X-Frame-Options` protection in the SPA; a hostile embedding page would receive
every API response (PHI). Mitigate with a `frame-ancestors` policy at the hosting layer and/or a
frame-busting check.

**LOW — `base44_from_url` localStorage key persists full deep-link URLs (potential PHI) and is
excluded from `clearCachedPHI()`** (`src/lib/app-params.js:163`, `src/lib/offlineKeys.js:70-77`).
Dead data that survives logout on shared devices; add it to the purge list.

**LOW — `functions.invoke` rejects with raw AxiosError, not `Base44Error`** — latent
inconsistency for error-code branching (`integration_credits_limit_reached`-style checks won't
match on function errors).

Clean (verified): `server_url`/`access_token` URL-param injection defenses in `app-params.js`;
localStorage-unavailable fallbacks; 401/403 handling and in-app `SignInScreen`; react-query retry
policy; Vite config (`base: './'`, console-stripping, no secret leakage, lockfile in sync with
`base44/config.jsonc` build commands); service worker scope/PHI-exclusion design; public token
routes (`/join`, `/signer`, `/followup`) gated before auth; HIPAA logout/idle PHI purge across all
three logout paths.

## 4. Backend Deno function layer (`base44/`)

Internally consistent and Deno-clean: all 225 functions transpile; every frontend invocation
targets an existing function; imports are uniformly `npm:`-specified (`@base44/sdk@0.8.31`
everywhere); zero Node-only APIs; env access only via `Deno.env.get`; entity access only through
structured SDK filters (no injection surface); webhook (Telnyx) verifies Ed25519 with timestamp
freshness and fails closed; no hardcoded secrets.

Findings to address:

- **MEDIUM — 191 of 225 functions echo raw `error.message` to clients** from catch-alls (e.g.
  `adminResetPassword/entry.ts:192`, `ensureSuperAdmin/entry.ts:89`). The hardened functions
  (`userManagement`, `sendFax`, `validateFollowUpToken`) explicitly avoid this; the rest should
  adopt the same generic-message pattern.
- **MEDIUM — fax send path bypasses the SSRF/URL allowlist**: `sendFax/entry.ts:139`,
  `sendBatchFax/entry.ts:184` (and the retry paths) hand client-supplied `file_url` directly to
  Telnyx, contradicting the `isSafeFetchUrl` invariant that 18 other functions inline. Any
  authenticated user can have Telnyx fetch and fax an arbitrary URL on the agency account.
- **MEDIUM-LOW — follow-up portal tokens stored in plaintext**
  (`generateFollowUpPortalToken/entry.ts:61-68`) while sibling signer tokens are SHA-256-hashed at
  rest; hash these the same way.
- **LOW — inconsistent admin gates**: `generateSignerToken` requires `role === 'admin'` only;
  `adminResetPassword` accepts admin/super_admin; the canonical `isAdminLike` helper accepts three
  tiers. Standardize on `isAdminLike`.
- **LOW — `ensureSuperAdmin` first-boot TOCTOU** (two concurrent callers can both become
  super_admin during bootstrap).
- **LOW — scheduler secret compared with `===`** (`backendHelpers.mjs:94`) instead of the
  timing-safe compare already used in `createTelehealthToken`.
- **LOW — SSRF allowlist admits any `*.base44.app`/`*.base44.io` tenant** — blocks internal-network
  SSRF but not cross-tenant content injection into PDF/OCR pipelines.
- **LOW — jspdf version drift**: pins span 2.5.1 / 2.5.2 / 4.0.0, and three functions import
  unpinned `npm:jspdf` (plus one unpinned `npm:openai`) — a redeploy can silently jump two breaking
  majors. Pin all to one version.
- **INFO — 16 functions have zero references anywhere in the repo** (e.g. `autoImportPatients`,
  `generateBagTechniquePDF`, `sendWelcomeEmail`, `trackUserLogin`) — dead code unless wired to
  platform-side automations; confirm and prune.
- **INFO — `signatureIntegrity` degrades to unkeyed SHA-256 when `SIGNATURE_HMAC_SECRET` is
  unset** — ensure the secret is set in production.

## 5. iOS wrapper / App Store readiness (`ios/`)

### Blocking for submission (missing artifacts)

1. **No Xcode project** (`.xcodeproj`/`.xcworkspace`) — nothing buildable exists yet.
2. **No app entry point** — no `AppDelegate`/`SceneDelegate`/SwiftUI `@main`; `WebViewController`
   is never instantiated.
3. **No `Assets.xcassets`/AppIcon** and no 1024×1024 marketing icon (`public/icons/` tops out at
   512 px) — submission is impossible without it.
4. `Info.plist:45-49` — `UIApplicationSceneManifest` lacks `UISceneConfigurations`; replacing a
   generated Info.plist with this one on a UIKit target boots to a black screen. Merge keys.
5. **No `PrivacyInfo.xcprivacy`** — expected for any 2024+ submission; declare collected data
   types (health data, identifiers).

### Wrapper defects

- **HIGH — external-URL policy applies to subframes** (`WebViewController.swift:100-104`, no
  `targetFrame.isMainFrame` check): every cross-origin iframe (Supabase-hosted PDF previews in
  `SignDocument.jsx:165`, `SignerDocumentSigner.jsx:123`, `OASISPDFComparison.jsx:279`, etc.) is
  cancelled and ejected to Safari, leaving blank preview panes.
- **HIGH — `blob:` catch applies to subframes too** (`WebViewController.swift:83-87`): inline blob
  iframe previews (`SignatureRequestCreator.jsx:531`) become share-sheet downloads instead of
  rendering. Both fixes: gate on `navigationAction.targetFrame?.isMainFrame != false`.
- **HIGH — no App-Bound Domains** (`WKAppBoundDomains` + `limitsNavigationsToAppBoundDomains`):
  service workers never run in WKWebView, so the entire offline system (`public/sw.js`,
  `offline.html`, offline queue) is inert in the shell; with no `didFailProvisionalNavigation`
  handler, a cold offline launch is a permanent white screen (Guideline 2.1 risk for a field-nurse
  app).
- **MEDIUM — deployment-target mismatch**: `WKUIDelegate` conformance is `@available(iOS 15, *)`
  but assigned unguarded at `:47`; at the README's stated iOS 14.5 floor the file does not
  compile. Raise the floor to iOS 15+.
- **MEDIUM — media auto-grant is dead code**: `WKSecurityOrigin.port` returns 0 for default
  ports, so `origin.port == 443` (`WebViewController.swift:203-206`) never matches (verified in
  source); telehealth/audio/camera-fax users get a redundant WebKit prompt. Treat port 0 as the
  scheme default.
- **MEDIUM — no `webViewWebContentProcessDidTerminate` handler** — WebKit process kill under
  memory pressure leaves a frozen blank view; call `webView.reload()`.
- **MEDIUM — popup/print handling** (`createWebViewWith` returns nil for `about:blank`;
  `openExternally` can't open `blob:`) — see the frontend HIGH above; fix jointly.
- **LOW** — no `canOpenURL` guard; no pull-to-refresh/native reload; external links exit to Safari
  (consider `SFSafariViewController`); `UIFileSharingEnabled` exposes a permanently empty
  Documents folder.

### App Store policy risks

- **Guideline 4.2 (minimum functionality): medium-high risk for a public listing.** A full-screen
  web view of a hosted site is the classic 4.2 rejection. De-risk by distributing via Apple
  Business Manager (unlisted/custom app) to agencies, or add visible native capability first
  (push notifications, Face ID app-lock over the PHI session, VisionKit document scanning).
- **Privacy policy (5.1.1(i)): missing.** No privacy policy link exists anywhere in `src/`;
  required both in App Store Connect and inside the app for a health-data app.
- **Account deletion (5.1.1(v)): satisfied** via `UserSettings.jsx:221-254` (request-based with
  audit trail) — state the regulated-data retention rationale in App Review notes.
- **Sign in with Apple (4.8): not currently triggered** (first-party email/password only), but
  verify the production hosted `/login` fallback page shows no Google button; if it does, 4.8
  applies and the OAuth redirect would also break in the shell.
- **IAP (3.1.1): clean** — no payment SDKs; all billing code is Medicare PDGM analytics, nothing
  sold to app users.
- **Review access (2.1):** supply a seeded non-PHI demo account; note the 15-minute idle timeout.
- Privacy nutrition labels must declare Health & Fitness data, identifiers, and audit data,
  linked to identity. `ITSAppUsesNonExemptEncryption=false` is correct.

### Mobile web quality: clean

Viewport (`viewport-fit=cover`), end-to-end safe-area insets (header, bottom nav, content,
offline page), 16 px inputs (no iOS focus-zoom), dark-mode-safe status bar, responsive shell,
correct manifest icons. Minor: `window.print()` is a no-op below iOS 16.4; manifest locks
portrait while Info.plist allows landscape (intent mismatch only).

## Prioritized action plan

1. **Reconcile repo ↔ live app drift** (§2) — everything else assumes one source of truth.
2. **Fix `appBaseUrl`** in `base44Client.js` (§3 HIGH) — unbreaks hosted sign-up/OTP/logout.
3. **Register the 10 missing entities** (or gate their pages) before deploying repo features.
4. **iOS wrapper fixes**: `isMainFrame` guards, App-Bound Domains + offline error view, iOS 15
   floor, process-terminate handler, port-0 fix, popup/print bridge (§5).
5. **Create the actual Xcode project** with entry point, icons, privacy manifest, launch screen.
6. **Backend hardening**: generic error messages, fax URL allowlist, hash follow-up tokens,
   standardize admin gates, pin jspdf/openai versions (§4).
7. **Policy prep**: in-app privacy policy link, demo account, privacy labels, distribution-route
   decision (ABM vs public) for 4.2.

## Implementation status (2026-07-22, same day)

All seven items were implemented on this branch:

1. **Drift reconciled** — the live-only Care Plan feature set (pages `CarePlanManagement`,
   `CarePlanBuilder`, `AutomaticCarePlans` + 10 `src/components/carePlan/` components, 4 backend
   functions, 3 entities) is ported and routed via the nav manifest; `ClinicalChart`,
   `ClinicalInsightsDashboard`, `MyLearning`, `NurseEducationVideos` page files are ported and,
   matching the live app's own routing, intentionally unrouted (both sides redirect those paths).
   The repo is now a superset of the live app.
2. **`appBaseUrl` passed** to `createClient` (`src/api/base44Client.js`) — platform
   sign-up/OTP/logout now target the backend origin. Also: `from_url` is no longer persisted,
   and the stale `base44_from_url` key is purged on logout/idle (registered in `OFFLINE_KEYS`).
3. **All 10 entities registered** in the live PENNSync app via the Base44 connector (verified
   by re-listing). Repo-only *functions* still deploy with the next app sync.
4. **iOS wrapper fixed** — main-frame-only guards, native offline/error view with retry,
   content-process-terminate recovery, media-permission default-port fix, popup/print bridge
   (`UIPrintInteractionController`), `canOpenURL` guard, pull-to-refresh, App-Bound Domains,
   iOS 15 floor.
5. **Project scaffolding added** — `AppDelegate`/`SceneDelegate`, asset catalog with 1024 px
   AppIcon + launch color, `PrivacyInfo.xcprivacy`, XcodeGen `ios/project.yml`, rewritten
   `ios/README.md`. (`xcodegen generate` + a real Xcode build remain the definitive check.)
6. **Backend hardened** — 191 catch-all `error.message` leaks replaced with generic messages +
   server-side logging; fax send/retry paths now enforce `isSafeFetchUrl`; follow-up portal
   tokens hashed (SHA-256) at rest; `generateSignerToken`/`adminResetPassword`/`sendTestSms`
   standardized on `isAdminLike`; unpinned `npm:jspdf`/`npm:openai` pinned and the 2.x jspdf
   cohort aligned on 2.5.2; scheduler-secret comparison made timing-safe and resynced to all 73
   helper consumers. Remaining role-gate inconsistencies that need a product decision are listed
   in the PR discussion.
7. **Policy prep** — public `/privacy` page (draft policy; **needs counsel review**) linked from
   the sign-in footer and Settings; `docs/APP_STORE_SUBMISSION_CHECKLIST.md` covers the App
   Store Connect process items (demo account, privacy labels, 4.8 login-page verification,
   ABM-vs-public decision).

Also fixed en route: `pnpm-lock.yaml` regenerated for the `@base44/sdk ^0.8.40` bump that landed
on `main` without a lockfile update (it broke every `pnpm install --frozen-lockfile` CI job).

Final validation on the combined tree: lint 0 errors, actionlint clean, typecheck clean,
`node --test` 46/46 + backend 82/82, Vitest 417/417, 229 functions transpile, shared helpers in
sync (73 consumers), production build succeeds.
