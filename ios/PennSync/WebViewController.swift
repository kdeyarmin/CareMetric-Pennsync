import UIKit
import WebKit

/// The WKWebView shell that hosts the PennSync SPA.
///
/// Two pieces of glue are required for feature parity with mobile Safari:
///
/// 1. **Media capture** — telehealth video visits
///    (`src/components/telehealth/VideoRoom.jsx`), visit audio recording
///    (`src/components/smartNote/VisitAudioRecorder.jsx`,
///    `src/components/visit/AudioRecorder.jsx`), and the camera-fax scanner
///    (`src/components/fax/EnhancedCameraFaxSender.jsx`) all call
///    `getUserMedia`. The Info.plist `NSCameraUsageDescription` /
///    `NSMicrophoneUsageDescription` strings let iOS show its permission
///    prompt; `requestMediaCapturePermission` below then grants the page's
///    request without a second, redundant in-app prompt.
///
/// 2. **Blob downloads** — the ~50 CSV/PDF export buttons create
///    `blob:` object URLs and click a hidden `<a download>` anchor. Plain
///    WKWebView ignores those navigations, so `decidePolicyFor` routes them
///    into a `WKDownload` handled by `BlobDownloadHandler`.
final class WebViewController: UIViewController {

    /// The hosted app URL. Point this at the deployed PennSync frontend.
    private let appURL = URL(string: "https://pennsync.example.com")!

    private var webView: WKWebView!
    private lazy var downloadHandler = BlobDownloadHandler(presenter: self)

    override func viewDidLoad() {
        super.viewDidLoad()

        let configuration = WKWebViewConfiguration()
        // Play telehealth audio/video inline instead of forcing fullscreen.
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        webView = WKWebView(frame: view.bounds, configuration: configuration)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        view.addSubview(webView)

        webView.load(URLRequest(url: appURL))
    }
}

// MARK: - WKNavigationDelegate (blob export routing)

extension WebViewController: WKNavigationDelegate {

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        // Anchor clicks carrying a `download` attribute (downloadCsv.js and
        // the PDF exporters) set `shouldPerformDownload`; blob: URLs are also
        // caught explicitly for older export paths that navigate directly.
        if navigationAction.shouldPerformDownload
            || navigationAction.request.url?.scheme == "blob" {
            decisionHandler(.download)
            return
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        // Server responses that can't be rendered (e.g. attachment
        // Content-Disposition from backend fax/report endpoints) also become
        // downloads instead of dead-end navigations.
        if !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
            return
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        navigationAction: WKNavigationAction,
        didBecome download: WKDownload
    ) {
        download.delegate = downloadHandler
    }

    func webView(
        _ webView: WKWebView,
        navigationResponse: WKNavigationResponse,
        didBecome download: WKDownload
    ) {
        download.delegate = downloadHandler
    }
}

// MARK: - WKUIDelegate (camera/mic capture for telehealth, audio, camera-fax)

@available(iOS 15.0, *)
extension WebViewController: WKUIDelegate {

    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermission origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        // Only auto-grant getUserMedia to the app's own origin; anything else
        // (embedded third-party frames) falls back to the default prompt.
        guard origin.host == appURL.host else {
            decisionHandler(.prompt)
            return
        }
        // iOS has already shown the system camera/microphone permission
        // dialog (driven by the Info.plist usage strings); avoid a second
        // per-page prompt for telehealth, audio recording, and camera fax.
        decisionHandler(.grant)
    }
}
