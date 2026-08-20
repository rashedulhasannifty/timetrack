import XCTest
@testable import TimeTrack

final class SelectionStoreTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        // A throwaway suite per test — never touch the real .standard defaults.
        suiteName = "SelectionStoreTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func testRoundTripsASelection() {
        let store = SelectionStore(defaults: defaults)
        let selection = StoredSelection(projectId: "p1", taskId: "t1")

        store.save(selection, userId: "u1")

        XCTAssertEqual(store.load(userId: "u1"), selection)
    }

    func testRoundTripsAProjectOnlySelection() {
        let store = SelectionStore(defaults: defaults)
        let selection = StoredSelection(projectId: "p1", taskId: nil)

        store.save(selection, userId: "u1")

        XCTAssertEqual(store.load(userId: "u1"), selection)
    }

    func testReturnsNilForAUserWithNothingStored() {
        let store = SelectionStore(defaults: defaults)
        XCTAssertNil(store.load(userId: "nobody"))
    }

    // The guarantee that lets persistence coexist with sign-out clearing: one user can never
    // inherit another user's (possibly wrong-team) selection.
    func testOneUsersSelectionIsInvisibleToAnother() {
        let store = SelectionStore(defaults: defaults)
        store.save(StoredSelection(projectId: "p1", taskId: nil), userId: "u1")

        XCTAssertNil(store.load(userId: "u2"))
    }

    func testClearRemovesOnlyThatUsersSelection() {
        let store = SelectionStore(defaults: defaults)
        store.save(StoredSelection(projectId: "p1", taskId: nil), userId: "u1")
        store.save(StoredSelection(projectId: "p2", taskId: nil), userId: "u2")

        store.clear(userId: "u1")

        XCTAssertNil(store.load(userId: "u1"))
        XCTAssertEqual(store.load(userId: "u2")?.projectId, "p2")
    }

    func testSavingTwiceOverwrites() {
        let store = SelectionStore(defaults: defaults)
        store.save(StoredSelection(projectId: "p1", taskId: "t1"), userId: "u1")
        store.save(StoredSelection(projectId: "p2", taskId: nil), userId: "u1")

        XCTAssertEqual(store.load(userId: "u1"), StoredSelection(projectId: "p2", taskId: nil))
    }
}
