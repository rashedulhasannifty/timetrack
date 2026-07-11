import Foundation

/// PRD §7.5 — one-way sync (client → server) for captured data. Every record carries a
/// UUIDv7 primary key so the API upserts idempotently; a retried batch is a no-op. Pair
/// with an UploadQueue and a BackoffPolicy (exponential) as separate files.
final class SyncEngine {
    private let intervalSeconds: TimeInterval

    init(intervalSeconds: TimeInterval = 90) {
        self.intervalSeconds = intervalSeconds
    }

    func syncNow() async {
        // TODO(scaffold): drain the offline buffer, POST batches (time-entries,
        // activity-samples/batch, screenshots) with the access token, backoff on failure.
        _ = intervalSeconds
    }
}
