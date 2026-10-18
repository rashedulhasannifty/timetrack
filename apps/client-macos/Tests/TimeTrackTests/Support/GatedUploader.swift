import Foundation
@testable import TimeTrack

/// Holds the FIRST upload open until `release()` — a pass caught mid-flight — and lets every later
/// upload succeed at once. `onEnter` fires once the first upload is parked.
final class GatedUploader: Uploading {
    private let lock = NSLock()
    private var gate: CheckedContinuation<Void, Never>?
    private var isFirst = true
    private var count = 0
    var onEnter: (() -> Void)?

    var uploadCount: Int { lock.withLock { count } }

    func upload(_ payload: Data) async -> UploadResult {
        let first = lock.withLock { () -> Bool in
            count += 1
            defer { isFirst = false }
            return isFirst
        }
        if first {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                lock.withLock { gate = continuation }
                onEnter?()
            }
        }
        return .success
    }

    func release() {
        let continuation = lock.withLock { () -> CheckedContinuation<Void, Never>? in
            defer { gate = nil }
            return gate
        }
        continuation?.resume()
    }
}
