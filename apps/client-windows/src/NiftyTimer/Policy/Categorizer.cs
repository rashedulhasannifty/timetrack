namespace NiftyTimer.Policy;

/// <summary>
/// How a sampled app or site is scored. The wire tokens are UPPERCASE and are written out
/// explicitly rather than derived from the enum name — serializing the C# name would send
/// <c>"Productive"</c>, which the server's <c>Category</c> enum rejects with a 422, and a 422
/// classifies as permanent so the whole batch would be dropped silently.
/// </summary>
public enum Category
{
    Productive,
    Unproductive,
    Neutral,
}

public static class Categories
{
    public static string Token(Category category) => category switch
    {
        Category.Productive => "PRODUCTIVE",
        Category.Unproductive => "UNPRODUCTIVE",
        Category.Neutral => "NEUTRAL",
        _ => throw new ArgumentOutOfRangeException(nameof(category)),
    };
}

/// <summary>
/// PRD §6.3 — client-side app/site categorization from the admin policy lists.
///
/// The site (host) lists and the app-name lists are SEPARATE: a host matches only the site lists,
/// the frontmost app matches only the app lists. A host category wins over the app category; with
/// neither, NEUTRAL.
///
/// For sites the MOST SPECIFIC matching term wins across both lists, so a broad
/// <c>amazon.com</c> in the unproductive list cannot silently override a specific
/// <c>aws.amazon.com</c> in the productive list. On equal specificity UNPRODUCTIVE wins — fail
/// toward flagging. An app rule matches by exact equality against EITHER the app's bundleId or
/// its display name (so a bundleId rule survives a rename), and there too UNPRODUCTIVE wins on
/// overlap. All matching is trimmed and case-insensitive.
///
/// **The site path is ported in full but never fires on Windows.** There is no equivalent of the
/// macOS client's AppleScript browser-URL read — UI Automation against address bars is fragile
/// and per-browser, and a browser extension is a separate product — so <c>host</c> is always
/// null here. The consequence is real and worth stating: a Windows user browsing in Chrome is
/// categorized by the Chrome APP rule, not by the site they are on. The code stays because the
/// server still sends site lists and the rules are shared with the Mac client; it is not a stub.
///
/// No content is read here — only the app name, its bundleId, and (on macOS) a host derived
/// upstream for this one call. This type is pure, takes no gate, and deliberately does not live
/// in a capture namespace: it classifies policy lists, it does not touch hardware.
/// </summary>
public sealed class Categorizer
{
    private readonly IReadOnlyList<string> _productiveApps;
    private readonly IReadOnlyList<string> _unproductiveApps;
    private readonly IReadOnlyList<string> _productiveSites;
    private readonly IReadOnlyList<string> _unproductiveSites;

    public Categorizer(
        IReadOnlyList<string>? productiveApps = null,
        IReadOnlyList<string>? unproductiveApps = null,
        IReadOnlyList<string>? productiveSites = null,
        IReadOnlyList<string>? unproductiveSites = null)
    {
        _productiveApps = productiveApps ?? [];
        _unproductiveApps = unproductiveApps ?? [];
        _productiveSites = productiveSites ?? [];
        _unproductiveSites = unproductiveSites ?? [];
    }

    /// <summary>
    /// Build from the live team settings. Read on every sample rather than captured once, so an
    /// admin's edit applies on the next tick instead of the next launch.
    /// </summary>
    public static Categorizer From(PolicySettings settings) => new(
        settings.ProductiveApps,
        settings.UnproductiveApps,
        settings.ProductiveSites,
        settings.UnproductiveSites);

    public Category Categorize(string appName, string? bundleId = null, string? host = null)
    {
        if (Normalize(host) is { } normalizedHost)
        {
            // Most-specific term wins across both site lists; equal specificity → unproductive.
            var unproductive = BestSiteSpecificity(normalizedHost, _unproductiveSites);
            var productive = BestSiteSpecificity(normalizedHost, _productiveSites);

            if (unproductive is { } u && productive is { } p)
            {
                return u >= p ? Category.Unproductive : Category.Productive;
            }

            if (unproductive is not null)
            {
                return Category.Unproductive;
            }

            if (productive is not null)
            {
                return Category.Productive;
            }
        }

        var app = Normalize(appName);
        var bundle = Normalize(bundleId);
        if (app is not null || bundle is not null)
        {
            if (AppListMatches(_unproductiveApps, app, bundle))
            {
                return Category.Unproductive;
            }

            if (AppListMatches(_productiveApps, app, bundle))
            {
                return Category.Productive;
            }
        }

        return Category.Neutral;
    }

    /// <summary>True if any term in the list equals the normalized display name or bundleId.</summary>
    private static bool AppListMatches(IReadOnlyList<string> list, string? app, string? bundle)
    {
        foreach (var raw in list)
        {
            if (Normalize(raw) is { } term && (term == app || term == bundle))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>Highest match specificity of any term in the list, or null if none match.</summary>
    private static int? BestSiteSpecificity(string host, IReadOnlyList<string> list)
    {
        int? best = null;
        foreach (var raw in list)
        {
            if (Normalize(raw) is not { } term || SiteMatchSpecificity(host, term) is not { } score)
            {
                continue;
            }

            if (best is null || score > best)
            {
                best = score;
            }
        }

        return best;
    }

    /// <summary>
    /// How specifically <paramref name="term"/> pins <paramref name="host"/> (higher = more
    /// specific), or null if it does not match at all:
    /// <list type="bullet">
    /// <item>equality or dotted suffix (<c>youtube.com</c> matches <c>m.youtube.com</c>): the
    /// term's length.</item>
    /// <item>leading-label wildcard (<c>api.*</c> matches <c>api.stripe.com</c>): the literal
    /// prefix length (<c>api.</c>) — deliberately lower than a full-domain suffix, so a real
    /// domain rule outranks a broad wildcard. A bare <c>*</c> (no dot) never matches.</item>
    /// </list>
    /// </summary>
    private static int? SiteMatchSpecificity(string host, string term)
    {
        if (term.EndsWith(".*", StringComparison.Ordinal))
        {
            var prefix = term[..^1]; // "api.*" -> "api."
            return host.StartsWith(prefix, StringComparison.Ordinal) ? prefix.Length : null;
        }

        if (host == term || host.EndsWith("." + term, StringComparison.Ordinal))
        {
            return term.Length;
        }

        return null;
    }

    private static string? Normalize(string? value)
    {
        if (value is null)
        {
            return null;
        }

        var trimmed = value.Trim().ToLowerInvariant();
        return trimmed.Length == 0 ? null : trimmed;
    }
}
