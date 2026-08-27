// Support/FakeManualIdleMonitorDelegate.swift
import Foundation
@testable import TimeTrack

final class FakeManualIdleMonitorDelegate: ManualIdleMonitorDelegate {
    enum Call: Equatable {
        case timedOut(from: Date, stoppingAt: Date)
    }
    private(set) var calls: [Call] = []

    func manualIdleMonitor(_ m: ManualIdleMonitor, didTimeOutFrom awayStart: Date, stoppingAt stopInstant: Date) {
        calls.append(.timedOut(from: awayStart, stoppingAt: stopInstant))
    }
}
