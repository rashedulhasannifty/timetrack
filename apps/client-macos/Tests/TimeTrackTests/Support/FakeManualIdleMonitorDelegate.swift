// Support/FakeManualIdleMonitorDelegate.swift
import Foundation
@testable import TimeTrack

final class FakeManualIdleMonitorDelegate: ManualIdleMonitorDelegate {
    enum Call: Equatable {
        case beganAway(at: Date)
        case becameAway(seconds: Int)
        case resolved(from: Date, to: Date, keeping: Bool)
        case abandoned(from: Date, to: Date)
        case exceededLimit(from: Date, at: Date)
        case withdrewPrompt
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
    func manualIdleMonitor(_ m: ManualIdleMonitor, didExceedAwayLimitFrom awayStart: Date, at limitInstant: Date) {
        calls.append(.exceededLimit(from: awayStart, at: limitInstant))
    }
    func manualIdleMonitorDidWithdrawPrompt(_ m: ManualIdleMonitor) {
        calls.append(.withdrewPrompt)
        // A real prompt resolves with its default when it is closed; the monitor must ignore it.
        m.resolve(.keep)
    }
}
