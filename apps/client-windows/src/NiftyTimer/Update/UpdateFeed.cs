using System.Globalization;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;

namespace NiftyTimer.Update;

public enum UpdateFeedFailure
{
    Http,

    Malformed,

    /// <summary>
    /// GitHub allows 60 unauthenticated API requests per hour per IP. A pilot office behind one
    /// NAT reaches that, so it is a distinct case the caller stays QUIET about rather than
    /// surfacing as a failure — an update check that could not run is not news.
    /// </summary>
    RateLimited,
}

public sealed class UpdateFeedException : Exception
{
    public UpdateFeedException(UpdateFeedFailure failure, string message)
        : base(message) =>
        Failure = failure;

    public UpdateFeedFailure Failure { get; }
}

public interface IUpdateFeed
{
    Task<ReleaseManifest> LatestAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Reads the newest release from the public Windows distribution repo.
///
/// **The repo is separate from the macOS one, and that is load-bearing.** GitHub has exactly one
/// <c>releases/latest</c> per repository; the shipped Mac client resolves its update through that
/// endpoint and requires an asset named <c>NiftyTimer-pilot.zip</c> on it, as does the dashboard
/// download button. Publishing a Windows release into the same repo would make it <c>latest</c>,
/// and every installed Mac client would go silently blind to updates while the download button
/// started answering 404. A Mac client already in the field cannot be rolled back to fix that.
///
/// Deliberately unauthenticated: the endpoint is public, and shipping a token inside a binary that
/// sits on employee laptops would be a worse problem than the rate limit.
///
/// The checksum is a sidecar asset rather than something parsed out of the release notes, so
/// publishing is a file copy rather than a formatting convention a future release can break.
/// </summary>
public sealed class GitHubReleaseFeed : IUpdateFeed
{
    /// <summary>Both asset names are contract: the feed refuses a release missing either.</summary>
    public const string AssetName = "NiftyTimer-windows-pilot.zip";

    public const string ChecksumAssetName = AssetName + ".sha256";

    private readonly HttpClient _http;
    private readonly string _repo;

    public GitHubReleaseFeed(HttpClient http, string repo)
    {
        _http = http;
        _repo = repo;
    }

    public async Task<ReleaseManifest> LatestAsync(CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            new Uri($"https://api.github.com/repos/{_repo}/releases/latest"));
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));

        // GitHub rejects API requests carrying no User-Agent outright.
        request.Headers.UserAgent.ParseAdd("NiftyTimer-Windows");

        using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var status = (int)response.StatusCode;

        if (status == 429)
        {
            throw new UpdateFeedException(UpdateFeedFailure.RateLimited, "GitHub API rate limit reached.");
        }

        if (status == 403)
        {
            // 403 with the rate-limit counter exhausted is the documented shape for throttling.
            // A 403 with quota remaining is a real failure and must not be silently swallowed.
            var remaining = response.Headers.TryGetValues("x-ratelimit-remaining", out var values)
                ? values.FirstOrDefault()
                : null;

            throw remaining == "0"
                ? new UpdateFeedException(UpdateFeedFailure.RateLimited, "GitHub API rate limit reached.")
                : new UpdateFeedException(UpdateFeedFailure.Http, "GitHub API returned 403.");
        }

        if (status != 200)
        {
            throw new UpdateFeedException(UpdateFeedFailure.Http, $"GitHub API returned {status}.");
        }

        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        var release = ParseRelease(body);

        using var checksumResponse = await _http
            .GetAsync(release.ChecksumUrl, cancellationToken)
            .ConfigureAwait(false);

        if (!checksumResponse.IsSuccessStatusCode)
        {
            throw new UpdateFeedException(UpdateFeedFailure.Malformed, "Checksum asset is unreadable.");
        }

        var checksumText = await checksumResponse.Content
            .ReadAsStringAsync(cancellationToken)
            .ConfigureAwait(false);

        var digest = ParseChecksum(checksumText)
            ?? throw new UpdateFeedException(
                UpdateFeedFailure.Malformed,
                "Checksum asset is not a SHA-256 digest.");

        return new ReleaseManifest(release.Version, release.PublishedAt, release.ZipUrl, digest);
    }

    /// <summary>
    /// Pure parse of the release JSON — the tested surface. Only the HTTP around it is
    /// build-verified.
    /// </summary>
    internal static ParsedRelease ParseRelease(string json)
    {
        JsonElement root;
        try
        {
            root = JsonDocument.Parse(json).RootElement;
        }
        catch (JsonException e)
        {
            throw new UpdateFeedException(UpdateFeedFailure.Malformed, $"Release JSON: {e.Message}");
        }

        var tag = root.TryGetProperty("tag_name", out var tagElement) ? tagElement.GetString() : null;
        var version = AppVersion.Parse(tag)
            ?? throw new UpdateFeedException(
                UpdateFeedFailure.Malformed,
                $"Tag {tag} is not a version.");

        if (!root.TryGetProperty("published_at", out var publishedElement) ||
            !DateTimeOffset.TryParse(
                publishedElement.GetString(),
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out var publishedAt))
        {
            throw new UpdateFeedException(UpdateFeedFailure.Malformed, "Release has no usable published_at.");
        }

        return new ParsedRelease(
            version,
            publishedAt,
            FindAsset(root, AssetName),
            FindAsset(root, ChecksumAssetName));
    }

    internal sealed record ParsedRelease(
        AppVersion Version,
        DateTimeOffset PublishedAt,
        Uri ZipUrl,
        Uri ChecksumUrl);

    private static Uri FindAsset(JsonElement root, string name)
    {
        if (root.TryGetProperty("assets", out var assets) && assets.ValueKind == JsonValueKind.Array)
        {
            foreach (var asset in assets.EnumerateArray())
            {
                if (asset.TryGetProperty("name", out var assetName) &&
                    assetName.GetString() == name &&
                    asset.TryGetProperty("browser_download_url", out var url) &&
                    Uri.TryCreate(url.GetString(), UriKind.Absolute, out var parsed))
                {
                    return parsed;
                }
            }
        }

        throw new UpdateFeedException(UpdateFeedFailure.Malformed, $"No asset named {name}.");
    }

    /// <summary>
    /// Accepts a bare digest or sha256sum-style output (digest, whitespace, filename), so the
    /// publishing script can use whichever tool is to hand.
    /// </summary>
    internal static string? ParseChecksum(string text)
    {
        // Null separators means "split on any whitespace" — avoids spelling out char literals.
        var field = text.Split(null as char[], StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();

        if (field is null || field.Length != 64)
        {
            return null;
        }

        var digest = field.ToLowerInvariant();
        foreach (var c in digest)
        {
            if (!char.IsAsciiHexDigitLower(c))
            {
                return null;
            }
        }

        return digest;
    }
}
