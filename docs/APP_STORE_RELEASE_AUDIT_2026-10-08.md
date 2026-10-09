# App Store release audit — 2026-10-08

Scope: everything that decides whether the iOS app (`ios/`, a WKWebView shell over
`https://app.caremetricai.com/`) can be submitted as an update to the live App
Store record **CareMetric AI** (Apple ID `6757097720`, bundle `com.caremetric.ai`)
and work once installed. That covers the native shell, the web app it loads,
App Review Guideline exposure, the live store listing, and the repository's own
gates.

## Verdict

**Not ready to submit.** This change fixes eight defects that would have failed
review or broken the installed app (section 2). The remaining blockers are
decisions or account actions only the owner can take: the live in-app
purchases, publishing the frontend, the brand and listing mismatch, the paused
features a reviewer will land on, AI data-sharing consent, and device testing
(section 3). Do not upload a build, including to TestFlight, until each item in
section 3 has current evidence.

Every live reading below is dated. These readings describe the deployment on
that date and can go stale. Re-run the named command before relying on any of
them.

## Owner decisions, 2026-10-08, and what followed

The owner's words, recorded verbatim: "outbound email - release both to
production. password reset - allow. Subscriptions - remove - there should be no
subscriptions. This is only for my own staff to use. clinical features - remove
risk prediction and PDGM payment features. external sign offs - everything has
been signed off. all agreements in place for everything", and later "just setup
me as the super admin of the app for right now and a way for me to add the staff
later / sign ups. This is strictly an invite only app / turn everything on -
including OASIS center or build it".

| Decision | Done in this pull request or in production | Still open |
| --- | --- | --- |
| Release outbound email and SMS | `OUTBOUND_DELIVERY_RELEASE=enabled-v1` set on the production app after a census of every outbound path. | Nothing in the code. |
| Allow password reset | "Forgot password?" sends the platform reset email again (`SignInScreen.jsx`); the owned backend path stays closed. | Reaches users when the frontend is published (B2). |
| No subscriptions, staff only | No purchase code exists in the binary or the web app. | **Owner:** mark the four in-app purchases *Removed from Sale* (B1a). Consider Apple Business Manager distribution (B8). |
| Remove risk prediction and PDGM payment features | Done in this pull request. Predictive Analytics, the Clinical Insights dashboard, Documentation Impact, PDGM Rate Settings, the OASIS Center Revenue tab and the PDGM reimbursement report are gone, and each old path redirects; the AI patient risk scorer, Proactive Clinical Support, the revenue tiles and every payment estimate went with them. PDGM clinical grouping used for coding validation stays. | **Owner:** stop advertising "Predictive Analytics" in the App Store description (B7). |
| Sign-offs and agreements in place | The privacy policy and the AI agreement gate now say business associate agreements cover OpenAI, Anthropic and Google (B5). | Counsel review of the policy text remains good practice. |
| Owner as super admin | The production `User` row is the built-in admin, and `SUPER_ADMIN_EMAIL` is set on the backend and baked into the production build (`publish-production-frontend.yml`). | — |
| A way to add staff later | Invite from **Admin User Setup**; the person registers from the email and `onUserSignup` approves them. Then grant agency access in **User Management → Agency access** (`AgencyAccessPanel.jsx`, owner only), which provisions and activates an `AgencyMembership` with a role pre-selected from the invitation. | — |
| Invite-only | The in-app "Sign up" offer is gone; `onUserSignup` already leaves an uninvited account unapproved and alerts administrators. Social sign-in is off. The app stays *public with login* on purpose: making it private sent `/privacy` and the patient-facing public routes to the hosted login, measured live 2026-10-08. | — |
| Turn everything on, including OASIS Center | Turned on in this pull request, each behind membership and care-team checks rather than editable profile fields: the 44 open, view and print buttons; Messages; Telehealth (schedule, join links, the dashboard widget); Care Plans (management, builder, automatic triggers); duplicate-patient detection and merge; the OASIS AI endpoints; PDF Tools; the dashboard's Time Saved card; Send Feedback; Bulk Discharge Import; the User Activity Report and Nurse Performance; Phone Center call history, callbacks, inbound call routing and scheduled SMS; the provider follow-up portal; the AI KPI, productivity, quality, system-health and compliance dashboards; the AI compliance auditor and admission documentation; the Clinical Pathway Manager; security log review and the security audit; patient education and discharge summaries; document AI analysis; the patient roster import; and reactivating an offboarded user. | Turned on in the follow-up pull request: the OASIS Center (every screen, saving, review, audit, automation and Outcome Measures); electronic signature (requests, the `/signer` portal, sealing, certificates, reminders, in-person and discharge-summary signing); calling or texting a patient from the chart, inbound texts, telehealth vitals, phone analytics and the remaining activity screens; and the AI helpers (message suggestions and summaries, urgent notifications, care plans drafted from a referral, outcome measures, data quality, the agency report and the documentation-compliance monitor). The e-signature consent text is a standard ESIGN/UETA statement set as `SIGNATURE_AGREEMENT_TEXT` on 2026-10-09; **owner:** replace it with your approved wording if it differs (set the text and its SHA-256 together). Every backend change reaches production only when its functions are redeployed (**Deploy production backend functions**) and the frontend is published (B2). |

## 1. What was measured

| Reading (2026-10-08) | How | Result |
| --- | --- | --- |
| Live store record | `curl 'https://itunes.apple.com/lookup?id=6757097720'` | "CareMetric AI", version **1.0**, minimum iOS **15.6**, rated **17+** (advisory: Frequent/Intense Medical/Treatment Information), genres Utilities + Medical, free, **5 iPhone and 0 iPad screenshots**. The description advertises "Predictive Analytics: Identify high-risk patients…" and "Personalized Care Plans". It links its EULA to `https://caremetricai.base44.app/eula`. |
| Live store icon | artwork from the same lookup | A CareMetric AI nurse-and-house icon. The binary's `AppIcon-1024.png` is the gold "PENN Sync" artwork. It is RGB with no alpha (Apple accepts that), but the artwork has its own rounded corners and a white margin, so iOS's mask produces a white frame. |
| Published frontend | `node tools-live-frontend-sync.mjs` | **Drift** on both production origins. The live entry is `index-Cq2uld1D-8cdd1e5d….js`, built from `8cdd1e5d` ("Fix sign-in guidance…", #201, **2026-09-17**). `main` is at #426. Every installed app loads this stale build. |
| Sign-out endpoint | Chromium, navigating as the SDK does | `https://base44.app/api/apps/auth/logout?from_url=<app>` → `302 base44.app/` → **`base44.com` (the platform's marketing site)**. `https://app.caremetricai.com/api/apps/auth/logout?from_url=<app>` → `302` back to the app. |
| Hosted sign-in fallback | same | `https://base44.app/login?from_url=<app>` → **404 `{"message":"App not found"}`**. `https://app.caremetricai.com/login` → 200, the Base44-hosted sign-in, titled **"Welcome to CareMetric AI"**, with email/password only and no social buttons. |
| Dark mode | Chromium, iPhone 13 profile, `colorScheme: 'dark'` | The live sign-in heading "Welcome to Penn**Sync**" renders near-white on a light gradient, and the footer links nearly disappear. |
| Public routes | same, light mode | `/privacy`, `/privacy-policy`, `/privacypolicy` render the policy. **`/eula` and `/support` render the sign-in screen**: there is no EULA page. |

Apple requirements current on this date (secondary sources; confirm on
developer.apple.com before submitting):

- Since **2026-04-28**, uploads, including TestFlight, must be built with
  **Xcode 26+ and the iOS 26 SDK**. The iOS 27 SDK becomes the floor in April
  2027. Xcode 27 is out and runs on Apple silicon only.
- The **revised age-rating questionnaire** (new 13+, 16+ and 18+ bands)
  was due **2026-01-31**. Apple blocks submissions until it is answered.
- Guideline **5.1.2(i)**, revised 2025-11-13: an app must clearly disclose
  where personal data is shared with **third-party AI**, and must get explicit
  permission before sharing it.

## 2. Fixed in this change

| # | Defect | Who it hit | Fix | Proof |
| --- | --- | --- | --- | --- |
| 1 | The SDK's `appBaseUrl` was the shared API host `https://base44.app`, so **every sign-out, every 15-minute idle timeout, and the hosted sign-in fallback** (OTP, email verification, captcha, sign-up) navigated there. | **Web:** sign-out landed on base44.com and the fallback was a 404. **iOS:** the shell hands any off-origin main-frame navigation to Safari, so these actions left the app, and the page stayed in the poisoned post-logout state. | `appBaseUrl` is now the origin the SPA is served from, where Base44 serves `/login` and `/api/apps/auth/logout` (`src/lib/platformAuthBaseUrl.js`). | `platformAuthBaseUrl.spec.js` covers the resolver and pins the constructor argument; it fails when the old line is restored. Section 1 has the live endpoint readings. |
| 2 | `main.jsx` applied the OS dark preference before `Layout` mounts. `Layout` then removed the class but left `color-scheme: dark`. | Every dark-mode user of the sign-in, set-password, privacy and access screens (half-dark, low-contrast UI), and dark native form controls inside the light app. | The app is always light, which matches the decision recorded in `Layout.jsx`. **iOS:** `UIUserInterfaceStyle = Light`, so WKWebView reports light and the status bar uses dark text over the white header. This holds even for the stale live frontend. | Info.plist assertion in `tools-app-store-migration.test.mjs`, which fails under `Automatic`. |
| 3 | `WhisperTranscriber` forced `mimeType: 'audio/webm'`. WebKit before iOS 18.4 has no webm recorder, so the constructor threw. The error showed as **"Microphone access denied"** right after the user had granted access. The other two recorders labelled iOS's mp4 output as webm, and the SOAP backend names the upload from that type. | iPhone and iPad users on iOS 15–18.3: Whisper dictation never recorded. All iOS users: mislabelled uploads. | `src/lib/audioRecordingFormat.js` picks a supported container (webm/opus → webm → mp4) and labels the blob and file name with what the recorder actually produced. | `audioRecordingFormat.spec.js`, plus a source check on all three recorders. |
| 4 | `Info.plist` had no `NSSpeechRecognitionUsageDescription`. WebKit checks for this key itself and denies Web Speech recognition without it. | iOS app: the SmartNote dictation button and the Real-Time Dictation Scribe could never start. | Key added with a specific purpose string. | Info.plist assertion. |
| 5 | Account deletion (Guideline 5.1.1(v)): the dialog promised the request was **"recorded in the security audit log"** and that administrators were notified, then reported "submitted". In fact `logSecurityEvent` deliberately records nothing, and the User read rule hides every built-in admin row from a non-admin, so **nothing reached anyone** for ordinary users. The card also said "Permanently delete… cannot be undone". | Every non-admin user who asked to delete their account. | The flow now does only what it says. It still alerts any administrators the caller can see (and says how many), then gives the user a **pre-filled email to `support@caremetric.ai`**, the established support channel and the one path that reaches a person for every user, plus a Sign out button. Card, dialog and privacy-policy copy updated to match. | `supportContacts.spec.js` fails against the old page. `userDeletionPauseContract.test.js` still passes. |
| 6 | An account created with the sign-in screen's **"Sign up"** has no agency membership, so it stops at an access screen offering only Retry and Sign out. It could be created in the app and never deleted from it. | Self-registered accounts (5.1.1(v)). | A "Request account deletion" link on all three dead-end screens: no agency workspace, pending or deactivated, and not registered. | `UserNotRegisteredError.spec.jsx`. |
| 7 | A 402 from the AI quota asked nurses to **"upgrade your plan"**. No purchase exists in the app, and on iOS a pointer to an off-store purchase is Guideline 3.1.1 exposure. | **Nobody today.** Production aliases `sonner` to `src/lib/tenantSonner.js`, which replaces every toast's text with a generic line. The source string was dormant, and is corrected so it cannot surface if that wrapper is relaxed. | "Your agency has reached its monthly AI usage limit. Please contact your agency administrator." | Lint and component suites. |
| 8 | Native release metadata. `MARKETING_VERSION` was `1.0.0`, which App Store Connect treats as **equal** to the live `1.0` and refuses at upload. The privacy manifest omitted **AudioData** (visit recordings sent for transcription), **PhotosorVideos** (incident photos, Camera Fax), **PhoneNumber** and **PhysicalAddress** (patient charts). The README still said Xcode 15. | The upload itself; the privacy label (Apple rejects understated collection). | Version 1.1.0, enforced by a test that compares against the live 1.0. Manifest additions are asserted. README and `project.yml` state the Xcode 26 floor. The privacy policy now names the third-party AI processors and gives a real contact address. | `tools-app-store-migration.test.mjs`: two new tests, both shown to fail when the change is reverted. Each changed native file is enumerated with a reason, as that test requires. |

This change does **not** reach installed apps on its own. The iOS binary loads
whatever build `app.caremetricai.com` serves, and that build is from 2026-09-17
(section 1). Fixes 1–3 and 5–7 reach users only when the frontend is published,
which is item B2.

## 3. Release blockers — owner actions

### B1. The four live in-app purchases (Guidelines 3.1.1, 3.1.2, 2.1)

**Decided 2026-10-08: path (a), retire them.** The owner's words: "there
should be no subscriptions. This is only for my own staff to use." The App
Store Connect step is the owner's.

The live app sells Monthly ($29.99), Quarterly ($79.99), Semi Annual ($149.99)
and Annual ($264.99) Premium. This binary has **no StoreKit**, and the web app
has no purchase UI. Submitting it as-is removes purchase and restore for any
current subscriber, and App Review will report that it cannot find the
products. Choose one path before submitting:

- **(a) Retire them:** mark each product *Removed from Sale* in App Store
  Connect, handle active auto-renewing subscribers (let them lapse, refund, or
  communicate), and tell App Review in the notes that access is sold to
  agencies under 3.1.3(c), the enterprise-services exception.
- **(b) Keep them:** implement StoreKit 2 purchase, restore, and server-side
  entitlement checks. Auto-renewable subscriptions also require a working
  Terms of Use (EULA) link in the binary and the metadata. There is none today
  (B7).

Check App Store Connect → *Sales and Trends* / *Subscriptions* for active
subscribers first. That number decides how much (a) costs.

### B2. Publish the frontend, then test against it

Merge this change, then dispatch **Deploy production backend functions**
(`.github/workflows/deploy-production-functions.yml`) and **Publish production
frontend (site only)** (`.github/workflows/publish-production-frontend.yml`),
both manual, `main` only, `production` environment. A merge or a secret change
does not redeploy a function: Base44 pulls `main` into the app's stored
source, and each function keeps serving its last deployed code until it is
deployed again (measured 2026-10-09). After both complete,
`node tools-live-frontend-sync.mjs` should exit 0 on both origins. Every device
test in B9 must run after that publish. Testing earlier tests the 2026-09-17
build.

### B3. Name, icon and brand (Guideline 2.3.8)

The device shows **PennSync** (`CFBundleDisplayName`) with the PennSync icon,
and the store record is named **CareMetric AI** with a CareMetric icon. App
Review rejects a home-screen name that does not match the store name. Either:

- rename the listing in App Store Connect (name, subtitle, description,
  keywords, screenshots, promotional text) to PennSync, which is the direction
  the app has gone; or
- change `CFBundleDisplayName`.

The App Store icon comes from the binary, so the listing icon changes either
way. Also rename the Base44 app, so the hosted fallback sign-in page stops
saying "Welcome to CareMetric AI" (Base44 dashboard, outside this repository).
Consider replacing the icon with full-bleed artwork: no baked-in rounded
corners or white margin.

### B4. Paused features a reviewer will land on (Guideline 2.1)

**Status, later on 2026-10-08:** the owner chose to finish them rather than hide
them ("turn everything on"). Every row in the table below is turned on in this
pull request except Sign Document, which is being built with the rest of
electronic signature, and Predictive Analytics, which was removed by the
owner's decision. The open, view and print buttons work, and Forgot password
and Send Feedback send. What follows is the reading that prompted the work and
is kept as a record.

The production build ships these as visible navigation targets that show
technical "paused" or "unavailable" states:

| Feature | What it shows |
| --- | --- |
| Messages | "until v2 tenant, membership, patient, thread, participant, idempotency, and hosted atomicity evidence is approved" |
| Telehealth | Unavailable |
| Care Plans (three pages) | Unavailable |
| Phone Center call history and callbacks | Unavailable |
| Dashboard | The first screen after sign-in shows "Upcoming telehealth schedule unavailable" and "Time Saved: Unavailable / Tenant metrics paused" |
| Other paused pages | Sign Document, PDF Tools, Predictive Analytics, Bulk Discharge Import, User Activity Report, Nurse Performance |
| Forgot password, Send Feedback | "Outbound delivery is paused in this environment." |

Separately, the 46 call sites that open a document, a stored file or an
external reference in a new window do nothing on any platform. This is by
design: `openAuthorityBoundWindow` returns `null` "in this source checkpoint".
The certificate, handout and manual print buttons fail with a generic error
toast. Each certificate screen also has a Download button, which works through
the share sheet and is the route to recommend.

All toast text is also generic in production. `tenantSonner.js` shows only
"Action completed.", "The action could not be completed." and similar lines,
whatever the caller wrote, so a reviewer who hits an error is not told why.
That wrapper is a deliberate cross-tenant containment. Changing it is a design
decision, not a copy fix.

**Choose before submitting:** hide paused destinations from navigation and the
dashboard for the release (and say in the review notes which features are
web-only), or finish them. Shipping them visible risks a 2.1 "incomplete app"
rejection. The App Store description must also stop advertising Predictive
Analytics (`PREDICTIVE_OASIS_ANALYTICS_ENABLED = false`) and Care Plans (paused)
— Guideline 2.3.1.

### B5. Third-party AI consent (Guideline 5.1.2(i))

**Addressed 2026-10-08, by a different route than the one proposed below.** The
gate now shows a distinct "Where your information goes when you use AI" section
naming OpenAI, Anthropic and Google and saying patient information can be
included, and the accept line says the user agrees to it
(`AI_CONTENT_AGREEMENT_DATA_SHARING` in `src/lib/aiContentAgreement.js`). It is
not a fourth acknowledgment, so no version bump or coordinated backend deploy
was needed: the acknowledgments are pinned word for word by the attestation
broker, its status twin and the owned store's contract. The only accepted
attestation in production is the owner's (measured 2026-10-08), so no user is
grandfathered without seeing it. The owner confirmed the business associate
agreements, and the policy and gate now state them. The analysis below is kept
as the record of the alternative.

Patient text, documents and visit audio go to **OpenAI**
(`transcribeAudioWithWhisper`, `transcribeAndGenerateSOAPNote`), **Anthropic**
(`transcribeAndGenerateSOAPNote`) and **Google Gemini** through Base44
`InvokeLLM` (`generateNoteFromRecording`; about 95 production files in `src/` call `InvokeLLM`). The mandatory
AI gate (`AIContentResponsibilityAgreement`) is a *liability* acknowledgment. It
names no provider, does not say data leaves the app, and asks no permission to
share it. This change adds the disclosure to the privacy policy (have counsel
review it), but Apple also requires **explicit permission**, and that belongs in
the gate.

The gate cannot be changed from the client alone.
`base44/functions/acceptAiContentAgreement/entry.ts` hard-codes
`AGREEMENT_VERSION = '1.0'` and the exact acknowledgment strings. Base44
functions deploy separately from merges, so a client-only change would lock
every user out. Ship it as one coordinated release:

1. Add a fourth acknowledgment to both `src/lib/aiContentAgreement.js` and
   the backend's `AGREEMENT_ACKNOWLEDGMENTS`. Suggested wording for counsel:
   *"I understand that when I use an AI-assisted feature, the text, documents,
   images or audio I submit — which may include patient health information — are
   sent to third-party AI providers (currently OpenAI, Anthropic and Google)
   solely to produce the result, and I permit this."* Counsel should also
   confirm a HIPAA business-associate agreement covers each provider. The
   policy's existing Sharing paragraph already claims one for "AI processing",
   and this audit could not verify it.
2. Bump the version to `1.1` on both sides.
3. Deploy the function, confirm it with `pnpm run check:live-functions`, then
   publish the frontend.

Every user re-attests once. Separately, **Settings → AI Features** toggles save
`AIConfiguration` values that no AI feature reads. Remove the toggles or make
them work, because a non-functional privacy-looking control is its own risk.

### B6. Account deletion has to be processed

After fixes 5 and 6, a deletion request arrives as an email at
`support@caremetric.ai`. Someone must own that inbox and complete requests,
with the agency for retained records, within the period the privacy policy
promises. The durable fix is a server-side request broker that records the
request and notifies the agency's `agency_admin` memberships. That is a new
backend capability with its own disposition, not in this change.

Self sign-up: **decided 2026-10-08, invite-only.** The in-app offer is
removed and `onUserSignup` leaves an uninvited account unapproved. The Base44
app stays "Public (login required)" because the private setting also hides the
privacy policy and the public patient routes; an account created on the hosted
page without an invitation still reaches the deletion link (fix 6).

### B7. App Store Connect metadata and forms

- **Version:** 1.1.0 is set. Bump it again for each later submission.
- **iPad:** the binary is universal (`TARGETED_DEVICE_FAMILY: "1,2"`) and the
  listing has **no iPad screenshots**. Provide 13-inch iPad screenshots, or
  make the app iPhone-only.
- **EULA:** the description links `caremetricai.base44.app/eula`, which shows
  the sign-in screen. Use Apple's standard EULA (remove the link), or publish
  counsel-approved terms at a public route. Auto-renewable subscriptions (B1b)
  make a working link mandatory.
- **Privacy nutrition label:** match `PrivacyInfo.xcprivacy` exactly. Declare
  Health; Name; Email Address; Phone Number; Physical Address; Other User
  Contact Info; User ID; Device ID; Product Interaction; Other Usage Data;
  Audio Data; Photos or Videos. Mark all as linked to the user, none as
  tracking, all for App Functionality.
- **Age rating:** complete the revised questionnaire. The current 17+ is an
  old-system rating, and the medical-information answers carry over.
- **App Review notes:** provide a demo account with an **active
  `AgencyMembership` in a synthetic agency**. Without one the reviewer stops at
  "No clinical workspace was opened". Seed it with non-PHI data. Also mention
  the 15-minute idle timeout, the deletion process (B6), that AI output
  requires clinician review, and which features are web-only (B4).
- **Export compliance:** `ITSAppUsesNonExemptEncryption = false` is already
  set.

### B8. Guideline 4.2, minimum functionality

The shell adds downloads with a share sheet, native error and offline
recovery, camera, microphone and speech, and print bridging. It is still a web
wrapper, and Apple reviews wrappers strictly. Two options:

- Distribute to agency staff through **Apple Business Manager** (Custom App),
  as `APP_STORE_SUBMISSION_CHECKLIST.md` already recommends.
- Before a public submission, add a visible native capability: Face ID app
  lock, push notifications, or VisionKit document scanning for Camera Fax.

### B9. Device testing (cannot be done from this repository)

No Mac, Xcode, simulator or device was available. **The Swift sources have not
been compiled in this audit.** Archive with Xcode 26 or newer, then test on a
physical iPhone (iOS 15.x if any are still in the fleet, 17.x, and 18.4 or
later) and an iPad, after B2, with the demo account. Check each of these:

1. **Launch and sign in:** cold launch, wrong password, then the "standard
   sign-in page" fallback. It must stay in the app and return signed in.
2. **Sign out and idle timeout:** both must return to the sign-in screen
   *in the app*, never Safari. Sign in again without a manual reload.
3. **Dark mode on:** status bar readable, all screens light.
4. **Exports:** a CSV export, a PDF export, and a certificate Download, each
   ending in the share sheet. `downloadAuthorityBoundBlob` revokes the object
   URL synchronously after `click()`. Whether WebKit's `WKDownload` has
   already captured the blob by then is the one export risk that only a device
   can answer. If exports fail with "Export Failed", that helper is the place
   to look.
5. **Recording:** SmartNote visit recording (narrative and SOAP), Whisper
   dictation, and Clinical Documentation audio capture, on iOS 15–18.3 (mp4)
   and on 18.4 or later.
6. **Dictation:** the speech-recognition permission prompt appears once and
   the text arrives.
7. **Camera Fax** capture and photo attachment on an incident report.
8. **Network:** airplane mode shows the native "You're offline" screen, and
   Retry recovers.
9. **iPad:** rotation, Split View and Stage Manager resizing, and share-sheet
   and print popover anchoring.
10. **Account deletion:** Settings → Delete My Account opens Mail with the
    pre-filled request.

## 4. Lower-priority findings (recorded, not fixed here)

- `transcribeAudioWithWhisper` relabels every upload as `audio.mp3` before
  sending it to OpenAI, whatever the container. It works today because the
  provider sniffs content. It is a backend change with its own deployment.
- The Whisper recorder reports every start failure as "Microphone access
  denied", including failures that are not permission errors.
- Sonner toasts (`position="top-right"`) take no safe-area offset, so they can
  sit under the status bar or notch in the app.
- iPhone landscape is allowed. At 768 px and wider the desktop sidebar renders
  without left/right safe-area padding.
- `telehealth/SessionCard.jsx` copies a link after an `await`, outside the user
  gesture. WebKit refuses that, and the user sees "copy it manually". Telehealth
  is paused, so this is latent.
- Pull-to-refresh reloads the whole page, and any unsaved form content goes
  with it. Check on a device whether an over-scroll inside a long form can
  trigger it.
- The app switcher snapshot shows PHI. Many clinical apps obscure it when they
  resign active.
- Features and About show an internal roadmap ("Top 25 end-user improvement
  implementation plan", "Next Best Upgrade"), unverifiable claims ("40%+"), and
  messaging that is paused. Security Compliance names the hosting vendor and
  hard-codes "compliant" statuses.
- Admin-facing screens tell the reader to "add a `HEYGEN_API_KEY` to the
  environment's function secrets".
- `UserSettings` "AI Features" carries an "Experimental" badge.
- `ios/README.md` documents the popup and print bridge. The web build no
  longer reaches it, and the README now says so.

## 5. Validation

Commands and results for this branch, against the baseline taken before any
edit, are in the pull request description: `pnpm run lint`, `pnpm run
typecheck:signal`, `pnpm run build`, every `check:*` gate CI blocks on, and
all twelve `test:*` scripts run individually so that no failure can hide the
scripts after it.

## Sources

- [Expo: App Store Connect minimum SDK 26](https://expo.dev/blog/app-store-connect-minimum-sdk-26)
- [Mac Observer: April 2027 SDK requirement](https://www.macobserver.com/news/april-2027-sdk-requirement-five-platforms/)
- [TechCrunch: App Review guidelines and third-party AI (2025-11-13)](https://techcrunch.com/2025/11/13/apples-new-app-review-guidelines-clamp-down-on-apps-sharing-personal-data-with-third-party-ai)
- [Mac Observer: new App Store age ratings](https://www.macobserver.com/news/apple-adds-new-app-store-age-ratings-13-16-and-18/)
- [Blake Crosley: Xcode 27 requirements and deployment targets](https://blakecrosley.com/blog/xcode-27-release)
- Apple's own pages to confirm against: developer.apple.com/app-store/review/guidelines,
  developer.apple.com/news/upcoming-requirements, and
  developer.apple.com/support/offering-account-deletion-in-your-app.
