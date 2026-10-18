import Foundation

/// A thread-safe tally for callbacks invoked from an actor or a background task.
final class CallCounter {
    private let lock = NSLock()
    private var count = 0

    var value: Int { lock.withLock { count } }

    func increment() { lock.withLock { count += 1 } }
}
