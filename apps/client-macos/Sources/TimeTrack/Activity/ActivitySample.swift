import Foundation

/// Client mirror of @timetrack/contracts `ActivitySampleSchema` (2.3a). The client cannot import
/// the TS contract, so keep this in exact sync: extra keys are rejected server-side, missing keys
/// 422. `category` is a `Category.rawValue`. No URL/host field — those never leave the device.
struct ActivitySample: Codable, Equatable {
    let id: String            // client-minted UUIDv7 → idempotency key
    let timestamp: String     // ISO-8601 (interval end)
    let appName: String
    let bundleId: String?     // stable macOS bundle id; nil when the app has none
    let windowTitle: String?
    let activityPct: Int      // 0…100
    let category: String      // Category.rawValue

    private enum CodingKeys: String, CodingKey {
        case id, timestamp, appName, bundleId, windowTitle, activityPct, category
    }

    // Custom encode: the contract's windowTitle is `.nullable()` but NOT `.optional()`, so
    // a nil value must serialize as an explicit JSON `null`, never be omitted. Swift's
    // synthesized Codable would use encodeIfPresent for the Optional and drop the key
    // entirely, which fails server-side validation with a 422. `encode(forKey:)` (not
    // encodeIfPresent) is what emits `null` for a nil Optional.
    //
    // No custom init(from:) — the synthesized Decodable uses decodeIfPresent, which already
    // accepts both `null` and an absent key, so it stays as-is.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(timestamp, forKey: .timestamp)
        try container.encode(appName, forKey: .appName)
        // Server field is `.nullable().optional()`, so an explicit `null` is accepted (and
        // unambiguous). Emit it rather than omitting the key, mirroring windowTitle.
        try container.encode(bundleId, forKey: .bundleId)
        try container.encode(windowTitle, forKey: .windowTitle)
        try container.encode(activityPct, forKey: .activityPct)
        try container.encode(category, forKey: .category)
    }
}
