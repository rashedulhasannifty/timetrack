using NiftyTimer.App;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The tray icon's registration with the shell. The controller needs a real notification area to
/// construct, so the decision — add, else modify, else retry, else give up — is a pure type and is
/// pinned here with a fake shell.
///
/// The defect: <c>TrayIconController.Add</c> threw on the first refused <c>NIM_ADD</c>, from the
/// constructor at login and from the window procedure on a <c>TaskbarCreated</c> broadcast. Nothing
/// caught it, so the process ended silently and the icon was simply gone.
/// </summary>
public class TrayRegistrationTests
{
    [Fact]
    public void AnAcceptedAddShowsTheIcon()
    {
        var registration = new TrayRegistration(add: () => true, modify: () => false);

        Assert.Equal(TrayRegistrationOutcome.Shown, registration.Register());
        Assert.True(registration.IsShown);
    }

    /// <summary>The login case: the notification area does not exist yet. Wait, do not throw.</summary>
    [Fact]
    public void ARefusedAddIsRetriedRatherThanThrown()
    {
        var registration = new TrayRegistration(add: () => false, modify: () => false);

        Assert.Equal(TrayRegistrationOutcome.RetryLater, registration.Register());
        Assert.False(registration.IsShown);
    }

    /// <summary>
    /// A <c>TaskbarCreated</c> broadcast that did not actually drop the icon: adding it again is
    /// refused because it is still there, and that must read as shown, not as a failure.
    /// </summary>
    [Fact]
    public void AnIconTheShellStillHoldsCountsAsShown()
    {
        var shellHasIcon = false;
        var registration = new TrayRegistration(
            add: () =>
            {
                var accepted = !shellHasIcon;
                shellHasIcon = true;
                return accepted;
            },
            modify: () => shellHasIcon);

        registration.Register();

        Assert.Equal(TrayRegistrationOutcome.Shown, registration.OnTaskbarCreated());
        Assert.True(registration.IsShown);
    }

    [Fact]
    public void AShellThatComesUpLaterIsPickedUpOnALaterAttempt()
    {
        var attempts = 0;
        var registration = new TrayRegistration(add: () => ++attempts >= 3, modify: () => false);

        Assert.Equal(TrayRegistrationOutcome.RetryLater, registration.Register());
        Assert.Equal(TrayRegistrationOutcome.RetryLater, registration.Register());
        Assert.Equal(TrayRegistrationOutcome.Shown, registration.Register());
    }

    /// <summary>The indicator is not optional: the app does not run on without it forever.</summary>
    [Fact]
    public void RefusingForTheWholeBudgetGivesUp()
    {
        var registration = new TrayRegistration(add: () => false, modify: () => false, maxAttempts: 3);

        Assert.Equal(TrayRegistrationOutcome.RetryLater, registration.Register());
        Assert.Equal(TrayRegistrationOutcome.RetryLater, registration.Register());
        Assert.Equal(TrayRegistrationOutcome.GiveUp, registration.Register());
    }

    [Fact]
    public void ANewTaskbarStartsAFreshBudget()
    {
        var registration = new TrayRegistration(add: () => false, modify: () => false, maxAttempts: 3);
        registration.Register();
        registration.Register();

        Assert.Equal(TrayRegistrationOutcome.RetryLater, registration.OnTaskbarCreated());
    }

    [Fact]
    public void SuccessResetsTheBudget()
    {
        var answers = new Queue<bool>([false, true, false]);
        var registration = new TrayRegistration(add: () => answers.Dequeue(), modify: () => false, maxAttempts: 2);

        Assert.Equal(TrayRegistrationOutcome.RetryLater, registration.Register());
        Assert.Equal(TrayRegistrationOutcome.Shown, registration.Register());
        Assert.Equal(TrayRegistrationOutcome.RetryLater, registration.Register());
    }
}
