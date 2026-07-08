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

    /// The hosted app URL — the deployed production frontend. Also the origin
    /// `requestMediaCapturePermission` auto-grants getUserMedia to, so it must
    /// match the origin the shell actually loads. Keep any hosted subpath here:
    /// all same-origin `target=_blank` links, signer links, and telehealth links
    /// are resolved relative to this app base.
    private let appURL = URL(string: "https://caremetricai.base44.app/")!

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
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.navigationDelegate = self
        webView.uiDelegate = self
        view.addSubview(webView)

        webView.load(URLRequest(url: appURL))
    }

    private func isAppURL(_ url: URL) -> Bool {
        guard let appHost = appURL.host,
              let urlHost = url.host else { return false }
        return urlHost.caseInsensitiveCompare(appHost) == .orderedSame
    }

    private func openExternally(_ url: URL) {
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }
}

// MARK: - WKNavigationDelegate (blob export routing + external URL handling)

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

        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        if ["tel", "mailto", "sms"].contains(url.scheme?.lowercased() ?? "") {
            openExternally(url)
            decisionHandler(.cancel)
            return
        }

        if ["http", "https"].contains(url.scheme?.lowercased() ?? ""), !isAppURL(url) {
            openExternally(url)
            decisionHandler(.cancel)
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

// MARK: - WKUIDelegate (camera/mic capture, target=_blank, JS dialogs)

@available(iOS 15.0, *)
extension WebViewController: WKUIDelegate {

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // WKWebView does not create new windows by default. Open same-origin
        // popups (for example in-app generated documents) in the existing web
        // view and send external links to Safari instead of making them no-ops.
        guard navigationAction.targetFrame == nil,
              let url = navigationAction.request.url else { return nil }

        if isAppURL(url) {
            webView.load(URLRequest(url: url))
        } else {
            openExternally(url)
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: "PennSync", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: "PennSync", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermission origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        // Only auto-grant getUserMedia to the app's own origin; anything else
        // (embedded third-party frames) falls back to the default prompt.
        guard let expectedHost = appURL.host,
              let expectedScheme = appURL.scheme else {
            decisionHandler(.prompt)
            return
        }
        let expectedPort = appURL.port ?? (expectedScheme == "http" ? 80 : 443)
        guard origin.host == expectedHost,
              origin.`protocol` == expectedScheme,
              origin.port == expectedPort else {
            decisionHandler(.prompt)
            return
        }
        // iOS has already shown the system camera/microphone permission
        // dialog (driven by the Info.plist usage strings); avoid a second
        // per-page prompt for telehealth, audio recording, and camera fax.
        decisionHandler(.grant)
    }
}
