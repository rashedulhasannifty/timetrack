import Foundation

enum SessionError: Error { case notAuthenticated }

/// The single owner of the client's tokens. An actor so concurrent accessToken() callers
/// share ONE in-flight refresh instead of racing. Refresh token → Keychain; access token
/// → memory only, re-minted via refresh on expiry.
actor AuthSession {
    private let client: AuthClienting
    private let store: TokenStore

    private var access: String?
    private var accessDeadline: Date?
    private static let skew: TimeInterval = 30

    init(client: AuthClienting, store: TokenStore) {
        self.client = client
        self.store = store
    }

    func isAuthenticated() -> Bool { store.readRefreshToken() != nil }

    func userId() -> String? {
        guard let access else { return nil }
        return try? JWTDecoder.claims(from: access).sub
    }

    /// On launch: if a refresh token is stored, refresh once to mint an access token.
    /// A rejected refresh clears the store and returns false. Never throws to the caller.
    func bootstrap() async -> Bool {
        guard let refresh = store.readRefreshToken() else { return false }
        do {
            try await refreshWith(refresh)
            return true
        } catch {
            store.clear()
            access = nil
            accessDeadline = nil
            return false
        }
    }

    func login(email: String, password: String) async throws {
        let pair = try await client.login(email: email, password: password)
        apply(pair)
    }

    func logout() {
        store.clear()
        access = nil
        accessDeadline = nil
    }

    /// Returns a valid access token, refreshing when within `skew` of the deadline.
    func accessToken() async throws -> String {
        if let access, let deadline = accessDeadline, deadline.timeIntervalSinceNow > Self.skew {
            return access
        }
        guard let refresh = store.readRefreshToken() else { throw SessionError.notAuthenticated }
        try await refreshWith(refresh)
        guard let access else { throw SessionError.notAuthenticated }
        return access
    }

    /// Forces a refresh regardless of deadline — used by PolicyClient on a 401.
    func forceRefresh() async throws -> String {
        guard let refresh = store.readRefreshToken() else { throw SessionError.notAuthenticated }
        try await refreshWith(refresh)
        guard let access else { throw SessionError.notAuthenticated }
        return access
    }

    private func refreshWith(_ refresh: String) async throws {
        let pair = try await client.refresh(refreshToken: refresh)
        apply(pair)
    }

    private func apply(_ pair: TokenPair) {
        access = pair.accessToken
        accessDeadline = Date().addingTimeInterval(TimeInterval(pair.expiresIn))
        store.saveRefreshToken(pair.refreshToken)
    }
}
