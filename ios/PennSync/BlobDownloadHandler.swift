import UIKit
import WebKit
import UniformTypeIdentifiers

/// WKDownloadDelegate for PennSync's client-side file exports.
///
/// The web app has ~50 export paths (CSV via `src/lib/downloadCsv.js`, PDF
/// exports, QAPI/report downloads, …) that all follow the same pattern:
/// build a `Blob`, call `URL.createObjectURL(blob)`, and click a temporary
/// `<a download="filename">` anchor. Safari handles that natively, but a bare
/// WKWebView silently drops the navigation, so every export button would be a
/// no-op in the iOS shell.
///
/// `WebViewController` converts those blob navigations into a `WKDownload`
/// (iOS 14.5+) and hands them here. This delegate:
///   1. Streams the blob to a unique temp file, preserving the `download`
///      attribute filename WebKit surfaces via `suggestedFilename`.
///   2. On completion, presents the standard iOS share sheet so the user can
///      save to Files, AirDrop, print, or open the CSV/PDF in another app.
final class BlobDownloadHandler: NSObject, WKDownloadDelegate {

    /// The view controller used to present the share sheet.
    private weak var presenter: UIViewController?

    /// Destination URLs keyed by download, so we know what to share on finish.
    private var destinations = [WKDownload: URL]()

init(presenter: UIViewController) {
    self.presenter = presenter
    super.init()
}

    // MARK: - WKDownloadDelegate

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        // `suggestedFilename` carries the anchor's `download="…"` attribute
        // (e.g. `report_2026-06.csv`). Sanitize it and keep each download in
        // its own temp directory so repeated exports never collide.
        let safeName = sanitize(filename: suggestedFilename, response: response)
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("exports", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)

        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            completionHandler(nil)
            return
        }

        let destination = directory.appendingPathComponent(safeName)
        destinations[download] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let fileURL = destinations.removeValue(forKey: download) else { return }
        presentShareSheet(for: fileURL)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let fileURL = destinations.removeValue(forKey: download) {
            try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent())
        }
        presentError(error)
    }

    // MARK: - Helpers

    /// Strips path separators and falls back to a typed default name when the
    /// export produced no usable filename.
    private func sanitize(filename: String, response: URLResponse) -> String {
var name = (filename as NSString).lastPathComponent
    .replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "\\", with: "_")
    .trimmingCharacters(in: .whitespacesAndNewlines)

if name.isEmpty || name == "_" || name == "." || name == ".." {
    name = "export"
}
        // Blob exports always set a MIME type (text/csv, application/pdf, …);
        // make sure the saved file keeps a matching extension so the share
        // sheet and Files app treat it correctly.
        if (name as NSString).pathExtension.isEmpty,
           let mimeType = response.mimeType,
           let utType = UTType(mimeType: mimeType),
           let ext = utType.preferredFilenameExtension {
            name += ".\(ext)"
        }

        return name
    }

    /// The deepest presented view controller reachable from `presenter`, so
    /// sheets still appear when a popup window or another modal is on screen
    /// (downloads can start from the popup web views too).
    private func topPresenter() -> UIViewController? {
        guard var top = presenter else { return nil }
        while let presented = top.presentedViewController {
            top = presented
        }
        return top
    }

    private func presentShareSheet(for fileURL: URL) {
        guard let presenter = topPresenter() else { return }

        let activity = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        // iPad requires a popover anchor.
        activity.popoverPresentationController?.sourceView = presenter.view
        activity.popoverPresentationController?.sourceRect = CGRect(
            x: presenter.view.bounds.midX,
            y: presenter.view.bounds.midY,
            width: 0,
            height: 0
        )
        activity.completionWithItemsHandler = { _, _, _, _ in
            // Clean up the temp copy once the user is done with it.
            try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent())
        }
        presenter.present(activity, animated: true)
    }

    private func presentError(_ error: Error) {
        guard let presenter = topPresenter() else { return }
        let alert = UIAlertController(
            title: "Export Failed",
            message: "The file could not be downloaded. \(error.localizedDescription)",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        presenter.present(alert, animated: true)
    }
}
