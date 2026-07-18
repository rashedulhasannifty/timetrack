import Foundation

/// Pure activity-% computation (PRD §6.3, Slice 2.3b): the 60s interval is split into N sub-buckets;
/// a bucket is "active" if any input (key OR pointer) occurred in it. activityPct = active/N × 100.
/// Separated from timing so it is fully unit-testable. Buckets beyond `buckets` are ignored.
struct ActivityRateMeter {
    private let buckets: Int
    private var seen = 0
    private var active = 0

    init(buckets: Int) { self.buckets = max(1, buckets) }

    mutating func addBucket(delta: (keys: UInt64, pointer: UInt64)) {
        guard seen < buckets else { return }
        seen += 1
        if delta.keys > 0 || delta.pointer > 0 { active += 1 }
    }

    /// round(active / buckets × 100), clamped 0…100.
    func activityPct() -> Int {
        let pct = (Double(active) / Double(buckets) * 100).rounded()
        return min(100, max(0, Int(pct)))
    }
}
