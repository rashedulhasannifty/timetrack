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

/// PRD §7.5 — POSTs a buffered time-entry payload to /v1/time-entries with the session bearer
/// token. The API upserts on the client-minted UUIDv7, so a retried record is a no-op. On a 401 it
/// forces a token refresh and retries once (mirrors PolicyClient/ProjectClient); a surviving 401 →
/// authFailed. Not a capture path — no AckGate.
final class TimeEntryUploader: Uploading {
    private let baseURL: URL
    private let session: AuthSession

    init(baseURL: URL, session: AuthSession) {
        self.baseURL = baseURL
        self.session = session
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
        case 200, 201: return .success
        case 401: return .authFailed
        case 500...599: return .transient
        case 400...499: return .permanent(status)
        default: return .transient
        }
    }

    private func post(_ payload: Data, token: String) async throws -> Int {
        var request = URLRequest(url: baseURL.appendingPathComponent("time-entries"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = payload
        let (_, response) = try await URLSession.shared.data(for: request)
        return (response as? HTTPURLResponse)?.statusCode ?? 0
    }
}
