import Foundation

/// PRD §7.5 / §7.8 — POSTs a batch of buffered activity samples to `<baseURL>/activity-samples/batch`
/// as one JSON body `{ "samples": [...] }` (≤500) with the session bearer token. The API upserts on
/// each client-minted UUIDv7, so a retried batch is a no-op. On a 401 it forces a refresh and retries
/// once (mirrors TimeEntryUploader); a surviving 401 → authFailed. Not a capture path — no AckGate.
protocol ActivitySampleUploading {
    func upload(_ samples: [ActivitySample]) async -> UploadResult
}

final class ActivitySampleUploader: ActivitySampleUploading {
    private let baseURL: URL
    private let session: AuthSession

    init(baseURL: URL, session: AuthSession) {
        self.baseURL = baseURL
        self.session = session
    }

    func upload(_ samples: [ActivitySample]) async -> UploadResult {
        guard !samples.isEmpty else { return .success }
        let payload = Self.body(samples: samples)
        do {
            let token = try await session.accessToken()
            let status = try await post(payload, token: token)
            if status == 401 {
                let refreshed = try await session.forceRefresh()
                let retried = try await post(payload, token: refreshed)
                return TimeEntryUploader.classify(status: retried)
            }
            return TimeEntryUploader.classify(status: status)
        } catch {
            return .transient
        }
    }

    /// Pure body builder (unit-tested); the async orchestration is build-verified.
    static func body(samples: [ActivitySample]) -> Data {
        (try? JSONEncoder().encode(["samples": samples])) ?? Data()
    }

    private func post(_ payload: Data, token: String) async throws -> Int {
        var request = URLRequest(url: baseURL.appendingPathComponent("activity-samples/batch"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = payload
        let (_, response) = try await URLSession.shared.data(for: request)
        return (response as? HTTPURLResponse)?.statusCode ?? 0
    }
}
