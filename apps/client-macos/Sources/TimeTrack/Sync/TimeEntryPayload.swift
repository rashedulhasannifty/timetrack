import Foundation

/// Matches `CreateTimeEntrySchema` in @timetrack/contracts.
///
/// `projectId`/`taskId`/`endTime` are `.nullable()` on the server (present, may be null), so a
/// nil MUST be encoded with `encodeNil` — Swift's synthesised Codable would omit the key and
/// the strict-mode Zod pipe answers 422. `note` is `.optional()`, so nil is omitted instead.
///
/// A nil `endTime` means the entry is still RUNNING. Only the direct live-entry publish sends
/// that; buffered records are always closed.
struct TimeEntryPayload: Encodable {
    let id: String
    let projectId: String?
    let taskId: String?
    let startTime: String
    let endTime: String?
    let source: String
    let note: String?

    enum CodingKeys: String, CodingKey {
        case id, projectId, taskId, startTime, endTime, source, note
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        if let projectId { try c.encode(projectId, forKey: .projectId) } else { try c.encodeNil(forKey: .projectId) }
        if let taskId { try c.encode(taskId, forKey: .taskId) } else { try c.encodeNil(forKey: .taskId) }
        try c.encode(startTime, forKey: .startTime)
        if let endTime { try c.encode(endTime, forKey: .endTime) } else { try c.encodeNil(forKey: .endTime) }
        try c.encode(source, forKey: .source)
        try c.encodeIfPresent(note, forKey: .note)
    }

    /// The wire format the API expects for instants.
    static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
