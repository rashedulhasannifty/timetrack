import Foundation

/// Mirrors `EffectivePolicySchema` in @timetrack/contracts. `ackRequired` is the gate:
/// while true, the client MUST NOT capture (PRD §4.1). Enforced server-side too.
struct EffectivePolicy: Decodable {
    let ackRequired: Bool
    let policyVersion: String
    let policyText: String
    let settings: Settings

    /// Subset of @timetrack/contracts `TeamSettingsSchema` that the client acts on. Extra keys
    /// in the JSON are ignored by `Decodable`.
    struct Settings: Decodable {
        let idleThresholdMinutes: Int
        let autoStartOnLogin: Bool
        let screenshotsEnabled: Bool
        let screenshotIntervalMinutes: Int
    }
}

protocol PolicyProviding {
    func effectivePolicy() async throws -> EffectivePolicy
}

/// Fetches the effective monitoring policy. The AckGate calls this before any capture path
/// may run. On a 401 it forces a token refresh and retries once; a second 401 (or any other
/// failure) propagates, and AckGate keeps the gate closed (fail-safe).
final class PolicyClient: PolicyProviding {
    private let baseURL: URL
    private let session: AuthSession

    init(baseURL: URL, session: AuthSession) {
        self.baseURL = baseURL
        self.session = session
    }

    func effectivePolicy() async throws -> EffectivePolicy {
        let token = try await session.accessToken()
        let (data, status) = try await fetch(token: token)
        if status == 401 {
            let refreshed = try await session.forceRefresh()
            let (data2, status2) = try await fetch(token: refreshed)
            guard status2 == 200 else { throw AckGateError.policyUnavailable }
            return try JSONDecoder().decode(EffectivePolicy.self, from: data2)
        }
        guard status == 200 else { throw AckGateError.policyUnavailable }
        return try JSONDecoder().decode(EffectivePolicy.self, from: data)
    }

    private func fetch(token: String) async throws -> (Data, Int) {
        var request = URLRequest(url: baseURL.appendingPathComponent("policy/effective"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
}
