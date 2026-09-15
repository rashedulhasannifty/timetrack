using System.Reflection;
using NiftyTimer.App;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// Structural guards for the tray-disappearance fixes, read from IL because each failure being
/// guarded is a call that is missing, present, or out of order — and standing up the real app to
/// observe it would need a notification area CI does not have.
/// </summary>
public class TrayResilienceWiringTests
{
    private const BindingFlags Declared =
        BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly;

    /// <summary>Every method body a type owns, including its lambdas' compiler-generated homes.</summary>
    private static IEnumerable<MethodBase> Bodies(Type type) =>
        type.GetMethods(Declared).Cast<MethodBase>()
            .Concat(type.GetConstructors(Declared))
            .Where(m => m.GetMethodBody() is not null)
            .Concat(type.GetNestedTypes(BindingFlags.NonPublic).SelectMany(nested => Bodies(nested)));

    private static MethodBase OnStartup() =>
        typeof(NiftyTimerApp).GetMethod("OnStartup", BindingFlags.Instance | BindingFlags.NonPublic)
        ?? throw new InvalidOperationException("NiftyTimerApp.OnStartup is gone. If it moved, move the guard.");

    private static MethodBase Start() =>
        typeof(AppDelegate).GetMethod(nameof(AppDelegate.Start))
        ?? throw new InvalidOperationException("AppDelegate.Start is gone. If it moved, move the guard.");

    /// <summary>
    /// The defect itself: a refused registration threw <see cref="InvalidOperationException"/> from
    /// the constructor and from the window procedure, and nothing above either caught it.
    /// </summary>
    [Fact]
    public void NothingInTheTrayControllerThrowsOnARefusedRegistration()
    {
        var bodies = Bodies(typeof(TrayIconController)).ToList();

        Assert.Contains(
            bodies,
            b => LaunchResolutionWiringTests.References(b, nameof(TrayRegistration), nameof(TrayRegistration.OnTaskbarCreated)));

        foreach (var body in bodies)
        {
            Assert.False(
                LaunchResolutionWiringTests.References(body, nameof(InvalidOperationException), ".ctor"),
                $"TrayIconController.{body.Name} constructs an InvalidOperationException again.");
        }
    }

    /// <summary>
    /// Sign-in leads to capture, so it must not start until the indicator is showing — and the
    /// direct call that used to start it regardless must stay gone.
    /// </summary>
    [Fact]
    public void StartupSignsInOnlyOnceTheIndicatorIsShowing()
    {
        Assert.True(
            LaunchResolutionWiringTests.References(Start(), nameof(TrayIconController), nameof(TrayIconController.WhenShown)),
            "AppDelegate.Start no longer waits for the tray icon before signing in.");
        Assert.False(
            LaunchResolutionWiringTests.References(Start(), nameof(AppDelegate), "BootstrapAsync"),
            "AppDelegate.Start calls BootstrapAsync directly again, ahead of the indicator.");
    }

    [Fact]
    public void AnIndicatorThatNeverAppearsEndsTheApp()
    {
        Assert.True(
            LaunchResolutionWiringTests.References(Start(), nameof(TrayIconController), "add_GaveUp"),
            "AppDelegate.Start no longer listens for the tray giving up.");
        Assert.True(
            LaunchResolutionWiringTests.References(LaunchResolutionWiringTests.Body("OnTrayGaveUp"), "Application", "Shutdown"),
            "Giving up on the tray icon no longer ends the app.");
    }

    [Fact]
    public void CrashLoggingListensOnEveryChannel()
    {
        var install = typeof(CrashLog).GetMethod(nameof(CrashLog.Install))!;

        Assert.True(LaunchResolutionWiringTests.References(install, "Application", "add_DispatcherUnhandledException"));
        Assert.True(LaunchResolutionWiringTests.References(install, nameof(AppDomain), "add_UnhandledException"));
        Assert.True(LaunchResolutionWiringTests.References(install, nameof(TaskScheduler), "add_UnobservedTaskException"));
    }

    /// <summary>Installed after the app is built, a failure while building it is as silent as before.</summary>
    [Fact]
    public void CrashLoggingIsInstalledBeforeTheAppIsBuilt()
    {
        var install = LaunchResolutionWiringTests.FirstReference(OnStartup(), nameof(CrashLog), nameof(CrashLog.Install));
        var build = LaunchResolutionWiringTests.FirstReference(OnStartup(), nameof(AppDelegate), ".ctor");

        Assert.True(install >= 0, "NiftyTimerApp.OnStartup no longer installs the crash log.");
        Assert.True(build > install, "The crash log must be installed before AppDelegate is built.");
    }

    [Fact]
    public void ASecondLaunchDefersToTheRunningCopyBeforeBuildingAnything()
    {
        var claim = LaunchResolutionWiringTests.FirstReference(OnStartup(), nameof(SingleInstance), nameof(SingleInstance.TryAcquire));
        var build = LaunchResolutionWiringTests.FirstReference(OnStartup(), nameof(AppDelegate), ".ctor");

        Assert.True(claim >= 0, "NiftyTimerApp.OnStartup no longer claims the single-instance lock.");
        Assert.True(build > claim, "The lock must be claimed before a second copy builds anything.");
        Assert.True(
            LaunchResolutionWiringTests.References(OnStartup(), nameof(SingleInstance), nameof(SingleInstance.SignalRunning)),
            "A second launch no longer asks the running copy to show itself.");
        Assert.True(
            LaunchResolutionWiringTests.References(OnStartup(), nameof(SingleInstance), "add_ShowRequested"),
            "The running copy no longer answers a second launch by opening its menu.");
    }
}
