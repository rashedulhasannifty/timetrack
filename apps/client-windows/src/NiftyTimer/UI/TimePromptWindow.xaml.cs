using System.Globalization;
using System.Windows;
using NiftyTimer.Tracking;

namespace NiftyTimer.UI;

/// <summary>
/// The shared keep-or-discard card, used by both time prompts. Only the copy and the DEFAULT
/// button differ between them:
///
/// <list type="bullet">
///   <item><b>Away</b> (PRD §6.1) defaults to Discard. The clock ran while nobody was there, so
///   the safe answer is not to invent time.</item>
///   <item><b>Recovery</b> defaults to Keep. A graceful shutdown routes through the same prompt,
///   and pressing Enter must not throw away real work.</item>
/// </list>
///
/// Dismissing the window resolves to <b>Discard</b> in both cases, whatever the default button is:
/// an ignored prompt must never silently invent time. <c>Resolve</c> is guaranteed to fire exactly
/// once — the close handler and the buttons share one latch.
///
/// Always a visible window; there is no quiet variant (CLAUDE.md §1).
/// </summary>
public partial class TimePromptWindow : Window
{
    private readonly OneShotResolution _resolution;

    public TimePromptWindow(
        string title,
        int minutes,
        string message,
        AwayResolution defaultChoice,
        Action<AwayResolution> resolve)
    {
        InitializeComponent();

        _resolution = new OneShotResolution(resolve);

        Title = title;
        TitleLabel.Text = title;
        MinutesLabel.Text = string.Create(
            CultureInfo.InvariantCulture,
            $"{minutes} {(minutes == 1 ? "minute" : "minutes")}");
        MessageLabel.Text = message;

        if (defaultChoice == AwayResolution.Keep)
        {
            KeepButton.IsDefault = true;
            KeepButton.Focus();
        }
        else
        {
            DiscardButton.IsDefault = true;
            DiscardButton.Focus();
        }
    }

    /// <summary>Resolve as if the user pressed that button, and close.</summary>
    public void Choose(AwayResolution action)
    {
        // Deliver BEFORE closing: Close() re-enters through OnClosed, which would otherwise turn
        // the user's Keep into a Discard. The latch makes the second delivery a no-op either way.
        _resolution.Deliver(action);
        Close();
    }

    /// <summary>Closing without choosing is a Discard — never a Keep. See the type comment.</summary>
    protected override void OnClosed(EventArgs e)
    {
        base.OnClosed(e);
        _resolution.Deliver(AwayResolution.Discard);
    }

    private void OnKeep(object sender, RoutedEventArgs e) => Choose(AwayResolution.Keep);

    private void OnDiscard(object sender, RoutedEventArgs e) => Choose(AwayResolution.Discard);
}

/// <summary>
/// Delivers a keep/discard answer exactly once, whoever asks first.
///
/// Extracted from the window because it is the part that can actually be wrong, and because the
/// two callers race by construction: choosing closes the window, and closing resolves. Without the
/// latch every Keep would be followed a microsecond later by the close handler's Discard, and the
/// away window the user chose to keep would be thrown away — with the prompt already gone, so the
/// only evidence would be time quietly missing from someone's day.
/// </summary>
public sealed class OneShotResolution
{
    private Action<AwayResolution>? _resolve;

    public OneShotResolution(Action<AwayResolution> resolve) => _resolve = resolve;

    /// <summary>Whether an answer is still outstanding.</summary>
    public bool IsPending => _resolve is not null;

    public void Deliver(AwayResolution action)
    {
        var resolve = _resolve;
        _resolve = null;
        resolve?.Invoke(action);
    }
}

/// <summary>
/// Presents one prompt at a time and can dismiss it. Two instances exist — one per prompt kind —
/// because they are dismissed at different moments and for different reasons.
///
/// Dismissal is not merely tidiness. A prompt left on screen across a sign-out belongs to the
/// previous user, and answering it would attribute their time to whoever signed in next
/// (CLAUDE.md §1). The tear-down order matters: deactivate the monitor FIRST so the away window is
/// already recorded UNRESOLVED, then dismiss, so the resulting Discard lands on an inactive monitor
/// and is a no-op.
/// </summary>
public sealed class TimePrompt
{
    private TimePromptWindow? _live;

    public void Present(
        string title,
        int minutes,
        string message,
        AwayResolution defaultChoice,
        Action<AwayResolution> resolve)
    {
        // Replace rather than stack. A second prompt behind the first is one the user cannot see
        // and would answer blind.
        DismissIfShowing();

        var window = new TimePromptWindow(title, minutes, message, defaultChoice, action =>
        {
            _live = null;
            resolve(action);
        });

        _live = window;
        window.Show();
        window.Activate();
    }

    public void DismissIfShowing()
    {
        var window = _live;
        _live = null;
        window?.Close();
    }
}

/// <summary>The copy for each prompt, kept out of the wiring so it reads as product text.</summary>
public static class TimePrompts
{
    public static void PresentAway(this TimePrompt prompt, int minutes, Action<AwayResolution> resolve) =>
        prompt.Present(
            "You were away",
            minutes,
            "The clock kept running while this PC was idle. Keep this time or discard it?",
            AwayResolution.Discard, // PRD §6.1 — never invent time by default
            resolve);

    public static void PresentRecovery(this TimePrompt prompt, int minutes, Action<AwayResolution> resolve) =>
        prompt.Present(
            "Recover interrupted time?",
            minutes,
            "Nifty Timer was still tracking when it last closed. Keep this time or discard it?",
            AwayResolution.Keep, // Enter must not throw away real work
            resolve);
}
