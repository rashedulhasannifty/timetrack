import Foundation

/// The outcome of one upload attempt. `success` = the server upserted (idempotent on UUIDv7).
/// `permanent` = a non-401 4xx the record can never satisfy → drop it (don't wedge the queue).
/// `transient` = network error / 5xx → retry later with backoff. `authFailed` = a 401 that
/// survived one refresh-retry → stop; the session is likely invalid.
enum UploadResult: Equatable {
    case success
    case permanent(Int)
    case transient
    case authFailed
}

protocol Uploading {
    func upload(_ payload: Data) async -> UploadResult
}

/// PRD §7.5 — POSTs a buffered record payload to `<baseURL>/<path>` (default `time-entries`;
/// idle events pass `idle-events`) with the session bearer token. The API upserts on the
/// client-minted UUIDv7, so a retried record is a no-op. On a 401 it forces a token refresh and
/// retries once (mirrors PolicyClient/ProjectClient); a surviving 401 → authFailed. Not a capture
/// path — no AckGate.
final class TimeEntryUploader: Uploading {
    private let baseURL: URL
    private let session: AuthSession
    private let path: String

    init(baseURL: URL, session: AuthSession, path: String = "time-entries") {
        self.baseURL = baseURL
        self.session = session
        self.path = path
    }

    func upload(_ payload: Data) async -> UploadResult {
        do {
            let token = try await session.accessToken()
            let status = try await post(payload, token: token)
            if status == 401 {
                let refreshed = try await session.forceRefresh()
                let retried = try await post(payload, token: refreshed)
                return Self.classify(status: retried)   // a second 401 → .authFailed
            }
            return Self.classify(status: status)
        } catch {
            return .transient   // network error, refresh failure, etc. → retry later
        }
    }

    /// Pure status → result mapping (unit-tested; the async orchestration is build-verified).
    static func classify(status: Int) -> UploadResult {
        switch status {
        // Any 2xx = the server accepted the record. The activity-samples/batch endpoint
        // returns 202 Accepted; narrowing success to 200/201 made the client treat every
        // accepted batch as a transient failure, wedging the buffer and re-sending forever.
        case 200...299: return .success
        case 401: return .authFailed
        case 408, 429: return .transient
        case 500...599: return .transient
        case 400...499: return .permanent(status)
        default: return .transient
        }
    }

    private func post(_ payload: Data, token: String) async throws -> Int {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = payload
        let (_, response) = try await URLSession.shared.data(for: request)
        return (response as? HTTPURLResponse)?.statusCode ?? 0
    }
}
