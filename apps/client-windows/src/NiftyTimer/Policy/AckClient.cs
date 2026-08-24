using System.Net.Http;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using NiftyTimer.Auth;

namespace NiftyTimer.Policy;

/// <summary>Mirrors <c>AckMonitoringSchema</c> in @timetrack/contracts.</summary>
public sealed record AckMonitoringBody(
    [property: JsonPropertyName("policyVersion")] string PolicyVersion);

public interface IAckClient
{
    Task<bool> AcknowledgeAsync(string userId, string policyVersion, CancellationToken cancellationToken = default);
}

/// <summary>
/// POSTs <c>users/{userId}/ack-monitoring</c>. The API enforces self-only — the id must be the
/// signed-in user's own <c>sub</c> — and writes an audit row. Acknowledgement is the one thing
/// that opens <see cref="AckGate"/>; nothing else does.
/// </summary>
public sealed class AckClient : IAckClient
{
    private readonly HttpClient _http;
    private readonly Uri _baseUrl;
    private readonly AuthSession _session;

    public AckClient(HttpClient http, Uri baseUrl, AuthSession session)
    {
        _http = http;
        _baseUrl = baseUrl;
        _session = session;
    }

    public async Task<bool> AcknowledgeAsync(
        string userId,
        string policyVersion,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var token = await _session.AccessTokenAsync(cancellationToken).ConfigureAwait(false);
            var status = await PostAsync(userId, policyVersion, token, cancellationToken).ConfigureAwait(false);
            if (status == (int)HttpStatusCode.Unauthorized)
            {
                var refreshed = await _session.ForceRefreshAsync(cancellationToken).ConfigureAwait(false);
                status = await PostAsync(userId, policyVersion, refreshed, cancellationToken).ConfigureAwait(false);
            }

            return status is >= 200 and <= 299;
        }
        catch (Exception e) when (e is AuthException or NotAuthenticatedException or HttpRequestException
                                      or TaskCanceledException)
        {
            return false;
        }
    }

    private async Task<int> PostAsync(
        string userId,
        string policyVersion,
        string token,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri(_baseUrl, $"users/{Uri.EscapeDataString(userId)}/ack-monitoring"))
        {
            Content = JsonContent.Create(new AckMonitoringBody(policyVersion)),
        };
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        return (int)response.StatusCode;
    }
}
