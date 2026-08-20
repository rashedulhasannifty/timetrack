import XCTest
@testable import TimeTrack

final class RecentSelectionClientTests: XCTestCase {
    private func decode(_ json: String) -> StoredSelection? {
        RecentSelectionClient.newestSelection(in: Data(json.utf8))
    }

    func testPicksTheNewestEntrysProjectAndTask() {
        let selection = decode("""
        [
          {"id":"a","startTime":"2026-08-18T04:00:00.000Z","projectId":"p-old","taskId":null},
          {"id":"b","startTime":"2026-08-20T04:00:00.000Z","projectId":"p-new","taskId":"t-new"}
        ]
        """)
        XCTAssertEqual(selection, StoredSelection(projectId: "p-new", taskId: "t-new"))
    }

    func testIgnoresEntriesWithNoProject() {
        // An entry tracked with nothing selected tells us nothing to restore.
        let selection = decode("""
        [
          {"id":"a","startTime":"2026-08-18T04:00:00.000Z","projectId":"p-old","taskId":null},
          {"id":"b","startTime":"2026-08-20T04:00:00.000Z","projectId":null,"taskId":null}
        ]
        """)
        XCTAssertEqual(selection, StoredSelection(projectId: "p-old", taskId: nil))
    }

    func testReturnsNilForAnEmptyList() {
        XCTAssertNil(decode("[]"))
    }

    func testReturnsNilForMalformedJson() {
        XCTAssertNil(decode("not json"))
    }

    func testReturnsNilWhenNoEntryHasAProject() {
        XCTAssertNil(decode("""
        [{"id":"a","startTime":"2026-08-20T04:00:00.000Z","projectId":null,"taskId":null}]
        """))
    }
}
