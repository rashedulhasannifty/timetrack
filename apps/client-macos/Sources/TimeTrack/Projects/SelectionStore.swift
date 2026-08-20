import Foundation

/// The picker selection worth remembering across launches. Ids only — never names or titles.
struct StoredSelection: Codable, Equatable {
    let projectId: String
    let taskId: String?
}

/// Persists the last picker selection so the employee doesn't re-pick their project every day
/// (spec §6).
///
/// Keyed by userId. `MenuViewModel.reset()` deliberately clears the in-memory selection on
/// sign-out so a different user cannot inherit a stale, wrong-team selection (CLAUDE.md §1);
/// namespacing the persisted value per user is what lets it survive a relaunch without
/// reopening that hole. Nothing here is a capture path — no AckGate.
final class SelectionStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func save(_ selection: StoredSelection, userId: String) {
        guard let data = try? JSONEncoder().encode(selection) else { return }
        defaults.set(data, forKey: Self.key(for: userId))
    }

    func load(userId: String) -> StoredSelection? {
        guard let data = defaults.data(forKey: Self.key(for: userId)) else { return nil }
        return try? JSONDecoder().decode(StoredSelection.self, from: data)
    }

    func clear(userId: String) {
        defaults.removeObject(forKey: Self.key(for: userId))
    }

    private static func key(for userId: String) -> String {
        "TimeTrack.lastSelection.\(userId)"
    }
}
