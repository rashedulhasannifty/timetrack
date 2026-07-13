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
}
