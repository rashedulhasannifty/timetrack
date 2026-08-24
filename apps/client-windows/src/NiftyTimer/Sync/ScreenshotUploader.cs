using System.Globalization;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using NiftyTimer.Auth;
using NiftyTimer.Storage;
using NiftyTimer.Tracking;

namespace NiftyTimer.Sync;

/// <summary>The screenshot-upload seam. Tests substitute a fake.</summary>
public interface IScreenshotUploading
{
    Task<UploadResult> UploadAsync(
        string id,
        DateTimeOffset capturedAt,
        CaptureGroup group,
        byte[] jpeg,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// PRD §7.4 — uploads one captured screenshot to <c>&lt;baseUrl&gt;/screenshots</c> as
/// <c>multipart/form-data</c>.
///
/// **Every TEXT field must precede the file part.** <c>@fastify/multipart</c>'s <c>req.file()</c>
/// only exposes fields that were parsed BEFORE the file, so a file-first body arrives with
/// undefined metadata and 422s every single upload — which then classifies as permanent and
/// silently discards the image. The body is therefore built by hand rather than with
/// <c>MultipartFormDataContent</c>: a pure builder can have its field order asserted by a test,
/// where an ordering that lives in a series of <c>Add</c> calls cannot.
///
/// <c>userId</c> is never sent. The server attributes the upload to the bearer token, and an
/// extra field would be ignored at best.
///
/// The upload is idempotent on the client-minted <c>id</c>, so a retry after a lost 201 is a
/// no-op. Not a capture path — this sends what capture already produced — so no
/// <see cref="Policy.AckGate"/>.
/// </summary>
public sealed class ScreenshotUploader : IScreenshotUploading
{
    private readonly HttpClient _http;
    private readonly Uri _baseUrl;
    private readonly AuthSession _session;

    public ScreenshotUploader(HttpClient http, Uri baseUrl, AuthSession session)
    {
        _http = http;
        _baseUrl = baseUrl;
        _session = session;
    }

    public async Task<UploadResult> UploadAsync(
        string id,
        DateTimeOffset capturedAt,
        CaptureGroup group,
        byte[] jpeg,
        CancellationToken cancellationToken = default)
    {
        var timestamp = UuidV7.Iso(capturedAt);
        try
        {
            var token = await _session.AccessTokenAsync(cancellationToken).ConfigureAwait(false);
            var status = await PostAsync(id, timestamp, group, jpeg, token, cancellationToken).ConfigureAwait(false);
            if (status == (int)HttpStatusCode.Unauthorized)
            {
                var refreshed = await _session.ForceRefreshAsync(cancellationToken).ConfigureAwait(false);
                var retried = await PostAsync(id, timestamp, group, jpeg, refreshed, cancellationToken)
                    .ConfigureAwait(false);
                return TimeEntryUploader.Classify(retried); // a second 401 → AuthFailed
            }

            return TimeEntryUploader.Classify(status);
        }
        catch (Exception e) when (e is AuthException or NotAuthenticatedException or HttpRequestException
                                      or TaskCanceledException)
        {
            return new UploadResult.Transient();
        }
    }

    /// <summary>
    /// The pure body builder. Field order is the invariant, and it is what
    /// <c>ScreenshotUploaderTests</c> asserts: <c>id</c>, <c>timestamp</c>, then the grouping
    /// fields, then the file — never the other way round.
    ///
    /// The grouping fields are optional on the server so that a client predating multi-display
    /// capture is still accepted; this client always sends them.
    /// </summary>
    internal static byte[] MultipartBody(string boundary, string id, string timestampIso, CaptureGroup group, byte[] jpeg)
    {
        using var body = new MemoryStream();

        void Ascii(string text)
        {
            var bytes = Encoding.UTF8.GetBytes(text);
            body.Write(bytes, 0, bytes.Length);
        }

        void Field(string name, string value)
        {
            Ascii($"--{boundary}\r\n");
            Ascii($"Content-Disposition: form-data; name=\"{name}\"\r\n\r\n");
            Ascii($"{value}\r\n");
        }

        Field("id", id);               // MUST be first
        Field("timestamp", timestampIso); // MUST precede the file
        Field("captureGroupId", group.Id);
        Field("displayIndex", group.DisplayIndex.ToString(CultureInfo.InvariantCulture));
        Field("displayCount", group.DisplayCount.ToString(CultureInfo.InvariantCulture));

        Ascii($"--{boundary}\r\n");
        Ascii($"Content-Disposition: form-data; name=\"file\"; filename=\"{id}.jpg\"\r\n");
        Ascii("Content-Type: image/jpeg\r\n\r\n");
        body.Write(jpeg, 0, jpeg.Length);
        Ascii($"\r\n--{boundary}--\r\n");

        return body.ToArray();
    }

    private async Task<int> PostAsync(
        string id,
        string timestampIso,
        CaptureGroup group,
        byte[] jpeg,
        string token,
        CancellationToken cancellationToken)
    {
        var boundary = $"NiftyTimer-{Guid.NewGuid():N}";

        using var content = new ByteArrayContent(MultipartBody(boundary, id, timestampIso, group, jpeg));
        var contentType = new MediaTypeHeaderValue("multipart/form-data");
        contentType.Parameters.Add(new NameValueHeaderValue("boundary", boundary));
        content.Headers.ContentType = contentType;

        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(_baseUrl, "screenshots"))
        {
            Content = content,
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        return (int)response.StatusCode;
    }
}
