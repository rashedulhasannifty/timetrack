import XCTest
@testable import TimeTrack

final class ActivitySamplerTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)
    private final class CategoryBox { var values: [TimeTrack.Category] = [] }

    private func makeSampler(
        ackRequired: Bool,
        isTracking: @escaping () -> Bool,
        counter: InputCounting,
        site: SiteResolving = FakeSiteResolver(host: nil),
        app: AppSampling = FakeAppSampler(),
        buffer: ActivitySampleBuffering,
        policy: PolicyProviding? = nil,
        captureWindowTitles: Bool = true,
        onCategorized: @escaping (TimeTrack.Category) -> Void = { _ in }
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
            sleep: { _ in },  // instant
            onCategorized: onCategorized
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
        let measured = await sampler.captureTick()
        XCTAssertFalse(measured) // skip path → caller must wait a full interval before retrying
        XCTAssertTrue(buffer.samples.isEmpty)
        XCTAssertEqual(policy.calls, 0) // isTracking checked BEFORE the gate
    }

    func testClosedGateDoesNotEnqueue() async {
        let buffer = MemoryActivityBuffer()
        let sampler = makeSampler(ackRequired: true, isTracking: { true },
                                  counter: halfActiveCounter(), buffer: buffer)
        let measured = await sampler.captureTick()
        XCTAssertFalse(measured) // skip path → caller must wait a full interval before retrying
        XCTAssertTrue(buffer.samples.isEmpty)
    }

    func testOneCycleEnqueuesOneCategorizedSample() async {
        let buffer = MemoryActivityBuffer()
        let sampler = makeSampler(ackRequired: false, isTracking: { true },
                                  counter: halfActiveCounter(),
                                  site: FakeSiteResolver(host: "youtube.com"), buffer: buffer)
        let measured = await sampler.captureTick()
        XCTAssertTrue(measured) // fully measured → caller schedules the next window back-to-back
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

    /// Proves the sampler itself never skips a window between two measured cycles — the scheduling
    /// fix (measured → 0 delay) only pays off if back-to-back `captureTick()` calls each enqueue.
    func testTwoConsecutiveCyclesEachEnqueueASample() async {
        let buffer = MemoryActivityBuffer()
        let sampler = makeSampler(ackRequired: false, isTracking: { true },
                                  counter: halfActiveCounter(), buffer: buffer)
        let first = await sampler.captureTick()
        let second = await sampler.captureTick()
        XCTAssertTrue(first)
        XCTAssertTrue(second)
        XCTAssertEqual(buffer.samples.count, 2)
    }

    func testMeasuredTickInvokesOnCategorizedWithCategory() async {
        let buffer = MemoryActivityBuffer()
        let box = CategoryBox()
        let sampler = makeSampler(ackRequired: false, isTracking: { true },
                                  counter: halfActiveCounter(),
                                  site: FakeSiteResolver(host: "youtube.com"),
                                  buffer: buffer,
                                  onCategorized: { box.values.append($0) })
        let measured = await sampler.captureTick()
        XCTAssertTrue(measured)
        XCTAssertEqual(box.values, [TimeTrack.Category.unproductive]) // host youtube.com → UNPRODUCTIVE
    }

    func testSkipPathDoesNotInvokeOnCategorized() async {
        let buffer = MemoryActivityBuffer()
        let box = CategoryBox()
        let sampler = makeSampler(ackRequired: false, isTracking: { false }, // not tracking → skip
                                  counter: halfActiveCounter(), buffer: buffer,
                                  onCategorized: { box.values.append($0) })
        _ = await sampler.captureTick()
        XCTAssertTrue(box.values.isEmpty)
    }

    /// A cycle cancelled mid-flight (sign-out teardown calling `stop()`, which cancels
    /// `currentCycle`) must never persist a partial-window sample. The injected `sleep` cancels the
    /// surrounding task on its first invocation — the earliest point a real cancellation could land
    /// — so this deterministically exercises the `Task.isCancelled` guard before `store.enqueue`.
    func testCancelledCycleDoesNotEnqueueAPartialSample() async {
        let buffer = MemoryActivityBuffer()
        var task: Task<Bool, Never>?
        let sampler = ActivitySampler(
            ackGate: AckGate(policyProvider: FakePolicyProvider(ackRequired: false)),
            counter: halfActiveCounter(),
            appSampler: FakeAppSampler(),
            siteResolver: FakeSiteResolver(host: nil),
            categorizer: Categorizer(productiveApps: ["github.com"], unproductiveApps: ["youtube.com"]),
            store: buffer,
            captureWindowTitles: true,
            intervalSeconds: 60,
            subBuckets: 12,
            isTracking: { true },
            clock: { self.t0 },
            sleep: { _ in task?.cancel() }
        )
        task = Task { await sampler.captureTick() }
        let measured = await task?.value
        XCTAssertEqual(measured, false)
        XCTAssertTrue(buffer.samples.isEmpty)
    }
}
