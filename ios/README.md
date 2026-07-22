# PennSync iOS Shell (WKWebView wrapper)

A native iOS wrapper around the PennSync web app
(`https://caremetricai.base44.app/`). The repo is a frontend-only SPA (see
`AGENTS.md`); this directory holds the complete source + project spec for the
App Store shell. Minimum deployment target: **iOS 15.0**.

## Building

Prerequisites:

- Xcode 15 or newer
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`

Steps:

```sh
cd ios
xcodegen generate      # produces PennSync.xcodeproj from project.yml
open PennSync.xcodeproj
```

Then in Xcode: select the `PennSync` target → *Signing & Capabilities* → pick
your development team (signing style is Automatic), choose a device or
simulator, and build. The bundle identifier defaults to
`com.caremetric.pennsync` (set in `project.yml`); change it there if your
App Store Connect record uses a different one, then re-run
`xcodegen generate`.

## What's here

| File | Purpose |
| --- | --- |
| `project.yml` | XcodeGen spec — app target, iOS 15.0 deployment target, bundle id, marketing version 1.0.0, scheme. |
| `PennSync/AppDelegate.swift` / `PennSync/SceneDelegate.swift` | UIKit lifecycle; a single window whose root is `WebViewController`. |
| `PennSync/WebViewController.swift` | The WKWebView host: navigation policy, downloads, popups/printing, media capture grants, offline recovery, pull-to-refresh. |
| `PennSync/BlobDownloadHandler.swift` | `WKDownloadDelegate` that saves blob CSV/PDF exports to a temp file and presents the iOS share sheet. |
| `PennSync/Info.plist` | Usage strings, scene manifest, launch screen, App-Bound Domains, queried URL schemes. |
| `PennSync/PrivacyInfo.xcprivacy` | Privacy manifest (collected data types; no tracking; no required-reason APIs). |
| `PennSync/Assets.xcassets` | 1024×1024 single-size `AppIcon` and the `LaunchBackground` color (brand `#1F3261`, from `public/manifest.json` `theme_color`). |

## Behavior notes

### App-Bound Domains

`Info.plist` declares `WKAppBoundDomains` (`base44.app`, `base44.com` — bare
domains cover their subdomains, including `caremetricai.base44.app`) and
`WebViewController` sets `limitsNavigationsToAppBoundDomains = true` on the
`WKWebViewConfiguration`. **This is what enables Service Workers inside
WKWebView** — WebKit only exposes them to app-bound web views.

The trade-off is that *main-frame* navigation is limited to the listed
domains. That is safe here because the navigation policy already opens
external `http(s)` main-frame links in Safari, so in-web-view main-frame
navigation never leaves the app domain. Cross-origin **subframes** (for
example Supabase-hosted PDF preview iframes) are not restricted by
app-bound limits and keep working inline; the policy handler also
deliberately `.allow`s all subframe navigations rather than ejecting them
to Safari.

If the frontend ever moves off these domains, update both the plist array
and `appURL` in `WebViewController.swift`.

### Popups and printing

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

### Export compliance

`ITSAppUsesNonExemptEncryption` is `false`: the shell uses only Apple's
system TLS/HTTPS and ships no proprietary encryption code.

## App Store submission

See `docs/APP_STORE_SUBMISSION_CHECKLIST.md` (maintained separately) for the
full submission checklist. The pieces provided here: 1024×1024 marketing icon
(no alpha), privacy manifest, usage strings, launch screen color, and
`MARKETING_VERSION` 1.0.0 in `project.yml`.
