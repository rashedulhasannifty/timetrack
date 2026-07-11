import AppKit

/// Wires the app together. The AckGate (PRD §4.1) sits between every capture path and the
/// hardware APIs; nothing here starts capturing until the policy is acknowledged.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let statusItem = StatusItemController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem.install()
        // TODO(scaffold): construct PolicyClient + AckGate, then TimeTracker/capture services
        // behind the gate. Never start capture before AckGate reports acknowledged.
    }
}
