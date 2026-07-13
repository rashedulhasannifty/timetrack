import AppKit

/// A callback holder for `onSignOut`'s forward reference to `presentLogin()` (see
/// `AppDelegate.init`): `self` isn't usable yet when the closure capturing it is built.
private final class CallbackBox {
    var call: (@MainActor () -> Void)?
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

    private var loginWindow: LoginWindowController?
    private var ackWindow: AckWindowController?

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

        let tracker = TimeTracker(buffer: BufferStore())
        self.timeTracker = tracker

        // `onSignOut` is built as an argument to MenuViewModel's own initializer, before
        // `super.init()` runs (so `self`/AppDelegate can't be captured yet). This box stands
        // in for `presentLogin()`, not available as a value yet; it's filled in below once
        // `self` exists, before the closure can ever run. It's a `let`-bound reference type
        // (not a captured `var`) so the escaping Task below doesn't trip Swift 6's
        // captured-var-across-concurrency-domains diagnostic.
        let presentLoginBox = CallbackBox()

        let menuViewModel = MenuViewModel(
            tracker: tracker,
            dashboardURL: AppDelegate.dashboardURL(),
            openURL: { NSWorkspace.shared.open($0) },
            onSignOut: {
                Task {
                    // Read the user before logout clears the in-memory access token the
                    // sub is decoded from; a stale marker must never survive to grant
                    // readiness to whoever signs in next (CLAUDE.md §1 fail-safe posture).
                    // MenuViewModel.reset() (called by signOut() before this closure runs)
                    // already stopped/enqueued any live span and cleared the VM's own state.
                    if let userId = await session.userId() { ackMarker.clear(userId: userId) }
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
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Keep the indicator in sync with tracking state (always visible; no kill switch).
        // onPhaseChanged fires on the main thread (from a SwiftUI button action).
        menuViewModel.onPhaseChanged = { [weak self] isTracking in
            self?.statusItem.setState(isTracking ? .tracking : .idle)
        }
        statusItem.install(content: MenuBarView(viewModel: menuViewModel))
        Task { await start() }
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
        await MainActor.run { menuViewModel.markReady() }
        await MainActor.run { menuViewModel.projects = projectCache.load() } // instant, offline-safe
        if let fresh = try? await projectClient.list() {
            projectCache.save(fresh)
            await MainActor.run { menuViewModel.projects = fresh }
        }
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
