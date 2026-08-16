import XCTest
@testable import TimeTrack

/// Serves canned responses so the feed's decoding is tested without touching the network.
private final class StubProtocol: URLProtocol {
    nonisolated(unsafe) static var routes: [String: (Int, Data, [String: String])] = [:]

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let key = request.url?.absoluteString ?? ""
        let (status, body, headers) = Self.routes[key] ?? (404, Data(), [:])
        let response = HTTPURLResponse(url: request.url!, statusCode: status,
                                       httpVersion: nil, headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class GitHubReleaseFeedTests: XCTestCase {
    private let api = "https://api.github.com/repos/acme/dist/releases/latest"
    private let asset = GitHubReleaseFeed.assetName
    private let zipURL = "https://example.invalid/download.zip"
    private let sumURL = "https://example.invalid/download.zip.sha256"
    private let digest = String(repeating: "ab", count: 32)

    private func makeFeed() -> GitHubReleaseFeed {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        return GitHubReleaseFeed(repo: "acme/dist", session: URLSession(configuration: config))
    }

    private func releaseJSON(tag: String, assets: [(String, String)]) -> Data {
        let assetJSON = assets
            .map { "{\"name\":\"\($0.0)\",\"browser_download_url\":\"\($0.1)\"}" }
            .joined(separator: ",")
        return Data("""
        {"tag_name":"\(tag)","published_at":"2026-08-01T10:00:00Z","assets":[\(assetJSON)]}
        """.utf8)
    }

    override func tearDown() {
        StubProtocol.routes = [:]
        super.tearDown()
    }

    func testParsesAReleaseIntoAManifest() async throws {
        StubProtocol.routes = [
            api: (200, releaseJSON(tag: "v0.3.0",
                                   assets: [(asset, zipURL),
                                            (asset + ".sha256", sumURL)]), [:]),
            sumURL: (200, Data("\(digest)  \(asset)\n".utf8), [:]),
        ]

        let manifest = try await makeFeed().latest()

        XCTAssertEqual(manifest.version, AppVersion("0.3.0"))
        XCTAssertEqual(manifest.sha256, digest)
        XCTAssertEqual(manifest.zipURL.absoluteString, zipURL)
        XCTAssertEqual(manifest.publishedAt, ISO8601DateFormatter().date(from: "2026-08-01T10:00:00Z"))
    }

    func testReleaseWithoutAChecksumAssetIsRejected() async {
        // Publishing the zip but forgetting the digest must make the release invisible, never
        // installable-without-verification.
        StubProtocol.routes = [
            api: (200, releaseJSON(tag: "v0.3.0", assets: [(asset, zipURL)]), [:]),
        ]
        await XCTAssertThrowsErrorAsync(try await self.makeFeed().latest())
    }

    func testReleaseWithoutTheExpectedAssetNameIsRejected() async {
        StubProtocol.routes = [
            api: (200, releaseJSON(tag: "v0.3.0",
                                   assets: [("some-other-name.zip", zipURL),
                                            ("some-other-name.zip.sha256", sumURL)]), [:]),
        ]
        await XCTAssertThrowsErrorAsync(try await self.makeFeed().latest())
    }

    func testNonVersionTagIsRejected() async {
        StubProtocol.routes = [
            api: (200, releaseJSON(tag: "nightly",
                                   assets: [(asset, zipURL),
                                            (asset + ".sha256", sumURL)]), [:]),
        ]
        await XCTAssertThrowsErrorAsync(try await self.makeFeed().latest())
    }

    func testGarbageChecksumAssetIsRejected() async {
        StubProtocol.routes = [
            api: (200, releaseJSON(tag: "v0.3.0",
                                   assets: [(asset, zipURL),
                                            (asset + ".sha256", sumURL)]), [:]),
            sumURL: (200, Data("not-a-digest\n".utf8), [:]),
        ]
        await XCTAssertThrowsErrorAsync(try await self.makeFeed().latest())
    }

    func testRateLimitIsItsOwnCase() async {
        StubProtocol.routes = [api: (403, Data(), ["x-ratelimit-remaining": "0"])]
        do {
            _ = try await makeFeed().latest()
            XCTFail("expected a throw")
        } catch {
            XCTAssertEqual(error as? UpdateFeedError, .rateLimited)
        }
    }

    func testPlainForbiddenIsNotMistakenForRateLimiting() async {
        StubProtocol.routes = [api: (403, Data(), [:])]
        do {
            _ = try await makeFeed().latest()
            XCTFail("expected a throw")
        } catch {
            XCTAssertEqual(error as? UpdateFeedError, .http(403))
        }
    }
}

private func XCTAssertThrowsErrorAsync<T>(
    _ expression: @autoclosure () async throws -> T,
    file: StaticString = #filePath, line: UInt = #line
) async {
    do {
        _ = try await expression()
        XCTFail("expected a throw", file: file, line: line)
    } catch {
        // expected
    }
}
