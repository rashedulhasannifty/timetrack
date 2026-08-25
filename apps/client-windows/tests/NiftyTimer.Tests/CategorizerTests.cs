using NiftyTimer.Policy;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The categorization rules are shared with the macOS client and with the admin's mental model of
/// the settings page, so they are specified here term by term rather than spot-checked.
/// </summary>
public class CategorizerTests
{
    [Fact]
    public void AnAppWithNoMatchingRuleIsNeutral()
    {
        var categorizer = new Categorizer(productiveApps: ["code"], unproductiveApps: ["steam"]);

        Assert.Equal(Category.Neutral, categorizer.Categorize("Notepad", "notepad"));
    }

    [Fact]
    public void AnAppRuleMatchesTheBundleIdOrTheDisplayName()
    {
        var byBundle = new Categorizer(productiveApps: ["devenv"]);
        var byName = new Categorizer(productiveApps: ["Visual Studio"]);

        Assert.Equal(Category.Productive, byBundle.Categorize("Visual Studio", "devenv"));
        Assert.Equal(Category.Productive, byName.Categorize("Visual Studio", "devenv"));
    }

    /// <summary>
    /// A bundleId rule has to survive the app being renamed, and a display-name rule has to keep
    /// working for an app that reports no executable. Matching either is what buys both.
    /// </summary>
    [Fact]
    public void ABundleIdRuleStillMatchesAfterTheAppIsRenamed()
    {
        var categorizer = new Categorizer(unproductiveApps: ["steam"]);

        Assert.Equal(Category.Unproductive, categorizer.Categorize("Steam Beta (2026)", "steam"));
    }

    [Fact]
    public void MatchingIsTrimmedAndCaseInsensitive()
    {
        var categorizer = new Categorizer(productiveApps: ["  CODE  "]);

        Assert.Equal(Category.Productive, categorizer.Categorize("Code", "code"));
    }

    /// <summary>
    /// Overlapping app lists resolve toward flagging. An admin who has an app in both lists has
    /// made a mistake, and the safer reading of the mistake is the stricter one.
    /// </summary>
    [Fact]
    public void UnproductiveWinsWhenAnAppIsInBothLists()
    {
        var categorizer = new Categorizer(productiveApps: ["chrome"], unproductiveApps: ["chrome"]);

        Assert.Equal(Category.Unproductive, categorizer.Categorize("Google Chrome", "chrome"));
    }

    [Fact]
    public void ASiteRuleOutranksAnAppRule()
    {
        var categorizer = new Categorizer(
            unproductiveApps: ["chrome"],
            productiveSites: ["github.com"]);

        Assert.Equal(Category.Productive, categorizer.Categorize("Google Chrome", "chrome", "github.com"));
    }

    [Fact]
    public void ASiteTermMatchesADottedSubdomainButNotASuffixCollision()
    {
        var categorizer = new Categorizer(unproductiveSites: ["youtube.com"]);

        Assert.Equal(Category.Unproductive, categorizer.Categorize("Chrome", "chrome", "m.youtube.com"));
        Assert.Equal(Category.Neutral, categorizer.Categorize("Chrome", "chrome", "notyoutube.com"));
    }

    /// <summary>
    /// The reason specificity is scored at all: without it, a broad <c>amazon.com</c> in the
    /// unproductive list would silently override a deliberate <c>aws.amazon.com</c> in the
    /// productive one, and the admin's more specific rule would appear to do nothing.
    /// </summary>
    [Fact]
    public void TheMostSpecificSiteTermWinsAcrossBothLists()
    {
        var categorizer = new Categorizer(
            productiveSites: ["aws.amazon.com"],
            unproductiveSites: ["amazon.com"]);

        Assert.Equal(Category.Productive, categorizer.Categorize("Chrome", "chrome", "aws.amazon.com"));
        Assert.Equal(Category.Unproductive, categorizer.Categorize("Chrome", "chrome", "www.amazon.com"));
    }

    [Fact]
    public void EqualSiteSpecificityResolvesToUnproductive()
    {
        var categorizer = new Categorizer(
            productiveSites: ["example.com"],
            unproductiveSites: ["example.com"]);

        Assert.Equal(Category.Unproductive, categorizer.Categorize("Chrome", "chrome", "example.com"));
    }

    [Fact]
    public void AWildcardIsLessSpecificThanAWholeDomain()
    {
        var categorizer = new Categorizer(
            productiveSites: ["api.*"],
            unproductiveSites: ["stripe.com"]);

        // "stripe.com" (10) outranks the "api." prefix (4), so the domain rule wins.
        Assert.Equal(Category.Unproductive, categorizer.Categorize("Chrome", "chrome", "api.stripe.com"));
    }

    [Fact]
    public void ABareWildcardNeverMatches()
    {
        var categorizer = new Categorizer(unproductiveSites: ["*"]);

        Assert.Equal(Category.Neutral, categorizer.Categorize("Chrome", "chrome", "example.com"));
    }

    /// <summary>
    /// Windows has no browser-URL read, so the sampler always passes a null host. Site rules must
    /// then be inert rather than throwing or accidentally matching an empty string.
    /// </summary>
    [Fact]
    public void WithNoHostOnlyAppRulesApply()
    {
        var categorizer = new Categorizer(
            unproductiveApps: ["chrome"],
            productiveSites: ["github.com"]);

        Assert.Equal(Category.Unproductive, categorizer.Categorize("Google Chrome", "chrome", host: null));
    }

    /// <summary>
    /// Serializing the C# enum name would send "Productive"; the server's Category enum only
    /// accepts the uppercase token and answers 422 otherwise — which classifies as permanent, so
    /// the whole batch would be dropped rather than retried.
    /// </summary>
    [Theory]
    [InlineData(Category.Productive, "PRODUCTIVE")]
    [InlineData(Category.Unproductive, "UNPRODUCTIVE")]
    [InlineData(Category.Neutral, "NEUTRAL")]
    public void TheWireTokenIsUppercase(Category category, string expected) =>
        Assert.Equal(expected, Categories.Token(category));

    [Fact]
    public void ItReadsTheLiveTeamSettings()
    {
        var settings = new PolicySettings
        {
            ProductiveApps = ["devenv"],
            UnproductiveApps = ["steam"],
        };

        var categorizer = Categorizer.From(settings);

        Assert.Equal(Category.Productive, categorizer.Categorize("Visual Studio", "devenv"));
        Assert.Equal(Category.Unproductive, categorizer.Categorize("Steam", "steam"));
    }
}
