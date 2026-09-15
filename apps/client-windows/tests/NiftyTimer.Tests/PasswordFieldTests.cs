using System.Windows.Controls;
using NiftyTimer.UI;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The sign-in password field's reveal toggle, driven on the shared WPF thread. The value has to
/// survive every swap between the hidden and revealed boxes: a toggle that dropped what was typed
/// would be worse than no toggle at all.
/// </summary>
[Collection("wpf")]
public class RevealablePasswordFieldTests
{
    private static PasswordBox Hidden(RevealablePasswordField field) => (PasswordBox)field.FindName("HiddenBox");

    private static TextBox Revealed(RevealablePasswordField field) => (TextBox)field.FindName("RevealedBox");

    [Fact]
    public void RevealingShowsWhatWasTyped()
    {
        var (revealed, shown, password) = Wpf.Run(() =>
        {
            var field = new RevealablePasswordField();
            Hidden(field).Password = "hunter2";

            field.ToggleReveal();

            return (field.IsRevealed, Revealed(field).Text, field.Password);
        });

        Assert.True(revealed);
        Assert.Equal("hunter2", shown);
        Assert.Equal("hunter2", password);
    }

    [Fact]
    public void AnEditMadeWhileRevealedSurvivesHidingAgain()
    {
        var (revealed, hidden, leftBehind) = Wpf.Run(() =>
        {
            var field = new RevealablePasswordField();
            field.ToggleReveal();
            Revealed(field).Text = "corrected";

            field.ToggleReveal();

            return (field.IsRevealed, Hidden(field).Password, Revealed(field).Text);
        });

        Assert.False(revealed);
        Assert.Equal("corrected", hidden);

        // Hidden again means the plain-text copy is gone, not merely collapsed.
        Assert.Equal(string.Empty, leftBehind);
    }

    /// <summary>After a sign-in the reused window must hold nothing, in either box.</summary>
    [Fact]
    public void ClearEmptiesBothBoxesAndHidesAgain()
    {
        var (revealed, hidden, shown) = Wpf.Run(() =>
        {
            var field = new RevealablePasswordField();
            Hidden(field).Password = "hunter2";
            field.ToggleReveal();

            field.Clear();

            return (field.IsRevealed, Hidden(field).Password, Revealed(field).Text);
        });

        Assert.False(revealed);
        Assert.Equal(string.Empty, hidden);
        Assert.Equal(string.Empty, shown);
    }

    /// <summary>Tab from the password belongs on Sign in, as on the Mac, not on the eye.</summary>
    [Fact]
    public void TheToggleIsOutOfTheTabOrder()
    {
        var (focusable, tabStop) = Wpf.Run(() =>
        {
            var button = (Button)new RevealablePasswordField().FindName("RevealButton");
            return (button.Focusable, button.IsTabStop);
        });

        Assert.False(focusable);
        Assert.False(tabStop);
    }
}
