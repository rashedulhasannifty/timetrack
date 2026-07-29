import Foundation

/// Wraps the system notifier for the DISTRACTION nudge only. It posts a normal local notification
/// when macOS has authorized notifications, and falls back to a dismissible in-app window when it
/// has NOT (e.g. an un-notarized dev build the OS refuses to register) — so the nudge is never
/// silently dropped. Only the distraction path uses this; the idle / forgot-to-start / end-of-day
/// nudges keep the plain notifier and its documented silent-drop behaviour.
///
/// It conforms to `LocalNotifying` so `DistractionMonitor` stays unchanged and UI-free — the
/// monitor still just calls `notify(id:title:body:)` once per streak, and the authorized-vs-window
/// decision lives here. The strings it forwards are the generic, category-derived nudge title/body
/// the monitor produced — never an app name, host, or window title (CLAUDE.md §1).
final class FallbackDistractionNotifier: LocalNotifying {
    private let primary: LocalNotifying
    /// Async check of the current authorization state (real wiring reads
    /// `UNUserNotificationCenter.getNotificationSettings`; tests inject a synchronous stub).
    private let isAuthorized: (@escaping (Bool) -> Void) -> Void
    /// Presents the in-app fallback window. Real wiring hops to the main thread; kept as a plain
    /// closure so the decision logic is testable without AppKit.
    private let presentWindow: (_ title: String, _ body: String) -> Void

    init(primary: LocalNotifying,
         isAuthorized: @escaping (@escaping (Bool) -> Void) -> Void,
         presentWindow: @escaping (_ title: String, _ body: String) -> Void) {
        self.primary = primary
        self.isAuthorized = isAuthorized
        self.presentWindow = presentWindow
    }

    func requestAuthorization() { primary.requestAuthorization() }
    func clearAll() { primary.clearAll() }

    func notify(id: String, title: String, body: String) {
        isAuthorized { [weak self] authorized in
            guard let self else { return }
            if authorized {
                self.primary.notify(id: id, title: title, body: body)
            } else {
                self.presentWindow(title, body)
            }
        }
    }
}
