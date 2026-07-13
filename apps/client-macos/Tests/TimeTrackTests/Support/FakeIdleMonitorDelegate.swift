import Foundation
@testable import TimeTrack

final class FakeIdleMonitorDelegate: IdleMonitorDelegate {
    enum Call: Equatable {
        case start
        case stop(at: Date)
        case becameAway(seconds: Int)
        case resolved(from: Date, to: Date, keeping: Bool)
        case abandoned(from: Date, to: Date)
    }
    private(set) var calls: [Call] = []

    func idleMonitorShouldStartTracking(_ monitor: IdleMonitor) { calls.append(.start) }
    func idleMonitor(_ monitor: IdleMonitor, shouldStopTrackingAt awayStart: Date) { calls.append(.stop(at: awayStart)) }
    func idleMonitor(_ monitor: IdleMonitor, didBecomeAwayForSeconds seconds: Int) { calls.append(.becameAway(seconds: seconds)) }
    func idleMonitor(_ monitor: IdleMonitor, didResolveAwayFrom awayStart: Date, to resume: Date, keeping: Bool) {
        calls.append(.resolved(from: awayStart, to: resume, keeping: keeping))
    }
    func idleMonitor(_ monitor: IdleMonitor, didAbandonAwayFrom awayStart: Date, to lastKnown: Date) {
        calls.append(.abandoned(from: awayStart, to: lastKnown))
    }
}
