import Foundation
@testable import TimeTrack

/// Returns snapshots from a fixed script (one per sub-bucket). Values are cumulative.
final class FakeInputCounter: InputCounting {
    private var scripted: [(UInt64, UInt64)]
    private var last: (UInt64, UInt64) = (0, 0)
    init(_ scripted: [(UInt64, UInt64)]) { self.scripted = scripted }
    func snapshot() -> (keys: UInt64, pointer: UInt64) {
        if !scripted.isEmpty { last = scripted.removeFirst() }
        return (keys: last.0, pointer: last.1)
    }
}

final class FakeAppSampler: AppSampling {
    let appName: String; let windowTitle: String?
    init(appName: String = "Google Chrome", windowTitle: String? = nil) {
        self.appName = appName; self.windowTitle = windowTitle
    }
    func sample(captureWindowTitles: Bool) -> (appName: String, windowTitle: String?) {
        (appName, captureWindowTitles ? windowTitle : nil)
    }
}

final class FakeSiteResolver: SiteResolving {
    let host: String?
    init(host: String? = nil) { self.host = host }
    func currentHost() -> String? { host }
}

/// Minimal in-memory buffer for sampler tests.
final class MemoryActivityBuffer: ActivitySampleBuffering {
    private(set) var samples: [ActivitySample] = []
    func enqueue(_ sample: ActivitySample) { samples.append(sample) }
    func take(limit: Int) -> [ActivitySample] { Array(samples.prefix(limit)) }
    func remove(ids: [String]) { samples.removeAll { ids.contains($0.id) } }
    func prune(olderThan maxAge: TimeInterval, maxCount: Int) {}
    func clear() { samples.removeAll() }
}

/// Counts how many times the gate consulted policy (to prove no fetch on a stopped clock).
final class CountingPolicyProvider: PolicyProviding {
    private let inner: FakePolicyProvider
    private(set) var calls = 0
    init(ackRequired: Bool) { inner = FakePolicyProvider(ackRequired: ackRequired) }
    func effectivePolicy() async throws -> EffectivePolicy { calls += 1; return try await inner.effectivePolicy() }
}
