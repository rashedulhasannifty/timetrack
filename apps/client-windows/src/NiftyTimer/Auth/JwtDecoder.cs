using System.Text.Json;
using System.Text.Json.Serialization;

namespace NiftyTimer.Auth;

public sealed class JwtMalformedException : Exception
{
    public JwtMalformedException()
        : base("Access token is not a well-formed JWT.")
    {
    }
}

/// <summary>
/// Decodes the payload segment of a JWT (base64url) into the claims the client needs.
/// No signature verification — the API verifies; the client only needs its own user id
/// (<c>sub</c>) for the ack-monitoring call. Mirrors <c>JwtClaimsSchema { sub, role, teamId }</c>.
/// </summary>
public static class JwtDecoder
{
    public sealed record Claims(
        [property: JsonPropertyName("sub")] string Sub,
        [property: JsonPropertyName("role")] string Role,
        [property: JsonPropertyName("teamId")] string TeamId);

    public static Claims ReadClaims(string accessToken)
    {
        var segments = accessToken.Split('.');
        if (segments.Length != 3)
        {
            throw new JwtMalformedException();
        }

        byte[] payload;
        try
        {
            payload = Base64UrlDecode(segments[1]);
        }
        catch (FormatException)
        {
            throw new JwtMalformedException();
        }

        try
        {
            return JsonSerializer.Deserialize<Claims>(payload)
                   ?? throw new JwtMalformedException();
        }
        catch (JsonException)
        {
            throw new JwtMalformedException();
        }
    }

    /// <summary>Returns null instead of throwing — for the many call sites that only want a best-effort id.</summary>
    public static Claims? TryReadClaims(string? accessToken)
    {
        if (string.IsNullOrEmpty(accessToken))
        {
            return null;
        }

        try
        {
            return ReadClaims(accessToken);
        }
        catch (JwtMalformedException)
        {
            return null;
        }
    }

    private static byte[] Base64UrlDecode(string s)
    {
        var b = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(b.PadRight(b.Length + ((4 - (b.Length % 4)) % 4), '='));
    }
}
