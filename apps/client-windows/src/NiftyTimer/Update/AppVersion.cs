using System.Diagnostics;
using System.Globalization;
using System.Reflection;

namespace NiftyTimer.Update;

/// <summary>
/// A dotted release version, compared numerically rather than as text.
///
/// String comparison gets this wrong in the one case that eventually matters — <c>"0.10.0"</c>
/// sorts before <c>"0.9.0"</c> — which would strand every install on the older build at exactly
/// the point the version numbers start being interesting.
///
/// Parsing is deliberately lenient about a leading <c>v</c> (GitHub tags carry one), about missing
/// components (<c>0.2</c> equals <c>0.2.0</c>), and about a pre-release or build suffix
/// (<c>0.2.0-windows-pilot</c> compares as <c>0.2.0</c>) — and deliberately strict about
/// everything else. An unparseable version means we do not know what is installed, and the caller
/// must treat that as "cannot compare", never as "needs updating".
/// </summary>
public sealed class AppVersion : IComparable<AppVersion>, IEquatable<AppVersion>
{
    private AppVersion(IReadOnlyList<int> components) => Components = components;

    public IReadOnlyList<int> Components { get; }

    /// <summary>Null when the text is not a version at all — the caller must not guess.</summary>
    public static AppVersion? Parse(string? raw)
    {
        if (raw is null)
        {
            return null;
        }

        var text = raw.Trim();
        if (text.StartsWith("v", StringComparison.OrdinalIgnoreCase))
        {
            text = text[1..];
        }

        var cut = text.IndexOfAny(['-', '+']);
        if (cut >= 0)
        {
            text = text[..cut];
        }

        if (text.Length == 0)
        {
            return null;
        }

        var parsed = new List<int>();
        foreach (var part in text.Split('.'))
        {
            if (!int.TryParse(part, NumberStyles.None, CultureInfo.InvariantCulture, out var n) || n < 0)
            {
                return null;
            }

            parsed.Add(n);
        }

        return parsed.Count == 0 ? null : new AppVersion(parsed);
    }

    /// <summary>
    /// The running build's version. Read from the assembly's informational version, falling back
    /// to the file version — null when neither is a version, which a debug build run straight from
    /// <c>dotnet run</c> can be.
    /// </summary>
    public static AppVersion? Current(Assembly? assembly = null)
    {
        var target = assembly ?? Assembly.GetEntryAssembly() ?? Assembly.GetExecutingAssembly();

        var informational = target
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        if (Parse(informational) is { } fromInformational)
        {
            return fromInformational;
        }

        var location = target.Location;
        if (location.Length == 0)
        {
            return null;
        }

        try
        {
            return Parse(FileVersionInfo.GetVersionInfo(location).FileVersion);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException)
        {
            return null;
        }
    }

    public int CompareTo(AppVersion? other)
    {
        if (other is null)
        {
            return 1;
        }

        var length = Math.Max(Components.Count, other.Components.Count);
        for (var i = 0; i < length; i++)
        {
            // Missing components read as zero, so 0.2 and 0.2.0 compare equal.
            var left = i < Components.Count ? Components[i] : 0;
            var right = i < other.Components.Count ? other.Components[i] : 0;
            if (left != right)
            {
                return left.CompareTo(right);
            }
        }

        return 0;
    }

    public bool Equals(AppVersion? other) => CompareTo(other) == 0;

    public override bool Equals(object? obj) => obj is AppVersion other && Equals(other);

    public override int GetHashCode()
    {
        // Must agree with Equals, which treats trailing zeros as absent.
        var hash = default(HashCode);
        var significant = Components.Count;
        while (significant > 1 && Components[significant - 1] == 0)
        {
            significant--;
        }

        for (var i = 0; i < significant; i++)
        {
            hash.Add(Components[i]);
        }

        return hash.ToHashCode();
    }

    public override string ToString() => string.Join('.', Components);

    public static bool operator <(AppVersion? a, AppVersion? b) => Compare(a, b) < 0;

    public static bool operator >(AppVersion? a, AppVersion? b) => Compare(a, b) > 0;

    public static bool operator <=(AppVersion? a, AppVersion? b) => Compare(a, b) <= 0;

    public static bool operator >=(AppVersion? a, AppVersion? b) => Compare(a, b) >= 0;

    public static bool operator ==(AppVersion? a, AppVersion? b) => Compare(a, b) == 0;

    public static bool operator !=(AppVersion? a, AppVersion? b) => Compare(a, b) != 0;

    private static int Compare(AppVersion? a, AppVersion? b) =>
        a is null ? (b is null ? 0 : -1) : a.CompareTo(b);
}
