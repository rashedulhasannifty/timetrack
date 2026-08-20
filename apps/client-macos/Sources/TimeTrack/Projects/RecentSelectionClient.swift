import Foundation

/// Fallback for a FRESH INSTALL: what project was this user last tracking against? (spec §6)
///
/// Reads the existing `GET /v1/time-entries` — no new endpoint, no `/v1` change. Strictly a
/// fallback: only consulted when `SelectionStore` has nothing for this user, and a failure
/// simply leaves nothing pre-selected rather than blocking the UI. Not a capture path.
final class RecentSelectionClient {
    /// What `mostRecentSelection()` learned. Split from a bare `StoredSelection?` so the
    /// caller can tell "the server answered and there's nothing to restore" apart from
    /// "no answer was obtained" — a 429 from the global throttler or a 503 mid-deploy
    /// shouldn't burn the caller's one-shot fallback attempt the way a real answer should.
    enum FallbackOutcome {
        /// The server answered (2xx) and named a project to restore.
        case found(StoredSelection)
        /// The server answered (2xx) but there was nothing usable in the window.
        case notFound
        /// No answer was obtained: no token, offline, or a non-2xx status (429/503/etc).
        /// Says nothing about the user's history, so it should not be treated as a real
        /// attempt.
        case transientFailure
    }

    private let baseURL: URL
    private let session: AuthSession
    /// How far back to look for a previous entry. A fortnight covers a holiday or a new Mac
    /// arriving mid-sprint without dragging back a project abandoned months ago.
    private static let lookbackDays = 14

    init(baseURL: URL, session: AuthSession) {
        self.baseURL = baseURL
        self.session = session
    }

    /// No 401 → forceRefresh → retry-once dance here, unlike `ProjectClient.list()`
    /// (`ProjectClient.swift:22-26`): `refreshProjects()` always calls `projectClient.list()`
    /// first, and that call already forces a token refresh on a 401, so by the time this
    /// fallback runs the token is already fresh. Adding the same retry here would be
    /// redundant, not a missing safeguard.
    func mostRecentSelection() async -> FallbackOutcome {
        guard let token = try? await session.accessToken() else { return .transientFailure }
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
        guard let url = components?.url else { return .transientFailure }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode)
        else { return .transientFailure }

        guard let selection = Self.newestSelection(in: data) else { return .notFound }
        return .found(selection)
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
