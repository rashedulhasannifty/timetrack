import XCTest
@testable import TimeTrack

final class ProjectCacheTests: XCTestCase {
    private func tempURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("projects-\(UUID().uuidString).json")
    }

    func testSaveThenLoadRoundTrips() {
        let url = tempURL()
        defer { try? FileManager.default.removeItem(at: url) }
        let cache = ProjectCache(fileURL: url)
        let projects = [
            Project(id: "p1", teamId: "t1", name: "Acme", archived: false,
                    tasks: [ProjectTask(id: "k1", projectId: "p1", name: "Design")]),
        ]

        cache.save(projects)

        XCTAssertEqual(cache.load(), projects)
    }

    func testLoadMissingFileReturnsEmpty() {
        let cache = ProjectCache(fileURL: tempURL())
        XCTAssertEqual(cache.load(), [])
    }

    func testClearRemovesFileAndLoadReturnsEmpty() {
        let url = tempURL()
        defer { try? FileManager.default.removeItem(at: url) }
        let cache = ProjectCache(fileURL: url)
        let projects = [
            Project(id: "p1", teamId: "t1", name: "Acme", archived: false, tasks: nil),
        ]
        cache.save(projects)
        XCTAssertEqual(cache.load(), projects, "precondition: the file must exist with data")

        cache.clear()

        XCTAssertEqual(cache.load(), [], "clear() must remove the cache so load() sees nothing")
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path),
                       "clear() must delete the underlying file")
    }

    /// A projects.json written by 0.6.x has no subproject fields. It must still load — the picker
    /// works offline from this file until the next successful fetch replaces it.
    func testLoadsACacheWrittenBeforeSubprojectsExisted() throws {
        let url = tempURL()
        defer { try? FileManager.default.removeItem(at: url) }
        let legacy = """
        [{"id":"p1","teamId":"t1","name":"Acme","archived":false,
          "tasks":[{"id":"k1","projectId":"p1","name":"Design"}]}]
        """
        try Data(legacy.utf8).write(to: url)

        let loaded = ProjectCache(fileURL: url).load()

        XCTAssertEqual(loaded.count, 1)
        XCTAssertNil(loaded[0].subprojects)
        XCTAssertNil(loaded[0].tasks?[0].subprojectId)
    }

    func testDecodesSubprojectsAndTaskSubprojectIds() throws {
        let json = """
        [{"id":"p1","teamId":"t1","name":"Acme","color":null,"archived":false,
          "tasks":[{"id":"k1","projectId":"p1","subprojectId":"s2","name":"Design","archived":false}],
          "subprojects":[{"id":"s1","projectId":"p1","name":"General","archived":false,"isDefault":true},
                         {"id":"s2","projectId":"p1","name":"Checkout","archived":false,"isDefault":false}]}]
        """
        let projects = try JSONDecoder().decode([Project].self, from: Data(json.utf8))

        XCTAssertEqual(projects[0].subprojects?.map(\.id), ["s1", "s2"])
        XCTAssertEqual(projects[0].subprojects?[0].isDefault, true)
        XCTAssertEqual(projects[0].tasks?[0].subprojectId, "s2")
    }

    func testTeamFieldsRoundTrip() {
        let url = tempURL()
        defer { try? FileManager.default.removeItem(at: url) }
        let cache = ProjectCache(fileURL: url)
        let projects = [
            Project(id: "p1", teamId: "t1", name: "Acme", archived: false, tasks: nil,
                    subprojects: nil, teamName: "Eng", teamIds: ["t1", "t2"]),
        ]

        cache.save(projects)

        XCTAssertEqual(cache.load(), projects)
    }

    func testAnOldCacheWithoutTeamFieldsStillLoads() throws {
        let url = tempURL()
        defer { try? FileManager.default.removeItem(at: url) }
        try Data(#"[{"id":"p","teamId":"t","name":"N","archived":false}]"#.utf8).write(to: url)

        let loaded = ProjectCache(fileURL: url).load()

        XCTAssertEqual(loaded.count, 1)
        XCTAssertNil(loaded[0].teamName)
        XCTAssertNil(loaded[0].teamIds)
    }
}
