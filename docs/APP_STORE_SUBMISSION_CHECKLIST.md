# Apple App Store Submission Checklist — PennSync iOS

Companion to `docs/BASE44_APPSTORE_COMPAT_REVIEW_2026-07-22.md` (§5) and `ios/README.md`.
Code-side items are implemented in the repo; the items below are the App Store Connect /
process steps that cannot be done from code.

## Before first submission

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
- [ ] **Privacy policy URL.** The in-app policy now lives at `/privacy` (public route,
      `src/pages/PrivacyPolicy.jsx`). Enter `https://<app-domain>/privacy` as the Privacy Policy
      URL in App Store Connect. **Have counsel review the draft text before submission.**
- [ ] **Privacy nutrition labels.** Declare (all "linked to identity", none used for tracking):
  - Health & Fitness → Health (patient clinical data processed in-app)
  - Contact Info → Name, Email Address
  - Identifiers → User ID
  - Usage Data → Product Interaction (audit trails)
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
- [ ] **Age rating**: 17+/medical is typical for clinical tools; complete the questionnaire.
- [ ] **App icon**: `ios/PennSync/Assets.xcassets` ships a generated 1024px icon. Replace with
      the official brand icon before submission if a higher-fidelity source than
      `public/icons/icon-512.png` exists.

## Build-time (see ios/README.md for the full flow)

- [ ] `xcodegen generate` in `ios/`, open the project, set the signing team.
- [ ] Bump `CFBundleShortVersionString`/build number.
- [ ] Archive → distribute via App Store Connect.

## After any submission

- [ ] Keep the privacy policy, nutrition labels, and `PrivacyInfo.xcprivacy` in sync whenever a
      new data type or SDK is added (notably if push notifications or analytics are introduced).
- [ ] If Sign in with Apple ever becomes required (third-party login added), implement it via
      `ASWebAuthenticationSession` — OAuth redirects inside the WKWebView shell will not work.
