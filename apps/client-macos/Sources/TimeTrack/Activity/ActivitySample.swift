import Foundation

/// Client mirror of @timetrack/contracts `ActivitySampleSchema` (2.3a). The client cannot import
/// the TS contract, so keep this in exact sync: extra keys are rejected server-side, missing keys
/// 422. `category` is a `Category.rawValue`. No URL/host field — those never leave the device.
struct ActivitySample: Codable, Equatable {
    let id: String            // client-minted UUIDv7 → idempotency key
    let timestamp: String     // ISO-8601 (interval end)
    let appName: String
    let windowTitle: String?
    let activityPct: Int      // 0…100
    let category: String      // Category.rawValue
}
