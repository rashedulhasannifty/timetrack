import Foundation

/// One published build, as the client needs to see it.
struct ReleaseManifest: Equatable {
    let version: AppVersion
    let publishedAt: Date
    let zipURL: URL
    /// Lowercase hex SHA-256 of the zip, published alongside it. Without this the installer
    /// refuses to proceed — see UpdateInstaller.
    let sha256: String
}

protocol UpdateFeed {
    func latest() async throws -> ReleaseManifest
}

enum UpdateFeedError: Error, Equatable {
    case http(Int)
    case malformed(String)
    /// GitHub's unauthenticated API allows 60 requests/hour per IP. A pilot office behind one
    /// NAT can reach that, so it is a distinct case the caller stays quiet about rather than
    /// surfacing as a failure.
    case rateLimited
}

/// Reads the newest release from the public distribution repo.
///
/// Deliberately unauthenticated: this endpoint is public, and shipping any token inside a
/// binary that sits on employee laptops would be worse than the rate limit.
///
/// The checksum is a sidecar asset (`<zip>.sha256`) rather than something parsed out of the
/// release notes, so publishing is a file copy and not a formatting convention that a future
/// release can quietly break.
struct GitHubReleaseFeed: UpdateFeed {
    static let defaultRepo = "rashedulhasansojib/timetrack-app"
    static let assetName = "TimeTrack-pilot.zip"

    let repo: String
    let session: URLSession

    init(repo: String = GitHubReleaseFeed.defaultRepo, session: URLSession = .shared) {
        self.repo = repo
        self.session = session
    }

    private struct Release: Decodable {
        let tag_name: String
        let published_at: Date
        let assets: [Asset]
        struct Asset: Decodable {
            let name: String
            let browser_download_url: URL
        }
    }

    func latest() async throws -> ReleaseManifest {
        var request = URLRequest(url: URL(string: "https://api.github.com/repos/\(repo)/releases/latest")!)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 20

        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        // 403 with the rate-limit counter exhausted is the documented shape; treat a bare 429
        // the same way.
        if status == 429 { throw UpdateFeedError.rateLimited }
        if status == 403 {
            let remaining = (response as? HTTPURLResponse)?
                .value(forHTTPHeaderField: "x-ratelimit-remaining")
            throw remaining == "0" ? UpdateFeedError.rateLimited : UpdateFeedError.http(403)
        }
        guard status == 200 else { throw UpdateFeedError.http(status) }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let release: Release
        do { release = try decoder.decode(Release.self, from: data) } catch {
            throw UpdateFeedError.malformed("release json: \(error)")
        }

        guard let version = AppVersion(release.tag_name) else {
            throw UpdateFeedError.malformed("tag \(release.tag_name) is not a version")
        }
        guard let zip = release.assets.first(where: { $0.name == Self.assetName }) else {
            throw UpdateFeedError.malformed("no asset named \(Self.assetName)")
        }
        guard let sum = release.assets.first(where: { $0.name == Self.assetName + ".sha256" }) else {
            throw UpdateFeedError.malformed("no checksum asset for \(Self.assetName)")
        }

        let (sumData, sumResponse) = try await session.data(from: sum.browser_download_url)
        guard (sumResponse as? HTTPURLResponse)?.statusCode == 200 else {
            throw UpdateFeedError.malformed("checksum asset unreadable")
        }
        guard let digest = Self.parseChecksum(sumData) else {
            throw UpdateFeedError.malformed("checksum asset is not a sha-256 digest")
        }

        return ReleaseManifest(version: version,
                               publishedAt: release.published_at,
                               zipURL: zip.browser_download_url,
                               sha256: digest)
    }

    /// Accepts either a bare digest or `shasum`/`sha256sum` output ("<digest>  <filename>").
    static func parseChecksum(_ data: Data) -> String? {
        guard let text = String(data: data, encoding: .utf8) else { return nil }
        guard let field = text.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" }).first
        else { return nil }
        let digest = field.lowercased()
        guard digest.count == 64, digest.allSatisfy({ $0.isHexDigit }) else { return nil }
        return digest
    }
}
