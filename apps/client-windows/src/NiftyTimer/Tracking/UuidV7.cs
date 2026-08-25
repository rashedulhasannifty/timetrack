using System.Globalization;

namespace NiftyTimer.Tracking;

/// <summary>
/// PRD §7.5 — every record carries a client-minted UUIDv7 primary key so sync is idempotent
/// (the API upserts on it). Hand-rolled to avoid a dependency (CLAUDE.md §2). Layout
/// (RFC 9562): 48-bit big-endian ms timestamp · version 7 · 12 rand · variant 10 · 62 rand.
/// <paramref name="now"/> / <paramref name="randomByte"/> are injectable for deterministic tests.
/// </summary>
public static class UuidV7
{
    public static string Generate(DateTimeOffset now, Func<byte>? randomByte = null)
    {
        randomByte ??= DefaultRandomByte;

        var bytes = new byte[16];

        // 48-bit big-endian millisecond timestamp.
        var ms = (ulong)now.ToUnixTimeMilliseconds();
        bytes[0] = (byte)((ms >> 40) & 0xFF);
        bytes[1] = (byte)((ms >> 32) & 0xFF);
        bytes[2] = (byte)((ms >> 24) & 0xFF);
        bytes[3] = (byte)((ms >> 16) & 0xFF);
        bytes[4] = (byte)((ms >> 8) & 0xFF);
        bytes[5] = (byte)(ms & 0xFF);

        for (var i = 6; i < 16; i++)
        {
            bytes[i] = randomByte();
        }

        bytes[6] = (byte)((bytes[6] & 0x0F) | 0x70); // version 7
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80); // variant 10

        var hex = Convert.ToHexString(bytes).ToLowerInvariant();
        return string.Create(
            36,
            hex,
            static (span, h) =>
            {
                h.AsSpan(0, 8).CopyTo(span);
                span[8] = '-';
                h.AsSpan(8, 4).CopyTo(span[9..]);
                span[13] = '-';
                h.AsSpan(12, 4).CopyTo(span[14..]);
                span[18] = '-';
                h.AsSpan(16, 4).CopyTo(span[19..]);
                span[23] = '-';
                h.AsSpan(20, 12).CopyTo(span[24..]);
            });
    }

    public static string Generate() => Generate(DateTimeOffset.UtcNow);

    private static byte DefaultRandomByte() =>
        (byte)System.Security.Cryptography.RandomNumberGenerator.GetInt32(0, 256);

    /// <summary>
    /// The wire format the API expects for instants: RFC 3339 UTC, no fractional seconds
    /// (matches Swift's <c>ISO8601DateFormatter</c> with <c>.withInternetDateTime</c>, which is
    /// what the shipped Mac client sends and what <c>z.iso.datetime()</c> accepts).
    /// </summary>
    public static string Iso(DateTimeOffset instant) =>
        instant.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
}
