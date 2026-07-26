import Foundation

/// Fans one `WorkspaceObserver` out to several receivers (auto + manual coordinators share the
/// single system-edge timer). Forwards each signal to every receiver, in order. Holds its
/// receivers strongly; the `WorkspaceObserver` holds the fan-out weakly, so the owner
/// (`AppDelegate`) must retain the fan-out.
final class FanOutSignalReceiver: AutoTrackingSignalReceiver {
    private let receivers: [AutoTrackingSignalReceiver]
    init(_ receivers: [AutoTrackingSignalReceiver]) { self.receivers = receivers }
    func tick(idleSeconds: Int) { receivers.forEach { $0.tick(idleSeconds: idleSeconds) } }
    func markAway() { receivers.forEach { $0.markAway() } }
    func resume() { receivers.forEach { $0.resume() } }
}
