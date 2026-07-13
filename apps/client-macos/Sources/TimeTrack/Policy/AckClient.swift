import Foundation

/// Records the signed-in user's acknowledgement of the monitoring policy. The id is the
/// user's OWN sub (from the access token) — the client cannot ack for anyone else, and the
/// API enforces self-only too (PRD §4.1). The API requires the acknowledged policyVersion
/// in the body (AckMonitoringSchema); it must be the same version the user was shown.
final class AckClient {
    private let baseURL: URL
    private let session: AuthSession
    private let urlSession: URLSession

    init(baseURL: URL, session: AuthSession, urlSession: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        self.urlSession = urlSession
    }

    func acknowledge(userId: String, policyVersion: String) async throws {
        let token = try await session.accessToken()
        var request = URLRequest(url: baseURL.appendingPathComponent("users/\(userId)/ack-monitoring"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["policyVersion": policyVersion])
        let (_, response) = try await urlSession.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ... 299).contains(status) else { throw AckGateError.policyUnavailable }
    }
}
