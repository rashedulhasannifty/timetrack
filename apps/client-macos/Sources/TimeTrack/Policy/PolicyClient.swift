import Foundation

/// Mirrors `EffectivePolicySchema` in @timetrack/contracts. `ackRequired` is the gate:
/// while true, the client MUST NOT capture (PRD §4.1). Enforced server-side too.
struct EffectivePolicy: Decodable {
    let ackRequired: Bool
    let policyVersion: String
    let policyText: String
}

/// Fetches the effective monitoring policy from the API. The AckGate calls this before
/// any capture path may run.
final class PolicyClient {
    private let baseURL: URL
    private let accessToken: () -> String?

    init(baseURL: URL, accessToken: @escaping () -> String?) {
        self.baseURL = baseURL
        self.accessToken = accessToken
    }

    func effectivePolicy() async throws -> EffectivePolicy {
        var request = URLRequest(url: baseURL.appendingPathComponent("policy/effective"))
        if let token = accessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(EffectivePolicy.self, from: data)
    }
}
