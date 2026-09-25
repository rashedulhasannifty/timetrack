import Foundation

/// Mirrors LoginSchema / RefreshSchema / TokenPairSchema in @timetrack/contracts.
struct TokenPair: Decodable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int
}

enum AuthError: Error, Equatable {
    case invalidCredentials  // 401 on login
    case refreshRejected     // 401 on refresh
    case server(Int)         // other non-2xx
    case transport           // URLSession threw
}

protocol AuthClienting {
    func login(email: String, password: String) async throws -> TokenPair
    func refresh(refreshToken: String) async throws -> TokenPair
}

/// POSTs to {baseURL}/auth/login and {baseURL}/auth/refresh. baseURL already carries /v1.
final class AuthClient: AuthClienting {
    private let baseURL: URL
    private let version: AppVersion?

    /// `version` is sent as X-Client-Version so an admin can see who needs an update. nil (as
    /// under `swift run`, which has no Info.plist) sends no identity headers at all.
    init(baseURL: URL, version: AppVersion? = AppVersion.current()) {
        self.baseURL = baseURL
        self.version = version
    }

    func login(email: String, password: String) async throws -> TokenPair {
        try await post("auth/login", body: ["email": email, "password": password], unauthorizedError: .invalidCredentials)
    }

    func refresh(refreshToken: String) async throws -> TokenPair {
        try await post("auth/refresh", body: ["refreshToken": refreshToken], unauthorizedError: .refreshRejected)
    }

    /// Built separately from the send so the headers can be checked without a network.
    func makeRequest(_ path: String, body: [String: String]) throws -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let version {
            // Identity only — platform and version, never anything about the person or device.
            request.setValue("MACOS", forHTTPHeaderField: "X-Client-Platform")
            request.setValue(version.description, forHTTPHeaderField: "X-Client-Version")
        }
        request.httpBody = try JSONEncoder().encode(body)
        return request
    }

    private func post(_ path: String, body: [String: String], unauthorizedError: AuthError) async throws -> TokenPair {
        let request = try makeRequest(path, body: body)
        let data: Data, response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw AuthError.transport
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        switch status {
        case 200 ... 299: return try JSONDecoder().decode(TokenPair.self, from: data)
        case 401: throw unauthorizedError
        default: throw AuthError.server(status)
        }
    }
}
