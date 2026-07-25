// Support/FakeManualIdleMonitorDelegate.swift
import Foundation
@testable import TimeTrack

final class FakeManualIdleMonitorDelegate: ManualIdleMonitorDelegate {
    enum Call: Equatable {
        case beganAway(at: Date)
        case becameAway(seconds: Int)
        case resolved(from: Date, to: Date, keeping: Bool)
        case abandoned(from: Date, to: Date)
    }
    private(set) var calls: [Call] = []

    func manualIdleMonitor(_ m: ManualIdleMonitor, didBeginAwayAt awayStart: Date) {
        calls.append(.beganAway(at: awayStart))
    }
    func manualIdleMonitor(_ m: ManualIdleMonitor, didBecomeAwayForSeconds seconds: Int) {
        calls.append(.becameAway(seconds: seconds))
    }
    func manualIdleMonitor(_ m: ManualIdleMonitor, didResolveAwayFrom awayStart: Date, to resume: Date, keeping: Bool) {
        calls.append(.resolved(from: awayStart, to: resume, keeping: keeping))
    }
    func manualIdleMonitor(_ m: ManualIdleMonitor, didAbandonAwayFrom awayStart: Date, to lastKnown: Date) {
        calls.append(.abandoned(from: awayStart, to: lastKnown))
    }
}
