using System.Windows;
using System.Windows.Interop;
using NiftyTimer.App;
using NiftyTimer.UI;
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

/// <summary>
/// The elapsed timer faked column alignment with Consolas — a code font, and a large part of why
/// the client read as unfinished. The WPF equivalent of the dashboard's tabular-nums and the Mac
/// client's .monospacedDigit() is NumeralAlignment=Tabular on the ordinary UI font.
/// </summary>
public class TypeTests
{
    [Fact]
    public void TheElapsedStyleIsTabularRatherThanMonospaced()
    {
        var tokens = File.ReadAllText(Path.Combine(ThemeSweepTests.UiDirectory(), "Tokens.xaml"));

        Assert.DoesNotContain("Consolas", tokens, StringComparison.Ordinal);
        Assert.Contains("Typography.NumeralAlignment", tokens, StringComparison.Ordinal);
    }
}

/// <summary>
/// The registry value is a tri-state: 1 light, 0 dark, absent on installs that have never been
/// through the personalisation page. Absent must mean light — the Windows default — rather than
/// throwing or defaulting to dark on a machine whose desktop is light.
/// </summary>
public class ThemeResolverTests
{
    [Theory]
    [InlineData(1, AppTheme.Light)]
    [InlineData(0, AppTheme.Dark)]
    [InlineData(null, AppTheme.Light)]
    [InlineData(7, AppTheme.Light)]
    public void ResolvesTheRegistryValue(int? value, AppTheme expected) =>
        Assert.Equal(expected, ThemeResolver.Resolve(value));
}

public class ThemeWatcherTests
{
    private sealed class FakeHost : IMessageHost
    {
        public IntPtr Handle => IntPtr.Zero;

        public void Dispose()
        {
        }
    }

    private static ThemeWatcher Watcher(Func<AppTheme> read, Action<AppTheme> apply) =>
        new(read, apply, _ => new FakeHost());

    [Fact]
    public void AppliesTheCurrentThemeOnConstruction()
    {
        var applied = new List<AppTheme>();
        using var watcher = Watcher(() => AppTheme.Dark, applied.Add);

        Assert.Equal([AppTheme.Dark], applied);
        Assert.Equal(AppTheme.Dark, watcher.Current);
    }

    /// <summary>
    /// WM_SETTINGCHANGE fires for far more than the colour scheme — DPI, locale, accessibility.
    /// Re-merging a dictionary on every one of those would discard and rebuild every brush in the
    /// app for no reason, so the watcher applies only on an actual change.
    /// </summary>
    [Fact]
    public void AppliesOnlyWhenTheThemeActuallyChanged()
    {
        var theme = AppTheme.Light;
        var applied = new List<AppTheme>();
        using var watcher = Watcher(() => theme, applied.Add);

        watcher.OnSettingChange();
        theme = AppTheme.Dark;
        watcher.OnSettingChange();
        watcher.OnSettingChange();

        Assert.Equal([AppTheme.Light, AppTheme.Dark], applied);
    }
}

/// <summary>
/// A headless stand-in for the one check nothing else here can perform: opening
/// <c>TrayPopupWindow</c> and watching it re-theme while the Windows appearance setting is
/// flipped, live. No agent in this session had display access to actually do that by hand, so
/// this proves the mechanism instead — that swapping the dictionary at
/// <c>Application.Current.Resources.MergedDictionaries[0]</c>, the way
/// <see cref="ThemeWatcher.ApplyToApplication"/> does, actually changes what a DynamicResource
/// binding on an already-constructed control resolves to. It is exactly the failure mode
/// <see cref="ThemeSweepTests"/> guards against from the other side (a stray
/// <c>{StaticResource}</c> in the XAML) — this side proves the DynamicResource path itself works,
/// which the string sweep cannot.
/// </summary>
[Collection("wpf")]
public class ThemeLiveSwapTests
{
    [Fact]
    public void SwappingTheMergedThemeDictionaryReThemesAnAlreadyResolvedBinding()
    {
        var (beforeColor, afterColor) = Wpf.Run(() =>
        {
            var border = new System.Windows.Controls.Border();
            border.SetResourceReference(
                System.Windows.Controls.Border.BackgroundProperty,
                "Surface");

            // Give the border a logical parent, the way it would have one inside
            // TrayPopupWindow. Resource-change invalidation propagates through the logical
            // tree, not by re-evaluating every DynamicResource on demand — a border with no
            // owning tree never hears about the swap below and this assertion would pass
            // vacuously.
            var window = new Window { Content = border };

            // Force the DynamicResource to resolve once, exactly as it would have when
            // TrayPopupWindow was first constructed and shown.
            var before = ((System.Windows.Media.SolidColorBrush)border.Background).Color;

            try
            {
                ThemeWatcher.ApplyToApplication(AppTheme.Dark);

                var after = ((System.Windows.Media.SolidColorBrush)border.Background).Color;
                return (before, after);
            }
            finally
            {
                // Leave the shared, process-wide Application in the state every other test in
                // this collection expects it in, and don't leak the throwaway window into
                // Application.Current.Windows for the rest of the shared dispatcher's life.
                ThemeWatcher.ApplyToApplication(AppTheme.Light);
                window.Close();
            }
        });

        Assert.NotEqual(beforeColor, afterColor);
        Assert.Equal(System.Windows.Media.Color.FromRgb(0xF6, 0xF6, 0xF4), beforeColor);
        Assert.Equal(System.Windows.Media.Color.FromRgb(0x11, 0x11, 0x13), afterColor);
    }
}
