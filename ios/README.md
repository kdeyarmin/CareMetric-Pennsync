# PennSync iOS Shell (WKWebView wrapper)

Sources for a native iOS wrapper around the PennSync web app. The repo is a
frontend-only SPA (see `AGENTS.md`), so this directory holds only the Swift /
plist glue that a WKWebView shell needs beyond what a stock Xcode "App"
template provides — it is **not** a complete Xcode project.

## What's here

| File | Purpose |
| --- | --- |
| `PennSync/Info.plist` | App Info.plist including the **camera/microphone usage strings** required for telehealth video visits, visit audio recording (SmartNote/Whisper), and the Camera Fax document scanner. iOS refuses `getUserMedia` (and App Store review rejects the binary) without `NSCameraUsageDescription` / `NSMicrophoneUsageDescription`. |
| `PennSync/BlobDownloadHandler.swift` | `WKDownloadDelegate` that receives the app's **blob CSV/PDF exports** (~50 call sites funnel through `src/lib/downloadCsv.js` and the PDF exporters), saves them to a temp file with the anchor's `download` filename, and presents the iOS share sheet. |
| `PennSync/WebViewController.swift` | The WKWebView host. Routes `blob:` / `shouldPerformDownload` navigations into `WKDownload`, forwards non-renderable responses to the download handler, and grants in-page `getUserMedia` requests for the app's own origin via `requestMediaCapturePermission`. |

## Integration

1. In Xcode (15+), create a new **iOS App** target named `PennSync`
   (UIKit lifecycle or a SwiftUI `App` that hosts `WebViewController` in a
   `UIViewControllerRepresentable`). Minimum deployment target **iOS 14.5**
   (`WKDownload` requirement); iOS 15+ recommended for
   `requestMediaCapturePermission`.
2. Replace the generated `Info.plist` with `PennSync/Info.plist` (or merge the
   `NS*UsageDescription` keys into your existing plist).
3. Add `WebViewController.swift` and `BlobDownloadHandler.swift` to the target.
4. Set `appURL` in `WebViewController.swift` to the deployed PennSync frontend
   origin.

## Why this glue is needed

- **Camera/mic:** WKWebView surfaces `getUserMedia` only when the Info.plist
  usage strings exist. Without them, telehealth (`VideoRoom.jsx`), audio
  recording (`VisitAudioRecorder.jsx`, `AudioRecorder.jsx`,
  `WhisperTranscriber.jsx`), and camera fax (`EnhancedCameraFaxSender.jsx`)
  crash or silently fail inside the shell.
- **Blob downloads:** every export button builds a `Blob`, calls
  `URL.createObjectURL`, and clicks an `<a download>` anchor
  (`src/lib/downloadCsv.js`). Safari downloads it; a bare WKWebView drops the
  navigation entirely. The `decidePolicyFor` → `.download` →
  `WKDownloadDelegate` chain restores that behavior and ends in the standard
  share sheet (Files, AirDrop, print, open-in).
