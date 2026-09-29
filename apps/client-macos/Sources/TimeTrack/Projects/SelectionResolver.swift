import Foundation

/// Matches a persisted selection against the CURRENT project list (spec §6).
///
/// A stored selection is only ever a hint. If the project was archived, deleted, or the user
/// was moved off that team, restoring it would pre-select something the server will reject on
/// Start — so an unmatched selection is dropped, never approximated. A stored task that no
/// longer exists degrades to its subproject (see `resolve` below).
enum SelectionResolver {
    /// The unified stale-resolution table (spec §4), identical on Windows:
    /// nothing gone → as stored; task gone → same subproject, no task; subproject gone → the
    /// project's default, no task; project gone or archived → nil. A task that still exists wins
    /// over the stored subproject (it may have been moved). Also upgrades a 0.6.x selection,
    /// which has no `subprojectId`.
    static func resolve(_ stored: StoredSelection?, in projects: [Project]) -> StoredSelection? {
        guard let stored,
              let project = projects.first(where: { $0.id == stored.projectId && !$0.archived })
        else { return nil }
        let node = PickerTree.node(project)
        if let taskId = stored.taskId,
           let home = node.subprojects.first(where: { $0.tasks.contains { $0.id == taskId } }) {
            return StoredSelection(projectId: project.id, subprojectId: home.id, taskId: taskId)
        }
        if let subprojectId = stored.subprojectId, node.subproject(subprojectId) != nil {
            return StoredSelection(projectId: project.id, subprojectId: subprojectId, taskId: nil)
        }
        return StoredSelection(projectId: project.id, subprojectId: node.defaultSubproject?.id, taskId: nil)
    }
}
