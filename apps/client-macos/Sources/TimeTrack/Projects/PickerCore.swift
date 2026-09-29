import Foundation

/// The UI-free picker core (spec §3): Projects → Subprojects → Tasks as rows the menu renders.
/// No SwiftUI here, so every rule — skip-General, ordering, back, search paths — is unit-tested.
/// The Windows client's `PickerCore.cs` is a line-for-line port; change both together.

struct PickerTask: Equatable {
    let id: String
    let name: String
}

/// One subproject bucket. `id == nil` is the implicit default of a project decoded from a cache
/// written before subprojects existed — the client sends `subprojectId: null` and the server
/// derives it.
struct PickerSubproject: Equatable {
    let id: String?
    let name: String
    let isDefault: Bool
    let tasks: [PickerTask]
}

struct PickerProject: Equatable {
    let id: String
    let name: String
    /// Default first, then by name. Never empty.
    let subprojects: [PickerSubproject]

    /// Only the default is active: the subproject screen is skipped and search paths omit it.
    var skipsSubprojectLevel: Bool { subprojects.count == 1 && subprojects[0].isDefault }
    var defaultSubproject: PickerSubproject? { subprojects.first { $0.isDefault } }
    func subproject(_ id: String?) -> PickerSubproject? { subprojects.first { $0.id == id } }
}

enum PickerTree {
    /// Name of the implicit default built for a pre-subproject cache. Never displayed: such a
    /// project always skips the subproject level.
    static let implicitDefaultName = "General"

    static func build(_ projects: [Project]) -> [PickerProject] {
        projects.filter { !$0.archived }.map(node)
    }

    static func node(_ project: Project) -> PickerProject {
        let tasks = project.tasks ?? []
        let active = (project.subprojects ?? []).filter { !$0.archived }
        guard !active.isEmpty else {
            return PickerProject(id: project.id, name: project.name, subprojects: [
                PickerSubproject(id: nil, name: implicitDefaultName, isDefault: true, tasks: sorted(tasks)),
            ])
        }
        let ordered = active.sorted { a, b in
            a.isDefault != b.isDefault ? a.isDefault : precedes(a.name, b.name)
        }
        let defaultId = ordered.first { $0.isDefault }?.id
        return PickerProject(id: project.id, name: project.name, subprojects: ordered.map { sub in
            PickerSubproject(id: sub.id, name: sub.name, isDefault: sub.isDefault,
                             tasks: sorted(tasks.filter { ($0.subprojectId ?? defaultId) == sub.id }))
        })
    }

    static func precedes(_ a: String, _ b: String) -> Bool {
        a.compare(b, options: .caseInsensitive) == .orderedAscending
    }

    private static func sorted(_ tasks: [ProjectTask]) -> [PickerTask] {
        tasks.sorted { precedes($0.name, $1.name) }.map { PickerTask(id: $0.id, name: $0.name) }
    }
}

enum PickerLevel: Equatable {
    case root
    case project(String)
    case subproject(projectId: String, subprojectId: String?)
}

struct PickerRow: Identifiable, Equatable {
    enum Action: Equatable {
        case back
        case open(PickerLevel)
        case track(StoredSelection)
    }

    let id: String
    let title: String
    let action: Action
}

enum PickerNavigation {
    static let separator = " › "

    static func open(_ project: PickerProject) -> PickerLevel {
        project.skipsSubprojectLevel
            ? .subproject(projectId: project.id, subprojectId: project.subprojects[0].id)
            : .project(project.id)
    }

    static func back(from level: PickerLevel, in tree: [PickerProject]) -> PickerLevel {
        guard case let .subproject(projectId, _) = normalize(level, in: tree),
              let project = tree.first(where: { $0.id == projectId }),
              !project.skipsSubprojectLevel
        else { return .root }
        return .project(projectId)
    }

    /// A level a refresh removed falls back to a valid one (ruling 5).
    static func normalize(_ level: PickerLevel, in tree: [PickerProject]) -> PickerLevel {
        switch level {
        case .root:
            return .root
        case let .project(id):
            guard let project = tree.first(where: { $0.id == id }) else { return .root }
            return open(project)
        case let .subproject(projectId, subprojectId):
            guard let project = tree.first(where: { $0.id == projectId }) else { return .root }
            return project.subproject(subprojectId) == nil ? open(project) : level
        }
    }

    static func rows(at level: PickerLevel, in tree: [PickerProject]) -> [PickerRow] {
        switch normalize(level, in: tree) {
        case .root:
            return tree.map { PickerRow(id: "p:\($0.id)", title: $0.name, action: .open(open($0))) }
        case let .project(id):
            guard let project = tree.first(where: { $0.id == id }) else { return rows(at: .root, in: tree) }
            return [PickerRow(id: "back", title: project.name, action: .back)]
                + project.subprojects.map { sub in
                    PickerRow(id: "s:\(sub.id ?? project.id)", title: sub.name,
                              action: .open(.subproject(projectId: project.id, subprojectId: sub.id)))
                }
        case let .subproject(projectId, subprojectId):
            guard let project = tree.first(where: { $0.id == projectId }),
                  let sub = project.subproject(subprojectId)
            else { return rows(at: .root, in: tree) }
            let skipped = project.skipsSubprojectLevel
            let backTitle = skipped ? project.name : project.name + separator + sub.name
            let noTask = (skipped ? project.name : sub.name) + " (no task)"
            return [
                PickerRow(id: "back", title: backTitle, action: .back),
                PickerRow(id: "n:\(sub.id ?? project.id)", title: noTask,
                          action: .track(StoredSelection(projectId: project.id, subprojectId: sub.id, taskId: nil))),
            ] + sub.tasks.map { task in
                PickerRow(id: "t:\(task.id)", title: task.name,
                          action: .track(StoredSelection(projectId: project.id, subprojectId: sub.id, taskId: task.id)))
            }
        }
    }

    /// The header strip's path for the current selection (ruling 4). Never renders a missing name.
    static func headerText(for selection: StoredSelection?, in tree: [PickerProject]) -> String {
        guard let selection, let project = tree.first(where: { $0.id == selection.projectId }) else {
            return "No project"
        }
        let taskHome = selection.taskId.flatMap { taskId in
            project.subprojects.first { $0.tasks.contains { $0.id == taskId } }
        }
        let sub = taskHome ?? project.subproject(selection.subprojectId)
        let task = selection.taskId.flatMap { taskId in taskHome?.tasks.first { $0.id == taskId } }
        var parts = [project.name]
        if let sub, !project.skipsSubprojectLevel { parts.append(sub.name) }
        if let task { parts.append(task.name) }
        return parts.joined(separator: separator)
    }

    /// Keyboard highlight (macOS). Nothing highlighted: Down starts at the top, Up at the bottom.
    static func moveHighlight(_ current: String?, by delta: Int, in rows: [PickerRow]) -> String? {
        guard !rows.isEmpty else { return nil }
        guard let current, let index = rows.firstIndex(where: { $0.id == current }) else {
            return delta >= 0 ? rows[0].id : rows[rows.count - 1].id
        }
        return rows[min(max(index + delta, 0), rows.count - 1)].id
    }
}

enum PickerSearch {
    static func isSearching(_ query: String) -> Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Flat full-path results across every level (spec §2). A lone default is omitted from paths.
    static func results(for query: String, in tree: [PickerProject]) -> [PickerRow] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return [] }
        var rows: [PickerRow] = []
        for project in tree {
            for sub in project.subprojects {
                let base = project.skipsSubprojectLevel ? [project.name] : [project.name, sub.name]
                if matches(base, q) {
                    rows.append(PickerRow(
                        id: "n:\(sub.id ?? project.id)",
                        title: base.joined(separator: PickerNavigation.separator),
                        action: .track(StoredSelection(projectId: project.id, subprojectId: sub.id, taskId: nil))))
                }
                for task in sub.tasks where matches(base + [task.name], q) {
                    rows.append(PickerRow(
                        id: "t:\(task.id)",
                        title: (base + [task.name]).joined(separator: PickerNavigation.separator),
                        action: .track(StoredSelection(projectId: project.id, subprojectId: sub.id, taskId: task.id))))
                }
            }
        }
        return rows
    }

    private static func matches(_ parts: [String], _ query: String) -> Bool {
        parts.contains { $0.range(of: query, options: .caseInsensitive) != nil }
    }
}
