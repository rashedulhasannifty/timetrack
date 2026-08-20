import Foundation
import Security

/// Persists only the long-lived secret (the refresh token). The short-lived access token
/// lives in memory on AuthSession and is re-minted via refresh — it is never written to disk.
protocol TokenStore {
    func readRefreshToken() -> String?
    func saveRefreshToken(_ token: String)
    func clear()
}

/// Keychain-backed store over the system Security framework (no new dependency).
final class KeychainTokenStore: TokenStore {
    private let service: String
    private let account: String

    /// The service is per-install (`AppInstall`): shared with the released app, a dev sign-in
    /// would overwrite the token production is using and sign the employee out.
    init(service: String = AppInstall.keychainService, account: String = "refreshToken") {
        self.service = service
        self.account = account
    }

    private var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    func readRefreshToken() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let token = String(data: data, encoding: .utf8) else { return nil }
        return token
    }

    func saveRefreshToken(_ token: String) {
        let data = Data(token.utf8)
        SecItemDelete(baseQuery as CFDictionary)
        var attrs = baseQuery
        attrs[kSecValueData as String] = data
        attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(attrs as CFDictionary, nil)
    }

    func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
