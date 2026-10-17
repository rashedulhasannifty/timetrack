import XCTest
@testable import TimeTrack

final class AppSamplerTests: XCTestCase {
    func testTruncatesToOneTwentyGraphemes() {
        let long = String(repeating: "a", count: 200)
        XCTAssertEqual(AppSampler.truncateTitle(long)?.count, 120)
    }

    func testShortTitleUnchanged() {
        XCTAssertEqual(AppSampler.truncateTitle("Inbox"), "Inbox")
    }

    func testNilAndEmptyBecomeNil() {
        XCTAssertNil(AppSampler.truncateTitle(nil))
        XCTAssertNil(AppSampler.truncateTitle(""))
    }

    // Server schema is `appName: z.string().max(200)` — a pathological localizedName must not 422 the batch.
    func testAppNameTruncatesToTwoHundredCharacters() {
        let long = String(repeating: "a", count: 250)
        XCTAssertEqual(AppSampler.truncateAppName(long)?.count, 200)
    }

    func testShortAppNameUnchanged() {
        XCTAssertEqual(AppSampler.truncateAppName("Xcode"), "Xcode")
    }

    func testNilAppNameStaysNil() {
        XCTAssertNil(AppSampler.truncateAppName(nil))
    }

    // MARK: - the server counts UTF-16 units, not Characters

    /// The cut fits the server's limit, is a prefix of the input, and ends on a Character
    /// boundary (its last Character is a whole Character of the input, not a fragment).
    private func assertCleanCut(_ cut: String?, of input: String, limit: Int,
                                file: StaticString = #filePath, line: UInt = #line) {
        guard let cut else { return XCTFail("unexpected nil", file: file, line: line) }
        XCTAssertLessThanOrEqual(cut.utf16.count, limit, "over the server limit", file: file, line: line)
        XCTAssertEqual(Array(cut), Array(input.prefix(cut.count)),
                       "not a whole-Character prefix of the input", file: file, line: line)
    }

    /// The bug: 120 emoji passed the old Character-count check at 240 UTF-16 units, the server
    /// answered 422, and the whole 500-sample batch was dropped.
    func testEmojiTitleIsCutToOneTwentyUTF16Units() {
        let title = String(repeating: "😀", count: 120)            // 240 units
        let cut = AppSampler.truncateTitle(title)
        assertCleanCut(cut, of: title, limit: 120)
        XCTAssertEqual(cut, String(repeating: "😀", count: 60))
    }

    func testAnEmojiThatWouldStraddleTheLimitIsLeftOutWhole() {
        let title = "a" + String(repeating: "😀", count: 100)       // 1 + 200 units
        let cut = AppSampler.truncateTitle(title)
        assertCleanCut(cut, of: title, limit: 120)
        XCTAssertEqual(cut?.utf16.count, 119, "the 60th emoji would need units 120–121: dropped, not halved")
    }

    func testFlagsAreNeverSplitIntoRegionalIndicators() {
        let title = String(repeating: "🇧🇩", count: 40)              // 4 units each = 160
        let cut = AppSampler.truncateTitle(title)
        assertCleanCut(cut, of: title, limit: 120)
        XCTAssertEqual(cut, String(repeating: "🇧🇩", count: 30))
    }

    func testCombiningAccentsStayWithTheirLetter() {
        let title = String(repeating: "e\u{301}", count: 100)       // é decomposed: 2 units each
        let cut = AppSampler.truncateTitle(title)
        assertCleanCut(cut, of: title, limit: 120)
        XCTAssertEqual(cut?.count, 60)
        XCTAssertTrue(cut?.allSatisfy { $0 == "e\u{301}" } ?? false, "no bare 'e' left at the end")
    }

    func testZWJFamilyEmojiIsKeptOrDroppedWhole() {
        let family = "👨‍👩‍👧‍👦"                                       // one Character, 11 units
        let title = String(repeating: family, count: 20)
        let cut = AppSampler.truncateTitle(title)
        assertCleanCut(cut, of: title, limit: 120)
        XCTAssertEqual(cut?.count, 10)
        XCTAssertEqual(cut?.utf16.count, 110)
    }

    func testTitleExactlyAtTheLimitIsUnchanged() {
        let title = String(repeating: "😀", count: 60)             // exactly 120 units
        XCTAssertEqual(AppSampler.truncateTitle(title), title)
    }

    func testATitleWhoseFirstCharacterAloneIsTooLongBecomesNil() {
        let zalgo = "e" + String(repeating: "\u{301}", count: 200)  // one Character, 201 units
        XCTAssertNil(AppSampler.truncateTitle(zalgo), "nullable on the server; never an empty or broken title")
    }

    func testEmojiAppNameIsCutToTwoHundredUTF16Units() {
        let name = String(repeating: "🚀", count: 150)              // 300 units
        let cut = AppSampler.truncateAppName(name)
        assertCleanCut(cut, of: name, limit: 200)
        XCTAssertEqual(cut?.count, 100)
    }

    func testBundleIdOverTheLimitIsDroppedNotCut() {
        XCTAssertEqual(AppSampler.limitBundleId("com.microsoft.VSCode"), "com.microsoft.VSCode")
        XCTAssertNil(AppSampler.limitBundleId(String(repeating: "a", count: 256)))
        XCTAssertNil(AppSampler.limitBundleId(nil))
    }
}
