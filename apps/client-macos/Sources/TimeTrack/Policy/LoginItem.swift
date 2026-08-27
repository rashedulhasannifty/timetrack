import Foundation
import ServiceManagement

/// Where the login item currently stands, independent of `ServiceManagement` so the decision
/// below is testable without touching the real machine's login items.
enum LoginItemStatus: Equatable {
    case registered
    case notRegistered
    /// Registered once, then switched OFF by the employee in System Settings. Only they can turn
    /// it back on — `register()` cannot, and must not try.
    case requiresApproval
}

/// The macOS login-item seam.
///
/// `autoStartOnLogin` selects the tracking MODE, but a menu bar app cannot start tracking on a
/// Mac that never opened it — so the team setting also has to make the app *be running* at login.
/// `SMAppService.mainApp` (macOS 13+) is the supported way, and it is deliberately VISIBLE: the
/// item appears in System Settings › General › Login Items, macOS announces it when it is added,
/// and the employee can switch it off there. No LaunchAgent, nothing hidden (CLAUDE.md §1).
///
/// NOT a capture path — this only launches the app, it touches no hardware API — so it does not
/// route through `AckGate` and must not be made to.
protocol LoginItemControlling {
    var status: LoginItemStatus { get }
    func register() throws
    func unregister() throws
}

/// The real thing: this app's own bundle as a login item.
struct MainAppLoginItem: LoginItemControlling {
    var status: LoginItemStatus {
        switch SMAppService.mainApp.status {
        case .enabled: return .registered
        case .requiresApproval: return .requiresApproval
        // `.notFound` is a bundle macOS has no record of — same actionable state as never
        // having registered, so it is treated as such rather than as an error case.
        case .notRegistered, .notFound: return .notRegistered
        @unknown default: return .notRegistered
        }
    }

    func register() throws { try SMAppService.mainApp.register() }
    func unregister() throws { try SMAppService.mainApp.unregister() }
}

/// Brings the machine's login item in line with the team policy. Run on every launch that
/// resolves a policy, so it is idempotent by construction — "already in the wanted state" is the
/// common case and costs nothing.
///
/// Two things it deliberately does NOT do:
///
/// - It never re-registers over `.requiresApproval`. That state means the employee turned the
///   item off by hand; macOS requires *them* to turn it back on, and hammering `register()` each
///   launch would be an app arguing with its user about their own machine.
/// - It cannot take effect on the login that is already happening. Registration only runs while
///   the app is open, so an admin who flips the toggle today reaches the employee at their NEXT
///   login. That is inherent to a login item, and the dashboard copy says so.
enum LoginItemSync {
    enum Outcome: Equatable {
        case unchanged
        case registered
        case unregistered
        case failed
    }

    /// Best-effort: a `ServiceManagement` failure leaves the login item as it was and reports
    /// `.failed`. Tracking is unaffected either way — the employee can still open the app and
    /// work — so there is nothing here worth blocking a launch over.
    @discardableResult
    static func apply(autoStartOnLogin: Bool, to item: LoginItemControlling) -> Outcome {
        do {
            if autoStartOnLogin {
                guard item.status == .notRegistered else { return .unchanged }
                try item.register()
                return .registered
            } else {
                guard item.status != .notRegistered else { return .unchanged }
                try item.unregister()
                return .unregistered
            }
        } catch {
            return .failed
        }
    }
}
