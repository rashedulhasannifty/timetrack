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
    private var refreshInFlight: Task<Void, Error>?
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
        guard store.readRefreshToken() != nil else { return false }
        do { try await refresh(); return true }
        catch { store.clear(); access = nil; accessDeadline = nil; return false }
    }

    func login(email: String, password: String) async throws {
        let pair = try await client.login(email: email, password: password)
        apply(pair)
    }

    func logout() {
        store.clear()
        access = nil
        accessDeadline = nil
        refreshInFlight = nil
    }

    /// Returns a valid access token, refreshing when within `skew` of the deadline.
    func accessToken() async throws -> String {
        if let access, let deadline = accessDeadline, deadline.timeIntervalSinceNow > Self.skew {
            return access
        }
        try await refresh()
        guard let access else { throw SessionError.notAuthenticated }
        return access
    }

    /// Forces a refresh regardless of deadline — used by PolicyClient on a 401.
    func forceRefresh() async throws -> String {
        try await refresh(force: true)
        guard let access else { throw SessionError.notAuthenticated }
        return access
    }

    /// Coalesced: concurrent callers await the SAME in-flight refresh instead of racing.
    /// `force` only matters to the first caller that starts the task; joiners await whatever
    /// refresh is already running.
    private func refresh(force: Bool = false) async throws {
        if let refreshInFlight { try await refreshInFlight.value; return }
        guard let token = store.readRefreshToken() else { throw SessionError.notAuthenticated }
        let task = Task { try await self.performRefresh(token: token) }
        refreshInFlight = task
        defer { refreshInFlight = nil }
        try await task.value
    }

    private func performRefresh(token: String) async throws {   // actor-isolated: apply runs before the task completes
        let pair = try await client.refresh(refreshToken: token)
        apply(pair)
    }

    private func apply(_ pair: TokenPair) {
        access = pair.accessToken
        accessDeadline = Date().addingTimeInterval(TimeInterval(pair.expiresIn))
        store.saveRefreshToken(pair.refreshToken)
    }
}
