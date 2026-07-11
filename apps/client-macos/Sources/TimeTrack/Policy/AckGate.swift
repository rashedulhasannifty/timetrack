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
    private let policyClient: PolicyClient

    init(policyClient: PolicyClient) {
        self.policyClient = policyClient
    }

    /// The ONLY entry point to any capture API. Screenshot, activity sampling,
    /// and idle detection all route through here.
    func withCaptureAllowed<T>(_ body: () async throws -> T) async throws -> T {
        let policy = try await policyClient.effectivePolicy()
        guard !policy.ackRequired else { throw AckGateError.notAcknowledged }
        return try await body()
    }
}
