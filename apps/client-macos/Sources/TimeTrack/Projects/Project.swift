import Foundation

/// Client-side mirror of `ProjectSchema` / `SubprojectSchema` / `TaskSchema` in @timetrack/contracts.
/// Named `ProjectTask` because `Task` is Swift's concurrency primitive (CLAUDE.md /
/// plan Global Constraints).
///
/// `subprojects` and `ProjectTask.subprojectId` are optional: a `projects.json` written before
/// subprojects existed has neither, and it must still load (the picker treats such a project as
/// one implicit default — see `PickerTree`). Explicit inits keep every existing construction site
/// compiling; decoding is synthesized.
struct Project: Codable, Identifiable, Equatable {
    let id: String
    let teamId: String
    let name: String
    let archived: Bool
    let tasks: [ProjectTask]?
    let subprojects: [Subproject]?

    init(id: String, teamId: String, name: String, archived: Bool,
         tasks: [ProjectTask]?, subprojects: [Subproject]? = nil) {
        self.id = id
        self.teamId = teamId
        self.name = name
        self.archived = archived
        self.tasks = tasks
        self.subprojects = subprojects
    }
}

struct Subproject: Codable, Identifiable, Equatable {
    let id: String
    let projectId: String
    let name: String
    let archived: Bool
    /// The project's "General" bucket — exactly one per project, never archivable.
    let isDefault: Bool
}

struct ProjectTask: Codable, Identifiable, Equatable {
    let id: String
    let projectId: String
    let name: String
    let subprojectId: String?

    init(id: String, projectId: String, name: String, subprojectId: String? = nil) {
        self.id = id
        self.projectId = projectId
        self.name = name
        self.subprojectId = subprojectId
    }
}
