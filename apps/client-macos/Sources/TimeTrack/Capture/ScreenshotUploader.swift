import Foundation

protocol ScreenshotUploading {
    func upload(id: String, capturedAt: Date, group: CaptureGroup?, jpeg: Data) async -> UploadResult
}

/// PRD §7.4 — uploads one captured screenshot to `<baseURL>/screenshots` as multipart/form-data.
/// The `id` + `timestamp` TEXT fields MUST precede the file part (2.2a §5): `@fastify/multipart`'s
/// `req.file()` only exposes fields parsed before the file, so a file-first body yields undefined
/// metadata → 422 on every upload. `userId` is the session (server reads the token, never a field).
/// Idempotent upsert on the client-minted `id`, so a lost-201 retry is a no-op. Reuses `UploadResult`
/// + `TimeEntryUploader.classify`. Not a capture path — no AckGate.
final class ScreenshotUploader: ScreenshotUploading {
    private let baseURL: URL
    private let session: AuthSession

    init(baseURL: URL, session: AuthSession) {
        self.baseURL = baseURL
        self.session = session
    }

    func upload(id: String, capturedAt: Date, group: CaptureGroup?, jpeg: Data) async -> UploadResult {
        let timestampISO = Self.iso.string(from: capturedAt)
        do {
            let token = try await session.accessToken()
            let status = try await post(id: id, timestampISO: timestampISO, group: group, jpeg: jpeg, token: token)
            if status == 401 {
                let refreshed = try await session.forceRefresh()
                let retried = try await post(id: id, timestampISO: timestampISO, group: group, jpeg: jpeg, token: refreshed)
                return TimeEntryUploader.classify(status: retried)
            }
            return TimeEntryUploader.classify(status: status)
        } catch {
            return .transient
        }
    }

    /// Pure multipart builder — field order (all TEXT fields, then the file) is the 2.2a
    /// invariant: `req.file()` on the server only exposes fields parsed BEFORE the file part, so
    /// a file-first body yields undefined metadata and 422s every upload.
    static func multipartBody(boundary: String, id: String, timestampISO: String,
                              group: CaptureGroup?, jpeg: Data) -> Data {
        var body = Data()
        func boundaryLine() { body.append(Data("--\(boundary)\r\n".utf8)) }
        func field(_ name: String, _ value: String) {
            boundaryLine()
            body.append(Data("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".utf8))
            body.append(Data("\(value)\r\n".utf8))
        }
        field("id", id)               // MUST come first
        field("timestamp", timestampISO)  // MUST precede the file
        if let group {
            // Optional on the server, so an API that predates multi-display capture ignores
            // these rather than rejecting the upload.
            field("captureGroupId", group.id)
            field("displayIndex", String(group.displayIndex))
            field("displayCount", String(group.displayCount))
        }
        boundaryLine()
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"\(id).jpg\"\r\n".utf8))
        body.append(Data("Content-Type: image/jpeg\r\n\r\n".utf8))
        body.append(jpeg)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        return body
    }

    private func post(id: String, timestampISO: String, group: CaptureGroup?, jpeg: Data,
                      token: String) async throws -> Int {
        let boundary = "TimeTrack-\(UUID().uuidString)"
        var request = URLRequest(url: baseURL.appendingPathComponent("screenshots"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = Self.multipartBody(boundary: boundary, id: id, timestampISO: timestampISO,
                                              group: group, jpeg: jpeg)
        let (_, response) = try await URLSession.shared.data(for: request)
        return (response as? HTTPURLResponse)?.statusCode ?? 0
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
