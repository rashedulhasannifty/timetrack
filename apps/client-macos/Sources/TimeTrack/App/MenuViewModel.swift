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

    /// The signed-in user, set by AppDelegate once the session resolves. Selection persistence is
    /// namespaced by it so one user can never inherit another's (possibly wrong-team) project.
    var currentUserId: String?

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
    private let selectionStore: SelectionStore

    /// A display-only clock anchor that overrides the live entry's real start. Set when manual idle
    /// Discard shifts the clock forward by the idle gap so it keeps reading accumulated *worked*
    /// time (the fresh entry's real start would read 0). Display-only: the entry sent to the server
    /// keeps its true start. Cleared by any explicit start/stop/pause/resume/reset, so a new user
    /// session reads its real elapsed again.
    private var displayStartOverride: Date?

    init(
        tracker: TimeTracker,
        dashboardURL: URL,
        openURL: @escaping (URL) -> Void,
        onSignIn: @escaping () -> Void,
        onSignOut: @escaping () -> Void,
        onQuit: @escaping () -> Void,
        selectionStore: SelectionStore = SelectionStore()
    ) {
        self.tracker = tracker
        self.dashboardURL = dashboardURL
        self.openURL = openURL
        self.onSignIn = onSignIn
        self.onSignOut = onSignOut
        self.onQuit = onQuit
        self.selectionStore = selectionStore
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

    func select(_ choice: Choice) {
        selectedChoice = choice
        guard let currentUserId else { return }
        selectionStore.save(StoredSelection(projectId: choice.projectId, taskId: choice.taskId),
                            userId: currentUserId)
    }

    /// Apply the persisted selection for `userId`, if it still exists in the CURRENT project
    /// list. Called by AppDelegate AFTER the project refresh — restoring against a stale or
    /// empty cache would either drop a valid selection or apply one the user has since lost
    /// access to.
    ///
    /// Only ever fills an EMPTY picker (`selectedChoice == nil`): `refreshProjects()` runs both
    /// at launch and on every menu open, so an unguarded restore would re-run each time and could
    /// overwrite a selection the user just made by hand.
    ///
    /// A selection that no longer resolves is dropped, but the stored key is cleared only when
    /// there is a non-empty project list to judge it against. `ProjectCache` is a single global
    /// file cleared wholesale on sign-out, so `projects` reads empty on every offline re-login
    /// until a network refresh succeeds — indistinguishable, to `SelectionResolver`, from "the
    /// project was archived". Clearing on an empty list would permanently delete a user's saved
    /// selection on an offline re-login instead of merely deferring the restore.
    func restoreSelection(userId: String) {
        guard selectedChoice == nil else { return }
        guard let stored = selectionStore.load(userId: userId) else { return }
        if let restored = SelectionResolver.resolve(stored, in: choices) {
            selectedChoice = restored
        } else if !choices.isEmpty {
            selectionStore.clear(userId: userId)
        }
    }

    func start() {
        guard isReady else { return }
        displayStartOverride = nil
        tracker.start(projectId: selectedChoice?.projectId, taskId: selectedChoice?.taskId)
        sync()
    }

    func stop() { displayStartOverride = nil; tracker.stop(); sync() }
    func pause() { displayStartOverride = nil; tracker.pause(); sync() }

    /// Manual idle Discard has replaced the live entry (trim + fresh start). Shift the clock anchor
    /// forward by the discarded idle gap so it keeps reading accumulated *worked* time and climbs,
    /// rather than resetting to the fresh entry's 0. The selection (project/task) is preserved —
    /// the fresh entry inherits it and the picker is untouched. Then re-sync the UI + status icon.
    func continueClockAfterDiscard(idleSeconds: TimeInterval) {
        if let anchor = startedAt {
            displayStartOverride = anchor.addingTimeInterval(idleSeconds)
        }
        sync()
    }

    func resume() {
        guard isReady else { return }
        displayStartOverride = nil
        tracker.resume()
        sync()
    }

    /// Open the employee self-view directly (the dashboard's /me page), not the dashboard root —
    /// the rich "My data" screen (time ribbon, activity, screenshots + redaction) lives on the web.
    func openMyData() { openURL(dashboardURL.appendingPathComponent("me")) }

    /// Returns the VM to a clean signed-out state: closes/enqueues any live span (`stop()`
    /// drives phase→idle + icon via `sync()`) and clears everything selection/search/project
    /// related so a different user's next login can't inherit a stale, wrong-team selection
    /// (CLAUDE.md §1 fail-safe posture).
    ///
    /// Deliberately asymmetric: this clears the IN-MEMORY selection and drops `currentUserId`
    /// (so a stray `select()` before the next sign-in can never write under the old user), but
    /// does NOT clear the PERSISTED key — the per-user namespacing is what lets the same user get
    /// their project back on their next sign-in without reopening the cross-user leak this guards.
    func reset() {
        stop()
        isReady = false
        isSignedIn = false
        selectedChoice = nil
        query = ""
        projects = []
        currentUserId = nil
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
            displayStartOverride = nil
        case let .tracking(_, entryStart, _, _):
            phase = .tracking
            // Prefer the Discard clock anchor (worked-time continuation) over the entry's real
            // start; the override is display-only and never leaves this type.
            startedAt = displayStartOverride ?? entryStart
        case .paused:
            phase = .paused
            startedAt = nil
        }
        onPhaseChanged?(iconIsTracking, startedAt)
    }
}
