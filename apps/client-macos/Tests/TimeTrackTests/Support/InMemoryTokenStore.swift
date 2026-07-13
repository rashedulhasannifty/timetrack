@testable import TimeTrack

final class InMemoryTokenStore: TokenStore {
    private(set) var stored: String?
    init(seed: String? = nil) { stored = seed }
    func readRefreshToken() -> String? { stored }
    func saveRefreshToken(_ token: String) { stored = token }
    func clear() { stored = nil }
}
