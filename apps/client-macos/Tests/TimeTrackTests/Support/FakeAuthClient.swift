@testable import TimeTrack

/// A JWT whose payload sub is the fixed test user id (see JWTDecoderTests token).
let kTestAccessToken =
    "eyJhbGciOiJIUzI1NiJ9." +
    "eyJzdWIiOiIxMTExMTExMS0xMTExLTcxMTEtODExMS0xMTExMTExMTExMTEiLCJyb2xlIjoiRU1QTE9ZRUUiLCJ0ZWFtSWQiOiIyMjIyMjIyMi0yMjIyLTcyMjItODIyMi0yMjIyMjIyMjIyMjIifQ." +
    "c2ln"

final class FakeAuthClient: AuthClienting {
    var loginResult: Result<TokenPair, Error>
    var refreshResult: Result<TokenPair, Error>
    private(set) var loginCalls = 0
    private(set) var refreshCalls = 0

    var gateRefresh = false
    private var gate: CheckedContinuation<Void, Never>?
    func openRefreshGate() { gate?.resume(); gate = nil }

    init(
        loginResult: Result<TokenPair, Error> = .success(TokenPair(accessToken: kTestAccessToken, refreshToken: "refresh-1", expiresIn: 900)),
        refreshResult: Result<TokenPair, Error> = .success(TokenPair(accessToken: kTestAccessToken, refreshToken: "refresh-2", expiresIn: 900))
    ) {
        self.loginResult = loginResult
        self.refreshResult = refreshResult
    }

    func login(email: String, password: String) async throws -> TokenPair {
        loginCalls += 1
        return try loginResult.get()
    }

    func refresh(refreshToken: String) async throws -> TokenPair {
        refreshCalls += 1
        if gateRefresh { await withCheckedContinuation { gate = $0 } }
        return try refreshResult.get()
    }
}
