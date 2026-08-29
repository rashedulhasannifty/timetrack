using System.Windows;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// A key present in one theme and missing from the other surfaces as a null brush in that theme
/// only — invisible text on exactly one appearance setting, which is the kind of thing that
/// ships.
/// </summary>
[Collection("wpf")]
public class ThemeDictionaryTests
{
    [Fact]
    public void BothThemesDefineExactlyTheSameKeys()
    {
        var (light, dark) = Wpf.Run(() => (
            Keys("pack://application:,,,/NiftyTimer;component/UI/Theme.Light.xaml"),
            Keys("pack://application:,,,/NiftyTimer;component/UI/Theme.Dark.xaml")));

        Assert.Equal(light, dark);
    }

    private static SortedSet<string> Keys(string uri) =>
        new(new ResourceDictionary { Source = new Uri(uri, UriKind.Absolute) }
            .Keys
            .Cast<object>()
            .Select(key => key.ToString()!));
}

/// <summary>
/// The guard for the one failure mode dark mode has that nothing else catches.
///
/// <c>{StaticResource}</c> resolves once, at load. <c>TrayPopupWindow</c> is constructed once and
/// then only shown and hidden for the whole session, so a single missed reference leaves it as the
/// one window that never re-themes — and a fresh-launch check in either theme still passes.
/// Dictionary completeness above does not catch it either: both dictionaries are complete whether
/// or not the sweep was finished.
///
/// String assertions over XAML, in the spirit of <see cref="PackagingContractTests"/>: unlovely,
/// and the only thing that fails in CI instead of in someone's eyes months later.
/// </summary>
public class ThemeSweepTests
{
    private static readonly string[] ThemedRoles =
    [
        "Surface", "SurfaceRaised", "Separator", "Text", "TextSecondary", "Neutral",
        "Accent", "AccentHover", "OnAccent", "Tint", "Destructive", "Recording",
        "Good", "Manual", "MarkRemaining", "MarkElapsed",
    ];

    [Theory]
    [InlineData("TrayPopupWindow.xaml")]
    [InlineData("LoginWindow.xaml")]
    [InlineData("AckWindow.xaml")]
    [InlineData("TimePromptWindow.xaml")]
    [InlineData("Tokens.xaml")]
    // Added by Task 3, which creates this file. Until then the case is skipped by the
    // File.Exists guard below rather than failing a task that has not run yet.
    [InlineData("Styles.xaml")]
    public void NoThemedBrushIsBoundWithStaticResource(string file)
    {
        var path = Path.Combine(UiDirectory(), file);
        if (!File.Exists(path))
        {
            // Styles.xaml arrives in Task 3. Absent is not a failure; present-and-dirty is.
            return;
        }

        var xaml = File.ReadAllText(path);

        foreach (var role in ThemedRoles)
        {
            Assert.DoesNotContain($"{{StaticResource {role}}}", xaml, StringComparison.Ordinal);
        }
    }

    /// <summary>Walk up from the test binary to the client root; XAML is not copied to output.</summary>
    internal static string UiDirectory()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "src")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return Path.Combine(directory!.FullName, "src", "NiftyTimer", "UI");
    }
}
