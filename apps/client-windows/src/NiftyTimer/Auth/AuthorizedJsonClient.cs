using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;

namespace NiftyTimer.Auth;

public sealed class ResourceUnavailableException : Exception
{
    public ResourceUnavailableException(string path, int status)
        : base($"GET {path} failed with status {status}.")
    {
        Path = path;
        Status = status;
    }

    public string Path { get; }

    public int Status { get; }
}

/// <summary>
/// Authenticated JSON GETs with the client's standard 401 handling: force one token refresh and
/// retry once; a surviving 401 (or any other non-200) throws.
///
/// The Swift client repeats this block inline in every read client. One copy is enough — but the
/// shape must not drift: a client that skips the refresh-retry silently stops working 15 minutes
/// after sign-in, which is exactly how long an access token lasts.
/// </summary>
public sealed class AuthorizedJsonClient
{
    private readonly HttpClient _http;
    private readonly Uri _baseUrl;
    private readonly AuthSession _session;

    public AuthorizedJsonClient(HttpClient http, Uri baseUrl, AuthSession session)
    {
        _http = http;
        _baseUrl = baseUrl;
        _session = session;
    }

    public async Task<T> GetAsync<T>(string path, CancellationToken cancellationToken = default)
    {
        var token = await _session.AccessTokenAsync(cancellationToken).ConfigureAwait(false);
        var (body, status) = await FetchAsync<T>(path, token, cancellationToken).ConfigureAwait(false);

        if (status == (int)HttpStatusCode.Unauthorized)
        {
            var refreshed = await _session.ForceRefreshAsync(cancellationToken).ConfigureAwait(false);
            (body, status) = await FetchAsync<T>(path, refreshed, cancellationToken).ConfigureAwait(false);
        }

        if (status != (int)HttpStatusCode.OK || body is null)
        {
            throw new ResourceUnavailableException(path, status);
        }

        return body;
    }

    private async Task<(T? Body, int Status)> FetchAsync<T>(
        string path,
        string token,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(_baseUrl, path));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        try
        {
            using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            var status = (int)response.StatusCode;
            if (!response.IsSuccessStatusCode)
            {
                return (default, status);
            }

            var body = await response.Content
                .ReadFromJsonAsync<T>(cancellationToken)
                .ConfigureAwait(false);
            return (body, status);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException
                                      or System.Text.Json.JsonException)
        {
            throw new ResourceUnavailableException(path, 0);
        }
    }
}
