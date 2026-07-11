import Foundation

/// PRD §6.1 — manual + automatic time tracking. Every AUTO capture path is created behind
/// the AckGate. WorkspaceObserver (active app via NSWorkspace) and IdleMonitor (last-input
/// via CGEventSource) feed this; add them alongside as separate files.
final class TimeTracker {
    enum Source {
        case manual, auto
    }

    private(set) var isRunning = false

    func start(source: Source) {
        // TODO(scaffold): open a TimeEntry with a client-minted UUIDv7 (PRD §7.5).
        isRunning = true
    }

    func stop() {
        // TODO(scaffold): close the current entry, enqueue for sync.
        isRunning = false
    }
}
