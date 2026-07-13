import Foundation

/// PRD §7.5 — every record carries a client-minted UUIDv7 primary key so sync is
/// idempotent (the API upserts on it). Hand-rolled to avoid a SwiftPM dependency
/// (CLAUDE.md §2). Layout (RFC 9562): 48-bit ms timestamp · version 7 · 12 rand ·
/// variant 10 · 62 rand. `now`/`randomByte` are injectable for deterministic tests.
enum UUIDv7 {
    static func generate(
        now: Date = Date(),
        randomByte: () -> UInt8 = { UInt8.random(in: UInt8.min...UInt8.max) }
    ) -> String {
        var bytes = [UInt8](repeating: 0, count: 16)

        // 48-bit big-endian millisecond timestamp.
        let ms = UInt64((now.timeIntervalSince1970 * 1000).rounded(.down))
        bytes[0] = UInt8((ms >> 40) & 0xFF)
        bytes[1] = UInt8((ms >> 32) & 0xFF)
        bytes[2] = UInt8((ms >> 24) & 0xFF)
        bytes[3] = UInt8((ms >> 16) & 0xFF)
        bytes[4] = UInt8((ms >> 8) & 0xFF)
        bytes[5] = UInt8(ms & 0xFF)

        for i in 6..<16 { bytes[i] = randomByte() }
        bytes[6] = (bytes[6] & 0x0F) | 0x70 // version 7
        bytes[8] = (bytes[8] & 0x3F) | 0x80 // variant 10

        let hex = bytes.map { String(format: "%02x", $0) }.joined()
        func slice(_ lo: Int, _ hi: Int) -> Substring {
            let a = hex.index(hex.startIndex, offsetBy: lo)
            let b = hex.index(hex.startIndex, offsetBy: hi)
            return hex[a..<b]
        }
        return "\(slice(0, 8))-\(slice(8, 12))-\(slice(12, 16))-\(slice(16, 20))-\(slice(20, 32))"
    }
}
