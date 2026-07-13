import XCTest
@testable import TimeTrack

final class AuthSessionTests: XCTestCase {
    func testBootstrapWithStoredTokenRefreshesAndAuthenticates() async {
        let store = InMemoryTokenStore(seed: "refresh-0")
        let client = FakeAuthClient()
        let session = AuthSession(client: client, store: store)

        let ok = await session.bootstrap()

        XCTAssertTrue(ok)
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
        let ok = await session.bootstrap()
        XCTAssertFalse(ok)
        let authenticated = await session.isAuthenticated()
        XCTAssertFalse(authenticated)
    }

    func testBootstrapClearsStoreWhenRefreshRejected() async {
        let store = InMemoryTokenStore(seed: "refresh-0")
        let client = FakeAuthClient(refreshResult: .failure(AuthError.refreshRejected))
        let session = AuthSession(client: client, store: store)

        let ok = await session.bootstrap()

        XCTAssertFalse(ok)
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
}
