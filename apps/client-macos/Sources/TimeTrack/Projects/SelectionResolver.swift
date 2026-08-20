import Foundation

/// Matches a persisted selection against the CURRENT project list (spec §6).
///
/// A stored selection is only ever a hint. If the project was archived, deleted, or the user
/// was moved off that team, restoring it would pre-select something the server will reject on
/// Start — so an unmatched selection is dropped, never approximated. A stored task that no
/// longer exists does NOT silently degrade to its project: the employee never chose the
/// project on its own.
enum SelectionResolver {
    static func resolve(_ stored: StoredSelection?, in choices: [Choice]) -> Choice? {
        guard let stored else { return nil }
        return choices.first { $0.projectId == stored.projectId && $0.taskId == stored.taskId }
    }
}
