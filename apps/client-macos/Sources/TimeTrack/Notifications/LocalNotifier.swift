import Foundation
import UserNotifications
import AppKit

/// PRD §6.4 — the single local-notification seam. Every nudge (idle, forgot-to-start,
/// end-of-day) posts through this; nothing here touches the network (nudges are local, per the
/// Phase-2 exit criterion). Employee-facing strings only — this is transparency, not
/// surveillance (CLAUDE.md §1): no hidden mode, no kill switch.
///
/// Authorization is requested once at ready. If the employee denies it, `notify` silently
/// no-ops (the center drops unauthorized requests). The distraction nudge additionally falls back
/// to a visible in-app card in that case (see `FallbackDistractionNotifier`) so it is never lost.
protocol LocalNotifying: AnyObject {
    func requestAuthorization()
    func notify(id: String, title: String, body: String)
    func clearAll()   // pending + delivered
}

final class UNUserNotifier: LocalNotifying {
    // `lazy`, not `let`: `UNUserNotificationCenter.current()` aborts (SIGABRT,
    // "bundleProxyForCurrentProcess is nil") if the calling process has no bundle
    // identifier — true of the `swift test` xctest harness, not of the bundled .app
    // this ships as. Deferring the lookup past construction keeps
    // `testConcreteNotifierConstructs` (and every other suite in this binary) from
    // crashing, with no behavior change for the real app.
    private lazy var center = UNUserNotificationCenter.current()

    func requestAuthorization() {
        // The system permission dialog only appears while status is `.notDetermined`. For an
        // LSUIElement accessory app the prompt can fail to surface unless the app is the active
        // app, so activate briefly before asking on first run; already-decided statuses are left
        // untouched (a denied app can only be re-enabled from System Settings).
        center.getNotificationSettings { [weak self] settings in
            guard let self else { return }
            if settings.authorizationStatus == .notDetermined {
                DispatchQueue.main.async { NSApplication.shared.activate(ignoringOtherApps: true) }
            }
            self.center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }
    }

    func notify(id: String, title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        // nil trigger → deliver immediately.
        let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
        center.add(request)   // dropped by the center if authorization was denied — fail-safe
    }

    func clearAll() {
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
    }
}
