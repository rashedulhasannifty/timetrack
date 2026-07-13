import AppKit

/// Wires the app together. The AckGate (PRD §4.1) sits between every capture path and the
/// hardware APIs; nothing here starts capturing until the policy is acknowledged. No capture
/// service is constructed in Slice 1.7a — this proves auth + gate only.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let statusItem = StatusItemController()

    private let session: AuthSession
    private let policyClient: PolicyClient
    private let ackGate: AckGate
    private let ackClient: AckClient
    private var loginWindow: LoginWindowController?
    private var ackWindow: AckWindowController?

    override init() {
        let baseURL = AppDelegate.apiBaseURL()
        let session = AuthSession(client: AuthClient(baseURL: baseURL), store: KeychainTokenStore())
        self.session = session
        self.policyClient = PolicyClient(baseURL: baseURL, session: session)
        self.ackGate = AckGate(policyProvider: policyClient)
        self.ackClient = AckClient(baseURL: baseURL, session: session)
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem.install()
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
            }
            // else: ready. AckGate is available; capture paths (1.7b+) will route through it.
        } catch {
            // Fail-safe: gate stays closed. A retry surface lands with capture UI in 1.7b.
            await MainActor.run { statusItem.showPolicyUnavailable() }
        }
    }

    @MainActor private func presentAck(policy: EffectivePolicy, userId: String) {
        let controller = AckWindowController(policy: policy, userId: userId, ackClient: ackClient) { [weak self] in
            // Re-fetch to confirm the gate opened; nothing to start yet in 1.7a.
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
}
