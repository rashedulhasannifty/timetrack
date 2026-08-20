import XCTest
@testable import TimeTrack

final class SelectionResolverTests: XCTestCase {
    private let choices: [Choice] = [
        Choice(id: "p1", projectId: "p1", taskId: nil, projectName: "Apollo", taskName: nil),
        Choice(id: "t1", projectId: "p1", taskId: "t1", projectName: "Apollo", taskName: "Build"),
        Choice(id: "p2", projectId: "p2", taskId: nil, projectName: "Gemini", taskName: nil),
    ]

    func testResolvesAProjectOnlySelection() {
        let got = SelectionResolver.resolve(
            StoredSelection(projectId: "p2", taskId: nil), in: choices
        )
        XCTAssertEqual(got?.id, "p2")
    }

    func testResolvesAProjectAndTaskSelection() {
        let got = SelectionResolver.resolve(
            StoredSelection(projectId: "p1", taskId: "t1"), in: choices
        )
        XCTAssertEqual(got?.id, "t1")
        XCTAssertEqual(got?.taskId, "t1")
    }

    func testDropsASelectionWhoseProjectIsGone() {
        // Archived, deleted, or the user was moved off that team.
        XCTAssertNil(SelectionResolver.resolve(
            StoredSelection(projectId: "gone", taskId: nil), in: choices
        ))
    }

    func testDropsASelectionWhoseTaskIsGone() {
        // The project survives but the task does not — do NOT silently fall back to the
        // project, because that would start tracking against something never chosen.
        XCTAssertNil(SelectionResolver.resolve(
            StoredSelection(projectId: "p1", taskId: "gone"), in: choices
        ))
    }

    func testDropsEverythingWhenTheProjectListIsEmpty() {
        // Offline first launch with an empty cache — never pre-select from nothing.
        XCTAssertNil(SelectionResolver.resolve(
            StoredSelection(projectId: "p1", taskId: nil), in: []
        ))
    }

    func testNilStoredSelectionResolvesToNil() {
        XCTAssertNil(SelectionResolver.resolve(nil, in: choices))
    }
}
