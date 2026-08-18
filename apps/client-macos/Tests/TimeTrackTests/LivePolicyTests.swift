import XCTest
@testable import TimeTrack

/// Settings an admin edits in the dashboard used to reach a running client only on relaunch,
/// while the settings page promised "≤60s". These pin the seam that closes that gap: AckGate
/// publishes the policy it already fetches each capture cycle, and everything policy-driven on
/// the capture path reads it through this box.
final class LivePolicyTests: XCTestCase {
    private func settings(
        sites: [String] = [], captureWindowTitles: Bool = true,
        alerts: Bool = false, threshold: Int = 10, repeatMinutes: Int = 5
    ) -> EffectivePolicy.Settings {
        EffectivePolicy.Settings(
            idleThresholdMinutes: 5, autoStartOnLogin: false, screenshotsEnabled: true,
            screenshotIntervalMinutes: 10, captureWindowTitles: captureWindowTitles,
            distractionAlertsEnabled: alerts, distractionThresholdMinutes: threshold,
            distractionRepeatMinutes: repeatMinutes, unproductiveSites: sites)
    }

    func testStartsSilentAndCategorizesNothingUntilAPolicyArrives() {
        let snapshot = LivePolicy().current
        XCTAssertFalse(snapshot.distraction.enabled)
        XCTAssertFalse(snapshot.categorizer.hasSiteRules)
        XCTAssertEqual(snapshot.categorizer.category(appName: "Google Chrome", host: "youtube.com"), .neutral)
    }

    func testAdoptsNewSiteRulesWithoutRebuilding() {
        let live = LivePolicy()
        live.update(from: settings(sites: ["youtube.com"]))
        let snapshot = live.current
        XCTAssertTrue(snapshot.categorizer.hasSiteRules)
        XCTAssertEqual(snapshot.categorizer.category(appName: "Google Chrome", host: "m.youtube.com"),
                       .unproductive)
    }

    func testAdoptsTheDistractionSettings() {
        let live = LivePolicy()
        live.update(from: settings(alerts: true, threshold: 3, repeatMinutes: 7))
        XCTAssertEqual(live.current.distraction,
                       DistractionSettings(enabled: true, thresholdMinutes: 3, repeatMinutes: 7))
    }

    func testAdoptsAWithdrawnWindowTitlePermission() {
        let live = LivePolicy()
        live.update(from: settings(captureWindowTitles: true))
        XCTAssertTrue(live.current.captureWindowTitles)
        live.update(from: settings(captureWindowTitles: false))
        XCTAssertFalse(live.current.captureWindowTitles, "an admin switching titles off applies live")
    }

    // MARK: - the gate is the thing that feeds it

    func testGatePublishesThePolicyItAlreadyFetches() async throws {
        let live = LivePolicy()
        let provider = FakePolicyProvider(ackRequired: false)
        provider.result = .success(EffectivePolicy(ackRequired: false, policyVersion: "v1",
                                                   policyText: "p",
                                                   settings: settings(sites: ["youtube.com"], alerts: true)))
        let gate = AckGate(policyProvider: provider, onPolicy: { live.update(from: $0.settings) })
        _ = try await gate.withCaptureAllowed { 1 }
        XCTAssertTrue(live.current.distraction.enabled)
        XCTAssertTrue(live.current.categorizer.hasSiteRules)
    }

    func testAdminEditReachesTheNextCaptureCycle() async throws {
        let live = LivePolicy()
        let provider = FakePolicyProvider(ackRequired: false)
        let gate = AckGate(policyProvider: provider, onPolicy: { live.update(from: $0.settings) })
        _ = try await gate.withCaptureAllowed { 1 }
        XCTAssertFalse(live.current.distraction.enabled, "server default: alerts off")

        // The admin turns alerts on and adds youtube.com — no relaunch, no extra request.
        provider.result = .success(EffectivePolicy(ackRequired: false, policyVersion: "v1",
                                                   policyText: "p",
                                                   settings: settings(sites: ["youtube.com"],
                                                                      alerts: true, threshold: 2)))
        _ = try await gate.withCaptureAllowed { 1 }
        XCTAssertEqual(live.current.distraction,
                       DistractionSettings(enabled: true, thresholdMinutes: 2, repeatMinutes: 5))
        XCTAssertEqual(live.current.categorizer.category(appName: "Google Chrome", host: "youtube.com"),
                       .unproductive)
    }

    func testAClosedGatePublishesNothing() async {
        let live = LivePolicy()
        let provider = FakePolicyProvider(ackRequired: true)
        provider.result = .success(EffectivePolicy(ackRequired: true, policyVersion: "v1",
                                                   policyText: "p",
                                                   settings: settings(sites: ["youtube.com"], alerts: true)))
        let gate = AckGate(policyProvider: provider, onPolicy: { live.update(from: $0.settings) })
        _ = try? await gate.withCaptureAllowed { 1 }
        // No acknowledgement ⇒ no capture ⇒ nothing to configure (CLAUDE.md §1: the gate decides).
        XCTAssertFalse(live.current.distraction.enabled)
        XCTAssertFalse(live.current.categorizer.hasSiteRules)
    }

    // MARK: - end to end: the sampler categorizes off the live snapshot

    func testSamplerPicksUpNewSiteRulesOnTheNextTick() async {
        let live = LivePolicy()
        let buffer = MemoryActivityBuffer()
        let provider = FakePolicyProvider(ackRequired: false)
        let sampler = ActivitySampler(
            ackGate: AckGate(policyProvider: provider, onPolicy: { live.update(from: $0.settings) }),
            counter: FakeInputCounter(Array(repeating: (0, 0), count: 13)),
            appSampler: FakeAppSampler(appName: "Google Chrome", bundleId: "com.google.Chrome"),
            siteResolver: FakeSiteResolver(host: "youtube.com"),
            livePolicy: live, store: buffer,
            intervalSeconds: 60, subBuckets: 12, isTracking: { true },
            clock: { Date(timeIntervalSince1970: 1_700_000_000) }, sleep: { _ in })

        _ = await sampler.captureTick()
        XCTAssertEqual(buffer.samples.last?.category, "NEUTRAL", "no site rules yet")

        provider.result = .success(EffectivePolicy(ackRequired: false, policyVersion: "v1",
                                                   policyText: "p",
                                                   settings: settings(sites: ["youtube.com"])))
        _ = await sampler.captureTick()
        XCTAssertEqual(buffer.samples.last?.category, "UNPRODUCTIVE",
                       "the rule an admin added applies on the next sample, not the next launch")
    }
}
