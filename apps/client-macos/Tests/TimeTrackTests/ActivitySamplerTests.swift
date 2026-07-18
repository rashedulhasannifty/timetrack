import XCTest
@testable import TimeTrack

final class ActivitySamplerTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    private func makeSampler(
        ackRequired: Bool,
        isTracking: @escaping () -> Bool,
        counter: InputCounting,
        site: SiteResolving = FakeSiteResolver(host: nil),
        app: AppSampling = FakeAppSampler(),
        buffer: ActivitySampleBuffering,
        policy: PolicyProviding? = nil,
        captureWindowTitles: Bool = true
    ) -> ActivitySampler {
        ActivitySampler(
            ackGate: AckGate(policyProvider: policy ?? FakePolicyProvider(ackRequired: ackRequired)),
            counter: counter,
            appSampler: app,
            siteResolver: site,
            categorizer: Categorizer(productiveApps: ["github.com"], unproductiveApps: ["youtube.com"]),
            store: buffer,
            captureWindowTitles: captureWindowTitles,
            intervalSeconds: 60,
            subBuckets: 12,
            isTracking: isTracking,
            clock: { self.t0 },
            sleep: { _ in }  // instant
        )
    }

    // 12 buckets: 6 with input, 6 idle → 50%.
    private func halfActiveCounter() -> FakeInputCounter {
        var script: [(UInt64, UInt64)] = [(0, 0)] // initial snapshot before the loop
        var keys: UInt64 = 0
        for i in 0..<12 { if i % 2 == 0 { keys += 1 }; script.append((keys, 0)) }
        return FakeInputCounter(script)
    }

    func testStoppedClockNeitherSamplesNorFetchesPolicy() async {
        let buffer = MemoryActivityBuffer()
        let policy = CountingPolicyProvider(ackRequired: false)
        let sampler = makeSampler(ackRequired: false, isTracking: { false },
                                  counter: halfActiveCounter(), buffer: buffer, policy: policy)
        await sampler.captureTick()
        XCTAssertTrue(buffer.samples.isEmpty)
        XCTAssertEqual(policy.calls, 0) // isTracking checked BEFORE the gate
    }

    func testClosedGateDoesNotEnqueue() async {
        let buffer = MemoryActivityBuffer()
        let sampler = makeSampler(ackRequired: true, isTracking: { true },
                                  counter: halfActiveCounter(), buffer: buffer)
        await sampler.captureTick()
        XCTAssertTrue(buffer.samples.isEmpty)
    }

    func testOneCycleEnqueuesOneCategorizedSample() async {
        let buffer = MemoryActivityBuffer()
        let sampler = makeSampler(ackRequired: false, isTracking: { true },
                                  counter: halfActiveCounter(),
                                  site: FakeSiteResolver(host: "youtube.com"), buffer: buffer)
        await sampler.captureTick()
        XCTAssertEqual(buffer.samples.count, 1)
        let s = buffer.samples[0]
        XCTAssertEqual(s.activityPct, 50)
        XCTAssertEqual(s.category, "UNPRODUCTIVE") // host youtube.com wins
        XCTAssertEqual(s.appName, "Google Chrome")
    }

    func testWindowTitlePolicyRespected() async {
        let buffer = MemoryActivityBuffer()
        let sampler = makeSampler(ackRequired: false, isTracking: { true },
                                  counter: halfActiveCounter(),
                                  app: FakeAppSampler(appName: "Xcode", windowTitle: "secret.txt"),
                                  buffer: buffer, captureWindowTitles: false)
        await sampler.captureTick()
        XCTAssertNil(buffer.samples.first?.windowTitle)
    }
}
