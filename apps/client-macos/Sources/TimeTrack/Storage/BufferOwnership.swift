import Foundation

/// A durable buffer whose unsent records belong to one user.
protocol OwnedBuffer: AnyObject {
    func pendingCount() -> Int
    func clear()
}

extension BufferStore: OwnedBuffer {}
extension ImageBufferStore: OwnedBuffer {}
extension ActivitySampleStore: OwnedBuffer {}

/// Records which user the durable buffers (time entries + idle events, screenshots, activity
/// samples) belong to, so unsent data can outlive a sign-out without ever being uploaded under
/// someone else's account.
///
/// The server attributes every upload to the bearer token — no payload carries a user id — so a
/// record sent with the wrong session is filed under the wrong person. Sign-out therefore used to
/// clear every buffer, which lost whatever had not reached the server yet (a revoked session, an
/// offline laptop). Now sign-out keeps it, and `claim(for:)` runs when the next session becomes
/// ready, BEFORE any sync engine starts:
///
/// - same user as the recorded owner → keep; the new session drains it.
/// - a different user → discard everything first, then record the new owner.
/// - no recorded owner but records on disk → discard. These were written by a build that did
///   not tag ownership. That build cleared the buffers on every menu sign-out, but NOT when a
///   launch found the token rejected — so a leftover record can belong to someone other than
///   whoever is signed in now, and nothing on disk can prove otherwise. The cost is bounded: the
///   old build drained every 90 s, so what is left at upgrade is at most one undelivered cycle.
///
/// One owner covers all three buffers: records are written only while a user is ready, every
/// capture/sync path is stopped and joined on sign-out, and the claim happens before the next
/// user can write anything — so at any moment everything on disk was written by one user.
final class BufferOwnership {
    static let shared = BufferOwnership(
        fileURL: AppInstall.supportDirectory().appendingPathComponent("buffer-owner"),
        buffers: [BufferStore.shared, ImageBufferStore.shared, ActivitySampleStore.shared]
    )

    enum Outcome: Equatable {
        /// The records on disk (if any) are this user's; kept for upload.
        case kept
        /// The buffers were empty; this user is now the owner.
        case claimedEmpty
        /// Another user's records were on disk and have been discarded unsent.
        case discardedPreviousOwner
        /// Untagged records from an older build were on disk and have been discarded unsent.
        case discardedUnowned
    }

    private let fileURL: URL
    private let buffers: [OwnedBuffer]

    init(fileURL: URL, buffers: [OwnedBuffer]) {
        self.fileURL = fileURL
        self.buffers = buffers
    }

    /// The user the buffered records belong to, or nil when none is recorded.
    var owner: String? {
        guard let data = try? Data(contentsOf: fileURL),
              let value = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else { return nil }
        return value
    }

    /// Make `userId` the owner of the buffers, discarding anything that cannot be proven theirs.
    /// Must run before any sync engine for this session starts.
    @discardableResult
    func claim(for userId: String) -> Outcome {
        let previous = owner
        if previous == userId { return .kept }
        let hasRecords = buffers.contains { $0.pendingCount() > 0 }
        if hasRecords {
            for buffer in buffers { buffer.clear() }
        }
        write(userId)
        guard hasRecords else { return .claimedEmpty }
        return previous == nil ? .discardedUnowned : .discardedPreviousOwner
    }

    private func write(_ userId: String) {
        try? FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(),
                                                 withIntermediateDirectories: true)
        try? Data(userId.utf8).write(to: fileURL, options: .atomic)
    }
}
