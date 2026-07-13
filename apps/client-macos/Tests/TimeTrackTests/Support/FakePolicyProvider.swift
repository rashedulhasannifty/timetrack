@testable import TimeTrack

final class FakePolicyProvider: PolicyProviding {
    var result: Result<EffectivePolicy, Error>
    init(ackRequired: Bool) {
        self.result = .success(EffectivePolicy(ackRequired: ackRequired, policyVersion: "v1", policyText: "policy"))
    }
    init(error: Error) { self.result = .failure(error) }
    func effectivePolicy() async throws -> EffectivePolicy { try result.get() }
}
