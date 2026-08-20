import AppKit
import Combine
import UserNotifications

/// A callback holder for `onSignOut`'s forward reference to `presentLogin()` (see
/// `AppDelegate.init`): `self` isn't usable yet when the closure capturing it is built.
private final class CallbackBox {
    var call: (@MainActor () -> Void)?
}

/// Like `CallbackBox` but for the async sign-out flush (`self` isn't available in the pre-super.init
/// sign-out closure, so it's routed through this box, assigned after `super.init()`).
private final class AsyncCallbackBox {
    var call: (() async -> Void)?
}

/// Bridges `AuthSession` (an actor — every call to `userId()` requires `await`) to
/// `LiveSpanStore`'s `currentUserId` closure, which is `@escaping () -> String?`: plain
/// synchronous, called from `TimeTracker.start()` → `LiveSpanStore.begin()`, itself always
/// invoked on the main thread (SwiftUI button / `AutoTrackingCoordinator`) and never `await`s.
/// `becomeReady()` — the gate that also flips `MenuViewModel.isReady`, the only thing that lets
/// `start()` run — resolves the userId once via `await session.userId()` and stamps this box on
/// the main thread before tracking can begin, so the closure never needs to hop into the actor.
private final class UserIdBox {
    var value: String?
}

/// Wires the app together. The AckGate (PRD §4.1) still guards every capture path; manual
/// tracking is NOT a capture path, so it is gated by MenuViewModel.isReady (flipped once the
/// launch ack flow resolves) plus an offline AckMarker — never by AckGate.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let statusItem = StatusItemController()

    private let session: AuthSession
    private let policyClient: PolicyClient
    private let ackGate: AckGate
    private let ackClient: AckClient
    private let ackMarker: AckMarker
    private let projectClient: ProjectClient
    private let projectCache: ProjectCache
    /// Fresh-install fallback only — consulted from `refreshProjects()` when `selectionStore`
    /// has nothing for the current user. See `RecentSelectionClient`.
    private let recentSelectionClient: RecentSelectionClient
    /// The single instance shared with `MenuViewModel` (Task 4 needs AppDelegate to consult the
    /// same store directly) — two separately-constructed `SelectionStore`s would agree only by
    /// accident.
    private let selectionStore: SelectionStore
    private let timeTracker: TimeTracker
    private let menuViewModel: MenuViewModel
    private let liveSpanStore: LiveSpanStore
    private let liveEntryPublisher: LiveEntryPublisher
    private let userIdBox: UserIdBox

    private var loginWindow: LoginWindowController?
    private var ackWindow: AckWindowController?
    private var autoCoordinator: AutoTrackingCoordinator?
    private var workspaceObserver: WorkspaceObserver?
    private var manualIdleCoordinator: ManualIdleCoordinator?
    private var signalFanOut: FanOutSignalReceiver?
    private var syncEngine: SyncEngine?
    private var screenshotScheduler: ScreenshotScheduler?
    private var screenshotSync: ScreenshotSyncEngine?
    private var activitySampler: ActivitySampler?
    private var activitySync: ActivityBatchSyncEngine?
    private var heartbeatTimer: Timer?
    private var hasAttemptedRecovery = false
    /// One-shot-per-session guard on `RecentSelectionClient`'s fresh-install fallback (same
    /// shape as `hasAttemptedRecovery` just above). Without it, a user with nothing in the
    /// lookback window (or whose returned selection immediately fails `SelectionResolver` and
    /// gets cleared by `restoreSelection`) would never populate `selectionStore`, so the
    /// `selectionStore.load(userId:) == nil` gate alone would stay open and re-fire the fetch
    /// on every throttled menu-open, indefinitely, against the API's global throttler. Reset
    /// on sign-out in `stopAutoTracking()`, alongside `hasAttemptedRecovery`, so the next user
    /// on this Mac gets their own single attempt.
    private var hasAttemptedRecentSelectionFallback = false
    private var updateCoordinator: UpdateCoordinator?
    private var updateStatusObserver: AnyCancellable?
    /// Rate-limits the menu-open project re-fetch so opening the dropdown repeatedly doesn't
    /// hammer GET /v1/projects. First open always refreshes.
    private let projectRefreshThrottle = RefreshThrottle(minInterval: 60)

    private var notifier: LocalNotifying?
    private var dailyTotal: DailyTotalAccumulator?
    private var endOfDayScheduler: EndOfDayScheduler?
    private var manualNudgeMonitor: ManualNudgeMonitor?
    private var distractionMonitor: DistractionMonitor?
    /// The admin-editable slice of the team policy, refreshed by AckGate on every capture cycle.
    private let livePolicy: LivePolicy
    private var dailyDistraction: DailyDistractionAccumulator?
    private let endOfDayHour = 18
    private let forgotToStartMinutes = 10
    // 60s sampler window ⇒ a threshold in minutes == a consecutive-sample count (see
    // ActivitySampler). Whether the nudge runs at all, after how many unproductive minutes, and how
    // often it repeats are ALL team policy (`settings.distractionAlertsEnabled` /
    // `…ThresholdMinutes` / `…RepeatMinutes`) — threaded into installNudgeInfra as a
    // DistractionSettings, never hardcoded here.

    override init() {
        let baseURL = AppDelegate.apiBaseURL()
        let session = AuthSession(client: AuthClient(baseURL: baseURL), store: KeychainTokenStore())
        self.session = session
        self.policyClient = PolicyClient(baseURL: baseURL, session: session)
        // The gate re-fetches the policy before every capture cycle; hand each one to the box so
        // the sampler and the distraction nudge pick up an admin's edit on the next sample rather
        // than the next launch (the settings page promises ≤60s).
        let livePolicy = LivePolicy()
        self.livePolicy = livePolicy
        self.ackGate = AckGate(policyProvider: policyClient,
                               onPolicy: { policy in livePolicy.update(from: policy.settings) })
        self.ackClient = AckClient(baseURL: baseURL, session: session)
        let ackMarker = AckMarker()
        self.ackMarker = ackMarker
        self.projectClient = ProjectClient(baseURL: baseURL, session: session)
        let projectCache = ProjectCache(fileURL: ProjectCache.defaultURL())
        self.projectCache = projectCache
        self.recentSelectionClient = RecentSelectionClient(baseURL: baseURL, session: session)
        let selectionStore = SelectionStore()
        self.selectionStore = selectionStore

        let userIdBox = UserIdBox()
        self.userIdBox = userIdBox

        let liveSpanStore = LiveSpanStore(
            fileURL: LiveSpanStore.defaultURL(),
            currentUserId: { [userIdBox] in userIdBox.value }
        )
        self.liveSpanStore = liveSpanStore

        self.liveEntryPublisher = LiveEntryPublisher(
            uploader: TimeEntryUploader(baseURL: baseURL, session: session)
        )

        let tracker = TimeTracker(buffer: BufferStore.shared, liveSpan: liveSpanStore)
        self.timeTracker = tracker

        // `onSignOut` is built as an argument to MenuViewModel's own initializer, before
        // `super.init()` runs (so `self`/AppDelegate can't be captured yet). This box stands
        // in for `presentLogin()`, not available as a value yet; it's filled in below once
        // `self` exists, before the closure can ever run. It's a `let`-bound reference type
        // (not a captured `var`) so the escaping Task below doesn't trip Swift 6's
        // captured-var-across-concurrency-domains diagnostic.
        let presentLoginBox = CallbackBox()
        // Same forward-reference problem for `stopAutoTracking()`: the sign-out closure below
        // is built before `super.init()`, so `self` isn't available yet.
        let stopAutoBox = CallbackBox()
        // Same forward-reference problem for the sign-out buffer flush+clear (cross-user
        // integrity invariant): `self` isn't available yet either.
        let flushBufferBox = AsyncCallbackBox()

        let menuViewModel = MenuViewModel(
            tracker: tracker,
            dashboardURL: AppDelegate.dashboardURL(),
            openURL: { NSWorkspace.shared.open($0) },
            onSignIn: { Task { @MainActor in presentLoginBox.call?() } },
            onSignOut: {
                Task {
                    // Tear down auto-tracking first: stop the observer/timer and deactivate the
                    // monitor so any pending away is recorded UNRESOLVED, before anything else
                    // about the signed-out state is touched.
                    await MainActor.run { stopAutoBox.call?() }
                    // Best-effort final drain, then stop and clear the buffer — BEFORE logout,
                    // since the drain needs the still-valid token (cross-user integrity
                    // invariant: CreateTimeEntry has no userId, the server attributes by token).
                    await flushBufferBox.call?()
                    // Read the user before logout clears the in-memory access token the
                    // sub is decoded from; a stale marker must never survive to grant
                    // readiness to whoever signs in next (CLAUDE.md §1 fail-safe posture).
                    // MenuViewModel.reset() (called by signOut() before this closure runs)
                    // already stopped/enqueued any live span and cleared the VM's own state.
                    if let userId = await session.userId() { ackMarker.clear(userId: userId) }
                    await MainActor.run { userIdBox.value = nil }
                    // Clear the cached project list too: it's a single global file, so without
                    // this an offline login as a different user on this machine would show the
                    // previous user's team projects in the picker.
                    projectCache.clear()
                    await session.logout()
                    // Leave the app coherent: re-present login so the user can sign back in
                    // (the launch flow re-runs and re-enables tracking on success).
                    await MainActor.run { presentLoginBox.call?() }
                }
            },
            onQuit: { NSApp.terminate(nil) },
            selectionStore: selectionStore
        )
        self.menuViewModel = menuViewModel
        super.init()
        presentLoginBox.call = { [weak self] in self?.presentLogin() }
        stopAutoBox.call = { [weak self] in self?.stopAutoTracking() }
        flushBufferBox.call = { [weak self] in await self?.flushAndClearBuffer() }
        tracker.onSpanOpened = { [weak self] entryId, start, selection, source in
            guard let self else { return }
            Task { await self.liveEntryPublisher.publish(
                entryId: entryId, start: start, selection: selection, source: source
            ) }
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Keep the indicator in sync with tracking state (always visible; no kill switch).
        // onPhaseChanged fires on the main thread (from a SwiftUI button action).
        menuViewModel.onPhaseChanged = { [weak self] isTracking, startedAt in
            self?.statusItem.setState(isTracking ? .tracking : .idle, startedAt: startedAt)
        }
        let updates = UpdateCoordinator(
            openReleases: { NSWorkspace.shared.open($0) },
            onQuit: { NSApp.terminate(nil) }
        )
        updateCoordinator = updates
        // Escalate to the status item only once the grace period has elapsed; the menu row
        // carries the advisory case on its own.
        updateStatusObserver = updates.$status.sink { [weak self] status in
            self?.statusItem.setUpdateOverdue(status.isOverdue,
                                              version: status.manifest?.version.description)
        }
        updates.start()

        statusItem.install(content: MenuBarView(viewModel: menuViewModel, updates: updates))
        statusItem.onOpen = { [weak self] in self?.menuDidOpen() }
        startHeartbeat()
        Task { await start() }
    }

    @MainActor private func startHeartbeat() {
        let timer = Timer(timeInterval: 60, repeats: true) { [weak self] _ in
            guard let self, self.timeTracker.isRunning else { return }
            self.liveSpanStore.heartbeat(at: Date())
            // Re-publish the OPEN entry so the server's heartbeatAt stays fresh and the
            // dashboard keeps showing it as running (spec §4.1/§4.3). Best-effort.
            if let span = self.liveSpanStore.load() {
                Task { await self.liveEntryPublisher.publish(span) }
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        heartbeatTimer = timer
    }

    private func start() async {
        switch await session.bootstrap() {
        case .authenticated:
            await proceedToPolicy()
        case .offline:
            // The refresh token is still ours — we just could not reach the API. Take the
            // same route as a normal launch: the policy fetch below fails, and
            // proceedToPolicy()'s catch grants MANUAL tracking to a user who acked here
            // before. Capture stays shut behind AckGate either way. Presenting the login
            // window instead would be a lie — nothing is wrong with the session.
            await proceedToPolicy()
        case .unauthenticated:
            await MainActor.run { presentLogin() }
        }
    }

    @MainActor private func presentLogin() {
        statusItem.closePopover()   // don't leave the dropdown lingering behind the login window
        // Idempotent: reuse the window that's already up instead of stacking a second one (the
        // signed-out dropdown's Sign In and the sign-out flow both route here).
        if loginWindow?.bringToFrontIfShowing() == true { return }
        let controller = LoginWindowController(session: session) { [weak self] in
            Task { await self?.proceedToPolicy() }
        }
        loginWindow = controller
        controller.show()
    }

    private func proceedToPolicy() async {
        do {
            let policy = try await policyClient.effectivePolicy()
            if policy.ackRequired {
                guard let userId = await session.userId() else { await MainActor.run { presentLogin() }; return }
                await MainActor.run { presentAck(policy: policy, userId: userId) }
            } else {
                if let userId = await session.userId() {
                    ackMarker.record(userId: userId, policyVersion: policy.policyVersion)
                }
                // Seed the box before anything reads it — the gate refreshes it from here on.
                livePolicy.update(from: policy.settings)
                await becomeReady()
                await startAutoTrackingIfEnabled(policy)   // online, !ackRequired: capture is allowed
                await startScreenshotCaptureIfEnabled(policy)
                await startActivityCaptureIfEnabled(policy)
                await startManualNudgesIfManual(policy)
            }
        } catch {
            // Offline / policy unavailable: allow MANUAL tracking only if this user has a
            // prior local ack marker; capture stays closed behind AckGate regardless.
            if let userId = await session.userId(), ackMarker.hasAcknowledged(userId: userId) {
                await becomeReady()
            } else {
                await MainActor.run { statusItem.showPolicyUnavailable() }
            }
        }
    }

    /// Enable manual tracking and load projects (network → cache fallback). Nudge settings are
    /// read live from `livePolicy`, which the caller seeds and the gate keeps fresh; on the
    /// offline path it stays at its pending default (silent), which is moot anyway since a closed
    /// gate means no activity samples and therefore nothing to nudge about.
    private func becomeReady() async {
        // Resolve the userId once (an `await`, since `AuthSession` is an actor) and stamp
        // `userIdBox` on the main thread BEFORE `markReady()` flips `isReady` — that flip is
        // the only thing that lets `TimeTracker.start()` run, so the box is always populated
        // before any span can be stamped. The same value gates recovery below.
        let currentUserId = await session.userId()
        await MainActor.run {
            userIdBox.value = currentUserId
            // Namespaces `select()`/`restoreSelection()` persistence to this user; set before
            // `refreshProjects()` below so its post-refresh restore has a user id to resolve.
            menuViewModel.currentUserId = currentUserId
            menuViewModel.markReady()
        }
        await MainActor.run { self.installNudgeInfra() }
        await MainActor.run { menuViewModel.projects = projectCache.load() } // instant, offline-safe
        await refreshProjects()
        await MainActor.run { startSyncIfNeeded() }
        await MainActor.run { recoverLiveSpanIfNeeded(currentUserId: currentUserId) }
    }

    /// Re-fetch the team's projects (network → cache), replacing the picker list. Failures are
    /// swallowed — the last cached list stays. Called at ready and, throttled, on menu open so a
    /// project added in the dashboard appears without restarting the client.
    ///
    /// Restoring the persisted selection happens HERE, after the assignment, never at
    /// construction or from the instant cache-load in `becomeReady()` — resolving against a
    /// stale or empty list would either drop a valid selection or apply one the user has since
    /// lost access to. `MenuViewModel.restoreSelection` itself guards against overwriting a
    /// hand-made selection and against clearing the stored key on an empty list (Task 3 rulings).
    private func refreshProjects() async {
        guard let fresh = try? await projectClient.list() else { return }
        projectCache.save(fresh)

        // Fresh-install fallback: nothing stored locally for this user (new Mac, reinstall) —
        // ask the server what they were last tracking against. Gated on `selectionStore.load`
        // so this never overrides an existing local selection, AND on
        // `hasAttemptedRecentSelectionFallback` so it fires at most once per session per user —
        // the store gate alone doesn't self-close (a user with no history in the lookback
        // window, or a returned selection that immediately fails to resolve and gets cleared,
        // would otherwise re-trigger the fetch on every throttled menu-open forever). Best-effort:
        // any failure (offline, 401, empty history) just leaves nothing pre-selected, and the
        // attempt still only happens once. Written to `selectionStore` so the existing
        // `restoreSelection(userId:)` below picks it up through the normal path — no second,
        // parallel apply path.
        //
        // `userId` here is resolved independently of `menuViewModel.currentUserId` (read only
        // below, inside `MainActor.run`, atomically with the restore) so a concurrent sign-out's
        // `reset()` — which nils `currentUserId` — can't be raced into restoring a stale
        // selection. `mostRecentSelection()` independently re-reads a FRESH access token, so a
        // complete sign-out and sign-in-as-B inside that network round-trip would return B's
        // history for save under A's key. The `session.userId() == userId` re-check immediately before the save below
        // narrows that window to the handful of instructions between the check and the write —
        // it does NOT close it outright, so don't read it as eliminating the race. Even inside
        // that residual sliver the blast radius stays bounded: on A's next sign-in,
        // `SelectionResolver` matches the restored value against A's freshly-fetched project
        // list, so a different-team project is dropped and the key cleared before any wrong-team
        // `projectId` can reach a `Start`.
        if let userId = await session.userId() {
            let shouldAttemptFallback = await MainActor.run { () -> Bool in
                guard !hasAttemptedRecentSelectionFallback, selectionStore.load(userId: userId) == nil else {
                    return false
                }
                // Mark the attempt now, before the network call — a failed/empty result still
                // counts as "attempted" so the guard actually closes. Exception: a transient
                // failure (`RecentSelectionClient.FallbackOutcome.transientFailure` — no token,
                // offline, or ANY non-2xx status, including a 401 as well as a 429 from the
                // throttler or a 503 mid-deploy) un-marks it below, so it doesn't permanently
                // burn the session's only fresh-install attempt on an answer the server never
                // actually gave.
                hasAttemptedRecentSelectionFallback = true
                return true
            }
            if shouldAttemptFallback {
                switch await recentSelectionClient.mostRecentSelection() {
                case .found(let remote):
                    // Re-check immediately before the save — see the comment above.
                    if await session.userId() == userId {
                        selectionStore.save(remote, userId: userId)
                    }
                case .notFound:
                    break
                case .transientFailure:
                    await MainActor.run { hasAttemptedRecentSelectionFallback = false }
                }
            }
        }

        await MainActor.run {
            menuViewModel.projects = fresh
            // Deliberately re-reads `menuViewModel.currentUserId` here rather than reusing the
            // `userId` captured above: this block is the same MainActor hop that assigns
            // `projects`, so it's atomic with a concurrent sign-out's `reset()` (which nils
            // `currentUserId`). Writing `menuViewModel.currentUserId = userId` here — as an
            // earlier draft of this method did — would resurrect it after `reset()`, reopening
            // the cross-user leak `reset()` exists to close (CLAUDE.md §1). Do not add that
            // write-back.
            if let userId = menuViewModel.currentUserId {
                menuViewModel.restoreSelection(userId: userId)
            }
        }
    }

    /// Menu-open hook: refresh the project list, but only when signed in and not more than once
    /// per throttle window.
    /// Everything that should be re-checked because a person is looking at the menu right now.
    @MainActor private func menuDidOpen() {
        refreshProjectsOnMenuOpen()
        // The 6h background poll is the floor, not the whole story: a release published just
        // after this app launched would otherwise sit unseen until the next tick.
        updateCoordinator?.checkOnMenuOpen()
    }

    @MainActor private func refreshProjectsOnMenuOpen() {
        guard menuViewModel.isReady, projectRefreshThrottle.shouldRefresh() else { return }
        Task { await refreshProjects() }
    }

    /// Local-notification infra (not a capture path — safe on both ready paths). Idempotent.
    /// The team policy (read live) sets whether, and how often, an unbroken distraction
    /// streak re-nudges.
    @MainActor private func installNudgeInfra() {
        guard notifier == nil else { return }
        let notifier = UNUserNotifier()
        notifier.requestAuthorization()
        self.notifier = notifier

        let accumulator = DailyTotalAccumulator()
        self.dailyTotal = accumulator
        timeTracker.onSpanClosed = { [weak self] start, end in
            self?.dailyTotal?.add(start: start, end: end)
        }

        // Both the tally (`sampleSeconds` default 60) and the monitor's threshold/repeat (minutes)
        // assume the ActivitySampler's 60s window — one sample == one minute. If that interval ever
        // changes, revisit `sampleSeconds` here and the DistractionSettings bounds in
        // @timetrack/contracts together.
        let distraction = DailyDistractionAccumulator()
        self.dailyDistraction = distraction
        // The distraction nudge alone falls back to a visible in-app window when macOS has not
        // authorized notifications (e.g. an un-notarized dev build), so it is never silently
        // dropped. Other nudges keep the plain notifier.
        let distractionNotifier = FallbackDistractionNotifier(
            primary: notifier,
            isAuthorized: { completion in
                UNUserNotificationCenter.current().getNotificationSettings { s in
                    let ok = s.authorizationStatus == .authorized || s.authorizationStatus == .provisional
                    completion(ok)
                }
            },
            presentWindow: { title, body in
                DispatchQueue.main.async {
                    DistractionNudgeWindowController.present(title: title, message: body)
                }
            })
        self.distractionMonitor = DistractionMonitor(
            // Read per tick: an admin toggling alerts, or moving the threshold, applies to a
            // running client on its next sample.
            notifier: distractionNotifier, settings: { [livePolicy] in livePolicy.current.distraction })

        let scheduler = EndOfDayScheduler(
            hour: endOfDayHour, notifier: notifier,
            total: { [weak self] now in self?.dailyTotal?.todaySeconds(now: now) ?? 0 },
            distractionTotal: { [weak self] now in self?.dailyDistraction?.todaySeconds(now: now) ?? 0 }
        )
        self.endOfDayScheduler = scheduler
        scheduler.start()
    }

    /// Recover an interrupted span left by a crash / quit-while-tracking. Runs once, AFTER auth
    /// (so the userId is known) and before the user can start new tracking. A span from a
    /// DIFFERENT user on this Mac is cleared without enqueuing — never mis-attributed (buffer
    /// syncs by token). Keep → replay the completed entry (original id, ending at the last
    /// heartbeat). `currentUserId` is resolved by the caller (`becomeReady`, via `await
    /// session.userId()`) since `AuthSession` is an actor and this method stays non-async.
    @MainActor private func recoverLiveSpanIfNeeded(currentUserId: String?) {
        guard !hasAttemptedRecovery else { return }
        hasAttemptedRecovery = true
        guard let span = liveSpanStore.load() else { return }
        guard LiveSpanStore.shouldRecover(span: span, currentUserId: currentUserId) else {
            liveSpanStore.clear()
            return
        }
        let minutes = max(1, Int((span.lastAlive.timeIntervalSince(span.startTime) / 60).rounded()))
        // Both outcomes close the span through the DURABLE buffer, and the live `userIdBox`
        // value (not the `currentUserId` captured when this closure was built) is what the
        // cross-user re-check reads. See `LiveSpanRecovery` for why Discard is buffered too.
        let recovery = LiveSpanRecovery(
            tracker: timeTracker, store: liveSpanStore,
            currentUserId: { [weak self] in self?.userIdBox.value }
        )
        RecoveryWindowController.present(minutes: minutes) { action in
            recovery.apply(action, to: span)
        }
    }

    /// Auto-tracking is a CAPTURE path (CLAUDE.md §1), so it is started ONLY through the
    /// AckGate and ONLY on the live-policy `!ackRequired` branch — never via `becomeReady()`,
    /// which the offline-marker branch also reaches (the marker must never open capture).
    private func startAutoTrackingIfEnabled(_ policy: EffectivePolicy) async {
        guard policy.settings.autoStartOnLogin else { return }
        do {
            try await ackGate.withCaptureAllowed { [weak self] in
                await MainActor.run { self?.installAutoTracking(thresholdMinutes: policy.settings.idleThresholdMinutes) }
            }
        } catch {
            // Gate closed / policy unavailable → auto-tracking simply does not start. Manual
            // tracking (already enabled) continues. Fail-safe; no fallback path.
        }
    }

    /// The manual-mode nudge poller reads the same content-free idle scalar as WorkspaceObserver,
    /// so — like auto-tracking — it is installed ONLY on the live-policy `!ackRequired` branch and
    /// ONLY through AckGate. It is the manual-mode counterpart of WorkspaceObserver: exactly one of
    /// the two ever runs (keyed on `autoStartOnLogin`).
    private func startManualNudgesIfManual(_ policy: EffectivePolicy) async {
        guard !policy.settings.autoStartOnLogin else { return }   // auto mode uses WorkspaceObserver
        do {
            try await ackGate.withCaptureAllowed { [weak self] in
                await MainActor.run { self?.installManualNudges(thresholdMinutes: policy.settings.idleThresholdMinutes) }
            }
        } catch {
            // Gate closed → poller simply does not start. Manual tracking continues. Fail-safe.
        }
    }

    @MainActor private func installManualNudges(thresholdMinutes: Int) {
        guard manualNudgeMonitor == nil, let notifier else { return }   // idempotent; needs the notifier
        let monitor = ManualNudgeMonitor(
            notifier: notifier,
            idleThresholdSeconds: thresholdMinutes * 60,
            forgotToStartSeconds: forgotToStartMinutes * 60,
            isTracking: { [weak self] in self?.timeTracker.isRunning ?? false },
            isPaused: { [weak self] in self?.timeTracker.isPaused ?? false }
        )
        manualNudgeMonitor = monitor
        monitor.start()

        let manual = ManualIdleCoordinator(
            tracker: timeTracker,
            buffer: BufferStore.shared,
            thresholdSeconds: thresholdMinutes * 60,
            presentAwayPrompt: { minutes, resolve in
                AwayResolutionWindowController.present(minutes: minutes, resolve: resolve)
            },
            onEntryReplaced: { [weak self] idle in self?.menuViewModel.continueClockAfterDiscard(idleSeconds: idle) }
        )
        let observer = WorkspaceObserver(receiver: manual)
        self.manualIdleCoordinator = manual
        self.workspaceObserver = observer
        observer.start()
    }

    /// Screenshot capture is a CAPTURE path (CLAUDE.md §1) — installed ONLY on the live-policy
    /// `!ackRequired` branch and ONLY through `AckGate`, never via the offline-marker path. The
    /// scheduler re-checks the gate every tick. Enablement + interval are an install-time snapshot
    /// (the app has no periodic policy refresh; a mid-session change is picked up next launch).
    private func startScreenshotCaptureIfEnabled(_ policy: EffectivePolicy) async {
        guard policy.settings.screenshotsEnabled else { return }
        if !ScreenRecordingPermission.isGranted() { ScreenRecordingPermission.request() }
        do {
            try await ackGate.withCaptureAllowed { [weak self] in
                await MainActor.run { self?.installScreenshotCapture(intervalMinutes: policy.settings.screenshotIntervalMinutes) }
            }
        } catch {
            // Gate closed → capture simply does not start. Tracking continues. Fail-safe.
        }
    }

    @MainActor private func installScreenshotCapture(intervalMinutes: Int) {
        guard screenshotScheduler == nil else { return }   // idempotent
        let scheduler = ScreenshotScheduler(
            ackGate: ackGate,
            grabber: ScreenCaptureKitGrabber(),
            buffer: ImageBufferStore.shared,
            intervalMinutes: intervalMinutes,
            isTracking: { [weak self] in self?.timeTracker.isRunning ?? false },
            onCaptured: { [weak self] in
                // Surface the capture moment in the menu bar ("Saving a screenshot right now"),
                // then sync it up. Always visible, never silent (CLAUDE.md §1).
                Task { @MainActor in self?.statusItem.flashCapturing() }
                Task { await self?.screenshotSync?.syncNow() }
            },
            onPermissionDenied: { [weak self] in Task { @MainActor in self?.statusItem.showScreenRecordingDenied() } },
            onCaptureSucceeded: { [weak self] in Task { @MainActor in self?.statusItem.clearWarning() } }
        )
        screenshotScheduler = scheduler
        scheduler.start()
    }

    /// Activity sampling is a CAPTURE path (CLAUDE.md §1) — installed ONLY on the live-policy
    /// `!ackRequired` branch and ONLY through `AckGate`, never via the offline-marker path. The
    /// sampler re-checks the gate every interval. There is no `activityEnabled` flag (activity is
    /// the monitoring baseline), so — unlike screenshots — this is unconditional once capture is allowed.
    private func startActivityCaptureIfEnabled(_ policy: EffectivePolicy) async {
        do {
            try await ackGate.withCaptureAllowed { [weak self] in
                await MainActor.run { [weak self] in self?.installActivityCapture(policy: policy) }
            }
        } catch {
            // Gate closed → sampling simply does not start. Tracking continues. Fail-safe.
        }
    }

    @MainActor private func installActivityCapture(policy: EffectivePolicy) {
        guard activitySampler == nil else { return }   // idempotent
        livePolicy.update(from: policy.settings)       // freshest known values before the first tick
        let sampler = ActivitySampler(
            ackGate: ackGate,
            counter: EventCounter(),
            appSampler: AppSampler(),
            // A denied Apple Event means every site rule silently stops matching — surface it in
            // the menu bar. Only meaningful when the team has site rules at all; without them the
            // sampler never scripts the browser, so the callback never fires either.
            siteResolver: AppleScriptSiteResolver(onAutomationDenied: { [weak self] denied in
                Task { @MainActor in self?.statusItem.setAutomationDenied(denied) }
            }),
            livePolicy: livePolicy,
            store: ActivitySampleStore.shared,
            isTracking: { [weak self] in self?.timeTracker.isRunning ?? false },
            onSampled: { [weak self] in Task { await self?.activitySync?.syncNow() } },
            onCategorized: { [weak self] category in
                // Hop to the main actor — the monitor/tally are main-thread-only (like DailyTotal).
                Task { @MainActor in
                    guard let self else { return }
                    let now = Date()
                    self.distractionMonitor?.tick(category: category, now: now)
                    if category == .unproductive { self.dailyDistraction?.addUnproductive(now: now) }
                }
            }
        )
        activitySampler = sampler
        sampler.start()
    }

    /// Start the sync engine once the user is ready. Sync is NOT a capture path (it uploads the
    /// employee's own already-recorded entries), so — unlike auto-tracking — it is safe on BOTH the
    /// online and the offline-marker `becomeReady()` paths: offline just yields transient failures
    /// and backs off. Idempotent (guarded), so re-entry after ack does nothing.
    @MainActor private func startSyncIfNeeded() {
        guard syncEngine == nil else { return }
        let base = AppDelegate.apiBaseURL()
        let engine = SyncEngine(
            buffer: BufferStore.shared,
            uploader: TimeEntryUploader(baseURL: base, session: session),
            idleUploader: TimeEntryUploader(baseURL: base, session: session, path: "idle-events")
        )
        syncEngine = engine
        engine.start()

        let screenshotEngine = ScreenshotSyncEngine(
            buffer: ImageBufferStore.shared,
            uploader: ScreenshotUploader(baseURL: base, session: session)
        )
        screenshotSync = screenshotEngine
        screenshotEngine.start()

        let activityEngine = ActivityBatchSyncEngine(
            store: ActivitySampleStore.shared,
            uploader: ActivitySampleUploader(baseURL: base, session: session)
        )
        activitySync = activityEngine
        activityEngine.start()
    }

    /// Sign-out: stop the timer first (no scheduled cycle can overlap the final drain — the
    /// engine's `isDraining` re-entry guard is not actor-atomic), then do a best-effort final
    /// drain (needs the still-valid token → BEFORE logout), then clear the buffer so the next
    /// user on this Mac can't upload the previous user's entries under their own token
    /// (CreateTimeEntry has no userId — the server attributes by token).
    private func flushAndClearBuffer() async {
        let engine = await MainActor.run { self.syncEngine }
        await MainActor.run { engine?.stop() }   // stop the timer FIRST — no cycle overlaps the final drain
        await engine?.syncNow()                  // best-effort final drain (needs the still-valid token)
        await MainActor.run {
            self.syncEngine = nil
            BufferStore.shared.clear()
        }
        // Join any capture cycle already in flight FIRST: `stopAutoTracking()` invalidated the
        // timer but a cycle suspended mid-grab is not cancelled by that, so it could still enqueue.
        // After this awaits, no capture can run past this point (the joined cycle won't reschedule
        // — `stop()` set `started=false`), so its image (if any) is included in the drain below and
        // nothing can enqueue after `clear()`.
        let scheduler = await MainActor.run { self.screenshotScheduler }
        await scheduler?.finishInFlight()
        await MainActor.run { self.screenshotSync?.stop() }
        await self.screenshotSync?.syncNow()   // best-effort final drain (still-valid token)
        await MainActor.run {
            self.screenshotSync = nil
            self.screenshotScheduler = nil
            ImageBufferStore.shared.clear()   // cross-user integrity: no leftover images upload under the next user
        }
        // Activity mirrors the screenshot ordering exactly: join the in-flight sampler cycle
        // first, stop the sync engine, do a best-effort final drain on the still-valid token,
        // then clear the buffer — samples are attributed by token, so a leftover sample must
        // never upload under the next user (CLAUDE.md §1 cross-user integrity).
        let activityJoin = await MainActor.run { self.activitySampler }
        await activityJoin?.finishInFlight()
        await MainActor.run { self.activitySync?.stop() }
        await self.activitySync?.syncNow()   // best-effort final drain (still-valid token)
        await MainActor.run {
            self.activitySync = nil
            self.activitySampler = nil
            ActivitySampleStore.shared.clear()   // cross-user integrity: no leftover samples upload under the next user
        }
    }

    @MainActor private func installAutoTracking(thresholdMinutes: Int) {
        guard autoCoordinator == nil else { return }        // idempotent
        let coordinator = AutoTrackingCoordinator(
            tracker: timeTracker,
            buffer: BufferStore.shared,
            thresholdSeconds: thresholdMinutes * 60,
            currentSelection: { [weak self] in
                self?.menuViewModel.selectionForAuto ?? .init(projectId: nil, taskId: nil)
            },
            presentAwayPrompt: { minutes, resolve in
                AwayResolutionWindowController.present(minutes: minutes, resolve: resolve)
            },
            onIdleThresholdCrossed: { [weak self] seconds in
                let minutes = max(1, Int((Double(seconds) / 60.0).rounded()))
                self?.notifier?.notify(id: "idle-nudge", title: "Time tracking",
                                       body: "Idle for \(minutes) min — still working?")
            }
        )
        let manual = ManualIdleCoordinator(
            tracker: timeTracker,
            buffer: BufferStore.shared,
            thresholdSeconds: thresholdMinutes * 60,
            presentAwayPrompt: { minutes, resolve in
                AwayResolutionWindowController.present(minutes: minutes, resolve: resolve)
            },
            onEntryReplaced: { [weak self] idle in self?.menuViewModel.continueClockAfterDiscard(idleSeconds: idle) }
        )
        let fanOut = FanOutSignalReceiver([coordinator, manual])
        let observer = WorkspaceObserver(receiver: fanOut)
        self.autoCoordinator = coordinator
        self.manualIdleCoordinator = manual
        self.signalFanOut = fanOut
        self.workspaceObserver = observer
        observer.start()
        coordinator.activate()      // manual coordinator self-arms on first manual signal
    }

    @MainActor private func stopAutoTracking() {
        workspaceObserver?.stop()
        autoCoordinator?.deactivate()
        manualIdleCoordinator?.deactivate()
        // Deactivate first (records any pending away as UNRESOLVED and makes the monitors
        // inactive), THEN close a still-open away prompt so its resolve() is a no-op.
        AwayResolutionWindowController.dismissIfShowing()
        workspaceObserver = nil
        autoCoordinator = nil
        manualIdleCoordinator = nil
        signalFanOut = nil
        // Cross-user integrity (CLAUDE.md §1): this runs on sign-out, BEFORE userIdBox is
        // cleared, so a still-open recovery prompt belongs to the user who's signing out. Tear
        // it down here too — its discard path best-effort closes their own still-open server
        // row (never enqueued to BufferStore) and clears the live-span file — rather than
        // leaving it on screen for the next user to act on. Reset the one-shot flag as well, so
        // the NEXT user who signs in gets their own span evaluated by `recoverLiveSpanIfNeeded` instead
        // of being silently skipped because a prior user already "used" the attempt.
        RecoveryWindowController.dismissIfShowing()
        hasAttemptedRecovery = false
        // Same one-shot-per-session reset, same reason: the next user who signs in on this Mac
        // gets their own single fresh-install fallback attempt (`refreshProjects()`) instead of
        // inheriting the outgoing user's "already tried" state.
        hasAttemptedRecentSelectionFallback = false
        // Invalidate the interval timer so no NEW cycle is scheduled. A cycle already in flight is
        // NOT cancelled by this — `flushAndClearBuffer()` joins it via `finishInFlight()` before
        // clearing the buffer, so the reference must survive here (do not nil it).
        screenshotScheduler?.stop()
        activitySampler?.stop()
        // Slice 2.4 nudges — cross-user integrity (CLAUDE.md §1): clear the notifier's pending +
        // delivered items and reset all local nudge state so the prior user's "Today: Xh"/idle
        // nudge never lingers into the next user's session (same class as the recovery-prompt leak).
        endOfDayScheduler?.stop()
        endOfDayScheduler = nil
        manualNudgeMonitor?.stop()
        manualNudgeMonitor = nil
        dailyTotal?.reset()
        dailyTotal = nil
        // Slice 3.4 — same cross-user integrity guard: clear the distraction streak + today's tally
        // so a prior user's nudge state never bleeds into the next user's session. Dismiss any
        // fallback nudge window still on screen for the same reason (the away-prompt leak class).
        distractionMonitor?.stop()
        distractionMonitor = nil
        DistractionNudgeWindowController.dismissIfShowing()
        dailyDistraction?.reset()
        dailyDistraction = nil
        timeTracker.onSpanClosed = nil
        notifier?.clearAll()
        notifier = nil
    }

    @MainActor private func presentAck(policy: EffectivePolicy, userId: String) {
        statusItem.closePopover()   // don't leave the dropdown lingering behind the policy window
        let controller = AckWindowController(policy: policy, userId: userId, ackClient: ackClient) { [weak self] in
            self?.ackMarker.record(userId: userId, policyVersion: policy.policyVersion)
            Task { await self?.proceedToPolicy() }
        }
        ackWindow = controller
        controller.show()
    }

    private static func apiBaseURL() -> URL {
        if let s = Bundle.main.object(forInfoDictionaryKey: "TimeTrackAPIBaseURL") as? String,
           let url = URL(string: s) { return url }
        return URL(string: "http://127.0.0.1:3001/v1")!
    }

    private static func dashboardURL() -> URL {
        if let s = Bundle.main.object(forInfoDictionaryKey: "TimeTrackDashboardURL") as? String,
           let url = URL(string: s) { return url }
        return URL(string: "http://127.0.0.1:3000")!
    }
}
