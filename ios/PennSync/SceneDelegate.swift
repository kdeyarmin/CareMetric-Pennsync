import UIKit

/// Creates the single window with `WebViewController` as a plain root.
/// The web view controller presents its own modals (share sheets, popup
/// print windows, alerts), so no surrounding navigation chrome is needed.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = WebViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}
