using System.Net.Http;
using System.Net;
using System.Net.Http.Json;
using NiftyTimer.Auth;

namespace NiftyTimer.Policy;

/// <summary>
/// Fetches the effective monitoring policy. <see cref="AckGate"/> calls this before any capture
/// path may run. On a 401 it forces a token refresh and retries once; a second 401 (or any other
/// failure) propagates, and the gate stays closed (fail-safe).
/// </summary>
public sealed class PolicyClient : IPolicyProvider
{
    private readonly HttpClient _http;
    private readonly Uri _baseUrl;
    private readonly AuthSession _session;

    public PolicyClient(HttpClient http, Uri baseUrl, AuthSession session)
    {
        _http = http;
        _baseUrl = baseUrl;
        _session = session;
    }

    public async Task<EffectivePolicy> EffectivePolicyAsync(CancellationToken cancellationToken = default)
    {
        var token = await _session.AccessTokenAsync(cancellationToken).ConfigureAwait(false);
        var (body, status) = await FetchAsync(token, cancellationToken).ConfigureAwait(false);

        if (status == (int)HttpStatusCode.Unauthorized)
        {
            var refreshed = await _session.ForceRefreshAsync(cancellationToken).ConfigureAwait(false);
            (body, status) = await FetchAsync(refreshed, cancellationToken).ConfigureAwait(false);
        }

        if (status != (int)HttpStatusCode.OK || body is null)
        {
            throw new AckGateException(AckGateFailure.PolicyUnavailable);
        }

        return body;
    }

    private async Task<(EffectivePolicy? Body, int Status)> FetchAsync(
        string token,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(_baseUrl, "policy/effective"));
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        try
        {
            using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            var status = (int)response.StatusCode;
            if (!response.IsSuccessStatusCode)
            {
                return (null, status);
            }

            var body = await response.Content
                .ReadFromJsonAsync<EffectivePolicy>(cancellationToken)
                .ConfigureAwait(false);
            return (body, status);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            throw new AckGateException(AckGateFailure.PolicyUnavailable);
        }
    }
}
