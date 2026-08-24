using System.Net.Http;
using System.Net;
using System.Net.Http.Headers;
using NiftyTimer.Auth;

namespace NiftyTimer.Sync;

/// <summary>
/// PRD §7.5 — POSTs a buffered record payload to <c>&lt;baseUrl&gt;/&lt;path&gt;</c> (default
/// <c>time-entries</c>; idle events pass <c>idle-events</c>) with the session bearer token. The
/// API upserts on the client-minted UUIDv7, so a retried record is a no-op. On a 401 it forces a
/// token refresh and retries once; a surviving 401 → <see cref="UploadResult.AuthFailed"/>.
///
/// Not a capture path — no <see cref="Policy.AckGate"/>.
/// </summary>
public sealed class TimeEntryUploader : IUploader
{
    private readonly HttpClient _http;
    private readonly Uri _baseUrl;
    private readonly AuthSession _session;
    private readonly string _path;

    public TimeEntryUploader(HttpClient http, Uri baseUrl, AuthSession session, string path = "time-entries")
    {
        _http = http;
        _baseUrl = baseUrl;
        _session = session;
        _path = path;
    }

    /// <summary>
    /// Pure status → result mapping (unit-tested; the async orchestration is build-verified).
    ///
    /// Any 2xx is success. The activity-samples and idle-events endpoints answer 201, and the
    /// batch endpoint has answered 202 — narrowing success to 200/201 made the Mac client treat
    /// every accepted batch as a transient failure, wedging the buffer and re-sending forever.
    /// Do not narrow this range.
    ///
    /// 409 lands in <see cref="UploadResult.Permanent"/>: it means another machine holds the
    /// server's one-running-entry index, which no retry of THIS record can change. Callers that
    /// care about the difference read <see cref="UploadResult.Permanent.Status"/> — see
    /// <see cref="LiveEntryPublisher"/>. Safe to drop the record because the partial unique index
    /// only covers OPEN entries and the durable buffer only ever holds closed ones.
    /// </summary>
    public static UploadResult Classify(int status) => status switch
    {
        >= 200 and <= 299 => new UploadResult.Success(),
        401 => new UploadResult.AuthFailed(),
        408 or 429 => new UploadResult.Transient(),
        >= 500 and <= 599 => new UploadResult.Transient(),
        >= 400 and <= 499 => new UploadResult.Permanent(status),
        _ => new UploadResult.Transient(),
    };

    public async Task<UploadResult> UploadAsync(byte[] payload, CancellationToken cancellationToken = default)
    {
        try
        {
            var token = await _session.AccessTokenAsync(cancellationToken).ConfigureAwait(false);
            var status = await PostAsync(payload, token, cancellationToken).ConfigureAwait(false);
            if (status == (int)HttpStatusCode.Unauthorized)
            {
                var refreshed = await _session.ForceRefreshAsync(cancellationToken).ConfigureAwait(false);
                var retried = await PostAsync(payload, refreshed, cancellationToken).ConfigureAwait(false);
                return Classify(retried); // a second 401 → AuthFailed
            }

            return Classify(status);
        }
        catch (Exception e) when (e is AuthException or NotAuthenticatedException or HttpRequestException
                                      or TaskCanceledException)
        {
            return new UploadResult.Transient(); // network error, refresh failure, etc. → retry later
        }
    }

    private async Task<int> PostAsync(byte[] payload, string token, CancellationToken cancellationToken)
    {
        using var content = new ByteArrayContent(payload);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");

        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(_baseUrl, _path))
        {
            Content = content,
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        return (int)response.StatusCode;
    }
}
