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
    init(baseURL: URL) { self.baseURL = baseURL }

    func login(email: String, password: String) async throws -> TokenPair {
        try await post("auth/login", body: ["email": email, "password": password], unauthorizedError: .invalidCredentials)
    }

    func refresh(refreshToken: String) async throws -> TokenPair {
        try await post("auth/refresh", body: ["refreshToken": refreshToken], unauthorizedError: .refreshRejected)
    }

    private func post(_ path: String, body: [String: String], unauthorizedError: AuthError) async throws -> TokenPair {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
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
