import Foundation

enum SessionError: Error { case notAuthenticated }

/// What a launch-time bootstrap concluded.
///
/// The distinction that matters is `.offline` vs `.unauthenticated`: only a server that
/// actually REJECTED the refresh token (401) means the session is dead. Being offline, or
/// catching the API mid-deploy, or tripping the global throttler, says nothing about the
/// token — and used to sign the employee out anyway, wiping the Keychain on a laptop that
/// simply woke up before Wi-Fi associated.
enum BootstrapOutcome {
    /// Refresh succeeded; an access token is in memory.
    case authenticated
    /// Refresh could not be completed, but the refresh token is retained and still good.
    case offline
    /// No stored token, or the server rejected the one we had. Credentials are cleared.
    case unauthenticated
}

/// The single owner of the client's tokens. An actor so concurrent accessToken() callers
/// share ONE in-flight refresh instead of racing. Refresh token → Keychain; access token
/// → memory only, re-minted via refresh on expiry.
actor AuthSession {
    private let client: AuthClienting
    private let store: TokenStore
    private let defaults: UserDefaults

    /// The last signed-in user id, mirrored out of the access token's `sub`.
    ///
    /// The access token is memory-only, so after an offline launch there is nothing to decode
    /// a user id from — and the offline branch of AppDelegate.proceedToPolicy() needs one to
    /// look up this user's local ack marker. Cleared by logout(), which is what stops one
    /// user's marker from granting readiness to whoever signs in next.
    private static let lastUserIdKey = "auth.lastUserId"

    private var access: String?
    private var accessDeadline: Date?
    private var refreshInFlight: Task<Void, Error>?
    private static let skew: TimeInterval = 30

    /// `defaults` is defaulted so existing call sites keep compiling.
    init(client: AuthClienting, store: TokenStore, defaults: UserDefaults = .standard) {
        self.client = client
        self.store = store
        self.defaults = defaults
    }

    func isAuthenticated() -> Bool { store.readRefreshToken() != nil }

    func userId() -> String? {
        if let access, let sub = try? JWTDecoder.claims(from: access).sub { return sub }
        // Offline launch: no access token to decode, so fall back to the mirrored id.
        return defaults.string(forKey: Self.lastUserIdKey)
    }

    /// On launch: if a refresh token is stored, refresh once to mint an access token.
    /// Never throws to the caller.
    ///
    /// ONLY a 401 clears the stored token. Everything else — no network, a 5xx while the API
    /// is redeploying, a 429 from the global throttler — leaves the Keychain untouched and
    /// reports `.offline`, because none of those are evidence the token is dead. Clearing on
    /// them logged employees out for good and silently stopped capture until they noticed.
    func bootstrap() async -> BootstrapOutcome {
        guard store.readRefreshToken() != nil else { return .unauthenticated }
        do {
            try await refresh()
            return .authenticated
        } catch AuthError.refreshRejected {
            logout()
            return .unauthenticated
        } catch {
            access = nil
            accessDeadline = nil
            return .offline
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
        refreshInFlight = nil
        defaults.removeObject(forKey: Self.lastUserIdKey)
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
        try await refresh()
        guard let access else { throw SessionError.notAuthenticated }
        return access
    }

    /// Coalesced: concurrent callers await the SAME in-flight refresh instead of racing.
    private func refresh() async throws {
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
        if let sub = try? JWTDecoder.claims(from: pair.accessToken).sub {
            defaults.set(sub, forKey: Self.lastUserIdKey)
        }
    }
}
