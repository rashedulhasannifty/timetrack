import Foundation

/// Client-side mirror of `ProjectSchema` / `TaskSchema` in @timetrack/contracts.
/// Named `ProjectTask` because `Task` is Swift's concurrency primitive (CLAUDE.md /
/// plan Global Constraints).
struct Project: Codable, Identifiable, Equatable {
    let id: String
    let teamId: String
    let name: String
    let archived: Bool
    let tasks: [ProjectTask]?
}

struct ProjectTask: Codable, Identifiable, Equatable {
    let id: String
    let projectId: String
    let name: String
}
