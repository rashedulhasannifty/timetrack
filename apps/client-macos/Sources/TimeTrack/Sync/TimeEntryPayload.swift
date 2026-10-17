import Foundation

/// Matches `CreateTimeEntrySchema` in @timetrack/contracts.
///
/// `projectId`/`subprojectId`/`taskId`/`endTime` are `.nullable()` on the server (present, may be null), so a
/// nil MUST be encoded with `encodeNil` — Swift's synthesised Codable would omit the key and
/// the strict-mode Zod pipe answers 422. (`subprojectId` is `.nullable().optional()` on the server;
/// an explicit null means "derive it".) `note` is `.optional()`, so nil is omitted instead.
///
/// A nil `endTime` means the entry is still RUNNING. Only the direct live-entry publish sends
/// that; buffered records are always closed.
struct TimeEntryPayload: Encodable {
    let id: String
    let projectId: String?
    let subprojectId: String?
    let taskId: String?
    let startTime: String
    let endTime: String?
    let source: String
    let note: String?

    enum CodingKeys: String, CodingKey {
        case id, projectId, subprojectId, taskId, startTime, endTime, source, note
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        if let projectId { try c.encode(projectId, forKey: .projectId) } else { try c.encodeNil(forKey: .projectId) }
        if let subprojectId { try c.encode(subprojectId, forKey: .subprojectId) } else { try c.encodeNil(forKey: .subprojectId) }
        if let taskId { try c.encode(taskId, forKey: .taskId) } else { try c.encodeNil(forKey: .taskId) }
        try c.encode(startTime, forKey: .startTime)
        if let endTime { try c.encode(endTime, forKey: .endTime) } else { try c.encodeNil(forKey: .endTime) }
        try c.encode(source, forKey: .source)
        // `note: z.string().max(2000)` counts UTF-16 units. The note field has no limit of its own,
        // and an over-long note 422s the entry — a permanent failure, so the time entry itself
        // was dropped. Cut it here, at the one place every entry is serialised.
        try c.encodeIfPresent(note.map { UTF16Limit.truncate($0, to: Self.noteLimit) }, forKey: .note)
    }

    /// `CreateTimeEntrySchema.note` max, in UTF-16 units.
    static let noteLimit = 2000

    /// The wire format the API expects for instants.
    static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
