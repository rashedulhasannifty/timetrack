using System.Windows;
using NiftyTimer.Tracking;
using NiftyTimer.UI;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The latch behind both time prompts. Pure, because this is the part that can be wrong.
/// </summary>
public class OneShotResolutionTests
{
    [Fact]
    public void DeliversTheAnswerOnce()
    {
        var answers = new List<AwayResolution>();
        var resolution = new OneShotResolution(answers.Add);

        resolution.Deliver(AwayResolution.Keep);

        Assert.Equal([AwayResolution.Keep], answers);
        Assert.False(resolution.IsPending);
    }

    /// <summary>
    /// The one that matters: choosing Keep closes the window, and closing resolves to Discard. If
    /// the second delivery got through, every Keep would silently become a Discard.
    /// </summary>
    [Fact]
    public void ASecondAnswerCannotOverrideTheFirst()
    {
        var answers = new List<AwayResolution>();
        var resolution = new OneShotResolution(answers.Add);

        resolution.Deliver(AwayResolution.Keep);
        resolution.Deliver(AwayResolution.Discard);
        resolution.Deliver(AwayResolution.Discard);

        Assert.Equal([AwayResolution.Keep], answers);
    }

    [Fact]
    public void StartsPending()
    {
        Assert.True(new OneShotResolution(_ => { }).IsPending);
    }
}

/// <summary>
/// The real WPF prompt, driven on an STA thread. No display is needed — the windows are created
/// and closed, never shown — so this runs headless in CI exactly as it does locally.
///
/// Worth the setup cost because the alternative is the one part of this slice that cannot be
/// checked by hand: a prompt is only on screen for a few seconds, at a moment nobody plans, and
/// getting its default wrong loses real time silently.
/// </summary>
[Collection("wpf")]
public class TimePromptWindowTests
{
    /// <summary>
    /// Dismissing without choosing must resolve to Discard even for the recovery prompt, whose
    /// DEFAULT button is Keep. Default and dismissal are different questions: Enter should not
    /// throw away real work, but an ignored prompt must never invent time (PRD §6.1).
    /// </summary>
    [Fact]
    public void ClosingWithoutChoosingIsAlwaysADiscard()
    {
        var answers = Wpf.Run(() =>
        {
            var seen = new List<AwayResolution>();
            var window = new TimePromptWindow("Recover interrupted time?", 45, "…", AwayResolution.Keep, seen.Add);
            window.Close();
            return seen;
        });

        Assert.Equal([AwayResolution.Discard], answers);
    }

    [Fact]
    public void ChoosingKeepSurvivesTheWindowClosingBehindIt()
    {
        var answers = Wpf.Run(() =>
        {
            var seen = new List<AwayResolution>();
            var window = new TimePromptWindow("You were away", 12, "…", AwayResolution.Discard, seen.Add);
            window.Choose(AwayResolution.Keep);
            return seen;
        });

        Assert.Equal([AwayResolution.Keep], answers);
    }

    [Fact]
    public void TheDefaultButtonFollowsThePromptKind()
    {
        var (away, recovery) = Wpf.Run(() =>
        {
            var a = new TimePromptWindow("You were away", 12, "…", AwayResolution.Discard, _ => { });
            var r = new TimePromptWindow("Recover", 12, "…", AwayResolution.Keep, _ => { });
            var result = (Away: DefaultButtonOf(a), Recovery: DefaultButtonOf(r));
            a.Close();
            r.Close();
            return result;
        });

        Assert.Equal("Discard", away);
        Assert.Equal("Keep", recovery);
    }

    /// <summary>
    /// Dismissal on sign-out resolves to Discard, which is what closes the outgoing user's still-open
    /// server row. Silently dropping it would strand that row open forever, 409ing every future live
    /// entry for them.
    /// </summary>
    [Fact]
    public void DismissingAPresentedPromptResolvesToDiscard()
    {
        var answers = Wpf.Run(() =>
        {
            var seen = new List<AwayResolution>();
            var prompt = new TimePrompt();
            prompt.PresentAway(12, seen.Add);
            prompt.DismissIfShowing();
            return seen;
        });

        Assert.Equal([AwayResolution.Discard], answers);
    }

    /// <summary>
    /// A second prompt replaces the first rather than stacking behind it — a prompt the user cannot
    /// see is one they would answer blind. The replaced one resolves to Discard on its way out.
    /// </summary>
    [Fact]
    public void PresentingAgainReplacesTheLivePrompt()
    {
        var (first, second) = Wpf.Run(() =>
        {
            var seen = new List<AwayResolution>();
            var prompt = new TimePrompt();
            prompt.PresentAway(12, seen.Add);

            var later = new List<AwayResolution>();
            prompt.PresentRecovery(30, later.Add);
            prompt.DismissIfShowing();

            return (seen, later);
        });

        Assert.Equal([AwayResolution.Discard], first);
        Assert.Equal([AwayResolution.Discard], second);
    }

    [Fact]
    public void DismissingWhenNothingIsShowingIsHarmless()
    {
        Wpf.Run(() =>
        {
            new TimePrompt().DismissIfShowing();
            return 0;
        });
    }

    private static string DefaultButtonOf(Window window) =>
        window.FindName("KeepButton") is System.Windows.Controls.Button { IsDefault: true }
            ? "Keep"
            : "Discard";
}

/// <summary>
/// Runs a body on a dedicated STA thread with the application resources WPF needs.
///
/// WPF allows exactly one <see cref="Application"/> per process and pins it to the thread that
/// created it, so every test that touches a window shares this one thread — hence the xUnit
/// collection, which stops them running in parallel.
/// </summary>
public static class Wpf
{
    private static readonly Lazy<System.Windows.Threading.Dispatcher> Host = new(Start);

    public static T Run<T>(Func<T> body) => Host.Value.Invoke(body);

    private static System.Windows.Threading.Dispatcher Start()
    {
        var ready = new TaskCompletionSource<System.Windows.Threading.Dispatcher>();

        var thread = new Thread(() =>
        {
            var application = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };

            // The windows resolve brushes through the theme dictionary and styles through Tokens, so both
            // have to be loaded exactly as App.xaml loads them at runtime — same order, theme first.
            foreach (var source in new[] { "UI/Theme.Light.xaml", "UI/Tokens.xaml" })
            {
                application.Resources.MergedDictionaries.Add(new ResourceDictionary
                {
                    Source = new Uri($"pack://application:,,,/NiftyTimer;component/{source}", UriKind.Absolute),
                });
            }

            ready.SetResult(System.Windows.Threading.Dispatcher.CurrentDispatcher);
            System.Windows.Threading.Dispatcher.Run();
        })
        {
            IsBackground = true,
        };

        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        return ready.Task.GetAwaiter().GetResult();
    }
}

[CollectionDefinition("wpf", DisableParallelization = true)]
public class WpfCollection;
