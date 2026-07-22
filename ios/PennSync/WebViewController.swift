import UIKit
import WebKit

/// The WKWebView shell that hosts the PennSync SPA.
///
/// Pieces of glue required for feature parity with mobile Safari:
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
///
/// 3. **Popups & printing** — the app's receipt/certificate flows call
///    `window.open('', '_blank')` + `document.write` + `window.print()`, and
///    some viewers `window.open` a `blob:` URL. `createWebViewWith` returns a
///    real popup web view (presented modally with Done/Print chrome) for the
///    former and routes the latter into the download flow.
///
/// 4. **Failure recovery** — network failures show a native retry screen
///    instead of a white page, and a killed web content process reloads.
final class WebViewController: UIViewController {

    /// The hosted app URL — the deployed production frontend. Also the origin
    /// `requestMediaCapturePermission` auto-grants getUserMedia to, so it must
    /// match the origin the shell actually loads. Keep any hosted subpath here:
    /// all same-origin `target=_blank` links, signer links, and telehealth links
    /// are resolved relative to this app base.
    private let appURL = URL(string: "https://caremetricai.base44.app/")!

    private var webView: WKWebView!
    private lazy var downloadHandler = BlobDownloadHandler(presenter: self)

    /// The full-screen native error view shown when a navigation fails.
    private var errorView: UIView?

    /// The URL of the last failed navigation, so Retry reloads the right page.
    private var lastFailedURL: URL?

    /// Throwaway web views created for `window.open(blobURL)` popups. They are
    /// kept alive only until their blob navigation becomes a `WKDownload`.
    private var pendingBlobPopupWebViews = [WKWebView]()

    override func viewDidLoad() {
        super.viewDidLoad()

        let configuration = WKWebViewConfiguration()
        // Play telehealth audio/video inline instead of forcing fullscreen.
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        // Opt in to App-Bound Domains (WKAppBoundDomains in Info.plist lists
        // base44.app / base44.com). This unlocks Service Workers inside the
        // web view. Main-frame navigation is limited to app-bound domains,
        // which is safe here because `decidePolicyFor` already sends external
        // main-frame URLs to Safari; cross-origin subframes (e.g. Supabase
        // storage previews) are unaffected by the restriction.
        configuration.limitsNavigationsToAppBoundDomains = true

        webView = WKWebView(frame: view.bounds, configuration: configuration)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // The SPA uses a fixed-height layout, so force vertical bounce or the
        // pull-to-refresh gesture would never trigger on short pages.
        webView.scrollView.alwaysBounceVertical = true
        webView.navigationDelegate = self
        webView.uiDelegate = self
        view.addSubview(webView)

        let refreshControl = UIRefreshControl()
        refreshControl.addTarget(self, action: #selector(handleRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl

        webView.load(URLRequest(url: appURL))
    }

    private func isAppURL(_ url: URL) -> Bool {
        guard let appHost = appURL.host,
              let appScheme = appURL.scheme,
              let urlHost = url.host,
              let urlScheme = url.scheme else { return false }

        guard urlHost.caseInsensitiveCompare(appHost) == .orderedSame,
              urlScheme.caseInsensitiveCompare(appScheme) == .orderedSame else { return false }

        let appPath = appURL.path.hasSuffix("/") ? appURL.path : (appURL.path + "/")
        return url.path.hasPrefix(appPath)
    }

    private func openExternally(_ url: URL) {
        guard UIApplication.shared.canOpenURL(url) else {
            // e.g. tel: on an iPad with no phone app. The queried schemes are
            // declared under LSApplicationQueriesSchemes in Info.plist.
            showToast("This link can't be opened on this device.")
            return
        }
        UIApplication.shared.open(url, options: [:]) { [weak self] success in
            if !success {
                self?.showToast("This link can't be opened on this device.")
            }
        }
    }

    /// The deepest presented view controller — the safe presenter when a
    /// popup or share sheet is already on screen.
    private func topPresenter() -> UIViewController {
        var top: UIViewController = self
        while let presented = top.presentedViewController {
            top = presented
        }
        return top
    }

    // MARK: - Pull-to-refresh

    @objc private func handleRefresh(_ sender: UIRefreshControl) {
        if webView.url != nil {
            webView.reload()
        } else {
            webView.load(URLRequest(url: appURL))
        }
    }

    // MARK: - Popup windows (document.write print flows)

    /// Presents a modal popup web view for `window.open` calls that need a
    /// real browsing context (blank windows the page writes into, same-origin
    /// child pages). Per WebKit's contract, the returned web view is created
    /// with the exact `WKWebViewConfiguration` handed to `createWebViewWith`.
    private func presentPopup(with configuration: WKWebViewConfiguration) -> WKWebView {
        let popup = PopupWebViewController(configuration: configuration)
        popup.webView.navigationDelegate = self
        popup.webView.uiDelegate = self
        let navigationController = UINavigationController(rootViewController: popup)
        topPresenter().present(navigationController, animated: true)
        return popup.webView
    }

    private func releasePendingBlobWebView(_ webView: WKWebView) {
        guard pendingBlobPopupWebViews.contains(where: { $0 === webView }) else { return }
        // Defer the release so the web view is never deallocated inside one
        // of its own delegate callbacks.
        DispatchQueue.main.async { [weak self] in
            self?.pendingBlobPopupWebViews.removeAll { $0 === webView }
        }
    }

    // MARK: - Native error screen

    private func showErrorView(for error: Error) {
        hideErrorView()

        let nsError = error as NSError
        let offlineCodes = [
            NSURLErrorNotConnectedToInternet,
            NSURLErrorNetworkConnectionLost,
            NSURLErrorDataNotAllowed,
            NSURLErrorCannotFindHost,
            NSURLErrorTimedOut
        ]
        let isOffline = nsError.domain == NSURLErrorDomain && offlineCodes.contains(nsError.code)

        let container = UIView(frame: view.bounds)
        container.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        container.backgroundColor = .systemBackground

        let titleLabel = UILabel()
        titleLabel.text = isOffline ? "You're offline" : "Something went wrong"
        titleLabel.font = .systemFont(ofSize: 22, weight: .semibold)
        titleLabel.textColor = .label
        titleLabel.textAlignment = .center

        let messageLabel = UILabel()
        messageLabel.text = isOffline
            ? "Check your internet connection, then try again."
            : nsError.localizedDescription
        messageLabel.font = .systemFont(ofSize: 15)
        messageLabel.textColor = .secondaryLabel
        messageLabel.textAlignment = .center
        messageLabel.numberOfLines = 0

        var buttonConfiguration = UIButton.Configuration.filled()
        buttonConfiguration.title = "Retry"
        buttonConfiguration.baseBackgroundColor = UIColor(named: "LaunchBackground") ?? .systemBlue
        buttonConfiguration.baseForegroundColor = .white
        buttonConfiguration.cornerStyle = .medium
        buttonConfiguration.contentInsets = NSDirectionalEdgeInsets(
            top: 12, leading: 32, bottom: 12, trailing: 32
        )
        let retryButton = UIButton(configuration: buttonConfiguration, primaryAction: UIAction { [weak self] _ in
            self?.retryLoad()
        })

        let stack = UIStackView(arrangedSubviews: [titleLabel, messageLabel, retryButton])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 12
        stack.setCustomSpacing(28, after: messageLabel)
        stack.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: container.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -32)
        ])

        view.addSubview(container)
        errorView = container
    }

    private func hideErrorView() {
        errorView?.removeFromSuperview()
        errorView = nil
    }

    private func retryLoad() {
        hideErrorView()
        let url = lastFailedURL ?? webView.url ?? appURL
        webView.load(URLRequest(url: url))
    }

    private func handleNavigationFailure(in webView: WKWebView, error: Error) {
        // A failed blob popup navigation just discards its throwaway view.
        releasePendingBlobWebView(webView)
        guard webView === self.webView else { return }
        webView.scrollView.refreshControl?.endRefreshing()

        let nsError = error as NSError
        // Deliberately cancelled navigations (policy .cancel, rapid
        // re-navigation) are not failures.
        if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled { return }
        // "Frame load interrupted" fires when a navigation is converted into
        // a WKDownload; the download proceeds, so this is not a failure.
        if nsError.domain == "WebKitErrorDomain", nsError.code == 102 { return }

        lastFailedURL = (nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL) ?? lastFailedURL
        showErrorView(for: error)
    }

    // MARK: - Toast

    private func showToast(_ message: String) {
        let container = UIView()
        container.backgroundColor = UIColor.black.withAlphaComponent(0.8)
        container.layer.cornerRadius = 12
        container.alpha = 0
        container.translatesAutoresizingMaskIntoConstraints = false

        let label = UILabel()
        label.text = message
        label.font = .systemFont(ofSize: 14, weight: .medium)
        label.textColor = .white
        label.textAlignment = .center
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(label)

        view.addSubview(container)
        NSLayoutConstraint.activate([
            label.topAnchor.constraint(equalTo: container.topAnchor, constant: 10),
            label.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -10),
            label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 16),
            label.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -16),
            container.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            container.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            container.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, multiplier: 0.85)
        ])

        UIView.animate(withDuration: 0.25) {
            container.alpha = 1
        } completion: { _ in
            UIView.animate(withDuration: 0.25, delay: 2.0, options: []) {
                container.alpha = 0
            } completion: { _ in
                container.removeFromSuperview()
            }
        }
    }
}

// MARK: - WKNavigationDelegate (blob export routing + external URL handling)

extension WebViewController: WKNavigationDelegate {

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        // A nil targetFrame means a new window; treat it like the main frame.
        // Subframe navigations (e.g. Supabase-hosted PDF preview iframes,
        // inline blob: preview iframes) must stay inside the web view, so the
        // download and external-open branches below apply only to the main
        // frame.
        let isMainFrameNavigation = navigationAction.targetFrame?.isMainFrame != false

        // Anchor clicks carrying a `download` attribute (downloadCsv.js and
        // the PDF exporters) set `shouldPerformDownload`; blob: URLs are also
        // caught explicitly for older export paths that navigate directly.
        if isMainFrameNavigation,
           navigationAction.shouldPerformDownload
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

        if isMainFrameNavigation,
           ["http", "https"].contains(url.scheme?.lowercased() ?? ""), !isAppURL(url) {
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
        // If this was a `window.open(blobURL)` popup, the throwaway web view
        // that hosted the navigation has served its purpose.
        releasePendingBlobWebView(webView)
    }

    func webView(
        _ webView: WKWebView,
        navigationResponse: WKNavigationResponse,
        didBecome download: WKDownload
    ) {
        download.delegate = downloadHandler
        releasePendingBlobWebView(webView)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === self.webView else { return }
        webView.scrollView.refreshControl?.endRefreshing()
        hideErrorView()
        lastFailedURL = nil
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        handleNavigationFailure(in: webView, error: error)
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        handleNavigationFailure(in: webView, error: error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // The web content process was killed (memory pressure, crash).
        // Reload instead of leaving a permanently blank view.
        guard webView === self.webView else { return }
        webView.reload()
    }
}

// MARK: - WKUIDelegate (camera/mic capture, target=_blank, JS dialogs)

extension WebViewController: WKUIDelegate {

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard navigationAction.targetFrame == nil else { return nil }

        let url = navigationAction.request.url
        let scheme = url?.scheme?.lowercased() ?? ""

        // tel:/mailto:/sms: links opened with target=_blank still go to iOS.
        if let url = url, ["tel", "mailto", "sms"].contains(scheme) {
            openExternally(url)
            return nil
        }

        // External sites keep opening in Safari.
        if let url = url, ["http", "https"].contains(scheme), !isAppURL(url) {
            openExternally(url)
            return nil
        }

        // Blob object URLs (certificate/PDF viewers that `window.open` a
        // blob) only resolve inside this page's WebKit processes, so give
        // WebKit a throwaway web view built on the configuration it handed
        // us. `decidePolicyFor` then converts the blob navigation into a
        // WKDownload that ends in the share sheet (view, save, print).
        if scheme == "blob" {
            let blobWebView = WKWebView(frame: .zero, configuration: configuration)
            blobWebView.navigationDelegate = self
            pendingBlobPopupWebViews.append(blobWebView)
            return blobWebView
        }

        // Everything else — same-origin child windows and the blank
        // `window.open('', '_blank')` + document.write receipt/print flows —
        // gets a real popup window with Done/Print chrome so those pages can
        // render and print. WebKit requires the returned web view to use the
        // configuration passed to this method.
        return presentPopup(with: configuration)
    }

    func webViewDidClose(_ webView: WKWebView) {
        // `window.close()` from a popup (print flows close themselves).
        guard webView !== self.webView else { return }
        var controller = presentedViewController
        while let current = controller {
            if let navigationController = current as? UINavigationController,
               let popup = navigationController.viewControllers.first as? PopupWebViewController,
               popup.webView === webView {
                current.dismiss(animated: true)
                return
            }
            controller = current.presentedViewController
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: "PennSync", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        topPresenter().present(alert, animated: true)
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
        topPresenter().present(alert, animated: true)
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
        // WKSecurityOrigin.port is 0 when the origin uses its scheme's
        // default port (https://host reports 0, not 443), so normalize
        // before comparing.
        let originPort = origin.port == 0
            ? (origin.`protocol` == "http" ? 80 : 443)
            : origin.port
        guard origin.host == expectedHost,
              origin.`protocol` == expectedScheme,
              originPort == expectedPort else {
            decisionHandler(.prompt)
            return
        }
        // iOS has already shown the system camera/microphone permission
        // dialog (driven by the Info.plist usage strings); avoid a second
        // per-page prompt for telehealth, audio recording, and camera fax.
        decisionHandler(.grant)
    }
}

// MARK: - Popup window controller

/// Hosts a popup web view created by `window.open` (document.write receipt /
/// certificate print flows, same-origin child windows) behind a navigation
/// bar with Done and Print buttons.
private final class PopupWebViewController: UIViewController {

    let webView: WKWebView

    init(configuration: WKWebViewConfiguration) {
        // WebKit requires the popup web view to be created with the exact
        // configuration passed to `createWebViewWith` (shared process pool
        // and data store), or it crashes with an invalid-configuration
        // exception.
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        webView.frame = view.bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(webView)

        navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .done,
            target: self,
            action: #selector(doneTapped)
        )
        let printButton = UIBarButtonItem(
            image: UIImage(systemName: "printer"),
            style: .plain,
            target: self,
            action: #selector(printTapped(_:))
        )
        printButton.accessibilityLabel = "Print"
        navigationItem.rightBarButtonItem = printButton
    }

    @objc private func doneTapped() {
        dismiss(animated: true)
    }

    @objc private func printTapped(_ sender: UIBarButtonItem) {
        let printInfo = UIPrintInfo(dictionary: nil)
        printInfo.outputType = .general
        let title = webView.title ?? ""
        printInfo.jobName = title.isEmpty ? "PennSync" : title

        let printController = UIPrintInteractionController.shared
        printController.printInfo = printInfo
        printController.printFormatter = webView.viewPrintFormatter()
        // Present from the bar button so the iPad popover anchors correctly.
        _ = printController.present(from: sender, animated: true, completionHandler: nil)
    }
}
