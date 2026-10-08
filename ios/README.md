# PennSync iOS Shell (WKWebView wrapper)

A native iOS wrapper around the PennSync web app
(`https://app.caremetricai.com/`). The repo is a frontend-only SPA (see
`AGENTS.md`); this directory holds the complete source + project spec for the
App Store shell. Minimum deployment target: **iOS 15.0**.

## Building

Prerequisites:

- **Xcode 26 or newer.** App Store Connect has refused uploads built with an
  older Xcode or an SDK older than iOS 26 since 2026-04-28 (TestFlight
  included), and the iOS 27 SDK becomes the floor in April 2027. Xcode 27 runs
  on Apple silicon only.
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`

Steps:

```sh
cd ios
xcodegen generate      # produces PennSync.xcodeproj from project.yml
open PennSync.xcodeproj
```

Then in Xcode: select the `PennSync` target → *Signing & Capabilities* → pick
your development team (signing style is Automatic), choose a device or
simulator, and build. The bundle identifier is `com.caremetric.ai` (set in
`project.yml`) and must remain identical to the existing CareMetric AI App
Store record (Apple ID `6757097720`). Do not change it or create a new App
Store Connect record; re-run `xcodegen generate` after intentional project-spec
changes.

## What's here

| File | Purpose |
| --- | --- |
| `project.yml` | XcodeGen spec — app target, iOS 15.0 deployment target, existing CareMetric AI bundle id, marketing version 1.1.0, scheme. |
| `PennSync/AppDelegate.swift` / `PennSync/SceneDelegate.swift` | UIKit lifecycle; a single window whose root is `WebViewController`. |
| `PennSync/WebViewController.swift` | The WKWebView host: navigation policy, downloads, popups/printing, media capture grants, offline recovery, pull-to-refresh. |
| `PennSync/BlobDownloadHandler.swift` | `WKDownloadDelegate` that saves blob CSV/PDF exports to a temp file and presents the iOS share sheet. |
| `PennSync/Info.plist` | Usage strings (camera, microphone, speech recognition, photos), light-only appearance, scene manifest, launch screen, App-Bound Domains, queried URL schemes. |
| `PennSync/PrivacyInfo.xcprivacy` | Privacy manifest (collected data types; no tracking; no required-reason APIs). |
| `PennSync/Assets.xcassets` | 1024×1024 single-size `AppIcon` and the `LaunchBackground` color (brand `#1F3261`, from `public/manifest.json` `theme_color`). |

## Behavior notes

### App-Bound Domains

`Info.plist` declares `WKAppBoundDomains` (`caremetricai.com`, `base44.app`,
`base44.com` — bare domains cover their subdomains, so the first covers
`app.caremetricai.com` and the second covers `caremetricai.base44.app`) and
`WebViewController` sets `limitsNavigationsToAppBoundDomains = true`. This is
retained as a main-frame navigation boundary. The current web frontend
intentionally registers no service worker and has no offline app shell; network
failures are handled by the wrapper's native retry screen.

**All three are listed on purpose; this is the transitional set.** The shell
loads `https://app.caremetricai.com/`, and both Base44 domains stay because
sign-in is still Base44's: `/login` on the app origin is a Base44-served page
today, and the sign-in flow can navigate the main frame to a `base44.app`
address. The list takes up to ten entries, so one binary works either side of
the hosting move and the DNS change needs no second App Store release. Removing
the Base44 entries is a separate release, after the backend exit — see
`docs/HOSTING_EXIT_RUNBOOK.md`.

**Note what the list does NOT do: it keeps nothing in the web view.**
`isAppURL` in `WebViewController.swift` admits only the exact app host, so a
main-frame navigation to `base44.app` is opened in Safari whatever this list
says. Until 2026-10-08 the frontend sent every sign-out (and the 15-minute idle
timeout, and the hosted sign-in fallback) to `https://base44.app/...`, so in the
shell each of them left the app — and on the web the same URLs landed on the
platform's marketing site or a 404. The frontend now sends them to its own
origin (`src/lib/platformAuthBaseUrl.js`), where Base44 serves both. A binary is
only as good as the frontend build the origin serves, so that fix has to be
PUBLISHED before a submission is tested.

The trade-off is that *main-frame* navigation is limited to the listed
domains. That is safe here because the navigation policy already opens
external `http(s)` main-frame links in Safari, so in-web-view main-frame
navigation never leaves the app domain. Cross-origin **subframes** (for
example Supabase-hosted PDF preview iframes) are not restricted by
app-bound limits and keep working inline; the policy handler also
deliberately `.allow`s all subframe navigations rather than ejecting them
to Safari.

If the frontend ever moves off these domains, update both the plist array and
`appURL` in `WebViewController.swift` — and `tools-app-store-migration.test.mjs`,
which byte-pins every file in this directory against a baseline commit and
requires each intended change to be enumerated there with a reason.

### Popups and printing

> **Dormant in the current web build.** Since the authority-bound window
> containment landed, the SPA replaces `window.open`, `window.print` and
> `document.open` with stubs on every platform
> (`src/lib/authorityBoundWindows.js`, installed from `src/main.jsx`), so none of
> the flows below can be reached today — the certificate, handout and manual
> print buttons fail with a generic error toast instead (certificates can still
> be saved with Download, which ends in the share sheet). The native handling
> is kept so those flows work in the shell the day the web side re-enables
> them; see `docs/APP_STORE_RELEASE_AUDIT_2026-10-08.md`.

The web app's receipt/certificate flows call `window.open('', '_blank')`,
`document.write(...)`, then `window.print()`. `createWebViewWith` returns a
real popup web view — created with the exact configuration WebKit passes in,
as WebKit requires — presented modally in a navigation controller with a
**Done** button and a **Print** button that drives
`UIPrintInteractionController` with the popup's `viewPrintFormatter()`.
`window.close()` from the page dismisses the popup.

`window.open(blobURL)` (blob certificate/PDF viewers) is instead routed into
the standard download flow: a throwaway web view on the same configuration
carries the blob navigation, which becomes a `WKDownload` and ends in the
share sheet (Quick Look, save to Files, AirDrop, print).

External `http(s)`, `tel:`, `mailto:`, and `sms:` popups still go to
Safari / the system apps, guarded by `canOpenURL` (schemes declared under
`LSApplicationQueriesSchemes`) with a toast when a link can't be opened on
the device (e.g. `tel:` on an iPad).

### Offline / failure recovery

Failed navigations (`didFailProvisionalNavigation` / `didFail`) show a
native full-screen error view — "You're offline" for connectivity errors,
the error description otherwise — with a Retry button that reloads the
failed URL. Cancelled navigations (`NSURLErrorCancelled`) and
"frame load interrupted" download conversions are ignored. A killed web
content process (`webViewWebContentProcessDidTerminate`) reloads
automatically, and the web view's scroll view has a pull-to-refresh control.

### Media capture

Telehealth video (`VideoRoom.jsx`), visit audio recording
(`VisitAudioRecorder.jsx`, `AudioRecorder.jsx`), and camera fax
(`EnhancedCameraFaxSender.jsx`) call `getUserMedia`. The Info.plist
usage strings drive the one-time system prompt;
`requestMediaCapturePermission` then auto-grants requests from the app's own
origin (default ports normalized — `WKSecurityOrigin.port` reports `0` for
the scheme default) and prompts for any other origin.

### Blob downloads

Every export button builds a `Blob`, calls `URL.createObjectURL`, and clicks
an `<a download>` anchor (`src/lib/downloadCsv.js` and the PDF exporters).
The `decidePolicyFor` → `.download` → `WKDownloadDelegate` chain restores
Safari's behavior and ends in the standard share sheet. Non-renderable
server responses (attachment `Content-Disposition`) become downloads too.
These download branches apply to main-frame navigations only, so inline
blob/PDF preview iframes keep rendering in place.

### Appearance

`UIUserInterfaceStyle` is `Light`. The web app ships one light theme and the
page is drawn under the status bar, so on a dark-mode device the shell would
otherwise draw white status-bar text over the white mobile header, and WKWebView
would report `prefers-color-scheme: dark` to the pre-sign-in screens (measured
2026-10-08: the live sign-in heading renders near-white on a light gradient).

### Dictation

The SmartNote dictation button and the visit Real-Time Dictation Scribe use the
Web Speech API, which WebKit backs with Apple's on-device/server speech
recognizer. WebKit denies every recognition request in an app without
`NSSpeechRecognitionUsageDescription`, so the key is required for dictation to
start at all. Visit audio *recording* (`MediaRecorder`) is separate and needs
only the microphone string; the recorders pick a container the device supports
(`audio/mp4` on iOS before 18.4) via `src/lib/audioRecordingFormat.js`.

### Export compliance

`ITSAppUsesNonExemptEncryption` is `false`: the shell uses only Apple's
system TLS/HTTPS and ships no proprietary encryption code.

## App Store submission

**Read `docs/APP_STORE_RELEASE_AUDIT_2026-10-08.md` first** — it lists the
release blockers that are outside this directory (the live in-app purchases,
the stale published frontend, App Review findings in the web app) — then
`docs/APP_STORE_SUBMISSION_CHECKLIST.md` for the submission steps. The pieces
provided here: 1024×1024 marketing icon (no alpha), privacy manifest, usage
strings, launch screen color, and `MARKETING_VERSION` 1.1.0 in `project.yml`.

`MARKETING_VERSION` must be HIGHER than the last approved version of record
`6757097720` — `1.0` when read on 2026-10-08. App Store Connect compares
component-wise with missing components as zero, so `1.0.0` equals `1.0` and is
refused at upload; `tools-app-store-migration.test.mjs` asserts this. Bump it
again for every later submission.
