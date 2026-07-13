import Foundation

/// A local record that a user acknowledged the monitoring policy, so an OFFLINE relaunch
/// can re-enable MANUAL tracking without a live policy fetch (PRD §7.5 offline tolerance).
///
/// Scope guard: this gates manual time tracking only. It NEVER opens a capture path —
/// screenshots/activity/idle stay behind AckGate (CLAUDE.md §1). Cleared on logout.
final class AckMarker {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    private func key(_ userId: String) -> String { "ackedPolicyVersion:\(userId)" }

    func record(userId: String, policyVersion: String) {
        defaults.set(policyVersion, forKey: key(userId))
    }

    func hasAcknowledged(userId: String) -> Bool {
        defaults.string(forKey: key(userId)) != nil
    }

    func clear(userId: String) {
        defaults.removeObject(forKey: key(userId))
    }
}
