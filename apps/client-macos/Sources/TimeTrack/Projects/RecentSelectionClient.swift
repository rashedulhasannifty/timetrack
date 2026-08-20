import Foundation

/// Fallback for a FRESH INSTALL: what project was this user last tracking against? (spec §6)
///
/// Reads the existing `GET /v1/time-entries` — no new endpoint, no `/v1` change. Strictly a
/// fallback: only consulted when `SelectionStore` has nothing for this user, and a failure
/// simply leaves nothing pre-selected rather than blocking the UI. Not a capture path.
final class RecentSelectionClient {
    private let baseURL: URL
    private let session: AuthSession
    /// How far back to look for a previous entry. A fortnight covers a holiday or a new Mac
    /// arriving mid-sprint without dragging back a project abandoned months ago.
    private static let lookbackDays = 14

    init(baseURL: URL, session: AuthSession) {
        self.baseURL = baseURL
        self.session = session
    }

    func mostRecentSelection() async -> StoredSelection? {
        guard let token = try? await session.accessToken() else { return nil }
        let now = Date()
        let from = now.addingTimeInterval(-Double(Self.lookbackDays) * 86_400)

        var components = URLComponents(
            url: baseURL.appendingPathComponent("time-entries"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "from", value: TimeEntryPayload.iso.string(from: from)),
            URLQueryItem(name: "to", value: TimeEntryPayload.iso.string(from: now)),
        ]
        guard let url = components?.url else { return nil }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode)
        else { return nil }

        return Self.newestSelection(in: data)
    }

    /// Pure decode + pick (unit-tested; the async orchestration above is build-verified).
    /// Returns the newest entry that actually names a project.
    static func newestSelection(in data: Data) -> StoredSelection? {
        struct Row: Decodable {
            let startTime: String
            let projectId: String?
            let taskId: String?
        }
        guard let rows = try? JSONDecoder().decode([Row].self, from: data) else { return nil }
        return rows
            .filter { $0.projectId != nil }
            .max { $0.startTime < $1.startTime }
            .flatMap { row in
                row.projectId.map { StoredSelection(projectId: $0, taskId: row.taskId) }
            }
    }
}
