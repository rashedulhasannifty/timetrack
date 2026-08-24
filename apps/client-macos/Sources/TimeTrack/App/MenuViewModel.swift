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

    /// What the person says they were doing. Typed at any point during a span and applied to
    /// the RUNNING entry in place — a note does not re-attribute time the way a project switch
    /// does, so it must not split the span at the moment they stopped typing.
    ///
    /// Cleared on stop and on sign-out, so the next entry never inherits the last one's note.
    @Published var note: String = "" {
        didSet { tracker.setNote(trimmedNote) }
    }

    private var trimmedNote: String? {
        let t = note.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    /// The server's own today / this-week / this-month totals, refreshed when the dropdown opens.
    ///
    /// Nil means "not known yet" and renders as an em dash — never as 0h, which would be a lie
    /// about someone's tracked time on the one screen where that number is the whole point. A
    /// refresh that FAILS leaves the last successful value in place: it was true when it was
    /// fetched, and that is more useful than blanking the row on a dropped connection.
    ///
    /// These tick. The server's sum already counts a running entry up to the moment of the
    /// fetch — while heartbeats are fresh the clamp resolves to `now()` — so the view adds only
    /// the wall time elapsed SINCE the fetch, and today's figure moves as the person works.
    /// See `totalsFetchedAt`.
    @Published var totals: SelfTotals?

    /// When `totals` was fetched. This is what makes them live rather than a snapshot: the base
    /// number was true at this instant, so the running session's contribution since then is
    /// exactly `now - max(this, startedAt)`. Anchoring on the fetch instead of the session start
    /// is what keeps the current session from being counted twice — the base already contains it
    /// up to here.
    @Published var totalsFetchedAt: Date?

    /// How many of this person's own records have not reached the server yet — closed time
    /// entries, idle events, and screenshots still sitting in the durable buffers.
    ///
    /// Distinct from the menu bar's "not recording" warning, which says the server is actively
    /// REJECTING the running entry. This one is the ordinary offline case: nothing is wrong,
    /// the work is safely on disk, and it will drain. Showing it means a person who has been on
    /// a plane can see their time is not lost instead of guessing.
    @Published var pendingSyncCount: Int = 0

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
        selectionStore: SelectionStore
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

    /// Pick a project/task. The menu calls this "SWITCH PROJECT", and it means it: if a span is
    /// already running, the running entry is CLOSED here and a fresh one opened under the new
    /// selection.
    ///
    /// Storing the choice alone was not enough. `TimeTracker` captures the selection when a span
    /// OPENS and enqueues that captured value when it closes, so a switch made mid-span left the
    /// whole span — everything before the switch AND everything after — filed under the previous
    /// project. In AUTO mode a span runs from login to the first idle window, so that is hours of
    /// work attributed to the wrong project, with the UI reporting the switch as done.
    ///
    /// A `.paused` session is re-armed the same way: `resume()` reopens from the selection
    /// captured in the paused state, so without this a switch while paused would also be lost.
    ///
    /// The display clock is anchored to the OLD start, so the header keeps reading accumulated
    /// worked time instead of snapping back to 0 — the same treatment the manual-idle Discard
    /// trim gets. The entry itself starts now; only the readout continues.
    func select(_ choice: Choice) {
        selectedChoice = choice
        persist(choice)

        switch tracker.state {
        case let .tracking(_, entryStart, _, source):
            let anchor = displayStartOverride ?? entryStart
            tracker.stop()
            tracker.start(projectId: choice.projectId, taskId: choice.taskId,
                          note: trimmedNote, source: source)
            displayStartOverride = anchor
            sync()
        case .paused:
            // Nothing is running, so nothing to re-file — but the paused selection is what
            // `resume()` reopens with, so it has to be replaced rather than remembered.
            tracker.pause(reselecting: TimeTracker.Selection(projectId: choice.projectId,
                                                             taskId: choice.taskId,
                                                             note: trimmedNote))
        case .idle:
            break
        }
    }

    private func persist(_ choice: Choice) {
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
        tracker.start(projectId: selectedChoice?.projectId, taskId: selectedChoice?.taskId,
                      note: trimmedNote)
        sync()
    }

    /// Start, or stop, whichever the current state calls for — what the global shortcut does.
    ///
    /// A paused session RESUMES rather than starting fresh, so the shortcut can never silently
    /// abandon a pause the person meant to come back to.
    func toggle() {
        switch tracker.state {
        case .tracking: stop()
        case .paused: resume()
        case .idle: start()
        }
    }

    func stop() {
        displayStartOverride = nil
        tracker.stop() // closes with the note captured on the span
        note = ""
        sync()
    }
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
        // `stop()` above already cleared it; repeated here because the note is user-authored
        // text and this is the cross-user boundary — the same class of leak that has bitten
        // the away/recovery prompts twice. A reorder of this method must not reopen it.
        note = ""

        // A previous user's tracked time must never be visible to whoever signs in next.
        totals = nil
        totalsFetchedAt = nil
        pendingSyncCount = 0
    }

    /// A total as it stands right now: the figure the server returned, plus the tracked time that
    /// has accrued since it was fetched.
    ///
    /// Anchored on `max(fetchedAt, startedAt)`, which is the whole trick:
    ///  * the base ALREADY includes the running session up to `fetchedAt`, so counting from the
    ///    session start would count most of it twice;
    ///  * a session that began AFTER the fetch has only run since `startedAt`, so counting from
    ///    the fetch would add idle time that was never tracked.
    ///
    /// Only while the clock is actually running — a paused or stopped clock accrues nothing.
    static func liveTotal(base: Int, phase: Phase, fetchedAt: Date?, startedAt: Date?, now: Date) -> Int {
        guard phase == .tracking, let fetchedAt, let startedAt else { return base }
        let since = max(fetchedAt, startedAt)
        return base + max(0, Int(now.timeIntervalSince(since)))
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
