import Foundation

/// PRD §6.3 — the activity CAPTURE path. A self-gating interval timer (mirrors ScreenshotScheduler):
/// each tick, only while the clock runs and only through `AckGate`, it drives N×(interval/N) sub-buckets
/// off content-free `CGEventSource` counter deltas, computes activity %, samples the frontmost app +
/// (transiently, for categorization only) the browser host, categorizes, mints a UUIDv7, enqueues ONE
/// sample, and kicks the batch sync. `isTracking` is checked BEFORE the gate so a stopped clock never
/// triggers a policy fetch. Gate closed / error → the whole interval is skipped (no partial sample).
/// Never captures on a closed gate or the offline-marker path (installed only on !ackRequired).
final class ActivitySampler {
    private let ackGate: AckGate
    private let counter: InputCounting
    private let appSampler: AppSampling
    private let siteResolver: SiteResolving
    /// Categorization lists + captureWindowTitles are read from here on every tick, not captured
    /// at construction, so an admin's edit applies on the next sample instead of the next launch.
    private let livePolicy: LivePolicy
    private let store: ActivitySampleBuffering
    private let intervalSeconds: TimeInterval
    private let subBuckets: Int
    private let isTracking: () -> Bool
    private let idGen: (Date) -> String
    private let clock: () -> Date
    private let sleep: (TimeInterval) async -> Void
    private let onSampled: () -> Void
    private let onCategorized: (Category) -> Void

    private var timer: Timer?
    private var started = false
    private var isCapturing = false
    private var currentCycle: Task<Void, Never>?

    init(ackGate: AckGate, counter: InputCounting, appSampler: AppSampling,
         siteResolver: SiteResolving, livePolicy: LivePolicy, store: ActivitySampleBuffering,
         intervalSeconds: TimeInterval = 60, subBuckets: Int = 12,
         isTracking: @escaping () -> Bool,
         idGen: @escaping (Date) -> String = { UUIDv7.generate(now: $0) },
         clock: @escaping () -> Date = Date.init,
         sleep: @escaping (TimeInterval) async -> Void = { try? await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) },
         onSampled: @escaping () -> Void = {},
         onCategorized: @escaping (Category) -> Void = { _ in }) {
        self.ackGate = ackGate
        self.counter = counter
        self.appSampler = appSampler
        self.siteResolver = siteResolver
        self.livePolicy = livePolicy
        self.store = store
        self.intervalSeconds = intervalSeconds
        self.subBuckets = max(1, subBuckets)
        self.isTracking = isTracking
        self.idGen = idGen
        self.clock = clock
        self.sleep = sleep
        self.onSampled = onSampled
        self.onCategorized = onCategorized
    }

    func start() {
        guard !started else { return }
        started = true
        scheduleNext(after: 0) // first measurement window begins immediately
    }

    func stop() {
        started = false
        timer?.invalidate()
        timer = nil
        currentCycle?.cancel() // don't leave a ~60s cycle in flight; finishInFlight() still awaits it
    }

    /// One interval. `isTracking` is checked BEFORE the gate so a stopped clock never fetches policy.
    /// Returns `true` only when this call actually ran the full sub-bucket measurement and enqueued a
    /// sample; `false` on every skip path (already capturing, not tracking, gate closed, cancelled).
    /// The caller uses this to decide the next delay: measured → contiguous (0), skipped → `intervalSeconds`.
    @discardableResult
    func captureTick() async -> Bool {
        guard !isCapturing else { return false }
        guard isTracking() else { return false }
        isCapturing = true
        defer { isCapturing = false }
        do {
            return try await ackGate.withCaptureAllowed { [self] in
                var meter = ActivityRateMeter(buckets: subBuckets)
                var prev = counter.snapshot()
                let bucketSeconds = intervalSeconds / Double(subBuckets)
                for _ in 0..<subBuckets {
                    await sleep(bucketSeconds)
                    if Task.isCancelled { break }
                    let now = counter.snapshot()
                    meter.addBucket(delta: (keys: now.keys &- prev.keys, pointer: now.pointer &- prev.pointer))
                    prev = now
                }
                // Cancelled mid-cycle (e.g. sign-out) → never persist a partial-window sample.
                guard !Task.isCancelled else { return false }
                let capturedAt = clock()
                // One snapshot for the whole sample — a policy landing mid-tick must not title
                // the window under one rule set and categorize it under another.
                let policy = livePolicy.current
                let (appName, bundleId, windowTitle) = appSampler.sample(captureWindowTitles: policy.captureWindowTitles)
                // Only script the browser when a site rule could actually match. No site lists
                // ⇒ the URL is never read at all (and no Automation prompt is provoked).
                // Discarded on the next line either way; never stored, never sent.
                let host = policy.categorizer.hasSiteRules ? siteResolver.currentHost() : nil
                let category = policy.categorizer.category(appName: appName, bundleId: bundleId, host: host)
                let sample = ActivitySample(
                    id: idGen(capturedAt), timestamp: Self.iso.string(from: capturedAt),
                    appName: appName, bundleId: bundleId, windowTitle: windowTitle,
                    activityPct: meter.activityPct(), category: category.rawValue)
                store.enqueue(sample)
                onSampled()
                onCategorized(category)
                return true
            }
        } catch {
            // Gate closed (ackRequired / offline) or error → skip this interval. Fail-safe.
            return false
        }
    }

    /// Await any capture cycle already in flight (sign-out teardown joins this before clearing).
    func finishInFlight() async { await currentCycle?.value }

    // MARK: - self-scheduling timer glue (build-verified)

    /// A cycle that measured schedules the next one back-to-back (`after: 0`) so windows are
    /// contiguous (…[0,60][60,120][120,180]…). A skipped cycle (not tracking / gate closed) waits
    /// the full `intervalSeconds` before retrying, so a closed gate can't busy-loop policy fetches.
    func startCycle() {
        currentCycle = Task { [weak self] in
            let measured = await self?.captureTick() ?? false
            guard let self, self.started else { return }
            self.scheduleNext(after: measured ? 0 : self.intervalSeconds)
        }
    }

    private func scheduleNext(after delay: TimeInterval) {
        timer?.invalidate()
        let t = Timer(timeInterval: max(0.001, delay), repeats: false) { [weak self] _ in
            self?.startCycle()
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
