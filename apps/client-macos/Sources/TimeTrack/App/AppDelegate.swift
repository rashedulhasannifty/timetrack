import AppKit

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
    private let timeTracker: TimeTracker
    private let menuViewModel: MenuViewModel
    private let liveSpanStore: LiveSpanStore
    private let userIdBox: UserIdBox

    private var loginWindow: LoginWindowController?
    private var ackWindow: AckWindowController?
    private var autoCoordinator: AutoTrackingCoordinator?
    private var workspaceObserver: WorkspaceObserver?
    private var syncEngine: SyncEngine?
    private var screenshotScheduler: ScreenshotScheduler?
    private var screenshotSync: ScreenshotSyncEngine?
    private var activitySampler: ActivitySampler?
    private var activitySync: ActivityBatchSyncEngine?
    private var heartbeatTimer: Timer?
    private var hasAttemptedRecovery = false

    private var notifier: LocalNotifying?
    private var dailyTotal: DailyTotalAccumulator?
    private var endOfDayScheduler: EndOfDayScheduler?
    private var manualNudgeMonitor: ManualNudgeMonitor?
    private var distractionMonitor: DistractionMonitor?
    private var dailyDistraction: DailyDistractionAccumulator?
    private let endOfDayHour = 18
    private let forgotToStartMinutes = 10
    // 60s sampler window ⇒ threshold in minutes == consecutive-sample count (see ActivitySampler).
    private let distractionThresholdMinutes = 10

    override init() {
        let baseURL = AppDelegate.apiBaseURL()
        let session = AuthSession(client: AuthClient(baseURL: baseURL), store: KeychainTokenStore())
        self.session = session
        self.policyClient = PolicyClient(baseURL: baseURL, session: session)
        self.ackGate = AckGate(policyProvider: policyClient)
        self.ackClient = AckClient(baseURL: baseURL, session: session)
        let ackMarker = AckMarker()
        self.ackMarker = ackMarker
        self.projectClient = ProjectClient(baseURL: baseURL, session: session)
        let projectCache = ProjectCache(fileURL: ProjectCache.defaultURL())
        self.projectCache = projectCache

        let userIdBox = UserIdBox()
        self.userIdBox = userIdBox

        let liveSpanStore = LiveSpanStore(
            fileURL: LiveSpanStore.defaultURL(),
            currentUserId: { [userIdBox] in userIdBox.value }
        )
        self.liveSpanStore = liveSpanStore

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
            onQuit: { NSApp.terminate(nil) }
        )
        self.menuViewModel = menuViewModel
        super.init()
        presentLoginBox.call = { [weak self] in self?.presentLogin() }
        stopAutoBox.call = { [weak self] in self?.stopAutoTracking() }
        flushBufferBox.call = { [weak self] in await self?.flushAndClearBuffer() }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Keep the indicator in sync with tracking state (always visible; no kill switch).
        // onPhaseChanged fires on the main thread (from a SwiftUI button action).
        menuViewModel.onPhaseChanged = { [weak self] isTracking in
            self?.statusItem.setState(isTracking ? .tracking : .idle)
        }
        statusItem.install(content: MenuBarView(viewModel: menuViewModel))
        startHeartbeat()
        Task { await start() }
    }

    @MainActor private func startHeartbeat() {
        let timer = Timer(timeInterval: 60, repeats: true) { [weak self] _ in
            guard let self, self.timeTracker.isRunning else { return }
            self.liveSpanStore.heartbeat(at: Date())
        }
        RunLoop.main.add(timer, forMode: .common)
        heartbeatTimer = timer
    }

    private func start() async {
        if await session.bootstrap() {
            await proceedToPolicy()
        } else {
            await MainActor.run { presentLogin() }
        }
    }

    @MainActor private func presentLogin() {
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

    /// Enable manual tracking and load projects (network → cache fallback).
    private func becomeReady() async {
        // Resolve the userId once (an `await`, since `AuthSession` is an actor) and stamp
        // `userIdBox` on the main thread BEFORE `markReady()` flips `isReady` — that flip is
        // the only thing that lets `TimeTracker.start()` run, so the box is always populated
        // before any span can be stamped. The same value gates recovery below.
        let currentUserId = await session.userId()
        await MainActor.run {
            userIdBox.value = currentUserId
            menuViewModel.markReady()
        }
        await MainActor.run { self.installNudgeInfra() }
        await MainActor.run { menuViewModel.projects = projectCache.load() } // instant, offline-safe
        if let fresh = try? await projectClient.list() {
            projectCache.save(fresh)
            await MainActor.run { menuViewModel.projects = fresh }
        }
        await MainActor.run { startSyncIfNeeded() }
        await MainActor.run { recoverLiveSpanIfNeeded(currentUserId: currentUserId) }
    }

    /// Local-notification infra (not a capture path — safe on both ready paths). Idempotent.
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

        // Both the tally (`sampleSeconds` default 60) and the monitor threshold (minutes) assume
        // the ActivitySampler's 60s window — one sample == one minute. If that interval ever
        // changes, revisit `sampleSeconds` here and `distractionThresholdMinutes` together.
        let distraction = DailyDistractionAccumulator()
        self.dailyDistraction = distraction
        self.distractionMonitor = DistractionMonitor(
            notifier: notifier, threshold: distractionThresholdMinutes)

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
        RecoveryWindowController.present(minutes: minutes) { [weak self] action in
            guard let self else { return }
            // Defense-in-depth: the prompt is non-modal and can outlive the user who opened it
            // (e.g. left open across a sign-out/sign-in). Re-check against the CURRENT
            // logged-in user (the live `userIdBox` value, not the `currentUserId` captured when
            // this closure was built) so a stale "Keep" click from a prior user's prompt can
            // never enqueue that user's span into whoever is signed in now.
            if action == .keep, LiveSpanStore.shouldRecover(span: span, currentUserId: self.userIdBox.value) {
                self.timeTracker.recordSpan(
                    id: span.entryId, start: span.startTime, end: span.lastAlive,
                    projectId: span.projectId, taskId: span.taskId,
                    source: TimeTracker.Source(rawValue: span.source) ?? .manual
                )
            }
            self.liveSpanStore.clear()
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
            onCaptured: { [weak self] in Task { await self?.screenshotSync?.syncNow() } },
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
        let sampler = ActivitySampler(
            ackGate: ackGate,
            counter: EventCounter(),
            appSampler: AppSampler(),
            siteResolver: AppleScriptSiteResolver(),
            categorizer: Categorizer(
                productiveApps: policy.settings.productiveApps,
                unproductiveApps: policy.settings.unproductiveApps,
                productiveSites: policy.settings.productiveSites,
                unproductiveSites: policy.settings.unproductiveSites),
            store: ActivitySampleStore.shared,
            captureWindowTitles: policy.settings.captureWindowTitles,
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
        let observer = WorkspaceObserver(receiver: coordinator)
        self.autoCoordinator = coordinator
        self.workspaceObserver = observer
        observer.start()
        coordinator.activate()
    }

    @MainActor private func stopAutoTracking() {
        workspaceObserver?.stop()
        autoCoordinator?.deactivate()
        // Deactivate first (records any pending away as UNRESOLVED and makes the monitor
        // inactive), THEN close a still-open away prompt so its resolve() is a no-op.
        AwayResolutionWindowController.dismissIfShowing()
        workspaceObserver = nil
        autoCoordinator = nil
        // Cross-user integrity (CLAUDE.md §1): this runs on sign-out. A still-open recovery
        // prompt belongs to the user who's signing out, so tear it down here too (its discard
        // path clears the live-span file — nothing gets enqueued) rather than leaving it on
        // screen for the next user to act on. Reset the one-shot flag as well, so the NEXT
        // user who signs in gets their own span evaluated by `recoverLiveSpanIfNeeded` instead
        // of being silently skipped because a prior user already "used" the attempt.
        RecoveryWindowController.dismissIfShowing()
        hasAttemptedRecovery = false
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
        // so a prior user's nudge state never bleeds into the next user's session.
        distractionMonitor?.stop()
        distractionMonitor = nil
        dailyDistraction?.reset()
        dailyDistraction = nil
        timeTracker.onSpanClosed = nil
        notifier?.clearAll()
        notifier = nil
    }

    @MainActor private func presentAck(policy: EffectivePolicy, userId: String) {
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
