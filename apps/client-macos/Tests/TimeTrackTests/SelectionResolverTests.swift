import XCTest
@testable import TimeTrack

/// The unified stale-resolution table (spec §4), identical on Windows.
final class SelectionResolverTests: XCTestCase {
    private let projects: [Project] = [
        Project(id: "p1", teamId: "t", name: "Acme", archived: false,
                tasks: [ProjectTask(id: "k1", projectId: "p1", name: "Build", subprojectId: "s2")],
                subprojects: [Subproject(id: "s1", projectId: "p1", name: "General", archived: false, isDefault: true),
                              Subproject(id: "s2", projectId: "p1", name: "Checkout", archived: false, isDefault: false),
                              Subproject(id: "s3", projectId: "p1", name: "Other", archived: false, isDefault: false)]),
        Project(id: "p2", teamId: "t", name: "Archived", archived: true, tasks: nil),
        Project(id: "p3", teamId: "t", name: "Legacy", archived: false, tasks: nil),
    ]

    private func resolve(_ s: StoredSelection?) -> StoredSelection? {
        SelectionResolver.resolve(s, in: projects)
    }

    func testNothingDisappearedKeepsTheSelection() {
        XCTAssertEqual(resolve(StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "k1")),
                       StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "k1"))
        XCTAssertEqual(resolve(StoredSelection(projectId: "p1", subprojectId: "s3", taskId: nil)),
                       StoredSelection(projectId: "p1", subprojectId: "s3", taskId: nil))
    }

    func testTaskGoneKeepsTheSubproject() {
        XCTAssertEqual(resolve(StoredSelection(projectId: "p1", subprojectId: "s3", taskId: "gone")),
                       StoredSelection(projectId: "p1", subprojectId: "s3", taskId: nil))
    }

    func testSubprojectGoneFallsBackToTheDefault() {
        XCTAssertEqual(resolve(StoredSelection(projectId: "p1", subprojectId: "gone", taskId: nil)),
                       StoredSelection(projectId: "p1", subprojectId: "s1", taskId: nil))
    }

    func testProjectGoneOrArchivedClearsTheSelection() {
        XCTAssertNil(resolve(StoredSelection(projectId: "gone", taskId: nil)))
        XCTAssertNil(resolve(StoredSelection(projectId: "p2", taskId: nil)))
        XCTAssertNil(resolve(nil))
    }

    /// Upgrade rule: a 0.6.x selection has no subprojectId.
    func testUpgradesAnOldSelectionFromItsTaskOrTheDefault() {
        XCTAssertEqual(resolve(StoredSelection(projectId: "p1", taskId: "k1")),
                       StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "k1"))
        XCTAssertEqual(resolve(StoredSelection(projectId: "p1", taskId: nil)),
                       StoredSelection(projectId: "p1", subprojectId: "s1", taskId: nil))
    }

    /// Ruling 1: the task's CURRENT subproject wins over a stale stored one.
    func testAMovedTaskResolvesToItsNewSubproject() {
        XCTAssertEqual(resolve(StoredSelection(projectId: "p1", subprojectId: "s3", taskId: "k1")),
                       StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "k1"))
    }

    func testALegacyCacheProjectResolvesWithANilSubproject() {
        XCTAssertEqual(resolve(StoredSelection(projectId: "p3", subprojectId: "s9", taskId: nil)),
                       StoredSelection(projectId: "p3", subprojectId: nil, taskId: nil))
    }
}
