import Foundation

/// What the menu bar should say about the installed build.
///
/// There is deliberately no case that stops tracking. An out-of-date client keeps recording
/// time: a person who has not clicked "update" has not done anything wrong, and losing their
/// day's records over it would be a far worse outcome than running an old build.
enum UpdateStatus: Equatable {
    /// Nothing newer published, or we could not tell (no network, rate limited, unparseable
    /// running version). Indistinguishable to the user, and that is intended — a failed check
    /// is not something to nag about.
    case unknownOrCurrent
    /// Newer build available, published recently. Quiet menu item.
    case available(ReleaseManifest)
    /// Newer build available and the grace period has elapsed. Prominent — the status item
    /// picks up a warning marker as well.
    case overdue(ReleaseManifest)

    var manifest: ReleaseManifest? {
        switch self {
        case .unknownOrCurrent: return nil
        case .available(let m), .overdue(let m): return m
        }
    }

    var isOverdue: Bool {
        if case .overdue = self { return true }
        return false
    }
}

/// Pure decision logic, kept apart from the network and the clock so it can be tested directly.
struct UpdateEvaluator {
    /// How long a newer build may sit unapplied before the prompt escalates.
    let graceDays: Int

    init(graceDays: Int = 7) { self.graceDays = graceDays }

    func evaluate(current: AppVersion?, latest: ReleaseManifest?, now: Date) -> UpdateStatus {
        // No manifest: the check failed or has not run. Say nothing.
        guard let latest else { return .unknownOrCurrent }
        // An unreadable running version (notably `swift run`, which has no Info.plist) must not
        // be treated as "older than everything" — that would nag every developer forever.
        guard let current else { return .unknownOrCurrent }
        guard current < latest.version else { return .unknownOrCurrent }

        let elapsed = now.timeIntervalSince(latest.publishedAt)
        let grace = TimeInterval(graceDays) * 24 * 60 * 60
        // A release dated in the future (clock skew, or a backdated tag) should not instantly
        // escalate; elapsed is negative there and falls through to .available.
        return elapsed > grace ? .overdue(latest) : .available(latest)
    }
}
