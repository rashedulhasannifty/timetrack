import Foundation

/// The UI-free picker core (spec §3): Projects → Subprojects → Tasks as rows the menu renders.
/// No SwiftUI here, so every rule — skip-General, ordering, back, search paths — is unit-tested.
/// The Windows client's `PickerCore.cs` is a line-for-line port; change both together.

/// Who is looking at the picker: an ADMIN's root list and search are grouped by team. Read from
/// the access token, or from the claims `AuthSession` mirrored for an offline launch.
struct PickerViewer: Equatable {
    let role: String
    let teamId: String
    var isAdmin: Bool { role == "ADMIN" }
}

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
        case open(PickerLevel)
        case track(StoredSelection)
    }

    let id: String
    let title: String
    let action: Action
    /// The team header this row sits under: set only on an ADMIN's root list and search results
    /// (`PickerTeams.group`), nil everywhere else. The UI draws a header where it changes.
    var section: String? = nil
}

/// One step of the breadcrumb bar above the list. Every crumb but the last is a way back.
struct PickerCrumb: Equatable {
    let title: String
    let level: PickerLevel
}

/// The "Working on" card: the project on its own line, then what is under it (subproject and/or
/// task), or nil when the project is all there is to say.
struct PickerWorkingOn: Equatable {
    let project: String
    let detail: String?
}

enum PickerNavigation {
    static let separator = " › "
    static let rootTitle = "All projects"

    /// A project whose lone default subproject has no tasks has nothing below it to choose:
    /// its root row selects it.
    static func isLeaf(_ project: PickerProject) -> Bool {
        project.skipsSubprojectLevel && project.subprojects[0].tasks.isEmpty
    }

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
            return tree.map { project in
                PickerRow(id: "p:\(project.id)", title: project.name,
                          action: isLeaf(project)
                              ? .track(StoredSelection(projectId: project.id,
                                                       subprojectId: project.subprojects[0].id, taskId: nil))
                              : .open(open(project)))
            }
        case let .project(id):
            guard let project = tree.first(where: { $0.id == id }) else { return rows(at: .root, in: tree) }
            // A subproject with no tasks is the choice itself — one click, not a screen whose
            // only useful row is "(no task)".
            return project.subprojects.map { sub in
                PickerRow(id: "s:\(sub.id ?? project.id)", title: sub.name,
                          action: sub.tasks.isEmpty
                              ? .track(StoredSelection(projectId: project.id, subprojectId: sub.id, taskId: nil))
                              : .open(.subproject(projectId: project.id, subprojectId: sub.id)))
            }
        case let .subproject(projectId, subprojectId):
            guard let project = tree.first(where: { $0.id == projectId }),
                  let sub = project.subproject(subprojectId)
            else { return rows(at: .root, in: tree) }
            let noTask = (project.skipsSubprojectLevel ? project.name : sub.name) + " (no task)"
            return [
                PickerRow(id: "n:\(sub.id ?? project.id)", title: noTask,
                          action: .track(StoredSelection(projectId: project.id, subprojectId: sub.id, taskId: nil))),
            ] + sub.tasks.map { task in
                PickerRow(id: "t:\(task.id)", title: task.name,
                          action: .track(StoredSelection(projectId: project.id, subprojectId: sub.id, taskId: task.id)))
            }
        }
    }

    /// The bar above the list: "All projects / Acme / checkout". Empty at the root. A skipped
    /// subproject screen is titled with the project alone, matching `back`.
    static func breadcrumb(at level: PickerLevel, in tree: [PickerProject]) -> [PickerCrumb] {
        let root = PickerCrumb(title: rootTitle, level: .root)
        switch normalize(level, in: tree) {
        case .root:
            return []
        case let .project(id):
            guard let project = tree.first(where: { $0.id == id }) else { return [] }
            return [root, PickerCrumb(title: project.name, level: .project(id))]
        case let .subproject(projectId, subprojectId):
            guard let project = tree.first(where: { $0.id == projectId }),
                  let sub = project.subproject(subprojectId) else { return [] }
            let here = PickerCrumb(title: project.skipsSubprojectLevel ? project.name : sub.name,
                                   level: .subproject(projectId: projectId, subprojectId: subprojectId))
            return project.skipsSubprojectLevel
                ? [root, here]
                : [root, PickerCrumb(title: project.name, level: .project(projectId)), here]
        }
    }

    /// The selection placed in the tree: its project, the subproject it belongs to (a task's own
    /// subproject wins; a missing id means the default) and its task, if still present.
    private static func place(_ selection: StoredSelection?, in tree: [PickerProject])
        -> (project: PickerProject, sub: PickerSubproject?, task: PickerTask?)? {
        guard let selection, let project = tree.first(where: { $0.id == selection.projectId }) else {
            return nil
        }
        let taskHome = selection.taskId.flatMap { taskId in
            project.subprojects.first { $0.tasks.contains { $0.id == taskId } }
        }
        let sub = taskHome ?? project.subproject(selection.subprojectId)
            ?? (selection.subprojectId == nil ? project.defaultSubproject : nil)
        let task = selection.taskId.flatMap { taskId in taskHome?.tasks.first { $0.id == taskId } }
        return (project, sub, task)
    }

    /// Whether a row lies on the path to the current selection — the project, then the
    /// subproject, then the exact choice — so every level shows where you are.
    static func isOnCurrentPath(_ row: PickerRow, selection: StoredSelection?, in tree: [PickerProject]) -> Bool {
        guard let placed = place(selection, in: tree) else { return false }
        switch row.action {
        case let .open(.project(projectId)):
            return projectId == placed.project.id
        case let .open(.subproject(projectId, subprojectId)):
            guard projectId == placed.project.id else { return false }
            // A skipped screen is opened from the project's root row: that row is the project.
            return placed.project.skipsSubprojectLevel || subprojectId == placed.sub?.id
        case .open(.root):
            return false
        case let .track(target):
            return target.projectId == placed.project.id
                && target.subprojectId == placed.sub?.id
                && target.taskId == placed.task?.id
        }
    }

    /// Where the picker opens: the level holding the current choice, so the first thing shown is
    /// where you are rather than the top of the list.
    static func home(for selection: StoredSelection?, in tree: [PickerProject]) -> PickerLevel {
        guard let placed = place(selection, in: tree) else { return .root }
        if placed.task != nil, let sub = placed.sub {
            return normalize(.subproject(projectId: placed.project.id, subprojectId: sub.id), in: tree)
        }
        return isLeaf(placed.project) ? .root : open(placed.project)
    }

    /// The "Working on" card's text. Nil when there is no (resolvable) selection.
    static func workingOn(_ selection: StoredSelection?, in tree: [PickerProject]) -> PickerWorkingOn? {
        guard let placed = place(selection, in: tree) else { return nil }
        var detail: [String] = []
        if let sub = placed.sub, !placed.project.skipsSubprojectLevel { detail.append(sub.name) }
        if let task = placed.task { detail.append(task.name) }
        return PickerWorkingOn(project: placed.project.name,
                               detail: detail.isEmpty ? nil : detail.joined(separator: separator))
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

/// An ADMIN's root list and search results split by team (spec 2026-10-08 §4). A layer over the
/// rows `PickerNavigation`/`PickerSearch` already build: it stamps `section` and stable-sorts —
/// rows stay rows, so activation, highlight and search Return are untouched.
enum PickerTeams {
    static let ownTeamTitle = "My team"
    static let otherTeamTitle = "Other team"

    struct Section: Equatable {
        let order: Int
        let title: String
    }

    /// Each project's section by project id. Empty unless the viewer is an ADMIN. Own team:
    /// every project linked to it (home or shared in); everything else under its home team,
    /// teams A→Z by name (ties by id, so the order is stable).
    static func sections(for projects: [Project], viewer: PickerViewer?) -> [String: Section] {
        guard let viewer, viewer.isAdmin else { return [:] }
        func isOwn(_ p: Project) -> Bool { (p.teamIds ?? [p.teamId]).contains(viewer.teamId) }
        let ownName = projects.first { $0.teamId == viewer.teamId }?.teamName
        let own = Section(order: 0, title: ownName.map { "\(ownTeamTitle) (\($0))" } ?? ownTeamTitle)
        let others = Dictionary(grouping: projects.filter { !isOwn($0) }, by: \.teamId)
            .map { (teamId: $0.key, title: $0.value.first?.teamName ?? otherTeamTitle) }
            .sorted { a, b in
                a.title.caseInsensitiveCompare(b.title) == .orderedSame
                    ? a.teamId < b.teamId
                    : PickerTree.precedes(a.title, b.title)
            }
        var byTeam: [String: Section] = [:]
        for (index, team) in others.enumerated() {
            byTeam[team.teamId] = Section(order: index + 1, title: team.title)
        }
        var result: [String: Section] = [:]
        for project in projects {
            result[project.id] = isOwn(project) ? own : byTeam[project.teamId]
        }
        return result
    }

    /// Stamps each row with its project's section and stable-sorts by section order. Rows pass
    /// through untouched when `sections` is empty (not an ADMIN).
    static func group(_ rows: [PickerRow], by sections: [String: Section]) -> [PickerRow] {
        guard !sections.isEmpty else { return rows }
        return rows.enumerated()
            .map { index, row -> (order: Int, index: Int, row: PickerRow) in
                let section = projectId(of: row).flatMap { sections[$0] }
                var stamped = row
                stamped.section = section?.title
                return (section?.order ?? Int.max, index, stamped)
            }
            .sorted { ($0.order, $0.index) < ($1.order, $1.index) }
            .map(\.row)
    }

    /// Whether the UI draws a header above `rows[index]`.
    static func startsSection(_ rows: [PickerRow], at index: Int) -> Bool {
        guard let section = rows[index].section else { return false }
        return index == 0 || rows[index - 1].section != section
    }

    private static func projectId(of row: PickerRow) -> String? {
        switch row.action {
        case let .open(.project(id)): return id
        case let .open(.subproject(projectId, _)): return projectId
        case .open(.root): return nil
        case let .track(selection): return selection.projectId
        }
    }
}
