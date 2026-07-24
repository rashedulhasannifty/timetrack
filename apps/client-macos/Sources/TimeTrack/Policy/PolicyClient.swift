import Foundation

/// Mirrors `EffectivePolicySchema` in @timetrack/contracts. `ackRequired` is the gate:
/// while true, the client MUST NOT capture (PRD §4.1). Enforced server-side too.
struct EffectivePolicy: Decodable {
    let ackRequired: Bool
    let policyVersion: String
    let policyText: String
    let settings: Settings

    /// Subset of @timetrack/contracts `TeamSettingsSchema` that the client acts on. Extra keys
    /// in the JSON are ignored by `Decodable`. Activity fields default to the server's defaults so
    /// a legacy/partial policy JSON (missing them) still decodes.
    struct Settings: Decodable {
        let idleThresholdMinutes: Int
        let autoStartOnLogin: Bool
        let screenshotsEnabled: Bool
        let screenshotIntervalMinutes: Int
        let captureWindowTitles: Bool
        let productiveApps: [String]
        let unproductiveApps: [String]
        let productiveSites: [String]
        let unproductiveSites: [String]

        /// Explicit memberwise init: declaring a custom `init(from:)` below suppresses the
        /// synthesized memberwise initializer, so test doubles (`FakePolicyProvider`) that
        /// construct `Settings` directly would break. Optional fields default here so existing
        /// call sites (written before this field was added) keep compiling unchanged — do NOT
        /// edit `FakePolicyProvider`.
        init(idleThresholdMinutes: Int, autoStartOnLogin: Bool, screenshotsEnabled: Bool,
             screenshotIntervalMinutes: Int, captureWindowTitles: Bool = true,
             productiveApps: [String] = [], unproductiveApps: [String] = [],
             productiveSites: [String] = [], unproductiveSites: [String] = []) {
            self.idleThresholdMinutes = idleThresholdMinutes
            self.autoStartOnLogin = autoStartOnLogin
            self.screenshotsEnabled = screenshotsEnabled
            self.screenshotIntervalMinutes = screenshotIntervalMinutes
            self.captureWindowTitles = captureWindowTitles
            self.productiveApps = productiveApps
            self.unproductiveApps = unproductiveApps
            self.productiveSites = productiveSites
            self.unproductiveSites = unproductiveSites
        }

        enum CodingKeys: String, CodingKey {
            case idleThresholdMinutes, autoStartOnLogin, screenshotsEnabled, screenshotIntervalMinutes
            case captureWindowTitles, productiveApps, unproductiveApps
            case productiveSites, unproductiveSites
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            idleThresholdMinutes = try c.decode(Int.self, forKey: .idleThresholdMinutes)
            autoStartOnLogin = try c.decode(Bool.self, forKey: .autoStartOnLogin)
            screenshotsEnabled = try c.decode(Bool.self, forKey: .screenshotsEnabled)
            screenshotIntervalMinutes = try c.decode(Int.self, forKey: .screenshotIntervalMinutes)
            captureWindowTitles = try c.decodeIfPresent(Bool.self, forKey: .captureWindowTitles) ?? true
            productiveApps = try c.decodeIfPresent([String].self, forKey: .productiveApps) ?? []
            unproductiveApps = try c.decodeIfPresent([String].self, forKey: .unproductiveApps) ?? []
            productiveSites = try c.decodeIfPresent([String].self, forKey: .productiveSites) ?? []
            unproductiveSites = try c.decodeIfPresent([String].self, forKey: .unproductiveSites) ?? []
        }
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
