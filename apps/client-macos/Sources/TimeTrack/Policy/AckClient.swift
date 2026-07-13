import Foundation

/// Records the signed-in user's acknowledgement of the monitoring policy. The id is the
/// user's OWN sub (from the access token) — the client cannot ack for anyone else, and the
/// API enforces self-only too (PRD §4.1).
final class AckClient {
    private let baseURL: URL
    private let session: AuthSession

    init(baseURL: URL, session: AuthSession) {
        self.baseURL = baseURL
        self.session = session
    }

    func acknowledge(userId: String) async throws {
        let token = try await session.accessToken()
        var request = URLRequest(url: baseURL.appendingPathComponent("users/\(userId)/ack-monitoring"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (_, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ... 299).contains(status) else { throw AckGateError.policyUnavailable }
    }
}
