import Foundation
import SwiftUI

/// One flattened project/task the picker can select. `taskId == nil` is the project itself.
struct Choice: Identifiable, Equatable {
    let id: String        // taskId ?? projectId
    let projectId: String
    let taskId: String?
    let projectName: String
    let taskName: String?
}

/// The single seam between the SwiftUI dropdown and the tracking logic. The view observes
/// this; the view has no logic and `TimeTracker` has no UI. Manual tracking is gated here by
/// `isReady` (set by AppDelegate once the launch ack flow resolves) — NOT by AckGate
/// (CLAUDE.md §1); AckGate stays reserved for real capture in 1.7c+.
///
/// A plain ObservableObject (not @MainActor): every @Published mutation is driven from the
/// main thread — SwiftUI button actions or AppDelegate's `MainActor.run` (the 1.7a pattern).
final class MenuViewModel: ObservableObject {
    enum Phase: Equatable { case idle, tracking, paused }

    @Published private(set) var isReady = false
    /// Whether a user session is open. Drives the dropdown's signed-in vs signed-out layout —
    /// the signed-out dropdown never offers My Data / Sign Out (those belong to a session).
    @Published private(set) var isSignedIn = false
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var startedAt: Date?
    @Published private(set) var selectedChoice: Choice?
    @Published var projects: [Project] = []
    @Published var query: String = ""

    /// Called on every tracking-state change with `iconIsTracking` and the tracking start (nil
    /// when not tracking), so AppDelegate can update the always-visible status icon — including
    /// its live elapsed count — without a Combine subscription.
    var onPhaseChanged: ((Bool, Date?) -> Void)?

    private let tracker: TimeTracker
    private let dashboardURL: URL
    private let openURL: (URL) -> Void
    private let onSignIn: () -> Void
    private let onSignOut: () -> Void
    private let onQuit: () -> Void

    init(
        tracker: TimeTracker,
        dashboardURL: URL,
        openURL: @escaping (URL) -> Void,
        onSignIn: @escaping () -> Void,
        onSignOut: @escaping () -> Void,
        onQuit: @escaping () -> Void
    ) {
        self.tracker = tracker
        self.dashboardURL = dashboardURL
        self.openURL = openURL
        self.onSignIn = onSignIn
        self.onSignOut = onSignOut
        self.onQuit = onQuit
    }

    /// The indicator reads as active whenever a session is open (tracking or paused) — it is
    /// never hidden while a span is in progress (PRD §4.2). Mapping `paused` → the tracking
    /// icon is deliberate over-disclosure: for monitoring software the indicator errs toward
    /// "active", never toward under-reporting. (`StatusItemController.State` has no `paused`.)
    var iconIsTracking: Bool { phase != .idle }

    /// The current picker selection as a tracker Selection, for auto-started entries
    /// (they inherit whatever the employee has picked; null if nothing is selected).
    var selectionForAuto: TimeTracker.Selection {
        TimeTracker.Selection(projectId: selectedChoice?.projectId, taskId: selectedChoice?.taskId)
    }

    var choices: [Choice] {
        projects.flatMap { p -> [Choice] in
            let projectOnly = Choice(id: p.id, projectId: p.id, taskId: nil,
                                     projectName: p.name, taskName: nil)
            let tasks = (p.tasks ?? []).map {
                Choice(id: $0.id, projectId: p.id, taskId: $0.id,
                       projectName: p.name, taskName: $0.name)
            }
            return [projectOnly] + tasks
        }
    }

    var filteredChoices: [Choice] {
        guard !query.isEmpty else { return choices }
        let q = query.lowercased()
        return choices.filter {
            $0.projectName.lowercased().contains(q) || ($0.taskName?.lowercased().contains(q) ?? false)
        }
    }

    func markReady() {
        isReady = true
        isSignedIn = true
    }
    func markNotReady() { isReady = false }

    func select(_ choice: Choice) { selectedChoice = choice }

    func start() {
        guard isReady else { return }
        tracker.start(projectId: selectedChoice?.projectId, taskId: selectedChoice?.taskId)
        sync()
    }

    func stop() { tracker.stop(); sync() }
    func pause() { tracker.pause(); sync() }

    func resume() {
        guard isReady else { return }
        tracker.resume()
        sync()
    }

    func openMyData() { openURL(dashboardURL) }

    /// Returns the VM to a clean signed-out state: closes/enqueues any live span (`stop()`
    /// drives phase→idle + icon via `sync()`) and clears everything selection/search/project
    /// related so a different user's next login can't inherit a stale, wrong-team selection
    /// (CLAUDE.md §1 fail-safe posture).
    func reset() {
        stop()
        isReady = false
        isSignedIn = false
        selectedChoice = nil
        query = ""
        projects = []
    }

    /// Bring the sign-in window forward from the signed-out dropdown (the login window is
    /// already presented on sign-out, but the user may have dismissed it).
    func signIn() { onSignIn() }

    func signOut() {
        reset()
        onSignOut()
    }

    func quit() { onQuit() }

    private func sync() {
        switch tracker.state {
        case .idle:
            phase = .idle
            startedAt = nil
        case let .tracking(_, startedAt, _, _):
            phase = .tracking
            self.startedAt = startedAt
        case .paused:
            phase = .paused
            startedAt = nil
        }
        onPhaseChanged?(iconIsTracking, startedAt)
    }
}
