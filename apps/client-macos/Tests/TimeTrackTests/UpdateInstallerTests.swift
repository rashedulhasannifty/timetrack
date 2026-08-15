import XCTest
@testable import TimeTrack

final class UpdateInstallerTests: XCTestCase {
    private func tempFile(_ contents: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("tt-\(UUID().uuidString).bin")
        try Data(contents.utf8).write(to: url)
        return url
    }

    func testSha256MatchesShasum() throws {
        let file = try tempFile("the quick brown fox\n")
        defer { try? FileManager.default.removeItem(at: file) }

        let ours = try UpdateInstaller.sha256(of: file)

        // Cross-check against the system tool rather than a hardcoded constant, so this test
        // fails if our chunked hashing is wrong rather than if someone mistyped a digest.
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/shasum")
        p.arguments = ["-a", "256", file.path]
        let pipe = Pipe()
        p.standardOutput = pipe
        try p.run()
        p.waitUntilExit()
        let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let expected = out.split(separator: " ").first.map(String.init) ?? ""

        XCTAssertEqual(ours, expected)
        XCTAssertEqual(ours.count, 64)
    }

    func testSha256HandlesFileLargerThanOneChunk() throws {
        // The reader loops at 1 MiB; make sure multi-chunk files hash the same as shasum.
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("tt-big-\(UUID().uuidString).bin")
        try Data(repeating: 0x5A, count: (1 << 20) + 12_345).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/shasum")
        p.arguments = ["-a", "256", url.path]
        let pipe = Pipe()
        p.standardOutput = pipe
        try p.run()
        p.waitUntilExit()
        let expected = (String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "")
            .split(separator: " ").first.map(String.init) ?? ""

        XCTAssertEqual(try UpdateInstaller.sha256(of: url), expected)
    }

    func testCanInstallIsFalseForUnwritableLocation() {
        // /usr is root-owned; the updater must find this out before downloading anything.
        let fake = URL(fileURLWithPath: "/usr/TimeTrack.app")
        XCTAssertFalse(UpdateInstaller().canInstall(bundleURL: fake))
    }

    func testCanInstallIsTrueForATemporaryLocation() {
        let fake = FileManager.default.temporaryDirectory.appendingPathComponent("TimeTrack.app")
        XCTAssertTrue(UpdateInstaller().canInstall(bundleURL: fake))
    }

    func testSignatureCheckFailsClosedForAForeignBundle() throws {
        // Whatever is running this test, it is not signed as TimeTrack — so a system app must
        // be rejected. The check must never fail open.
        let calculator = URL(fileURLWithPath: "/System/Applications/Calculator.app")
        guard FileManager.default.fileExists(atPath: calculator.path) else {
            throw XCTSkip("Calculator.app not present")
        }
        XCTAssertNotNil(UpdateInstaller.rejectionReason(for: calculator),
                        "a bundle that is not ours must be rejected")
    }

    func testSignatureCheckFailsClosedForAMissingBundle() {
        let missing = URL(fileURLWithPath: "/nonexistent-\(UUID().uuidString).app")
        XCTAssertNotNil(UpdateInstaller.rejectionReason(for: missing))
    }
}
