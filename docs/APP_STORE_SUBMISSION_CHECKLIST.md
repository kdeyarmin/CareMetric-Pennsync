# Apple App Store Submission Checklist — PennSync iOS

Companion to `docs/BASE44_APPSTORE_COMPAT_REVIEW_2026-07-22.md` (§5) and `ios/README.md`.

> **Start with `docs/APP_STORE_RELEASE_AUDIT_2026-10-08.md`.** It records what was
> measured on that date (the live listing, the stale published frontend, the
> broken sign-out and hosted sign-in URLs) and lists the release blockers B1–B9
> in the order they have to be cleared. Where it and this checklist disagree,
> the dated audit is the newer reading.
Some code-side foundations are present; the items below include the repository gaps and App
Store Connect/process steps that must be resolved before another native submission.

> Existing-listing correction (verified 2026-09-03): CareMetric AI is already live as
> Apple ID `6757097720` with four in-app purchases. This repository does not contain the
> original purchase-entitlement implementation or complete signing projects. Do not generate
> or upload a replacement IPA/AAB until those assets and the existing store configuration are
> recovered and verified.

## No-native-upload gate

> **STOP:** No new IPA or AAB may be uploaded to App Store Connect or Google
> Play, including TestFlight or Play testing tracks, until every gate below has
> current evidence.

- [ ] **Apple and Google privacy disclosures.** Reconcile App Store privacy
      labels, Google Play Data safety, and `ios/PennSync/PrivacyInfo.xcprivacy`
      with the app's actual web and native data handling.
- [ ] **Signing/distribution continuity.** These are two different problems and
      they were one bullet until 2026-10-01, which had a reader chasing the wrong
      thing on iOS.

      **iOS: nothing cryptographic needs recovering.** The App Store re-signs
      every upload for distribution, so a distribution certificate is reissued
      rather than recovered, and `ios/project.yml` already uses
      `CODE_SIGN_STYLE: Automatic`. What makes an upload an UPDATE rather than a
      new app is an identity, not a key: the Apple team plus the bundle id
      `com.caremetric.ai`, which `ios/project.yml` pins and
      `tools-app-store-migration.test.mjs` asserts. Apple's public record for
      ID 6757097720 gives the seller as the repository owner (read 2026-10-01
      from `itunes.apple.com/lookup`), so the record is on his own account and no
      App Store Connect app transfer is involved. What that reading does NOT
      establish, and one sign-in would: whether the Developer Program membership
      is current and the account credentials are to hand.

      **Android: the original wording holds, and only here.** Google signing /
      Play App Signing continuity for `com.caremetic.ai` must be recovered, not
      substituted — with no Play App Signing enrolment, a lost app signing key
      ends the listing's update path and users would have to reinstall. Whether
      that enrolment exists is **unmeasured from this repository**: there is no
      `android/` directory here at all, so nothing in the tree can answer it.

      `docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md` **contradicts itself about this,
      two hundred lines apart**, which is a different defect from carrying the
      error. The sentence beginning "App Signing for `com.caremetic.ai` must be
      RECOVERED, not regenerated" puts both platforms under Android's
      consequence, while the Stage L row beginning "Recover Android signing, and
      Apple **account** access" already carries the correction, dated 2026-09-22
      and citing `docs/MOBILE_RECOVERY_RUNBOOK_2026-09-22.md`. So the fix there is
      to narrow the earlier sentence and point it at the dated row — not to state
      the correction a third time. That belongs to that document's next change;
      read it by those two anchors rather than by line number, which moves.
- [ ] **IAP/billing continuity.** Reconcile the existing Apple in-app purchases
      and any Google billing configuration with product IDs, purchase/receipt
      validation, restore behavior, entitlements, and server state.
- [ ] **Physical iOS and Android devices.** Using non-PHI test data, verify
      permanent-origin launch and login, deep links, camera/microphone,
      downloads/sharing, idle timeout and logout, network loss/recovery, and
      purchase/restore behavior.

## Before next native submission

- [ ] **Distribution route decision (Guideline 4.2).** PennSync is a workforce clinical tool.
      Recommended: distribute via **Apple Business Manager** (unlisted app or custom app for the
      agency) rather than the public App Store — 4.2 "web wrapper" scrutiny is far lower and the
      audience is the agency's staff anyway. If public listing is required, consider adding a
      visible native capability first (push notifications, Face ID app-lock, VisionKit document
      scanning).
- [ ] **Verify the hosted login page has no third-party login buttons (Guideline 4.8).** Open
      `<VITE_BASE44_BACKEND_URL>/login` for the production app in a browser. The in-app
      sign-in is first-party email/password, but the platform-hosted fallback page is configured
      in the Base44 dashboard, outside this repo. If a "Continue with Google" (or similar) button
      appears there: either disable it for this app in the Base44 dashboard, or Sign in with
      Apple must be added. (Checked 2026-07-22 from the app origin: `/login` serves the SPA
      itself, no third-party buttons — but re-verify on the real backend origin before
      submitting.)
- [ ] **Privacy policy URLs.** The canonical in-app policy lives at `/privacy`.
      The source now defines public no-login aliases at `/privacy-policy` (the
      intended hyphenated compatibility route) and `/privacypolicy` (the existing
      store-linked route). Verify all three on the staged permanent origin before
      release. **Have counsel review the draft text before submission.**
- [ ] **EULA URL.** The live Apple metadata currently points at `/eula`, but this
      repository has no approved in-app EULA route. A separate external page is
      present at `https://caremetricai.com/eula`, but it remains unverified as
      approved governing terms for the installed apps. Do not copy, route, or
      submit it until the owner and counsel approve its exact text and
      applicability.
- [ ] **Existing IAP continuity.** Reconcile the four live products (Monthly `$29.99`, Quarterly
      `$79.99`, Semi Annual `$149.99`, Annual `$264.99`) with their product IDs, receipt/entitlement
      validation, restore-purchase flow, and server-side subscription state. None of that native
      implementation is present in this repository.
- [ ] **Privacy nutrition labels.** Declare (all "linked to identity", none used for tracking):
  - Health & Fitness → Health (patient clinical data processed in-app)
  - Contact Info → Name, Email Address, Phone Number, Physical Address, Other User Contact Info
  - User Content → Audio Data (visit recordings sent for transcription), Photos or Videos
    (incident photos, Camera Fax)
  - Identifiers → User ID, Device ID
  - Usage Data → Product Interaction (audit trails), Other Usage Data
  - Sensitive Info (if patient SSN/insurance data is entered by your agency)
      The bundled `ios/PennSync/PrivacyInfo.xcprivacy` mirrors these; keep both in sync.
- [ ] **App Review notes.** Provide:
  - A **demo account** seeded with non-PHI sample data (create a dedicated demo agency; never
    real patient data). Include role and credentials.
  - Note the **15-minute idle timeout** so reviewers aren't surprised by re-login.
  - State the **account-deletion rationale**: deletion is request-based because clinical records
    are subject to mandatory medical-record retention (HIPAA/state law); the request is audited,
    admins are notified, and the account is deactivated — this satisfies 5.1.1(v) for regulated
    data.
  - State that **AI-generated clinical content requires clinician review** before use (the app
    enforces an acknowledgment gate) — relevant to medical-app review (1.4.1).
- [ ] **Export compliance**: `ITSAppUsesNonExemptEncryption = false` is already set (HTTPS
      only) — answer the App Store Connect questions accordingly.
- [ ] **Age rating**: complete Apple's REVISED questionnaire (13+/16+/18+ bands, due
      2026-01-31; submissions are blocked until it is answered). The live 17+ is an
      old-system rating; the medical-information answers carry over.
- [ ] **App icon**: `ios/PennSync/Assets.xcassets` ships a generated 1024px icon. Replace with
      the official brand icon before submission if a higher-fidelity source than
      `public/icons/icon-512.png` exists.

## Build-time (see ios/README.md for the full flow)

- [ ] Use **Xcode 26 or newer** — App Store Connect refuses older builds since 2026-04-28.
- [ ] `xcodegen generate` in `ios/`, open the project, set the signing team.
- [ ] `MARKETING_VERSION` must be HIGHER than the live version (`1.0` on 2026-10-08;
      `1.0.0` counts as equal and is refused). It is `1.1.0`; bump it for each later
      submission. `tools-app-store-migration.test.mjs` enforces this.
- [ ] Archive → distribute via App Store Connect.

## After any submission

- [ ] Keep the privacy policy, nutrition labels, and `PrivacyInfo.xcprivacy` in sync whenever a
      new data type or SDK is added (notably if push notifications or analytics are introduced).
- [ ] If Sign in with Apple ever becomes required (third-party login added), implement it via
      `ASWebAuthenticationSession` — OAuth redirects inside the WKWebView shell will not work.
