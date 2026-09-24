using System.Net.Http;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using NiftyTimer.App;

namespace NiftyTimer.Auth;

/// <summary>Mirrors <c>TokenPairSchema</c> in @timetrack/contracts.</summary>
public sealed record TokenPair(
    [property: JsonPropertyName("accessToken")] string AccessToken,
    [property: JsonPropertyName("refreshToken")] string RefreshToken,
    [property: JsonPropertyName("expiresIn")] int ExpiresIn);

public enum AuthFailure
{
    /// <summary>401 on login.</summary>
    InvalidCredentials,

    /// <summary>401 on refresh — the only outcome that means the stored token is dead.</summary>
    RefreshRejected,

    /// <summary>Any other non-2xx.</summary>
    Server,

    /// <summary>The request never completed.</summary>
    Transport,
}

public sealed class AuthException : Exception
{
    public AuthException(AuthFailure failure, int status = 0)
        : base($"Auth request failed: {failure} ({status}).")
    {
        Failure = failure;
        Status = status;
    }

    public AuthFailure Failure { get; }

    public int Status { get; }
}

public interface IAuthClient
{
    Task<TokenPair> LoginAsync(string email, string password, CancellationToken cancellationToken = default);

    Task<TokenPair> RefreshAsync(string refreshToken, CancellationToken cancellationToken = default);
}

/// <summary>
/// POSTs to <c>{baseUrl}/auth/login</c> and <c>{baseUrl}/auth/refresh</c>. The base URL already
/// carries <c>/v1</c>.
/// </summary>
public sealed partial class AuthClient : IAuthClient
{
    private readonly HttpClient _http;
    private readonly Uri _baseUrl;
    private readonly string? _clientVersion;

    /// <param name="clientVersion">
    /// This build's version, sent as <c>X-Client-Version</c> so an admin can see who needs an
    /// update. Defaults to <see cref="BuildStamp.Version"/>; null or unparseable sends nothing.
    /// </param>
    public AuthClient(HttpClient http, Uri baseUrl, string? clientVersion = null)
    {
        _http = http;
        _baseUrl = baseUrl;
        _clientVersion = ReportableVersion(clientVersion ?? BuildStamp.Version);
    }

    /// <summary>
    /// "0.2.1-pilot" → "0.2.1". The API accepts dotted numbers only and ignores anything else,
    /// so a suffix is dropped here rather than costing the report entirely.
    /// </summary>
    internal static string? ReportableVersion(string? raw)
    {
        if (raw is null) return null;
        var m = LeadingVersion().Match(raw.Trim());
        return m.Success ? m.Value : null;
    }

    [GeneratedRegex(@"^\d{1,4}(\.\d{1,4}){0,3}(?=$|[-+])")]
    private static partial Regex LeadingVersion();

    public Task<TokenPair> LoginAsync(string email, string password, CancellationToken cancellationToken = default) =>
        PostAsync(
            "auth/login",
            new Dictionary<string, string> { ["email"] = email, ["password"] = password },
            AuthFailure.InvalidCredentials,
            cancellationToken);

    public Task<TokenPair> RefreshAsync(string refreshToken, CancellationToken cancellationToken = default) =>
        PostAsync(
            "auth/refresh",
            new Dictionary<string, string> { ["refreshToken"] = refreshToken },
            AuthFailure.RefreshRejected,
            cancellationToken);

    private async Task<TokenPair> PostAsync(
        string path,
        Dictionary<string, string> body,
        AuthFailure unauthorizedFailure,
        CancellationToken cancellationToken)
    {
        HttpResponseMessage response;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(_baseUrl, path))
            {
                Content = JsonContent.Create(body),
            };
            if (_clientVersion is not null)
            {
                // Identity only — platform and version, never anything about the person or device.
                request.Headers.Add("X-Client-Platform", "WINDOWS");
                request.Headers.Add("X-Client-Version", _clientVersion);
            }

            response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            throw new AuthException(AuthFailure.Transport);
        }

        using (response)
        {
            var status = (int)response.StatusCode;
            if (response.StatusCode == HttpStatusCode.Unauthorized)
            {
                throw new AuthException(unauthorizedFailure, status);
            }

            if (!response.IsSuccessStatusCode)
            {
                throw new AuthException(AuthFailure.Server, status);
            }

            try
            {
                return await response.Content
                           .ReadFromJsonAsync<TokenPair>(cancellationToken)
                           .ConfigureAwait(false)
                       ?? throw new AuthException(AuthFailure.Server, status);
            }
            catch (Exception e) when (e is System.Text.Json.JsonException or HttpRequestException)
            {
                throw new AuthException(AuthFailure.Server, status);
            }
        }
    }
}
