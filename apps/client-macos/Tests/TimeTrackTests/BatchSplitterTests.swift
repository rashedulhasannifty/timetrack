import XCTest
@testable import TimeTrack

final class BatchSplitterTests: XCTestCase {
    func testHalvesOnRejectionAndDropsOnlyASingleSample() {
        var s = BatchSplitter(fullSize: 500)
        XCTAssertEqual(s.size, 500)
        XCTAssertFalse(s.rejected(count: 500)); XCTAssertEqual(s.size, 250)
        XCTAssertFalse(s.rejected(count: 250)); XCTAssertEqual(s.size, 125)
        XCTAssertFalse(s.rejected(count: 3));   XCTAssertEqual(s.size, 1)
        XCTAssertTrue(s.rejected(count: 1), "a lone rejected sample is the bad one")
        XCTAssertEqual(s.size, 500, "back to full batches once it is gone")
    }

    func testGrowsBackOnSuccessUpToFull() {
        var s = BatchSplitter(fullSize: 8)
        _ = s.rejected(count: 8)   // 4
        _ = s.rejected(count: 4)   // 2
        s.accepted(); XCTAssertEqual(s.size, 4)
        s.accepted(); XCTAssertEqual(s.size, 8)
        s.accepted(); XCTAssertEqual(s.size, 8)
    }

    func testOnlyValidationAndSizeRejectionsSplit() {
        XCTAssertTrue(BatchSplitter.isSplittable(status: 422))
        XCTAssertTrue(BatchSplitter.isSplittable(status: 413))
        XCTAssertFalse(BatchSplitter.isSplittable(status: 400))
        XCTAssertFalse(BatchSplitter.isSplittable(status: 404))
    }
}
