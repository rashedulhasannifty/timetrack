import Foundation

/// Persists the last-fetched project list so the picker works offline (PRD §7.5 spirit —
/// the client tolerates an unreachable backend). Plain Foundation JSON, no dependency.
final class ProjectCache {
    private let fileURL: URL

    init(fileURL: URL) {
        self.fileURL = fileURL
    }

    /// Default location: ~/Library/Application Support/TimeTrack/projects.json
    static func defaultURL() -> URL {
        let dir = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("TimeTrack", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("projects.json")
    }

    func save(_ projects: [Project]) {
        guard let data = try? JSONEncoder().encode(projects) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    func load() -> [Project] {
        guard let data = try? Data(contentsOf: fileURL),
              let projects = try? JSONDecoder().decode([Project].self, from: data)
        else { return [] }
        return projects
    }

    func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }
}
