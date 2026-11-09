using System.Reflection;
using System.Runtime.CompilerServices;
using NiftyTimer.App;
using NiftyTimer.Policy;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The decision layer only. <see cref="RunKeyLoginItem"/> is the sole code that touches HKCU and
/// is left to a manual pass, exactly as the macOS client leaves <c>MainAppLoginItem</c> — a unit
/// test that writes to the real Run key would put a startup entry on whatever machine ran it.
/// </summary>
public class LoginItemSyncTests
{
    private sealed class FakeLoginItem : ILoginItemControl
    {
        public FakeLoginItem(LoginItemStatus status = LoginItemStatus.NotRegistered) =>
            Status = status;

        public LoginItemStatus Status { get; private set; }

        public int Registers { get; private set; }

        public Exception? Throws { get; init; }

        public void Register()
        {
            if (Throws is not null)
            {
                throw Throws;
            }

            Registers++;
            Status = LoginItemStatus.Registered;
        }
    }

    /// <summary>
    /// Regression: the item used to be registered only when the team's <c>autoStartOnLogin</c> was
    /// on — and that setting is off by default. A team in manual mode never had the app open after
    /// a restart, so nobody was reminded to start the clock. The sync no longer takes the setting.
    /// </summary>
    [Fact]
    public void AMissingItemIsRegisteredWhateverTheTrackingMode()
    {
        var item = new FakeLoginItem();

        Assert.Equal(LoginItemSync.Outcome.Registered, LoginItemSync.Apply(item));
        Assert.Equal(LoginItemStatus.Registered, item.Status);
        Assert.Equal(1, item.Registers);
    }

    /// <summary>
    /// Regression: a value left behind by a copy unzipped into another folder read as Registered
    /// and was never rewritten, so login launched a path that no longer existed — silently.
    /// </summary>
    [Fact]
    public void AnItemPointingAtAnotherCopyIsRepaired()
    {
        var item = new FakeLoginItem(LoginItemStatus.PointsElsewhere);

        Assert.Equal(LoginItemSync.Outcome.Repaired, LoginItemSync.Apply(item));
        Assert.Equal(LoginItemStatus.Registered, item.Status);
        Assert.Equal(1, item.Registers);
    }

    /// <summary>
    /// This runs on every policy resolution, which is every launch. Anything other than a no-op in
    /// the settled case would mean rewriting the Run value repeatedly.
    /// </summary>
    [Fact]
    public void AnAlreadyCorrectItemIsLeftAlone()
    {
        var item = new FakeLoginItem(LoginItemStatus.Registered);

        Assert.Equal(LoginItemSync.Outcome.Unchanged, LoginItemSync.Apply(item));
        Assert.Equal(0, item.Registers);
    }

    /// <summary>
    /// The "never fight the user" guarantee, reached differently than on macOS.
    ///
    /// <c>SMAppService</c> reports a <c>requiresApproval</c> state the client refuses to register
    /// over. Windows exposes no such read — Task Manager's enable/disable lives in an undocumented
    /// blob under <c>Explorer\StartupApproved\Run</c> whose absence is indistinguishable from never
    /// having registered. But disabling there LEAVES the Run value in place, so "a value that
    /// already launches this executable is never rewritten" respects the employee's choice on every
    /// subsequent launch without parsing anything undocumented.
    /// </summary>
    [Fact]
    public void AnItemDisabledByTheUserIsNeverRewritten()
    {
        // Disabling in Task Manager does not remove the value, so the client still reads it as
        // Registered — and must leave it exactly as it found it.
        var disabledInTaskManager = new FakeLoginItem(LoginItemStatus.Registered);

        for (var launch = 0; launch < 5; launch++)
        {
            Assert.Equal(LoginItemSync.Outcome.Unchanged, LoginItemSync.Apply(disabledInTaskManager));
        }

        Assert.Equal(0, disabledInTaskManager.Registers);
    }

    /// <summary>
    /// A locked hive or a group policy must not take the launch down with it. Tracking works
    /// either way; the employee can still open the app by hand.
    /// </summary>
    [Theory]
    [InlineData(LoginItemStatus.NotRegistered)]
    [InlineData(LoginItemStatus.PointsElsewhere)]
    public void ARegistryFailureIsReportedRatherThanThrown(LoginItemStatus status)
    {
        var item = new FakeLoginItem(status)
        {
            Throws = new UnauthorizedAccessException("hive is locked"),
        };

        Assert.Equal(LoginItemSync.Outcome.Failed, LoginItemSync.Apply(item));
    }
}

/// <summary>
/// How a Run value read from the registry is classified. <see cref="RunKeyLoginItem.StatusOf"/> is
/// the pure half of the one class that touches HKCU.
/// </summary>
public class RunKeyStatusTests
{
    private const string Command = "\"C:\\Users\\ada\\NiftyTimer\\NiftyTimer.exe\"";

    [Fact]
    public void NoValueIsNotRegistered()
    {
        Assert.Equal(LoginItemStatus.NotRegistered, RunKeyLoginItem.StatusOf(null, Command));
    }

    [Fact]
    public void AValueLaunchingThisExecutableIsRegistered()
    {
        Assert.Equal(LoginItemStatus.Registered, RunKeyLoginItem.StatusOf(Command, Command));
    }

    /// <summary>Windows paths are case-insensitive: a case-only difference launches the same file.</summary>
    [Fact]
    public void ACaseOnlyDifferenceIsStillRegistered()
    {
        Assert.Equal(
            LoginItemStatus.Registered,
            RunKeyLoginItem.StatusOf(Command.ToUpperInvariant(), Command));
    }

    [Fact]
    public void AValueLaunchingAnotherCopyPointsElsewhere()
    {
        const string oldCopy = "\"C:\\Users\\ada\\Downloads\\NiftyTimer-windows-pilot\\NiftyTimer.exe\"";

        Assert.Equal(LoginItemStatus.PointsElsewhere, RunKeyLoginItem.StatusOf(oldCopy, Command));
    }
}

/// <summary>
/// The Run value name is what keeps a dev build and a released install from overwriting each
/// other's startup entry — the same collision the macOS README documents for its two bundles.
/// </summary>
public class LoginItemNameTests
{
    [Fact]
    public void TheReleasedInstallUsesTheBareProductName()
    {
        Assert.Equal("Nifty Timer", AppInstall.LoginItemName(AppInstall.ProductionAppId));
    }

    [Fact]
    public void EveryOtherBuildIsScopedByItsVariant()
    {
        Assert.Equal("Nifty Timer (dev)", AppInstall.LoginItemName(AppInstall.ProductionAppId + ".dev"));

        // A checkout run has no packaged app id at all and must not claim production's name.
        Assert.Equal("Nifty Timer (dev)", AppInstall.LoginItemName(null));
    }

    [Fact]
    public void ADevBuildAndTheReleasedInstallNeverShareAName()
    {
        Assert.NotEqual(
            AppInstall.LoginItemName(AppInstall.ProductionAppId),
            AppInstall.LoginItemName(null));
    }
}

/// <summary>
/// That the sync is actually CALLED.
///
/// This is the failure mode the client already shipped once, with the updater: both halves worked
/// in isolation, every unit test was green, and nothing joined them — so the app detected updates
/// it had no path to apply. <see cref="LoginItemSync"/> is a pure decision and
/// <see cref="RunKeyLoginItem"/> is untested by construction, so without this the two could sit
/// there fully tested and never run. Modelled on <c>UpdateWiringTests</c>.
/// </summary>
public class LoginItemWiringTests
{
    [Fact]
    public void ThePolicyBranchActuallyAppliesTheLoginItem()
    {
        var proceed = typeof(AppDelegate).GetMethod(
            "ProceedToPolicyAsync",
            BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException(
                "AppDelegate.ProceedToPolicyAsync is gone. If it was renamed, rename it here too.");

        var stateMachine = proceed
            .GetCustomAttribute<AsyncStateMachineAttribute>()
            ?.StateMachineType;
        Assert.NotNull(stateMachine);

        var il = stateMachine!
            .GetMethod("MoveNext", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)!
            .GetMethodBody()!
            .GetILAsByteArray()!;
        Assert.NotEmpty(il);

        Assert.True(
            Calls(il, proceed.Module, nameof(LoginItemSync.Apply)),
            "AppDelegate.ProceedToPolicyAsync no longer calls LoginItemSync.Apply — the app would " +
            "never open at login, and manual mode would have nobody to remind to start the clock.");
    }

    /// <summary>
    /// The walk must be able to resolve SOMETHING, or the assertion above passes for the wrong
    /// reason on any future change that breaks token resolution.
    /// </summary>
    [Fact]
    public void TheReachabilityWalkIsNotVacuous()
    {
        var proceed = typeof(AppDelegate).GetMethod(
            "ProceedToPolicyAsync",
            BindingFlags.Instance | BindingFlags.NonPublic)!;

        var il = proceed
            .GetCustomAttribute<AsyncStateMachineAttribute>()!
            .StateMachineType
            .GetMethod("MoveNext", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)!
            .GetMethodBody()!
            .GetILAsByteArray()!;

        Assert.False(Calls(il, proceed.Module, "AMethodNameThatCannotExist"));
        Assert.True(Calls(il, proceed.Module, "StartIdleDetectionAsync"));
    }

    private static bool Calls(byte[] il, Module module, string methodName)
    {
        for (var i = 0; i < il.Length - 4; i++)
        {
            if (il[i] is not (0x28 or 0x6F))
            {
                continue;
            }

            try
            {
                if (module.ResolveMethod(BitConverter.ToInt32(il, i + 1))?.Name == methodName)
                {
                    return true;
                }
            }
            catch (Exception e) when (e is ArgumentException or BadImageFormatException)
            {
                // A byte that merely looked like an opcode; this is a linear scan, not a decoder.
            }
        }

        return false;
    }
}
