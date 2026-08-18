import Foundation

/// PRD §4.1 — monitoring MUST NOT run until the signed-in user has acknowledged
/// the monitoring policy. This is a structural gate, not a runtime `if` scattered
/// across call sites. Every capture path goes through `withCaptureAllowed`.
///
/// There is no admin override. There is no debug flag. Do not add one.
enum AckGateError: Error {
    case notAcknowledged
    case policyUnavailable
}

final class AckGate {
    private let policyProvider: PolicyProviding
    /// Receives each policy the gate fetches, once it has decided capture is allowed. This is how
    /// admin-editable settings reach a RUNNING client (see `LivePolicy`) — the gate already pays
    /// for this fetch every capture cycle, so nothing here adds a request. It deliberately does
    /// not fire on a closed gate: no capture, nothing to configure.
    private let onPolicy: (EffectivePolicy) -> Void

    init(policyProvider: PolicyProviding, onPolicy: @escaping (EffectivePolicy) -> Void = { _ in }) {
        self.policyProvider = policyProvider
        self.onPolicy = onPolicy
    }

    /// The ONLY entry point to any capture API. Screenshot, activity sampling,
    /// and idle detection all route through here.
    func withCaptureAllowed<T>(_ body: () async throws -> T) async throws -> T {
        let policy = try await policyProvider.effectivePolicy()
        guard !policy.ackRequired else { throw AckGateError.notAcknowledged }
        // Publish BEFORE the body so this very cycle already runs on the latest settings.
        onPolicy(policy)
        return try await body()
    }
}
