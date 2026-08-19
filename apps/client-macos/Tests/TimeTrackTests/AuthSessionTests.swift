import XCTest
@testable import TimeTrack

final class AuthSessionTests: XCTestCase {
    func testBootstrapWithStoredTokenRefreshesAndAuthenticates() async {
        let store = InMemoryTokenStore(seed: "refresh-0")
        let client = FakeAuthClient()
        let session = AuthSession(client: client, store: store)

        let outcome = await session.bootstrap()

        XCTAssertEqual(outcome, .authenticated)
        let authenticated = await session.isAuthenticated()
        XCTAssertTrue(authenticated)
        let refreshCalls = await client.refreshCalls
        XCTAssertEqual(refreshCalls, 1)
        XCTAssertEqual(store.stored, "refresh-2") // rotated refresh token persisted
        let userId = await session.userId()
        XCTAssertEqual(userId, "11111111-1111-7111-8111-111111111111")
    }

    func testBootstrapWithNoStoredTokenIsUnauthenticated() async {
        let session = AuthSession(client: FakeAuthClient(), store: InMemoryTokenStore())
        let outcome = await session.bootstrap()
        XCTAssertEqual(outcome, .unauthenticated)
        let authenticated = await session.isAuthenticated()
        XCTAssertFalse(authenticated)
    }

    func testBootstrapClearsStoreWhenRefreshRejected() async {
        let store = InMemoryTokenStore(seed: "refresh-0")
        let client = FakeAuthClient(refreshResult: .failure(AuthError.refreshRejected))
        let session = AuthSession(client: client, store: store)

        let outcome = await session.bootstrap()

        XCTAssertEqual(outcome, .unauthenticated)
        XCTAssertNil(store.stored)
        let authenticated = await session.isAuthenticated()
        XCTAssertFalse(authenticated)
    }

    func testLoginPersistsRefreshTokenAndAccess() async throws {
        let store = InMemoryTokenStore()
        let session = AuthSession(client: FakeAuthClient(), store: store)

        try await session.login(email: "e@x.com", password: "password1")

        XCTAssertEqual(store.stored, "refresh-1")
        let token = try await session.accessToken()
        XCTAssertEqual(token, kTestAccessToken)
    }

    func testLogoutClearsStore() async throws {
        let store = InMemoryTokenStore(seed: "refresh-0")
        let session = AuthSession(client: FakeAuthClient(), store: store)
        try await session.login(email: "e@x.com", password: "password1")

        await session.logout()

        XCTAssertNil(store.stored)
        let authenticated = await session.isAuthenticated()
        XCTAssertFalse(authenticated)
    }

    func testConcurrentAccessCoalescesToOneRefresh() async throws {
        let store = InMemoryTokenStore(seed: "refresh-0")
        let client = FakeAuthClient()
        client.gateRefresh = true
        let session = AuthSession(client: client, store: store)

        async let a = session.accessToken()
        async let b = session.accessToken()
        // let both calls reach the gated refresh, then release it
        try await Task.sleep(nanoseconds: 50_000_000)
        client.openRefreshGate()
        _ = try await (a, b)

        let calls = await client.refreshCalls
        XCTAssertEqual(calls, 1, "concurrent accessToken() calls must share one refresh")
    }

    // MARK: - A transient failure is not a dead session

    private static let testUserId = "11111111-1111-7111-8111-111111111111"

    private func freshDefaults() -> UserDefaults {
        let suite = "auth-session-\(UUID().uuidString)"
        let d = UserDefaults(suiteName: suite)!
        d.removePersistentDomain(forName: suite)
        return d
    }

    /// Launching with no network used to wipe the Keychain and sign the employee out for good.
    private func assertTransientFailureKeepsTheSession(
        _ error: AuthError,
        _ message: String,
        line: UInt = #line
    ) async {
        let store = InMemoryTokenStore(seed: "refresh-0")
        let client = FakeAuthClient(refreshResult: .failure(error))
        let session = AuthSession(client: client, store: store, defaults: freshDefaults())

        let outcome = await session.bootstrap()

        XCTAssertEqual(outcome, .offline, message, line: line)
        XCTAssertEqual(store.stored, "refresh-0", "the refresh token must survive: " + message, line: line)
        let authenticated = await session.isAuthenticated()
        XCTAssertTrue(authenticated, "still signed in: " + message, line: line)
    }

    func testBootstrapKeepsTheSessionWhenTheMachineIsOffline() async {
        await assertTransientFailureKeepsTheSession(.transport, "no network says nothing about the token")
    }

    func testBootstrapKeepsTheSessionWhenTheApiIsDown() async {
        await assertTransientFailureKeepsTheSession(.server(503), "a redeploying API says nothing about the token")
    }

    func testBootstrapKeepsTheSessionWhenThrottled() async {
        await assertTransientFailureKeepsTheSession(.server(429), "the global throttler says nothing about the token")
    }

    /// The offline branch of AppDelegate.proceedToPolicy() looks up this user's ack marker by
    /// id, and there is no access token to decode one from after an offline launch.
    func testOfflineBootstrapStillResolvesTheUserIdForTheAckLookup() async {
        let defaults = freshDefaults()
        let store = InMemoryTokenStore(seed: "refresh-0")
        _ = await AuthSession(client: FakeAuthClient(), store: store, defaults: defaults).bootstrap()

        let relaunch = AuthSession(
            client: FakeAuthClient(refreshResult: .failure(AuthError.transport)),
            store: store,
            defaults: defaults
        )
        let outcome = await relaunch.bootstrap()

        XCTAssertEqual(outcome, .offline)
        let userId = await relaunch.userId()
        XCTAssertEqual(userId, Self.testUserId, "without this the offline branch cannot find the ack marker")
    }

    /// CLAUDE.md §1 fail-safe posture: the mirrored id must never outlive the session that
    /// wrote it, or the next user to launch on this machine inherits the previous user's
    /// readiness. The sign-out leak class has regressed twice before.
    func testLogoutClearsTheMirroredUserIdSoItCannotReachTheNextUser() async {
        let defaults = freshDefaults()
        let store = InMemoryTokenStore(seed: "refresh-0")
        let session = AuthSession(client: FakeAuthClient(), store: store, defaults: defaults)
        _ = await session.bootstrap()
        let signedIn = await session.userId()
        XCTAssertEqual(signedIn, Self.testUserId)

        await session.logout()

        let afterLogout = await session.userId()
        XCTAssertNil(afterLogout, "a signed-out session still resolved the previous user")

        // The next launch on this machine — same defaults, empty Keychain — sees nothing.
        let nextUser = AuthSession(
            client: FakeAuthClient(refreshResult: .failure(AuthError.transport)),
            store: InMemoryTokenStore(),
            defaults: defaults
        )
        let leaked = await nextUser.userId()
        XCTAssertNil(leaked, "the previous user's id leaked into the next session")
    }

    /// The one case that SHOULD clear: the server actually rejected the token.
    func testRejectedRefreshClearsTheMirroredUserIdToo() async {
        let defaults = freshDefaults()
        let store = InMemoryTokenStore(seed: "refresh-0")
        _ = await AuthSession(client: FakeAuthClient(), store: store, defaults: defaults).bootstrap()

        let rejected = AuthSession(
            client: FakeAuthClient(refreshResult: .failure(AuthError.refreshRejected)),
            store: store,
            defaults: defaults
        )
        let outcome = await rejected.bootstrap()

        XCTAssertEqual(outcome, .unauthenticated)
        XCTAssertNil(store.stored)
        let userId = await rejected.userId()
        XCTAssertNil(userId)
    }
}
