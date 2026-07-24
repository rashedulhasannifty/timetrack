import Foundation

/// PRD §6.3 — client-side app/site categorization from the admin policy lists. Slice 4.5: the
/// site (host) lists and app-name lists are SEPARATE — a host matches only the site lists, the
/// frontmost app name matches only the app lists. A host category wins over the app category;
/// else NEUTRAL. UNPRODUCTIVE wins on overlap (fail toward flagging). All matching is
/// case-insensitive + trimmed. No content is read here — only the app name and (optionally) a
/// host derived upstream for this call.
enum Category: String {
    case productive = "PRODUCTIVE"
    case unproductive = "UNPRODUCTIVE"
    case neutral = "NEUTRAL"
}

struct Categorizer {
    private let productiveApps: [String]
    private let unproductiveApps: [String]
    private let productiveSites: [String]
    private let unproductiveSites: [String]

    init(productiveApps: [String], unproductiveApps: [String],
         productiveSites: [String] = [], unproductiveSites: [String] = []) {
        self.productiveApps = productiveApps
        self.unproductiveApps = unproductiveApps
        self.productiveSites = productiveSites
        self.unproductiveSites = unproductiveSites
    }

    func category(appName: String, host: String?) -> Category {
        if let host = Self.normalize(host) {
            if matchesHost(host, unproductiveSites) { return .unproductive }
            if matchesHost(host, productiveSites) { return .productive }
        }
        if let app = Self.normalize(appName) {
            if unproductiveApps.contains(where: { Self.normalize($0) == app }) { return .unproductive }
            if productiveApps.contains(where: { Self.normalize($0) == app }) { return .productive }
        }
        return .neutral
    }

    /// A term matches a host by equality or dotted-suffix (`youtube.com` matches `m.youtube.com`).
    private func matchesHost(_ host: String, _ list: [String]) -> Bool {
        list.contains { raw in
            guard let term = Self.normalize(raw) else { return false }
            return host == term || host.hasSuffix("." + term)
        }
    }

    private static func normalize(_ s: String?) -> String? {
        guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !t.isEmpty else { return nil }
        return t
    }
}
