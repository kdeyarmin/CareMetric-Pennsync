# Go-live review — 2026-10-15

Scope: the whole repository at `28984d3` (`main` after PR #469, Direct-AI Wave 1): the
React app, the 302 Base44 functions, the Railway services, the iOS shell, CI and
dependencies. Seven reviews ran in parallel (auth and routing, function
authorization, function correctness, user-facing pages, Railway services, iOS/config/CI,
AI and e-signature). Each finding below was traced in the code. Where this document
says "verified", the fix's test was also run against the old code and failed there.

Baseline before any change: `pnpm run lint` (0 errors, 2 warnings), `pnpm test`
(every suite green, 2,555 component tests), `pnpm run build`, `lint:actions`,
`check:shared-helpers` and `check:backend-transpile` all passed. The bugs below
are behaviors the suites did not exercise.

Out of scope by the owner's instruction: whether PHI may be sent to the AI providers
(BAAs are in place).

## 1. Fixed in this change

| # | Severity | Problem | Effect before the fix | Fix | Proof |
| --- | --- | --- | --- | --- | --- |
| 1 | Critical | `directInvokeLLM` (21 functions) and the integration runtime sent `tool_choice: {type:'tool'}` to `claude-sonnet-5-5` / `claude-opus-5-5`, which reject forced tool choice with a 400 | Every structured AI call would fail with `AI_PROVIDER_REJECTED` once deployed: SmartNote drafting, coverage and grounding, referral analysis/triage/tasks, patient match, supply analysis, AI report, chart and user-guide PDFs, and the runtime's `InvokeLLM`/`ExtractDataFromUploadedFile` | `tool_choice: auto` with one tool, a system instruction, and one more ask when the model answers in prose. `max_tokens` 16000, since thinking counts against it. Provider rejections are logged by status and error type only | New `directInvokeLLMRequestContract.test.js` (fails 6/8 on the old helper); new runtime test |
| 2 | High | `dispatchScheduledSms` claimed a row with an unconditional write | Two overlapping runs could text a patient twice | One compare-and-set on the row as listed (the `smsRowCas` pattern `redriveFailedSms` already uses) | New overlap test, fails on old code |
| 3 | High | Quiet hours failed open for unmapped area codes, and 65 common US codes were missing (445, 917, 702, 313, 615, …) | Scheduled or retried texts could go out at night | Codes added; the two unattended paths allow an unmapped number only while the window is open in every mainland zone. Manual `sendSms` is unchanged | New test, fails on old code |
| 4 | Medium-high | Scheduled signature reminders revoked the signer's link before checking `APP_PUBLIC_URL` and the deadline, and canceled for good on any read error (including a 429) | A signer could be left with no working link and nobody told; reminders lost to transient errors | Pure checks run before revocation; the failure reason says when a link was revoked; non-verdict errors release the claim (up to 5 attempts) | New e-sign runtime test, fails on old code |
| 5 | High | The link interceptor held every `mailto:`/`tel:` click before a workspace exists | "Request account deletion" (App Store 5.1.1(v)) and the sign-in screen's support links did nothing | The central support line and inbox are allowed in that state; everything else still held | New interceptor spec, fails on old code |
| 6 | Medium | `base44/auth/config.jsonc` had `enableGoogleLogin: true` | The next auth-config deploy would turn Google sign-in back on in an invite-only app | Set to `false`, matching the live hosted page | — |
| 7 | High | Referral Intake's provider fax card kept the follow-up engine's "reimbursement" items | Faxes to physicians argued from payment ("largest single driver of the 30-day payment", "Missed high-value comorbidity adjustment"), contrary to the 2026-10-08 decision | Compliance items only, as on the Referral Follow-Up page; Follow-Up Analytics counts the same way | Updated spec, fails on old code |
| 8 | Medium (clinical safety) | `groundNote` verified a note when no verdict said "unsupported", without checking every sentence got one | An empty, short, repeated or substituted verdict list verified unchecked AI-written sentences | Each submitted sentence must get its own verdict, matched by text (repeats once each, any order); anything else fails verification | New `generation.spec.js`, fails on old code |
| 9 | Medium | `matchPatientWithAI` told the model to return `null` for "no match" in a string field | Every no-match referral failed with `AI_RESULT_SCHEMA_MISMATCH` | Empty string instead (both copies, so the pennsync-api parity test holds) | Parity suites green |
| 10 | Medium | `generateNoteFromRecording` made two unused follow-on model calls that could fail the request | A good transcription was discarded and the nurse had to re-record | Both follow-on calls are non-fatal | — |
| 11 | Medium | Layout's approval gate used only the self-editable `is_approved` flag | Staff granted Agency access after a late sign-up waited on "Pending Approval" for an email that never comes | An exact bound membership counts as approval | Component suites green |
| 12 | Medium | Patient Alerts showed legacy AI `risk_score` values and sorted the huddle by them | Removed risk prediction still visible | Not shown, not used to sort; "Readmission Risk" filter removed | — |
| 13 | Medium | Education "Send to Patient" offered email/portal/text but sent nothing | Chart recorded deliveries that never happened | Records a hand-delivered printed copy only, and says so | — |
| 14 | Medium | `opacity-0 group-hover:opacity-100` controls never appear on touch devices (Tailwind v4 wraps `hover:` in `@media (hover:hover)`) | iPhone/iPad users could not rotate or remove camera-fax pages, remove incident photos, or manage folders | Visible by default, hover-revealed only where hover exists; `aria-label`s added | Build emits the variant inside `@media (hover:hover)` |
| 15 | High | The 15-minute idle sign-out lived in page memory | Any reload (an iOS relaunch, pull-to-refresh, a reopened tab) restarted it; an idle tab could sign out an active one | A shared, reload-surviving activity stamp; sign-out on mount when stale; first touch after the deadline signs out. A missing stamp is a fresh session, so this release signs nobody out. A stamp a backwards clock change left in the future is replaced on read, and every sign-in path starts a fresh clock | New spec, fails 6/6 on old code; future-stamp and owned-backend sign-in tests fail on old code |
| 16 | Low-medium | `onUserSignup` took `invitations[0]` and, on an approval-write error, fell through to the uninvited path | Re-invited staff refused as "expired"; invited staff un-approved with a false security alert | Latest-expiring invitation; 500 instead of falling through | Two new tests, fail on old code |
| 17 | Low | Base44 builder note on the 404 page, dead role map in AgencyAccessPanel (the 2 lint warnings), no `noindex` | — | Removed; `noindex, nofollow` added | Lint now has 0 warnings |
| 18 | High | **Owner decision 2026-10-15:** only the super admin sets up new employees; the invitee accepts. `onUserSignup` verified invited emails itself (it read the account's one-time code with the service role), and any Base44 admin, or through `resendInvitationV2` a facility Manager, could invite or resend | Whoever registered first with a pending invitee's address got a verified account | All six invite/resend functions require the super admin, and the UI shows those controls only to them. The invitee completes the emailed verification themselves; `onUserSignup` makes no platform auth call | New tests, including a facility admin refused at invite and resend (fails on old code) |
| 19 | Medium | **Owner decision 2026-10-15:** all patient information and names must be visible. Patient Details showed no name and hid the chart | Wrong-patient risk | The name heads the page and a Patient information card shows every field the existing purpose-bound reads return for the caller's role. The page makes those reads itself, mounted with the page: a card that read for itself re-ran the chart's shared identity check on mount and looped the chart gate | Updated page spec, new formatter spec, new page spec on the real hook (fails on the looping version) |

## 2. Before you merge or deploy this

- **`services/integration-runtime` redeploys when this merges to `main`, without waiting
  for CI** (CLAUDE.md). Fix 1 touches `providers.mjs`, so the runtime's AI fix goes live
  on merge. Its suite passes 294/294.
- The Base44 function fixes reach production only through **Deploy production backend
  functions**, which also publishes the app. Until then production keeps serving the
  old functions, including the Wave 1 helper with the forced `tool_choice`.
- `services/pennsync-api` (the `matchPatientWithAI` port) deploys only after a release
  variable write.
- After publishing, run one live structured AI call per class (for example a SmartNote
  draft and a referral triage) before relying on Wave 1. Every test mocks the provider.

## 3. Needs your decision or action

| Priority | Item | Why it needs you | Recommendation |
| --- | --- | --- | --- |
| High | **Integration runtime `/v1` accepts `SendEmail` from any manager's own token** (`services/integration-runtime/app.mjs`, `runtime.mjs`). The recipient-in-agency check (D98) exists only in `pennsync-api`. | A manager can send up to ~1,000 emails/day from the company's verified sender to any address with a copied browser token. This is a Railway setting plus a code change. | Remove `SendEmail` from `INTEGRATIONS_ALLOWED_OPERATIONS` until `/v1` requires a service credential that only `pennsync-api` holds. Do not release telecom on the runtime before that. |
| High | **`main` is unprotected and the repository is public.** Bot commits land on `main` with no PR (e.g. `e703f3a` changed authorization in 15 functions), and a pushed `.github/ops/function-deploy-request` dispatches a production deploy. | GitHub settings only you can change. | Ruleset on `main` requiring a PR and green CI; required reviewers on the `production` environment; make the repo private unless public is deliberate. |
| High | **Every toast message is replaced with generic text in all builds** (`src/lib/tenantSonner.js`, aliased for `sonner` in `vite.config.js`): successes are silent and all ~570 error toasts read "The action could not be completed." | It guards against one agency's message appearing after a switch to another, which a single-agency deployment does not face, but nurses lose the specific guidance ("Required before generating: Homebound status", "Enter the provider's fax number first") and names. | Let string messages and descriptions through, keep JSX and action callbacks blocked, and dismiss queued toasts on an agency switch. |
| Medium | **The e-signature disclosure promises the signer a copy** (`docs/SIGNATURE_CONSENT_TEXT_2026-10-09.md`), but the signer portal offers no download and only staff are emailed. | Wording or a feature, and the text is pinned by hash. | Offer a one-time download of the sealed PDF on the done screen, or reword the disclosure and rotate the hash. |
| Medium | **AI spend has no server-side cap.** Wave 1 moved 21 functions off platform credits onto the org's `ANTHROPIC_API_KEY`. Several referral/match functions check only that the caller is signed in. | Budget policy. | Require an active membership on every AI function, and add a per-agency daily token budget that returns 402 (the UI already handles 402). |
| Low | **Sonnet 5.5 thinks at `high` effort by default.** Nothing sets `output_config.effort`. | A latency/cost trade-off. | Measure SmartNote and extraction at `medium`/`low` on real notes before changing it. |

## 4. Remaining findings (not fixed here)

### High
- **iOS opens PHI file links in Safari** (`ios/PennSync/WebViewController.swift` popup and main-frame handlers). Document URLs land in Safari history outside the app's logout purge. Use `SFSafariViewController` or the existing download/share path for storage hosts; keep `UIApplication.open` for `tel:`/`sms:`/`mailto:`. `ios/README.md` still calls these flows dormant.
- **`importProvidersCsv` lets an agency admin overwrite the global `Physician` directory** (fax number, email) matched by NPI. A wrong fax number misdirects referral faxes. Gate it to the platform owner, or write an agency overlay.

### Medium
- **App-switcher snapshot shows the chart:** `SceneDelegate.swift` has no cover view on `sceneWillResignActive`.
- **Privacy manifest omits** `NSPrivacyCollectedDataTypeEmailsOrTextMessages` (SMS threads) and `NSPrivacyCollectedDataTypeOtherUserContent` (documents, faxes, signatures).
- **`getVoicemailPlaybackUrl` signs any URI** a caller writes into their own `CallLog` row (CallLog RLS allows self create/update). Make CallLog writes server-only or bind the URI to the row.
- **Patient alerts readers/writers** (`getScopedPatientAlerts`, `updateScopedPatientAlert`, `generateFollowUpTasks`) authorize by `created_by`/`assigned_nurses` email with no membership or care-team check, and `is_active` is self-editable. Use the generated `callerMayAccessPatient`.
- **Inbound calls are routed by a self-editable `work_phone_number`** (`handleTelnyxStatusWebhook`). Resolve the nurse from `TelecomDestinationBinding` as inbound SMS does.
- **PDF tools re-upload chart documents to public storage** (`mergePDFs`, `preparePDFWithPatientInfo`, `saveAnnotatedPDF`, `reorderDeletePDFPages` use `Core.UploadFile`). Use `UploadPrivateFile`.
- **`dispatchScheduledSms` reads agency policy from the self-editable `User.agency_name`** (quiet-hours toggle, `sms_enabled`, monthly cap), and deferred rows can hold the head of its 100-row window. Resolve from the line's agency as `redriveFailedSms` does. A row left in `sending` by a crashed run is never swept.
- **Referral Intake still shows LUPA and "payer strategy" text** (`VisitPlanCard.jsx`, `visitPlanEstimator.js`) and ranks uncoded conditions as "high-value" (`DiagnosisCodeGenerator.jsx`). These are the remaining payment leftovers after fix 7. The same goes for **Clinical Pathway Manager's "Rescores"** tiles and sample pathways "to optimize PDGM grouping".
- **Downloadable manuals describe removed features** ("risk prediction", "Offline mode", "Predictive analytics") in `generateUserManual` and `generateUserGuidePDF` outlines.
- **`pennsync-api` `deliverNotices` sends all staff emails at once on one token**; the runtime admits one or two, the rest 429, and the handler still reports `email: true`. Send sequentially and pass 429 through as retryable. The 30s `pennsync-api` → runtime timeout is shorter than the runtime's 90s model call, so long AI calls fail but are still billed.
- **`pennsync-api` reads whole bodies (up to 20 MiB) before authenticating**; 20 concurrent unauthenticated uploads reached ~1.5 GB RSS locally. Refuse a missing `Authorization` before reading, and cap concurrent large reads.
- **CI supply chain:** `pnpm/action-setup@v6` is pinned by tag in jobs that hold `BASE44_API_KEY` and `SUPABASE_ACCESS_TOKEN`; the Base44 CLI is installed without a lockfile. Pin the action by SHA and lock the CLI.

### Low
- Send buttons that always toast "Outbound delivery is paused in this environment" (`ComplianceCenter`, `ComplianceMonitoringDashboard`, both `PersonalizedEducationGenerator`s, `AdmissionBriefEmailCard`): hide or disable them.
- User roles: "Super Admin" in User Management means the Base44 `admin` role (facility admin in practice). Choosing admin in the invite dialogs does nothing lasting. Label it consistently and drop it from the invite dialogs.
- Admin User Setup shows "No users yet" while loading or on a failed read; facility admins without the Base44 admin role see links that land on Access Denied.
- `app-params.js` keeps an untrusted-referrer `?access_token=` in localStorage indefinitely and logout does not purge it.
- iPhone landscape renders the desktop layout without side safe-area insets. Consider portrait-only on iPhone.
- Pull-to-refresh reloads long forms without an unsaved-changes check.
- `gradeTrainingAttempt` puts free-text answers inside the grading prompt unmarked.
- Features/About pages carry an internal roadmap, "Next Best Upgrade" boxes and marketing copy.
- `pennsync-site` has no SIGTERM handler, and no `.dockerignore` for its root build context.

## 5. Checked and found sound

- Route guards, open redirects, logout cache/storage purge, error boundaries, and no remaining subscription/purchase/sign-up UI.
- Telnyx webhook Ed25519 verification, signer and provider-follow-up token handling, telehealth guest tokens, owner (super-admin) checks, and the Patient/Document/Visit/OASIS brokers.
- The fax jobs, Nightly Outcome Measures and Check Stale Follow-Ups (conditional claims, bounded retries, per-row error isolation), SMS consent enforcement, and every entity field name used by the 302 functions against the schemas.
- Railway services: digest-pinned non-root images, Supabase JWT/session checks, tenant isolation in SQL, `SECURITY DEFINER` with fixed `search_path`, CORS allowlist, no stack traces or secrets in responses, and the site server's static-file allowlist and cache headers.
- No production sourcemaps, `console.*` stripped in production, no service worker, `pnpm audit --prod` has one low, baselined advisory (quill).
- The code side of the 2026-10-08 audit's fixes 1–5, 7 and 8 is in place. Fix 6 (the deletion link on the no-workspace screens) did not work until item 5 above.

## 6. Validation of this change

`pnpm run lint` (0 errors, 0 warnings), `pnpm test` (every suite, including
2,578 component tests), `pnpm run build`, `pnpm run lint:actions`,
`pnpm run check:shared-helpers` and `pnpm run check:backend-transpile` are run
on the final commit; the results are recorded on the pull request.
