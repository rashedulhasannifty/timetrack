import Foundation

/// The team policy as the running client currently understands it.
///
/// The pieces of `TeamSettings` that the capture path acts on used to be frozen into the
/// `ActivitySampler` and `DistractionMonitor` when they were built at launch, so an admin's edit
/// in the dashboard did nothing until the employee quit and reopened the app — while the settings
/// page promised "changes take effect on each client's next heartbeat (≤60s)". `AckGate` already
/// re-fetches the effective policy before EVERY capture cycle to check `ackRequired`; it now
/// publishes each fetched policy here, so those settings ride the fetch that was happening anyway.
/// No extra timer, no second network cadence, and the refresh naturally stops when the clock stops.
///
/// Read from the sampler's background cycle and written from the gate; `NSLock` makes the swap
/// atomic, so a tick sees one coherent snapshot rather than a half-applied policy.
///
/// Scope: what a running client can change on the fly. The screenshot interval, the idle
/// threshold and auto-start-on-login are wired into timers built at launch and still need a
/// relaunch to change.
final class LivePolicy: @unchecked Sendable {
    struct Snapshot {
        let categorizer: Categorizer
        let captureWindowTitles: Bool
        let distraction: DistractionSettings

        init(categorizer: Categorizer, captureWindowTitles: Bool, distraction: DistractionSettings) {
            self.categorizer = categorizer
            self.captureWindowTitles = captureWindowTitles
            self.distraction = distraction
        }

        init(_ settings: EffectivePolicy.Settings) {
            self.init(
                categorizer: Categorizer(
                    productiveApps: settings.productiveApps,
                    unproductiveApps: settings.unproductiveApps,
                    productiveSites: settings.productiveSites,
                    unproductiveSites: settings.unproductiveSites),
                captureWindowTitles: settings.captureWindowTitles,
                distraction: DistractionSettings(settings))
        }

        /// Nothing fetched yet: categorize nothing, and stay silent. Never used for real once the
        /// gate has opened once — the first capture cycle replaces it.
        static let pending = Snapshot(
            categorizer: Categorizer(productiveApps: [], unproductiveApps: []),
            captureWindowTitles: false,
            distraction: .off)
    }

    private let lock = NSLock()
    private var snapshot: Snapshot

    init(_ initial: Snapshot = .pending) {
        snapshot = initial
    }

    var current: Snapshot {
        lock.lock()
        defer { lock.unlock() }
        return snapshot
    }

    func update(from settings: EffectivePolicy.Settings) {
        let next = Snapshot(settings)
        lock.lock()
        snapshot = next
        lock.unlock()
    }
}
