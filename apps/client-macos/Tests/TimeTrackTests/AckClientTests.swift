import XCTest
@testable import TimeTrack

private final class StubURLProtocol: URLProtocol {
    static var captured: URLRequest?
    static var responseStatus = 200
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        StubURLProtocol.captured = request
        let resp = HTTPURLResponse(url: request.url!, statusCode: StubURLProtocol.responseStatus,
                                   httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private extension URLRequest {
    /// URLSession often moves httpBody into httpBodyStream by the time URLProtocol sees it.
    var capturedBody: Data? {
        if let httpBody { return httpBody }
        guard let stream = httpBodyStream else { return nil }
        stream.open(); defer { stream.close() }
        var data = Data(); var buf = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
            let n = stream.read(&buf, maxLength: buf.count)
            if n > 0 { data.append(buf, count: n) } else { break }
        }
        return data
    }
}

final class AckClientTests: XCTestCase {
    func testAcknowledgePostsPolicyVersionBody() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        StubURLProtocol.captured = nil
        StubURLProtocol.responseStatus = 200
        let urlSession = URLSession(configuration: config)

        let store = InMemoryTokenStore(seed: "r0")
        let auth = AuthSession(client: FakeAuthClient(), store: store)
        _ = await auth.bootstrap()   // mints kTestAccessToken so accessToken() succeeds

        let client = AckClient(baseURL: URL(string: "http://api.test/v1")!,
                               session: auth, urlSession: urlSession)
        try await client.acknowledge(userId: "user-1", policyVersion: "2026-07")

        let req = try XCTUnwrap(StubURLProtocol.captured)
        XCTAssertEqual(req.httpMethod, "POST")
        XCTAssertEqual(req.url?.path, "/v1/users/user-1/ack-monitoring")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer \(kTestAccessToken)")
        let body = try XCTUnwrap(req.capturedBody)
        let decoded = try JSONDecoder().decode([String: String].self, from: body)
        XCTAssertEqual(decoded, ["policyVersion": "2026-07"])
    }
}
