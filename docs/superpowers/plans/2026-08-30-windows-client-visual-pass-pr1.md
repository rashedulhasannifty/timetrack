# Windows Client Visual Pass — PR 1 (Token and Style Layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Windows client's placeholder palette and stock WPF control chrome with a themed token layer that matches the dashboard, in both light and dark, without changing any window's structure.

**Architecture:** Two swapped resource dictionaries (`Theme.Light.xaml` / `Theme.Dark.xaml`) hold every themed brush; `Tokens.xaml` holds theme-independent radii and type styles; `Styles.xaml` holds `ControlTemplate`s for the stock controls. `App.xaml` merges one theme at `MergedDictionaries[0]`, and a `ThemeWatcher` swaps that entry when Windows changes theme. Every brush reference in a window moves to `{DynamicResource}` so the swap actually reaches the long-lived tray popup.

**Tech Stack:** C# / .NET 9 (`net9.0-windows`), WPF, xUnit. No new NuGet packages.

**Spec:** `docs/superpowers/specs/2026-08-30-windows-client-visual-parity-design.md`

## Global Constraints

- **No new dependency** without asking (CLAUDE.md §2). No WPF-UI / ModernWpf / MahApps. No `Microsoft.Win32.SystemEvents` PackageReference — see Deviation 1.
- **No AI attribution** in any commit — no co-author trailer, no generated-by footer, author stays the repo's configured git user (CLAUDE.md §0).
- Commit format: `<type>(client): <imperative summary ≤72 chars>`. Types used here: `refactor`, `feat`, `test`, `chore`.
- `TreatWarningsAsErrors` is on. `dotnet build NiftyTimer.sln -c Release` is both the build and the lint gate.
- **No structural changes to any window in this PR.** No control is added, removed, renamed, or reordered. Only appearance.
- `CaptureGateGuardTests`, `OfflineCaptureUnreachableTests`, `TimePromptTests`, `PackagingContractTests` stay green.
- The monitoring notice (`NoticeLabel`) and the tray indicator are never hidden, collapsed, or made dismissible (CLAUDE.md §1, PRD §4.2).
- All working-directory paths below are relative to `apps/client-windows/`.
- Run all commands from `apps/client-windows/`.

### Deviations from the spec — read before starting

Three, all deliberate. Flag them in the PR description.

**1. `WM_SETTINGCHANGE`, not `SystemEvents.UserPreferenceChanged`.** The spec picked `SystemEvents` and then had to add a mitigation for its callbacks arriving off the UI thread. This codebase already has `MessageWindow` — a hidden **top-level** window built specifically to receive broadcasts (`TaskbarCreated`, `WM_POWERBROADCAST`) — and `WM_SETTINGCHANGE` with `lParam == "ImmersiveColorSet"` is the canonical theme signal. Its `WndProc` runs on the UI thread, so the marshalling risk disappears rather than being mitigated. It also avoids depending on `Microsoft.Win32.SystemEvents` being present in the WindowsDesktop shared framework. Update the spec's "Theme detection" section to match once this lands.

**2. Elevation tokens deferred.** The spec says `e1`/`e2` "port directly". No window in this client uses a shadow today, and after Task 7 the tray popup gets its shadow from DWM. Adding unused `DropShadowEffect` resources is exactly the drift the spec warns about elsewhere. Defer to whichever PR first needs one.

**3. One token added: `OnAccent`.** The spec's table has no role for text drawn _on_ an accent fill. It cannot be a fixed colour: light accent `#0f766e` is dark and needs light text, dark accent `#43c0af` is light and needs dark text. Added as a themed role (`#f2f7f6` light, `#111113` dark), taking the light value from the dashboard's `--tt-hero-text`.

### Task order rationale

Dark mode is switched on in Task 6, **after** the control templates land in Tasks 3–5. Enabling it earlier would ship a build where dark mode is visibly broken (stock `TextBox` renders black-on-black). Every task below leaves the app shippable.

---

### Task 1: Theme dictionaries and the `DynamicResource` sweep

Replaces the placeholder palette with the teal roles and retargets every window at them. Light only — the swap arrives in Task 6.

**Files:**

- Create: `src/NiftyTimer/UI/Theme.Light.xaml`
- Create: `src/NiftyTimer/UI/Theme.Dark.xaml`
- Modify: `src/NiftyTimer/UI/Tokens.xaml` (full rewrite)
- Modify: `src/NiftyTimer/App.xaml`
- Modify: `src/NiftyTimer/UI/TrayPopupWindow.xaml`, `LoginWindow.xaml`, `AckWindow.xaml`, `TimePromptWindow.xaml`
- Modify: `tests/NiftyTimer.Tests/TimePromptTests.cs` (the `Wpf` helper at the bottom of the file)
- Test: `tests/NiftyTimer.Tests/ThemeTests.cs`

**Interfaces:**

- Consumes: nothing.
- Produces: resource keys used by every later task — brushes `Surface`, `SurfaceRaised`, `Separator`, `Text`, `TextSecondary`, `Neutral`, `Accent`, `AccentHover`, `OnAccent`, `Tint`, `Destructive`, `Recording`, `Good`, `Manual`, `MarkRemaining`, `MarkElapsed`; `CornerRadius` keys `RadiusSm`, `RadiusMd`, `RadiusLg`; `TextBlock` styles `CaptionText`, `BodyText`, `ElapsedText` (renamed in Task 2).

- [ ] **Step 1: Write the failing tests**

Create `tests/NiftyTimer.Tests/ThemeTests.cs`:

```csharp
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
    public void NoThemedBrushIsBoundWithStaticResource(string file)
    {
        var xaml = File.ReadAllText(Path.Combine(UiDirectory(), file));

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test tests/NiftyTimer.Tests --filter "FullyQualifiedName~Theme"`

Expected: FAIL. `ThemeDictionaryTests` throws because `Theme.Light.xaml` does not exist; `ThemeSweepTests` fails on `TrayPopupWindow.xaml` — it currently binds `{StaticResource SurfaceBrush}`, which does not match a role name yet, so this test will actually **pass** at first. That is expected and fine: it becomes meaningful the moment Step 4 renames the keys, and it is the rename that it guards.

- [ ] **Step 3: Create the two theme dictionaries**

`src/NiftyTimer/UI/Theme.Light.xaml`:

```xml
<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">

    <!-- Values are the dashboard's :root block in apps/dashboard/src/app/globals.css, role for
         role. Keep the two in step: a colour that exists here and not there is drift. -->
    <SolidColorBrush x:Key="Surface"       Color="#FFF6F6F4" />
    <SolidColorBrush x:Key="SurfaceRaised" Color="#FFFFFFFF" />
    <SolidColorBrush x:Key="Separator"     Color="#FFEAE9E5" />
    <SolidColorBrush x:Key="Text"          Color="#FF191917" />
    <SolidColorBrush x:Key="TextSecondary" Color="#FF73726C" />
    <SolidColorBrush x:Key="Neutral"       Color="#FFA4A39D" />
    <SolidColorBrush x:Key="Accent"        Color="#FF0F766E" />
    <SolidColorBrush x:Key="AccentHover"   Color="#FF0D5F59" />
    <SolidColorBrush x:Key="Tint"          Color="#FFEDF3F2" />
    <SolidColorBrush x:Key="Destructive"   Color="#FFBB2020" />
    <SolidColorBrush x:Key="Recording"     Color="#FF0F766E" />
    <SolidColorBrush x:Key="Good"          Color="#FF15803D" />
    <SolidColorBrush x:Key="Manual"        Color="#FFB45309" />

    <!-- Text drawn ON an accent fill. Cannot be a fixed colour: the light accent is dark and the
         dark accent is light, so this flips with the theme while the accent does. Light value is
         the dashboard's --tt-hero-text. -->
    <SolidColorBrush x:Key="OnAccent"      Color="#FFF2F7F6" />

    <!-- The product mark's two arcs. IDENTICAL in both themes on purpose: the same two values are
         baked into the app artwork and the dashboard's icon.svg, and a file cannot follow a theme.
         Mirrors the note in globals.css and TimeTrackTokens.swift. -->
    <SolidColorBrush x:Key="MarkRemaining" Color="#FF3F7A72" />
    <SolidColorBrush x:Key="MarkElapsed"   Color="#FF7FD6C9" />

</ResourceDictionary>
```

`src/NiftyTimer/UI/Theme.Dark.xaml`:

```xml
<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">

    <!-- The dashboard's .dark block. Every key in Theme.Light.xaml must appear here — ThemeDictionaryTests
         fails the build otherwise. -->
    <SolidColorBrush x:Key="Surface"       Color="#FF111113" />
    <SolidColorBrush x:Key="SurfaceRaised" Color="#FF1A1A1D" />
    <SolidColorBrush x:Key="Separator"     Color="#FF28282C" />
    <SolidColorBrush x:Key="Text"          Color="#FFF1F1EF" />
    <SolidColorBrush x:Key="TextSecondary" Color="#FF9D9D97" />
    <SolidColorBrush x:Key="Neutral"       Color="#FF676762" />
    <SolidColorBrush x:Key="Accent"        Color="#FF43C0AF" />
    <SolidColorBrush x:Key="AccentHover"   Color="#FF6BD3C4" />
    <SolidColorBrush x:Key="Tint"          Color="#FF1D2725" />
    <SolidColorBrush x:Key="Destructive"   Color="#FFF47272" />
    <SolidColorBrush x:Key="Recording"     Color="#FF43C0AF" />
    <SolidColorBrush x:Key="Good"          Color="#FF4ADE80" />
    <SolidColorBrush x:Key="Manual"        Color="#FFFBBF24" />

    <!-- Dark accent is light, so text on it is the dark ground rather than the light one. -->
    <SolidColorBrush x:Key="OnAccent"      Color="#FF111113" />

    <SolidColorBrush x:Key="MarkRemaining" Color="#FF3F7A72" />
    <SolidColorBrush x:Key="MarkElapsed"   Color="#FF7FD6C9" />

</ResourceDictionary>
```

- [ ] **Step 4: Rewrite `Tokens.xaml` as the theme-independent layer**

Replace the entire contents of `src/NiftyTimer/UI/Tokens.xaml`:

```xml
<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">

    <!-- Everything here is theme-INDEPENDENT: radii and type. The colours live in
         Theme.Light.xaml / Theme.Dark.xaml, one of which is merged ahead of this file, and are
         reached through DynamicResource so a runtime swap reaches already-loaded windows.
         Radii are not themed, so StaticResource is correct for them. -->

    <CornerRadius x:Key="RadiusSm">6</CornerRadius>
    <CornerRadius x:Key="RadiusMd">11</CornerRadius>
    <CornerRadius x:Key="RadiusLg">20</CornerRadius>

    <Style x:Key="CaptionText" TargetType="TextBlock">
        <Setter Property="FontSize" Value="11" />
        <Setter Property="Foreground" Value="{DynamicResource TextSecondary}" />
    </Style>

    <Style x:Key="BodyText" TargetType="TextBlock">
        <Setter Property="FontSize" Value="13" />
        <Setter Property="Foreground" Value="{DynamicResource Text}" />
    </Style>

    <Style x:Key="ElapsedText" TargetType="TextBlock">
        <Setter Property="FontSize" Value="26" />
        <Setter Property="FontFamily" Value="Consolas, Segoe UI" />
        <Setter Property="Foreground" Value="{DynamicResource Text}" />
    </Style>

</ResourceDictionary>
```

The three type styles keep their current names, sizes and the `Consolas` family for now so this task changes colour only. Task 2 replaces them.

- [ ] **Step 5: Update `App.xaml` merge order**

Replace the `MergedDictionaries` block in `src/NiftyTimer/App.xaml`:

```xml
<Application.Resources>
    <ResourceDictionary>
        <ResourceDictionary.MergedDictionaries>
            <!-- INDEX 0 IS THE THEME and is swapped wholesale at runtime by ThemeWatcher
                 (Task 6). Anything merged after it may reference its keys, but only through
                 DynamicResource — a StaticResource binding would survive the swap holding the
                 old brush. Do not insert a dictionary ahead of this one. -->
            <ResourceDictionary Source="UI/Theme.Light.xaml" />
            <ResourceDictionary Source="UI/Tokens.xaml" />
        </ResourceDictionary.MergedDictionaries>
    </ResourceDictionary>
</Application.Resources>
```

- [ ] **Step 6: Update the `Wpf` test helper to load the same dictionaries**

In `tests/NiftyTimer.Tests/TimePromptTests.cs`, in `Wpf.Start()`, replace the single `MergedDictionaries.Add(...)` call with both dictionaries in `App.xaml` order:

```csharp
// The windows resolve brushes through the theme dictionary and styles through Tokens, so both
// have to be loaded exactly as App.xaml loads them at runtime — same order, theme first.
foreach (var source in new[] { "UI/Theme.Light.xaml", "UI/Tokens.xaml" })
{
    application.Resources.MergedDictionaries.Add(new ResourceDictionary
    {
        Source = new Uri($"pack://application:,,,/NiftyTimer;component/{source}", UriKind.Absolute),
    });
}
```

Without this every existing WPF test fails at window construction with a missing-resource exception.

- [ ] **Step 7: Retarget the four windows**

Apply these replacements across `TrayPopupWindow.xaml`, `LoginWindow.xaml`, `AckWindow.xaml`, `TimePromptWindow.xaml`:

| Find                                  | Replace with                        |
| ------------------------------------- | ----------------------------------- |
| `{StaticResource SurfaceBrush}`       | `{DynamicResource SurfaceRaised}`   |
| `{StaticResource BorderBrushSubtle}`  | `{DynamicResource Separator}`       |
| `{StaticResource TextPrimaryBrush}`   | `{DynamicResource Text}`            |
| `{StaticResource TextSecondaryBrush}` | `{DynamicResource TextSecondary}`   |
| `{StaticResource WarningBrush}`       | `{DynamicResource Manual}`          |
| `{StaticResource AccentBrush}`        | _(no occurrences — key is dropped)_ |

`{StaticResource CaptionText}`, `{StaticResource BodyText}` and `{StaticResource ElapsedText}` are **style** references and stay `StaticResource`.

Then give the three windows that have no explicit background one, so they do not inherit the system white in dark mode. On `LoginWindow`, `AckWindow` and `TimePromptWindow`, add to the `<Window>` element:

```xml
Background="{DynamicResource Surface}"
```

Leave `TrayPopupWindow`'s `Background="Transparent"` alone — Task 7 handles it.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `dotnet test tests/NiftyTimer.Tests --filter "FullyQualifiedName~Theme"`
Expected: PASS — 5 `ThemeSweepTests` cases and 1 `ThemeDictionaryTests` case.

Run: `dotnet test tests/NiftyTimer.Tests`
Expected: PASS — the whole suite, confirming Step 6 kept the existing WPF tests green.

Run: `dotnet build NiftyTimer.sln -c Release`
Expected: succeeds with zero warnings.

- [ ] **Step 9: Look at it**

Run: `dotnet run --project src/NiftyTimer/NiftyTimer.csproj`

Open the tray popup. It should be teal-and-warm rather than green-and-white. Controls are still stock — that is expected until Task 3. Nothing should be unreadable.

- [ ] **Step 10: Commit**

```bash
git add src/NiftyTimer/UI/Theme.Light.xaml src/NiftyTimer/UI/Theme.Dark.xaml \
        src/NiftyTimer/UI/Tokens.xaml src/NiftyTimer/App.xaml \
        src/NiftyTimer/UI/TrayPopupWindow.xaml src/NiftyTimer/UI/LoginWindow.xaml \
        src/NiftyTimer/UI/AckWindow.xaml src/NiftyTimer/UI/TimePromptWindow.xaml \
        tests/NiftyTimer.Tests/TimePromptTests.cs tests/NiftyTimer.Tests/ThemeTests.cs
git commit -m "refactor(client): replace the placeholder palette with themed tokens"
```

---

### Task 2: Type scale and tabular digits

Drops `Consolas` and moves to the dashboard's type scale.

**Files:**

- Modify: `src/NiftyTimer/UI/Tokens.xaml`
- Modify: `src/NiftyTimer/UI/TrayPopupWindow.xaml`, `LoginWindow.xaml`, `AckWindow.xaml`, `TimePromptWindow.xaml`
- Test: `tests/NiftyTimer.Tests/ThemeTests.cs`

**Interfaces:**

- Consumes: Task 1's `Text` / `TextSecondary` brushes.
- Produces: `TextBlock` styles `MicroText` (11), `CaptionText` (12), `LabelText` (13), `BodyText` (15), `HeadingText` (19), `ElapsedText` (34, tabular). `CaptionText` and `BodyText` keep their names but change size; `ElapsedText` keeps its name.

- [ ] **Step 1: Write the failing test**

Append to `tests/NiftyTimer.Tests/ThemeTests.cs`:

```csharp
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test tests/NiftyTimer.Tests --filter "FullyQualifiedName~TypeTests"`
Expected: FAIL — `Assert.DoesNotContain() Failure` on "Consolas".

- [ ] **Step 3: Replace the type styles in `Tokens.xaml`**

Replace the three `Style` elements (keep the `CornerRadius` block above them):

```xml
    <!-- Segoe UI Variable, mapped to the dashboard's scale. Only the steps these four windows
         actually use are here — the dashboard's h1 and 52px display have no counterpart in a
         tray popup, and an unused step is a token waiting to drift.

         Segoe UI Variable Text is the optical size Microsoft intends below ~18px; the fallback
         chain keeps Windows 10, which does not ship it, on plain Segoe UI. -->
    <FontFamily x:Key="UiFont">Segoe UI Variable Text, Segoe UI</FontFamily>

    <Style x:Key="MicroText" TargetType="TextBlock">
        <Setter Property="FontFamily" Value="{StaticResource UiFont}" />
        <Setter Property="FontSize" Value="11" />
        <Setter Property="Foreground" Value="{DynamicResource TextSecondary}" />
    </Style>

    <Style x:Key="CaptionText" TargetType="TextBlock">
        <Setter Property="FontFamily" Value="{StaticResource UiFont}" />
        <Setter Property="FontSize" Value="12" />
        <Setter Property="Foreground" Value="{DynamicResource TextSecondary}" />
    </Style>

    <Style x:Key="LabelText" TargetType="TextBlock">
        <Setter Property="FontFamily" Value="{StaticResource UiFont}" />
        <Setter Property="FontSize" Value="13" />
        <Setter Property="Foreground" Value="{DynamicResource Text}" />
    </Style>

    <Style x:Key="BodyText" TargetType="TextBlock">
        <Setter Property="FontFamily" Value="{StaticResource UiFont}" />
        <Setter Property="FontSize" Value="15" />
        <Setter Property="Foreground" Value="{DynamicResource Text}" />
    </Style>

    <Style x:Key="HeadingText" TargetType="TextBlock">
        <Setter Property="FontFamily" Value="{StaticResource UiFont}" />
        <Setter Property="FontSize" Value="19" />
        <Setter Property="FontWeight" Value="SemiBold" />
        <Setter Property="Foreground" Value="{DynamicResource Text}" />
    </Style>

    <!-- Tabular so the seconds column does not shift the whole string every tick. Applies to
         every duration, total and timestamp — not only this style. -->
    <Style x:Key="ElapsedText" TargetType="TextBlock">
        <Setter Property="FontFamily" Value="{StaticResource UiFont}" />
        <Setter Property="FontSize" Value="34" />
        <Setter Property="FontWeight" Value="Light" />
        <Setter Property="Foreground" Value="{DynamicResource Text}" />
        <Setter Property="Typography.NumeralAlignment" Value="Tabular" />
    </Style>

    <!-- The numeric role for anything smaller than the hero timer: today/week/month totals. -->
    <Style x:Key="NumericText" TargetType="TextBlock" BasedOn="{StaticResource LabelText}">
        <Setter Property="FontWeight" Value="SemiBold" />
        <Setter Property="Typography.NumeralAlignment" Value="Tabular" />
    </Style>
```

- [ ] **Step 4: Point the three totals at `NumericText`**

In `TrayPopupWindow.xaml`, change the three totals values (and only those three) from `BodyText`:

```xml
<TextBlock x:Name="TodayLabel" Style="{StaticResource NumericText}" />
<TextBlock x:Name="WeekLabel" Style="{StaticResource NumericText}" />
<TextBlock x:Name="MonthLabel" Style="{StaticResource NumericText}" />
```

In `LoginWindow.xaml` and `AckWindow.xaml`, the two headings currently spell their size inline as `Style="{StaticResource BodyText}" FontSize="16"`. Replace both with `Style="{StaticResource HeadingText}"` and drop the inline `FontSize`.

In `TimePromptWindow.xaml`, the title is `Style="{StaticResource BodyText}" FontSize="17" FontWeight="SemiBold"`. Replace with `Style="{StaticResource HeadingText}"` and drop both inline setters.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `dotnet test tests/NiftyTimer.Tests`
Expected: PASS, whole suite.

Run: `dotnet build NiftyTimer.sln -c Release`
Expected: succeeds, zero warnings.

- [ ] **Step 6: Look at it**

Run: `dotnet run --project src/NiftyTimer/NiftyTimer.csproj`

Start the timer and watch the elapsed label tick. The digits must not shuffle horizontally as the seconds change — that is the tabular check, and it is the one thing this task exists to fix.

- [ ] **Step 7: Commit**

```bash
git add src/NiftyTimer/UI/Tokens.xaml src/NiftyTimer/UI/TrayPopupWindow.xaml \
        src/NiftyTimer/UI/LoginWindow.xaml src/NiftyTimer/UI/AckWindow.xaml \
        src/NiftyTimer/UI/TimePromptWindow.xaml tests/NiftyTimer.Tests/ThemeTests.cs
git commit -m "refactor(client): adopt the shared type scale and tabular digits"
```

---

### Task 3: Button templates

Three variants replacing the stock push button. This is the single largest visible change in the PR.

**Files:**

- Create: `src/NiftyTimer/UI/Styles.xaml`
- Modify: `src/NiftyTimer/App.xaml`
- Modify: `tests/NiftyTimer.Tests/TimePromptTests.cs` (`Wpf.Start()`)
- Modify: `src/NiftyTimer/UI/TrayPopupWindow.xaml`, `LoginWindow.xaml`, `AckWindow.xaml`, `TimePromptWindow.xaml`

**Interfaces:**

- Consumes: Task 1's brushes, Task 2's `UiFont`, `RadiusSm`.
- Produces: `Button` styles `BorderedButton` (also the implicit default), `ProminentButton`, `LinkButton`.

- [ ] **Step 1: Create `Styles.xaml` with the three button styles**

`src/NiftyTimer/UI/Styles.xaml`:

```xml
<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">

    <!-- Templates for the stock controls. Stock WPF chrome is Aero-era grey regardless of which
         brushes are bound to it, so recolouring alone does not change how the client reads —
         these do.

         The controls are TEMPLATED, never replaced with custom types: templating keeps WPF's
         keyboard handling, access keys, automation peers and IsDefault behaviour, all of which a
         hand-rolled control would have to reimplement. TimePromptTests casts a named element to
         System.Windows.Controls.Button and would fail if that stopped being true. -->

    <!-- Focus ring. Matches the dashboard's :focus-visible — 2px accent, 2px offset — instead of
         WPF's dotted rectangle. -->
    <Style x:Key="AccentFocusVisual">
        <Setter Property="Control.Template">
            <Setter.Value>
                <ControlTemplate>
                    <Rectangle Margin="-2"
                               RadiusX="6" RadiusY="6"
                               Stroke="{DynamicResource Accent}"
                               StrokeThickness="2"
                               SnapsToDevicePixels="True" />
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>

    <!-- The default. Matches the macOS client's .bordered: outlined, quiet, safe to repeat. -->
    <Style x:Key="BorderedButton" TargetType="Button">
        <Setter Property="FontFamily" Value="{StaticResource UiFont}" />
        <Setter Property="FontSize" Value="13" />
        <Setter Property="Foreground" Value="{DynamicResource Text}" />
        <Setter Property="Background" Value="{DynamicResource SurfaceRaised}" />
        <Setter Property="BorderBrush" Value="{DynamicResource Separator}" />
        <Setter Property="Padding" Value="12,6" />
        <Setter Property="Cursor" Value="Hand" />
        <Setter Property="SnapsToDevicePixels" Value="True" />
        <Setter Property="FocusVisualStyle" Value="{StaticResource AccentFocusVisual}" />
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="Button">
                    <Border x:Name="Chrome"
                            Background="{TemplateBinding Background}"
                            BorderBrush="{TemplateBinding BorderBrush}"
                            BorderThickness="1"
                            CornerRadius="{StaticResource RadiusSm}"
                            Padding="{TemplateBinding Padding}">
                        <ContentPresenter HorizontalAlignment="Center"
                                          VerticalAlignment="Center"
                                          RecognizesAccessKey="True" />
                    </Border>
                    <ControlTemplate.Triggers>
                        <Trigger Property="IsMouseOver" Value="True">
                            <Setter TargetName="Chrome" Property="Background" Value="{DynamicResource Tint}" />
                        </Trigger>
                        <Trigger Property="IsPressed" Value="True">
                            <Setter TargetName="Chrome" Property="Background" Value="{DynamicResource Tint}" />
                            <Setter TargetName="Chrome" Property="BorderBrush" Value="{DynamicResource Accent}" />
                        </Trigger>
                        <!-- Opacity rather than a grey brush: it degrades correctly in both themes
                             and needs no fourth colour that neither the dashboard nor the Mac
                             client has a role for. -->
                        <Trigger Property="IsEnabled" Value="False">
                            <Setter TargetName="Chrome" Property="Opacity" Value="0.45" />
                        </Trigger>
                    </ControlTemplate.Triggers>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>

    <!-- Every un-keyed Button picks this up, so the existing windows restyle with no markup
         change. The two calls to action opt into ProminentButton explicitly. -->
    <Style TargetType="Button" BasedOn="{StaticResource BorderedButton}" />

    <!-- The macOS client's .borderedProminent: accent fill, one per view. -->
    <Style x:Key="ProminentButton" TargetType="Button" BasedOn="{StaticResource BorderedButton}">
        <Setter Property="Foreground" Value="{DynamicResource OnAccent}" />
        <Setter Property="Background" Value="{DynamicResource Accent}" />
        <Setter Property="BorderBrush" Value="{DynamicResource Accent}" />
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="Button">
                    <Border x:Name="Chrome"
                            Background="{TemplateBinding Background}"
                            BorderBrush="{TemplateBinding BorderBrush}"
                            BorderThickness="1"
                            CornerRadius="{StaticResource RadiusSm}"
                            Padding="{TemplateBinding Padding}">
                        <ContentPresenter HorizontalAlignment="Center"
                                          VerticalAlignment="Center"
                                          RecognizesAccessKey="True" />
                    </Border>
                    <ControlTemplate.Triggers>
                        <Trigger Property="IsMouseOver" Value="True">
                            <Setter TargetName="Chrome" Property="Background" Value="{DynamicResource AccentHover}" />
                            <Setter TargetName="Chrome" Property="BorderBrush" Value="{DynamicResource AccentHover}" />
                        </Trigger>
                        <Trigger Property="IsPressed" Value="True">
                            <Setter TargetName="Chrome" Property="Opacity" Value="0.85" />
                        </Trigger>
                        <Trigger Property="IsEnabled" Value="False">
                            <Setter TargetName="Chrome" Property="Opacity" Value="0.45" />
                        </Trigger>
                    </ControlTemplate.Triggers>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>

    <!-- The macOS client's .link, for the footer row. Chrome-less: these are navigation and
         session actions, not the thing the popup is for. -->
    <Style x:Key="LinkButton" TargetType="Button">
        <Setter Property="FontFamily" Value="{StaticResource UiFont}" />
        <Setter Property="FontSize" Value="12" />
        <Setter Property="Foreground" Value="{DynamicResource Accent}" />
        <Setter Property="Background" Value="Transparent" />
        <Setter Property="Padding" Value="0" />
        <Setter Property="Cursor" Value="Hand" />
        <Setter Property="FocusVisualStyle" Value="{StaticResource AccentFocusVisual}" />
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="Button">
                    <Border Background="Transparent" Padding="{TemplateBinding Padding}">
                        <ContentPresenter x:Name="Label"
                                          HorizontalAlignment="Center"
                                          VerticalAlignment="Center"
                                          RecognizesAccessKey="True"
                                          TextBlock.Foreground="{TemplateBinding Foreground}" />
                    </Border>
                    <ControlTemplate.Triggers>
                        <Trigger Property="IsMouseOver" Value="True">
                            <Setter TargetName="Label" Property="TextBlock.Foreground" Value="{DynamicResource AccentHover}" />
                        </Trigger>
                        <Trigger Property="IsEnabled" Value="False">
                            <Setter TargetName="Label" Property="Opacity" Value="0.45" />
                        </Trigger>
                    </ControlTemplate.Triggers>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>

</ResourceDictionary>
```

- [ ] **Step 2: Merge `Styles.xaml` in both places**

In `src/NiftyTimer/App.xaml`, add after `Tokens.xaml`:

```xml
            <ResourceDictionary Source="UI/Styles.xaml" />
```

In `tests/NiftyTimer.Tests/TimePromptTests.cs`, extend the array in `Wpf.Start()`:

```csharp
foreach (var source in new[] { "UI/Theme.Light.xaml", "UI/Tokens.xaml", "UI/Styles.xaml" })
```

- [ ] **Step 3: Opt the right buttons into the right variants**

Only `Style` attributes change; no button is added, removed or renamed.

`TrayPopupWindow.xaml` — the footer row and the update button become links:

```xml
<Button Content="My data" Style="{StaticResource LinkButton}" Click="OnOpenMyData"
        ToolTip="Opens everything recorded about you in the dashboard" />
<Button Content="Sign out" Style="{StaticResource LinkButton}" Margin="12,0,0,0" Click="OnSignOut" />
<Button Content="Quit" Style="{StaticResource LinkButton}" Margin="12,0,0,0" Click="OnQuit" />
```

`StartStopButton` becomes prominent; `PauseResumeButton` stays bordered (the default):

```xml
<Button x:Name="StartStopButton" Content="Start" Width="92" Style="{StaticResource ProminentButton}" Click="OnStartStop" />
```

`LoginWindow.xaml` — `SignInButton` is the one call to action:

```xml
<Button x:Name="SignInButton" Content="Sign in" Style="{StaticResource ProminentButton}" Click="OnSignIn" IsDefault="True" />
```

`AckWindow.xaml` — `AcknowledgeButton` is prominent; **"Not now" stays a visible, ordinary button.** It is the only non-acknowledging exit and must not be demoted to a link or hidden (CLAUDE.md §1).

`TimePromptWindow.xaml` — leave both buttons on the default bordered style. Neither Keep nor Discard is the "safe" one in both prompts, and the default button already carries that distinction via `IsDefault`; making one prominent would contradict the other prompt's default.

- [ ] **Step 4: Run the tests**

Run: `dotnet test tests/NiftyTimer.Tests`
Expected: PASS. Watch `TimePromptTests` in particular — it resolves `KeepButton` by name and casts it to `Button`, which templating preserves.

Run: `dotnet build NiftyTimer.sln -c Release`
Expected: succeeds, zero warnings.

- [ ] **Step 5: Look at it**

Run: `dotnet run --project src/NiftyTimer/NiftyTimer.csproj`

Check hover and pressed states on all three variants, and Tab through the popup to confirm the focus ring is the accent rectangle rather than a dotted box.

- [ ] **Step 6: Commit**

```bash
git add src/NiftyTimer/UI/Styles.xaml src/NiftyTimer/App.xaml \
        src/NiftyTimer/UI/TrayPopupWindow.xaml src/NiftyTimer/UI/LoginWindow.xaml \
        src/NiftyTimer/UI/AckWindow.xaml tests/NiftyTimer.Tests/TimePromptTests.cs
git commit -m "feat(client): template buttons into bordered, prominent and link variants"
```

---

### Task 4: Text input templates

**Files:**

- Modify: `src/NiftyTimer/UI/Styles.xaml`

**Interfaces:**

- Consumes: Task 1 brushes, Task 2 `UiFont`, Task 3's `AccentFocusVisual`.
- Produces: implicit styles for `TextBox`, `PasswordBox`, `ComboBox`.

- [ ] **Step 1: Add the input styles to `Styles.xaml`**

Append before `</ResourceDictionary>`:

```xml
    <!-- Recessed field on the quiet ground, the way the dashboard and the Mac client both draw
         inputs. The stock template's 3D border is the single most dated thing on these windows
         after the buttons. -->
    <Style x:Key="FieldChrome" TargetType="Control">
        <Setter Property="FontFamily" Value="{StaticResource UiFont}" />
        <Setter Property="FontSize" Value="13" />
        <Setter Property="Foreground" Value="{DynamicResource Text}" />
        <Setter Property="CaretBrush" Value="{DynamicResource Text}" />
        <Setter Property="Background" Value="{DynamicResource Surface}" />
        <Setter Property="BorderBrush" Value="{DynamicResource Separator}" />
        <Setter Property="BorderThickness" Value="1" />
        <Setter Property="Padding" Value="9,6" />
        <Setter Property="SnapsToDevicePixels" Value="True" />
    </Style>

    <Style TargetType="TextBox" BasedOn="{StaticResource FieldChrome}">
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="TextBox">
                    <Border x:Name="Chrome"
                            Background="{TemplateBinding Background}"
                            BorderBrush="{TemplateBinding BorderBrush}"
                            BorderThickness="{TemplateBinding BorderThickness}"
                            CornerRadius="{StaticResource RadiusSm}">
                        <!-- The host must be named PART_ContentHost; TextBox finds its editor by
                             that name and renders nothing without it. -->
                        <ScrollViewer x:Name="PART_ContentHost"
                                      Margin="{TemplateBinding Padding}"
                                      VerticalAlignment="Center"
                                      Focusable="False"
                                      HorizontalScrollBarVisibility="Hidden"
                                      VerticalScrollBarVisibility="Hidden" />
                    </Border>
                    <ControlTemplate.Triggers>
                        <Trigger Property="IsKeyboardFocusWithin" Value="True">
                            <Setter TargetName="Chrome" Property="BorderBrush" Value="{DynamicResource Accent}" />
                        </Trigger>
                        <Trigger Property="IsEnabled" Value="False">
                            <Setter TargetName="Chrome" Property="Opacity" Value="0.45" />
                        </Trigger>
                    </ControlTemplate.Triggers>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>

    <Style TargetType="PasswordBox" BasedOn="{StaticResource FieldChrome}">
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="PasswordBox">
                    <Border x:Name="Chrome"
                            Background="{TemplateBinding Background}"
                            BorderBrush="{TemplateBinding BorderBrush}"
                            BorderThickness="{TemplateBinding BorderThickness}"
                            CornerRadius="{StaticResource RadiusSm}">
                        <ScrollViewer x:Name="PART_ContentHost"
                                      Margin="{TemplateBinding Padding}"
                                      VerticalAlignment="Center"
                                      Focusable="False"
                                      HorizontalScrollBarVisibility="Hidden"
                                      VerticalScrollBarVisibility="Hidden" />
                    </Border>
                    <ControlTemplate.Triggers>
                        <Trigger Property="IsKeyboardFocusWithin" Value="True">
                            <Setter TargetName="Chrome" Property="BorderBrush" Value="{DynamicResource Accent}" />
                        </Trigger>
                        <Trigger Property="IsEnabled" Value="False">
                            <Setter TargetName="Chrome" Property="Opacity" Value="0.45" />
                        </Trigger>
                    </ControlTemplate.Triggers>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>

    <!-- DELIBERATELY MINIMAL. PR 2 deletes this ComboBox and replaces the picker with a search
         field over a list, so a full ToggleButton + Popup + ItemsPresenter template here would be
         written to be thrown away. This restyles the field and the dropdown surface — which is
         what reads as dated — and leaves the toggle glyph stock.
         Do not invest further in it; move the effort to PR 2's picker. -->
    <Style TargetType="ComboBox" BasedOn="{StaticResource FieldChrome}">
        <Setter Property="Padding" Value="6,4" />
    </Style>

    <Style TargetType="ComboBoxItem">
        <Setter Property="FontFamily" Value="{StaticResource UiFont}" />
        <Setter Property="FontSize" Value="13" />
        <Setter Property="Foreground" Value="{DynamicResource Text}" />
        <Setter Property="Background" Value="{DynamicResource SurfaceRaised}" />
        <Setter Property="Padding" Value="8,6" />
    </Style>
```

- [ ] **Step 2: Run the tests**

Run: `dotnet test tests/NiftyTimer.Tests`
Expected: PASS.

Run: `dotnet build NiftyTimer.sln -c Release`
Expected: succeeds, zero warnings.

- [ ] **Step 3: Look at it**

Run: `dotnet run --project src/NiftyTimer/NiftyTimer.csproj`

Type in the note field and confirm the caret is visible and the border turns accent on focus. Sign out and check the password field on `LoginWindow` behaves the same — `PasswordBox` has its own template and is easy to leave behind.

- [ ] **Step 4: Commit**

```bash
git add src/NiftyTimer/UI/Styles.xaml
git commit -m "feat(client): template the text inputs onto the recessed field chrome"
```

---

### Task 5: Scrollbar template

**Files:**

- Modify: `src/NiftyTimer/UI/Styles.xaml`

**Interfaces:**

- Consumes: Task 1's `Neutral`, `TextSecondary`.
- Produces: implicit `ScrollBar` style.

- [ ] **Step 1: Add the scrollbar style to `Styles.xaml`**

Append before `</ResourceDictionary>`:

```xml
    <!-- Thin, no stepper arrows, thumb only. Stock WPF scrollbars are the most recognisable
         un-designed element left once the buttons and fields are templated; AckWindow's policy
         text and PR 2's picker list are both scrollable, so this is visible on real surfaces. -->
    <Style x:Key="ScrollThumb" TargetType="Thumb">
        <Setter Property="IsTabStop" Value="False" />
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="Thumb">
                    <Border x:Name="Bar"
                            Background="{DynamicResource Neutral}"
                            CornerRadius="3"
                            Margin="3,0" />
                    <ControlTemplate.Triggers>
                        <Trigger Property="IsMouseOver" Value="True">
                            <Setter TargetName="Bar" Property="Background" Value="{DynamicResource TextSecondary}" />
                        </Trigger>
                    </ControlTemplate.Triggers>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>

    <Style TargetType="ScrollBar">
        <Setter Property="Background" Value="Transparent" />
        <Setter Property="Width" Value="10" />
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="ScrollBar">
                    <Grid Background="{TemplateBinding Background}">
                        <!-- Track must be named PART_Track; ScrollBar drives the thumb through it
                             and the control is inert without it. No RepeatButtons: the stepper
                             arrows are the dated part, and dragging plus the wheel cover the
                             behaviour they provided. -->
                        <Track x:Name="PART_Track" IsDirectionReversed="True">
                            <Track.Thumb>
                                <Thumb Style="{StaticResource ScrollThumb}" />
                            </Track.Thumb>
                        </Track>
                    </Grid>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
        <Style.Triggers>
            <Trigger Property="Orientation" Value="Horizontal">
                <Setter Property="Width" Value="Auto" />
                <Setter Property="Height" Value="10" />
            </Trigger>
        </Style.Triggers>
    </Style>
```

- [ ] **Step 2: Run the tests**

Run: `dotnet test tests/NiftyTimer.Tests`
Expected: PASS.

Run: `dotnet build NiftyTimer.sln -c Release`
Expected: succeeds, zero warnings.

- [ ] **Step 3: Look at it**

Run: `dotnet run --project src/NiftyTimer/NiftyTimer.csproj`

`AckWindow` is the surface with a real scrollbar — the policy text is in a `ScrollViewer`. Sign out and back in to reach it, or shrink the window until the text overflows. Confirm the thumb drags and the mouse wheel still scrolls.

- [ ] **Step 4: Commit**

```bash
git add src/NiftyTimer/UI/Styles.xaml
git commit -m "feat(client): template the scrollbar down to a thumb"
```

---

### Task 6: Theme detection and the live swap

Dark mode switches on here, after the templates that make it look right.

**Files:**

- Create: `src/NiftyTimer/UI/AppTheme.cs`
- Create: `src/NiftyTimer/UI/ThemeWatcher.cs`
- Modify: `src/NiftyTimer/App.xaml.cs`
- Test: `tests/NiftyTimer.Tests/ThemeTests.cs`

**Interfaces:**

- Consumes: Task 1's two theme dictionaries; `NiftyTimer.App.IMessageHost` and `MessageWindowHost` from `src/NiftyTimer/App/MessageWindow.cs`.
- Produces: `enum AppTheme { Light, Dark }`; `static AppTheme ThemeResolver.Resolve(int? appsUseLightTheme)`; `static AppTheme ThemeResolver.FromRegistry()`; `sealed class ThemeWatcher : IDisposable` with `ThemeWatcher(Func<AppTheme> read, Action<AppTheme> apply, Func<HwndSourceHook, IMessageHost> host)`, property `AppTheme Current`, and `internal void OnSettingChange()`; `static void ThemeWatcher.ApplyToApplication(AppTheme theme)`.

- [ ] **Step 1: Write the failing tests**

Add these three to the `using` block at the **top** of `tests/NiftyTimer.Tests/ThemeTests.cs` (C# rejects them mid-file):

```csharp
using System.Windows.Interop;
using NiftyTimer.App;
using NiftyTimer.UI;
```

Then append the test classes to the end of the same file:

```csharp
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test tests/NiftyTimer.Tests --filter "FullyQualifiedName~Theme"`
Expected: FAIL to compile — `AppTheme`, `ThemeResolver` and `ThemeWatcher` do not exist.

- [ ] **Step 3: Create `AppTheme.cs`**

`src/NiftyTimer/UI/AppTheme.cs`:

```csharp
using Microsoft.Win32;

namespace NiftyTimer.UI;

/// <summary>Which appearance the shell is using.</summary>
public enum AppTheme
{
    Light,
    Dark,
}

/// <summary>
/// Reads the shell's app appearance. Split from <see cref="ThemeWatcher"/> so the tri-state
/// reading — and specifically what an ABSENT value means — is testable without a registry.
/// </summary>
public static class ThemeResolver
{
    private const string PersonalizeKey =
        @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

    /// <summary>
    /// 1 is light, 0 is dark. Anything else — including the value being absent, which is the case
    /// on an install that has never opened the personalisation page — is light, because light is
    /// the Windows default and guessing dark would paint the app against a light desktop.
    /// </summary>
    public static AppTheme Resolve(int? appsUseLightTheme) =>
        appsUseLightTheme == 0 ? AppTheme.Dark : AppTheme.Light;

    public static AppTheme FromRegistry() =>
        Resolve(Registry.GetValue(PersonalizeKey, "AppsUseLightTheme", null) as int?);
}
```

- [ ] **Step 4: Create `ThemeWatcher.cs`**

`src/NiftyTimer/UI/ThemeWatcher.cs`:

```csharp
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using NiftyTimer.App;

namespace NiftyTimer.UI;

/// <summary>
/// Keeps the merged theme dictionary in step with the shell's appearance.
///
/// The signal is <c>WM_SETTINGCHANGE</c> with an lParam of "ImmersiveColorSet", delivered to the
/// same kind of hidden top-level window the tray icon already uses. That choice is deliberate over
/// <c>SystemEvents.UserPreferenceChanged</c>: SystemEvents raises its callbacks on its own thread,
/// so every handler has to marshal to the dispatcher before touching
/// <see cref="Application.Resources"/> or it throws — whereas a window procedure already runs on
/// the UI thread. <see cref="MessageWindow"/> is top-level rather than message-only precisely so
/// broadcasts like this one reach it.
/// </summary>
public sealed class ThemeWatcher : IDisposable
{
    private const int WmSettingChange = 0x001A;

    private readonly Func<AppTheme> _read;
    private readonly Action<AppTheme> _apply;
    private readonly IMessageHost _host;

    private bool _disposed;

    public ThemeWatcher(
        Func<AppTheme> read,
        Action<AppTheme> apply,
        Func<HwndSourceHook, IMessageHost> host)
    {
        _read = read;
        _apply = apply;
        _host = host(Hook);

        Current = _read();
        _apply(Current);
    }

    /// <summary>The production wiring: real registry, real window, real dictionary swap.</summary>
    public ThemeWatcher()
        : this(
            ThemeResolver.FromRegistry,
            ApplyToApplication,
            hook => new MessageWindowHost("NiftyTimer.ThemeHost", hook))
    {
    }

    public AppTheme Current { get; private set; }

    /// <summary>
    /// Swap the dictionary at index 0. Everything downstream reaches these brushes through
    /// DynamicResource, so already-constructed windows re-resolve — which is the whole point,
    /// because the tray popup is built once and never rebuilt.
    /// </summary>
    public static void ApplyToApplication(AppTheme theme)
    {
        var name = theme == AppTheme.Dark ? "Theme.Dark" : "Theme.Light";

        Application.Current.Resources.MergedDictionaries[0] = new ResourceDictionary
        {
            Source = new Uri(
                $"pack://application:,,,/NiftyTimer;component/UI/{name}.xaml",
                UriKind.Absolute),
        };
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _host.Dispose();
    }

    /// <summary>
    /// Re-read and apply, but only on a real change. WM_SETTINGCHANGE also fires for DPI, locale
    /// and accessibility changes; re-merging the dictionary on each of those would rebuild every
    /// brush in the app for nothing.
    /// </summary>
    internal void OnSettingChange()
    {
        var next = _read();
        if (next == Current)
        {
            return;
        }

        Current = next;
        _apply(next);
    }

    private IntPtr Hook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WmSettingChange && IsColorSetChange(lParam))
        {
            OnSettingChange();
        }

        return IntPtr.Zero;
    }

    private static bool IsColorSetChange(IntPtr lParam) =>
        lParam != IntPtr.Zero
        && string.Equals(
            Marshal.PtrToStringUni(lParam),
            "ImmersiveColorSet",
            StringComparison.Ordinal);
}
```

- [ ] **Step 5: Wire it into the application lifetime**

In `src/NiftyTimer/App.xaml.cs`, add the field and construct it in `OnStartup` **after** `base.OnStartup` (so `Application.Current.Resources` exists) and **before** `_delegate.Start()` (so the first window opens already themed). Dispose it in `OnExit`:

```csharp
using System.Windows;
using NiftyTimer.UI;

namespace NiftyTimer;

public partial class NiftyTimerApp : Application
{
    private App.AppDelegate? _delegate;
    private ThemeWatcher? _theme;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // Before the delegate starts, so the first window is drawn in the right theme rather than
        // flashing light and correcting itself.
        _theme = new ThemeWatcher();

        _delegate = new App.AppDelegate();
        _delegate.Start();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _theme?.Dispose();
        _delegate?.Dispose();
        base.OnExit(e);
    }
}
```

Keep the existing class doc comment above the type.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `dotnet test tests/NiftyTimer.Tests --filter "FullyQualifiedName~Theme"`
Expected: PASS — 4 `ThemeResolverTests` cases, 2 `ThemeWatcherTests` cases, plus Task 1's and 2's.

Run: `dotnet test tests/NiftyTimer.Tests`
Expected: PASS, whole suite.

Run: `dotnet build NiftyTimer.sln -c Release`
Expected: succeeds, zero warnings.

- [ ] **Step 7: Verify the swap by hand — this is the step the automated tests cannot do**

Run: `dotnet run --project src/NiftyTimer/NiftyTimer.csproj`

1. **Open the tray popup and leave it open.** Switch Windows to dark (Settings → Personalisation → Colours → Choose your mode → Dark). The popup must re-theme **while open**. If it stays light until reopened, a `{StaticResource}` reference survived the Task 1 sweep — find it, do not work around it.
2. Switch back to light with the popup still open.
3. Walk `LoginWindow`, `AckWindow` and a time prompt in dark. Nothing unreadable, no white panel.

- [ ] **Step 8: Commit**

```bash
git add src/NiftyTimer/UI/AppTheme.cs src/NiftyTimer/UI/ThemeWatcher.cs \
        src/NiftyTimer/App.xaml.cs tests/NiftyTimer.Tests/ThemeTests.cs
git commit -m "feat(client): follow the system light and dark appearance"
```

---

### Task 7: Tray popup corner change

**One atomic step.** The rounded card comes from three cooperating settings; changing any one alone ships something worse than today.

**Files:**

- Modify: `src/NiftyTimer/UI/TrayPopupWindow.xaml`
- Modify: `src/NiftyTimer/UI/TrayPopupWindow.xaml.cs`

**Interfaces:**

- Consumes: Task 1's `SurfaceRaised`, `Separator`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Make all three changes together**

In `TrayPopupWindow.xaml`, on the `<Window>` element: remove `AllowsTransparency="True"`, and change `Background="Transparent"` to `Background="{DynamicResource SurfaceRaised}"`. Keep `WindowStyle="None"`, `ResizeMode`, `ShowInTaskbar`, `Topmost`, `SizeToContent` and `Width` exactly as they are.

On the outer `<Border>`, set `CornerRadius="0"`. It stays for its padding and its 1px outline; the corners now come from the window manager.

In `TrayPopupWindow.xaml.cs`, add the interop and the hook. Put the `DllImport` with the other members at the bottom of the class:

```csharp
    /// <summary>
    /// Round the window through DWM instead of AllowsTransparency.
    ///
    /// AllowsTransparency is what produced the rounded card before, and it forces this window into
    /// SOFTWARE rendering — which degrades ClearType on the one surface in this client where text
    /// quality is the entire point. DWM rounds the real window with hardware rendering intact.
    ///
    /// The Border's own CornerRadius has to be 0 alongside this: DWM rounds the WINDOW, so a
    /// rounded Border inside a rounded window shows as a double edge.
    /// </summary>
    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);

        var preference = DwmWindowCornerPreferenceRound;
        var handle = new WindowInteropHelper(this).Handle;

        // Windows 10 has no such attribute and returns a failure HRESULT. Ignored on purpose:
        // square corners there is the accepted degradation, not an error worth surfacing.
        _ = DwmSetWindowAttribute(handle, DwmwaWindowCornerPreference, ref preference, sizeof(int));
    }

    private const int DwmwaWindowCornerPreference = 33;
    private const int DwmWindowCornerPreferenceRound = 2;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(
        IntPtr hwnd,
        int attribute,
        ref int value,
        int size);
```

Add `using System.Runtime.InteropServices;` and `using System.Windows.Interop;` to the file's using block.

- [ ] **Step 2: Build and test**

Run: `dotnet build NiftyTimer.sln -c Release`
Expected: succeeds, zero warnings.

Run: `dotnet test tests/NiftyTimer.Tests`
Expected: PASS.

- [ ] **Step 3: Verify appearance and position**

Run: `dotnet run --project src/NiftyTimer/NiftyTimer.csproj`

1. Open the popup. Corners are rounded once — no square window behind a rounded box, no double edge.
2. **Check the popup still sits flush against the tray.** `ShowNearTray` positions off `SystemParameters.WorkArea` and `ActualHeight`; that math was written against a transparent window and this is the moment a shift would appear.
3. Confirm in both themes, and confirm text looks crisper than before (this is the ClearType payoff).

- [ ] **Step 4: Commit**

```bash
git add src/NiftyTimer/UI/TrayPopupWindow.xaml src/NiftyTimer/UI/TrayPopupWindow.xaml.cs
git commit -m "fix(client): round the tray popup via DWM instead of transparency"
```

---

### Task 8: Theme-aware tray icons

The tray icon sits on the taskbar, whose background follows the system theme. A dark-on-dark icon is the most visible way this pass could fail.

**Files:**

- Modify: `scripts/generate-tray-icons.ps1`
- Create: `src/NiftyTimer/Resources/tray-idle-light.ico`, `tray-idle-dark.ico`, `tray-tracking-light.ico`, `tray-tracking-dark.ico` (generated)
- Delete: `src/NiftyTimer/Resources/tray-idle.ico`, `tray-tracking.ico`
- Modify: `src/NiftyTimer/NiftyTimer.csproj`
- Modify: `src/NiftyTimer/App/TrayIconController.cs`
- Modify: `scripts/package-app.ps1`
- Modify: whichever file constructs `TrayIconController` (find it in Step 4)

**Interfaces:**

- Consumes: `NiftyTimer.UI.AppTheme` from Task 6.
- Produces: `TrayIconController.Theme` settable property.

- [ ] **Step 1: Update the generator**

In `scripts/generate-tray-icons.ps1`, replace the two `New-TrayIcon` calls at the bottom:

```powershell
# Four icons, not two: the taskbar background follows the system theme, so each state needs a
# variant that is legible against it. The mark is DARK on a light taskbar and LIGHT on a dark one,
# which is why these are not simply the palette's light/dark values applied naively.
#
# Idle stays hollow and tracking stays filled — the two states must be distinguishable without
# relying on colour, which is also what keeps them legible for colour-blind users.

# Light theme: light taskbar, so draw dark.
New-TrayIcon -Path (Join-Path $outDir 'tray-idle-light.ico')     -R 0x73 -G 0x72 -B 0x6C -Hollow $true
New-TrayIcon -Path (Join-Path $outDir 'tray-tracking-light.ico') -R 0x0F -G 0x76 -B 0x6E

# Dark theme: dark taskbar, so draw light.
New-TrayIcon -Path (Join-Path $outDir 'tray-idle-dark.ico')      -R 0x9D -G 0x9D -B 0x97 -Hollow $true
New-TrayIcon -Path (Join-Path $outDir 'tray-tracking-dark.ico')  -R 0x43 -G 0xC0 -B 0xAF
```

- [ ] **Step 2: Generate and remove the old pair**

```bash
pwsh ./scripts/generate-tray-icons.ps1
rm src/NiftyTimer/Resources/tray-idle.ico src/NiftyTimer/Resources/tray-tracking.ico
```

Expected: four `wrote ...` lines.

- [ ] **Step 3: Update the csproj**

In `src/NiftyTimer/NiftyTimer.csproj`, replace the two `Content` entries with four. Keep the existing comment above them — the explicit-name rule is the point:

```xml
    <Content Include="Resources\tray-idle-light.ico">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </Content>
    <Content Include="Resources\tray-idle-dark.ico">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </Content>
    <Content Include="Resources\tray-tracking-light.ico">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </Content>
    <Content Include="Resources\tray-tracking-dark.ico">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </Content>
```

- [ ] **Step 4: Teach `TrayIconController` about the theme**

In `src/NiftyTimer/App/TrayIconController.cs`:

Add `using NiftyTimer.UI;` and change the icon dictionary to key on both axes:

```csharp
    private readonly Dictionary<(TrayState State, AppTheme Theme), IntPtr> _icons = [];
```

In the constructor, replace the two `LoadIcon` lines with four. All four load up front: the theme can change at any moment and the failure mode for a missing icon is no indicator at all, so it must surface at startup rather than on the first theme switch.

```csharp
        foreach (var (state, name) in new[]
                 {
                     (TrayState.Idle, "idle"),
                     (TrayState.Tracking, "tracking"),
                 })
        {
            foreach (var (theme, suffix) in new[]
                     {
                         (AppTheme.Light, "light"),
                         (AppTheme.Dark, "dark"),
                     })
            {
                _icons[(state, theme)] =
                    LoadIcon(Path.Combine(resourceDirectory, $"tray-{name}-{suffix}.ico"));
            }
        }
```

Add the property next to `State`, following the same shape:

```csharp
    /// <summary>
    /// Which taskbar background the icon has to read against. Set from the app's theme watcher; a
    /// dark mark on a dark taskbar is an indicator that is technically present and practically
    /// invisible, which PRD §4.2 does not allow.
    /// </summary>
    public AppTheme Theme
    {
        get => _theme;
        set
        {
            if (_theme == value)
            {
                return;
            }

            _theme = value;
            Update();
        }
    }
```

Add the backing field beside `_state`:

```csharp
    private AppTheme _theme = AppTheme.Light;
```

And in `NewData`, change the icon lookup:

```csharp
        hIcon = _icons.GetValueOrDefault((_state, _theme)),
```

- [ ] **Step 5: Feed the theme in at startup and on change**

`AppDelegate.cs:170` is the construction site. Add `using NiftyTimer.UI;` to the file, then set the theme immediately after construction so the very first icon drawn is the right one:

```csharp
        // ── The indicator comes first, and is never conditional. ─────────────────────────────
        _tray = new TrayIconController(Path.Combine(AppContext.BaseDirectory, "Resources"))
        {
            Theme = ThemeResolver.FromRegistry(),
        };
```

Then expose a way to keep it in step. Add to `AppDelegate`, near the other public members:

```csharp
    /// <summary>
    /// Follow the shell's appearance on the tray icon. Separate from the resource-dictionary swap
    /// because the icon is a file on a taskbar, not a brush in a window — the two happen to change
    /// together but are different mechanisms.
    /// </summary>
    public void ApplyTheme(AppTheme theme) => OnUi(() =>
    {
        if (_tray is not null)
        {
            _tray.Theme = theme;
        }
    });
```

In `src/NiftyTimer/App.xaml.cs`, construct the watcher with an apply callback that does both. The watcher itself stays ignorant of the tray — it swaps resources and nothing else; the composition happens here:

```csharp
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // A local, not the field: the field is nullable and the compiler's flow analysis does not
        // follow an assignment into a lambda, so capturing it would be CS8602 — and CS8602 is an
        // error here, not a warning.
        var appDelegate = new App.AppDelegate();
        _delegate = appDelegate;

        // The watcher applies once on construction, so the delegate must exist first or that very
        // first ApplyTheme lands on a null tray.
        _theme = new ThemeWatcher(
            ThemeResolver.FromRegistry,
            theme =>
            {
                ThemeWatcher.ApplyToApplication(theme);
                appDelegate.ApplyTheme(theme);
            },
            hook => new App.MessageWindowHost("NiftyTimer.ThemeHost", hook));

        appDelegate.Start();
    }
```

`AppDelegate._tray` is declared `= null!` and is genuinely null until `Start()` runs, which is why `ApplyTheme` guards it — the watcher's construction-time apply fires before the tray exists.

This replaces the parameterless `new ThemeWatcher()` call added in Task 6 Step 5. The parameterless constructor stays on the type — it is what the tests and any future non-tray caller use.

- [ ] **Step 6: Update the packaging script and its contract test**

`scripts/package-app.ps1:77` copies the icons by explicit name. Replace the array:

```powershell
foreach ($icon in @('tray-idle-light.ico', 'tray-idle-dark.ico', 'tray-tracking-light.ico', 'tray-tracking-dark.ico')) {
```

Leave the surrounding `throw` and the comment above it unchanged — the explicit-name rule and its reason both still hold, with twice as many files to lose.

`PackagingContractTests.cs:77-78` asserts on the old names and **will fail** until updated. Replace both assertions:

```csharp
        foreach (var icon in new[]
                 {
                     "tray-idle-light.ico", "tray-idle-dark.ico",
                     "tray-tracking-light.ico", "tray-tracking-dark.ico",
                 })
        {
            Assert.Contains(icon, script, StringComparison.Ordinal);
        }
```

- [ ] **Step 7: Build and test**

Run: `dotnet build NiftyTimer.sln -c Release`
Expected: succeeds, zero warnings. A missing icon fails here, which is the intent of the explicit-name rule.

Run: `dotnet test tests/NiftyTimer.Tests`
Expected: PASS, whole suite.

Run: `pwsh ./scripts/package-app.ps1`
Expected: completes, and the four icons are present in the output directory.

- [ ] **Step 8: Verify against both taskbars**

Run: `dotnet run --project src/NiftyTimer/NiftyTimer.csproj`

1. In light mode, confirm both idle and tracking icons are legible on the taskbar.
2. Switch to dark **while the app runs** and confirm the icon changes and stays legible.
3. Start and stop tracking in each theme so all four icons are seen.

- [ ] **Step 9: Commit**

```bash
git add scripts/generate-tray-icons.ps1 scripts/package-app.ps1 \
        src/NiftyTimer/Resources src/NiftyTimer/NiftyTimer.csproj \
        src/NiftyTimer/App/TrayIconController.cs
git commit -m "feat(client): give the tray icon light and dark variants"
```

---

## Final verification before opening the PR

Per the spec: `dotnet build` is not verification for this work.

- [ ] `dotnet build NiftyTimer.sln -c Release` — succeeds, zero warnings
- [ ] `dotnet test tests/NiftyTimer.Tests` — whole suite green, output pasted into the PR
- [ ] From the repo root: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — green (the client is outside the pnpm graph, but the root gate is the checklist in CLAUDE.md §8)
- [ ] App runs; all four windows walked in **light**
- [ ] App runs; all four windows walked in **dark**
- [ ] Theme toggled **with the tray popup open** — it re-themes live
- [ ] Tray icon legible on both taskbars, in both tracking states
- [ ] Popup still sits flush against the tray after the transparency change
- [ ] No stock WPF chrome visible: no grey gradient buttons, no Aero scrollbars, no dotted focus rectangles
- [ ] Elapsed timer digits do not shuffle as seconds tick
- [ ] No window's structure changed — `git diff --stat` shows no added or removed controls
- [ ] `AckWindow` still has no way to dismiss without acknowledging; `NoticeLabel` still always visible
- [ ] Commit messages carry no AI attribution and the author is the repo's git user

If the app cannot be launched, say so plainly in the PR rather than reporting the build as the result.
