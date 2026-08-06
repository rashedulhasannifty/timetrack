import Foundation

/// PRD §6.3 — client-side app/site categorization from the admin policy lists. Slice 4.5: the
/// site (host) lists and app-name lists are SEPARATE — a host matches only the site lists, the
/// frontmost app name matches only the app lists. A host category wins over the app category;
/// else NEUTRAL. For sites the MOST SPECIFIC matching term wins across both lists (so a broad
/// `amazon.com` in the unproductive list can't silently override a specific `aws.amazon.com` in
/// the productive list); on equal specificity, UNPRODUCTIVE wins (fail toward flagging). An app
/// rule matches by exact equality against EITHER the app's bundleId or its display name (so a
/// bundleId rule survives a rename), and there UNPRODUCTIVE wins on overlap. All matching is
/// case-insensitive + trimmed. No content is read here — only the app name, its bundleId, and
/// (optionally) a host derived upstream for this call.
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

    func category(appName: String, bundleId: String? = nil, host: String?) -> Category {
        if let host = Self.normalize(host) {
            // Most-specific term wins across both site lists; equal specificity -> unproductive.
            let unprod = bestSiteSpecificity(host, unproductiveSites)
            let prod = bestSiteSpecificity(host, productiveSites)
            if let u = unprod, let p = prod { return u >= p ? .unproductive : .productive }
            if unprod != nil { return .unproductive }
            if prod != nil { return .productive }
        }
        // An app rule matches by bundleId OR display name (either normalized) — so a bundleId rule
        // survives a rename, and a name rule keeps working. UNPRODUCTIVE wins on overlap.
        let app = Self.normalize(appName)
        let bundle = Self.normalize(bundleId)
        if app != nil || bundle != nil {
            if Self.appListMatches(unproductiveApps, app, bundle) { return .unproductive }
            if Self.appListMatches(productiveApps, app, bundle) { return .productive }
        }
        return .neutral
    }

    /// True if any term in `list` equals the app's normalized display name or bundleId.
    private static func appListMatches(_ list: [String], _ app: String?, _ bundle: String?) -> Bool {
        list.contains { raw in
            guard let term = normalize(raw) else { return false }
            return term == app || term == bundle
        }
    }

    /// Highest match specificity of any term in `list` against `host`, or nil if none match.
    private func bestSiteSpecificity(_ host: String, _ list: [String]) -> Int? {
        var best: Int?
        for raw in list {
            guard let term = Self.normalize(raw),
                  let s = Self.siteMatchSpecificity(host, term) else { continue }
            if best == nil || s > best! { best = s }
        }
        return best
    }

    /// How specifically `term` pins `host` (higher = more specific), or nil if it doesn't match:
    /// - equality / dotted-suffix (`youtube.com` matches `m.youtube.com`): the suffix length.
    /// - leading-label wildcard (`api.*` matches `api.stripe.com`): the literal prefix length
    ///   (`api.`) — deliberately lower than a full-domain suffix, so a real domain rule outranks a
    ///   broad wildcard. A bare `*` (no dot) never matches.
    private static func siteMatchSpecificity(_ host: String, _ term: String) -> Int? {
        if term.hasSuffix(".*") {
            let prefix = String(term.dropLast(1)) // "api.*" -> "api."
            return host.hasPrefix(prefix) ? prefix.count : nil
        }
        if host == term || host.hasSuffix("." + term) { return term.count }
        return nil
    }

    private static func normalize(_ s: String?) -> String? {
        guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !t.isEmpty else { return nil }
        return t
    }
}
