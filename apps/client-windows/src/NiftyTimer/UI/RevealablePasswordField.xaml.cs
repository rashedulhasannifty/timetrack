using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;

namespace NiftyTimer.UI;

/// <summary>
/// A password field with a reveal toggle. Ported from the macOS client's
/// <c>RevealableSecureField</c>.
///
/// Typing a password blind is error-prone, and the only feedback on a typo is a failed sign-in
/// several seconds later.
///
/// Safe to reveal here specifically: this field only appears in the sign-in window, which is only
/// shown while nobody is signed in. Capture cannot run without a signed-in, acknowledged user
/// (<see cref="Policy.AckGate"/>), and sign-out tears capture down before the window opens, so no
/// screenshot can record the revealed text.
///
/// WPF's <see cref="PasswordBox"/> cannot show its contents, so revealing swaps it for a
/// <see cref="TextBox"/> and carries the value across in each direction. While revealed, the
/// password lives in that text box; <see cref="Clear"/> empties both.
/// </summary>
public partial class RevealablePasswordField : UserControl
{
    private const string ShowGlyph = "";
    private const string HideGlyph = "";

    public RevealablePasswordField()
    {
        InitializeComponent();
    }

    public bool IsRevealed { get; private set; }

    /// <summary>The password, from whichever of the two boxes is showing.</summary>
    public string Password => IsRevealed ? RevealedBox.Text : HiddenBox.Password;

    public void ToggleReveal()
    {
        if (IsRevealed)
        {
            HiddenBox.Password = RevealedBox.Text;
            RevealedBox.Clear();
        }
        else
        {
            RevealedBox.Text = HiddenBox.Password;
            HiddenBox.Clear();
        }

        SetRevealed(!IsRevealed);

        // The swap moves focus off the field. Without this the caret vanishes mid-password and the
        // person has to click back in to keep typing — the same fix the Mac field needed.
        if (IsRevealed)
        {
            RevealedBox.Focus();
            RevealedBox.CaretIndex = RevealedBox.Text.Length;
        }
        else
        {
            HiddenBox.Focus();
        }
    }

    /// <summary>Empty both boxes and hide again, ready for the next person.</summary>
    public void Clear()
    {
        HiddenBox.Clear();
        RevealedBox.Clear();
        SetRevealed(false);
    }

    private void SetRevealed(bool revealed)
    {
        IsRevealed = revealed;
        HiddenBox.Visibility = revealed ? Visibility.Collapsed : Visibility.Visible;
        RevealedBox.Visibility = revealed ? Visibility.Visible : Visibility.Collapsed;

        var label = revealed ? "Hide password" : "Show password";
        RevealButton.Content = revealed ? HideGlyph : ShowGlyph;
        RevealButton.ToolTip = label;
        AutomationProperties.SetName(RevealButton, label);
    }

    private void OnToggleReveal(object sender, RoutedEventArgs e) => ToggleReveal();
}
