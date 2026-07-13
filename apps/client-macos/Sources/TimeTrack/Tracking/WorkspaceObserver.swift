import AppKit

/// PRD §6.1/§6.4 — the system edge for automatic tracking. A timer samples `CGEventSource`
/// idle seconds; `NSWorkspace` sleep and screen lock/unlock feed away/resume. All logic lives
/// in `IdleMonitor`; this type only forwards signals (no key/pointer *content* is ever read —
/// only a seconds-since-last-input scalar). Notifications and the timer fire on the main thread.
protocol AutoTrackingSignalReceiver: AnyObject {
    func tick(idleSeconds: Int)
    func markAway()
    func resume()
}

extension AutoTrackingCoordinator: AutoTrackingSignalReceiver {}

final class WorkspaceObserver {
    private weak var receiver: AutoTrackingSignalReceiver?
    private let pollInterval: TimeInterval
    private var timer: Timer?
    private var tokens: [NSObjectProtocol] = []

    init(receiver: AutoTrackingSignalReceiver, pollInterval: TimeInterval = 15) {
        self.receiver = receiver
        self.pollInterval = pollInterval
    }

    func start() {
        let timer = Timer(timeInterval: pollInterval, repeats: true) { [weak self] _ in
            self?.sample()
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer

        let ws = NSWorkspace.shared.notificationCenter
        tokens.append(ws.addObserver(forName: NSWorkspace.willSleepNotification,
                                     object: nil, queue: .main) { [weak self] _ in
            self?.receiver?.markAway()
        })
        tokens.append(ws.addObserver(forName: NSWorkspace.didWakeNotification,
                                     object: nil, queue: .main) { [weak self] _ in
            self?.receiver?.resume()
        })
        // Screen lock/unlock are distributed notifications, not on NSWorkspace's center.
        let dnc = DistributedNotificationCenter.default()
        tokens.append(dnc.addObserver(forName: .init("com.apple.screenIsLocked"),
                                      object: nil, queue: .main) { [weak self] _ in
            self?.receiver?.markAway()
        })
        tokens.append(dnc.addObserver(forName: .init("com.apple.screenIsUnlocked"),
                                      object: nil, queue: .main) { [weak self] _ in
            self?.receiver?.resume()
        })
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        let ws = NSWorkspace.shared.notificationCenter
        let dnc = DistributedNotificationCenter.default()
        for token in tokens { ws.removeObserver(token); dnc.removeObserver(token) }
        tokens.removeAll()
    }

    private func sample() {
        // Seconds since the last input event of any kind. Content is never inspected.
        let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState,
                                                           eventType: .init(rawValue: ~0)!)
        receiver?.tick(idleSeconds: Int(idle))
    }
}
