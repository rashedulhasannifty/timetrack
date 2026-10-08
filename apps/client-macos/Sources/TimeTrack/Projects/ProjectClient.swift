import Foundation

/// Fetches the team's projects (with tasks) for the picker. GET /v1/projects is available
/// to any authenticated user and is team-scoped server-side. On a 401 it forces a token
/// refresh and retries once (mirrors PolicyClient); any other failure propagates so the
/// caller falls back to the cache. `includeArchived` is omitted → the API defaults to
/// assignable-only projects. An ADMIN asks for every team (`allTeams=true`); the role is read from
/// the token each request carries, so a refresh after a promotion switches it.
enum ProjectClientError: Error { case unavailable }

final class ProjectClient {
    private let baseURL: URL
    private let session: AuthSession

    init(baseURL: URL, session: AuthSession) {
        self.baseURL = baseURL
        self.session = session
    }

    func list() async throws -> [Project] {
        let token = try await session.accessToken()
        let (data, status) = try await fetch(token: token)
        if status == 401 {
            let refreshed = try await session.forceRefresh()
            let (data2, status2) = try await fetch(token: refreshed)
            guard status2 == 200 else { throw ProjectClientError.unavailable }
            return try JSONDecoder().decode([Project].self, from: data2)
        }
        guard status == 200 else { throw ProjectClientError.unavailable }
        return try JSONDecoder().decode([Project].self, from: data)
    }

    /// `URLComponents`, never `appendingPathComponent("projects?…")`, which would encode the `?`.
    static func listURL(baseURL: URL, token: String) -> URL {
        let url = baseURL.appendingPathComponent("projects")
        guard (try? JWTDecoder.claims(from: token))?.role == "ADMIN",
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return url }
        components.queryItems = [URLQueryItem(name: "allTeams", value: "true")]
        return components.url ?? url
    }

    private func fetch(token: String) async throws -> (Data, Int) {
        var request = URLRequest(url: Self.listURL(baseURL: baseURL, token: token))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
}
