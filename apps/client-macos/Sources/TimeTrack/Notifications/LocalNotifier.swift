import Foundation
import UserNotifications

/// PRD §6.4 — the single local-notification seam. Every nudge (idle, forgot-to-start,
/// end-of-day) posts through this; nothing here touches the network (nudges are local, per the
/// Phase-2 exit criterion) and nothing here logs. Employee-facing strings only — this is
/// transparency, not surveillance (CLAUDE.md §1): no hidden mode, no kill switch.
///
/// Authorization is requested once at ready. If the employee denies it, `notify` silently
/// no-ops (the center drops unauthorized requests) — a known, accepted shell state; there is no
/// fallback path.
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
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
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
