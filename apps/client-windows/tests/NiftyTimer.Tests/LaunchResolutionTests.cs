using System.Reflection;
using System.Runtime.CompilerServices;
using System.Windows.Interop;
using NiftyTimer.App;
using NiftyTimer.Policy;
using NiftyTimer.Projects;
using NiftyTimer.Sync;
using Xunit;

namespace NiftyTimer.Tests;

public class PolicyResolutionRetryTests
{
    private static PolicyResolutionRetry Make(int warnAfter = 3) =>
        new(new BackoffPolicy(TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(300), jitter: d => d), warnAfter);

    /// <summary>
    /// The launch case: the policy fetch failed once (network not up yet at login), so try again
    /// soon and say nothing to the employee about a blip that is about to resolve itself.
    /// </summary>
    [Fact]
    public void TheFirstFailureSchedulesARetryWithoutWarning()
    {
        var retry = Make();

        Assert.Equal(new PolicyRetryOutcome.Retry(TimeSpan.FromSeconds(30), false), retry.RecordFailure());
    }

    /// <summary>Doubles and caps, so a laptop that stays offline all morning is not retrying every 30s.</summary>
    [Fact]
    public void TheDelayDoublesAndCapsAtTheMaximum()
    {
        var retry = Make(warnAfter: int.MaxValue);

        var delays = Enumerable.Range(0, 6)
            .Select(_ => ((PolicyRetryOutcome.Retry)retry.RecordFailure()).After.TotalSeconds)
            .ToList();

        Assert.Equal(new double[] { 30, 60, 120, 240, 300, 300 }, delays);
    }

    /// <summary>
    /// After the threshold the employee is told — ONCE. Without the one-shot the warning would
    /// re-fire on every retry, forever.
    /// </summary>
    [Fact]
    public void WarnsExactlyOnceWhenTheFailureThresholdIsReached()
    {
        var retry = Make(warnAfter: 3);

        var warnings = Enumerable.Range(0, 5)
            .Select(_ => ((PolicyRetryOutcome.Retry)retry.RecordFailure()).WarnUser)
            .ToList();

        Assert.Equal(new[] { false, false, true, false, false }, warnings);
    }

    /// <summary>
    /// Idle detection installed, so the loop must stop dead. Otherwise it keeps hitting the policy
    /// endpoint against the API's throttler for the rest of the session.
    /// </summary>
    [Fact]
    public void StopsRetryingOnceResolved()
    {
        var retry = Make();
        retry.RecordFailure();
        retry.MarkResolved();

        Assert.IsType<PolicyRetryOutcome.Stop>(retry.RecordFailure());
        Assert.True(retry.IsResolved);
    }

    /// <summary>
    /// Sign-out: the next user on this machine gets their own fresh schedule and their own single
    /// warning, never the outgoing user's exhausted one-shot.
    /// </summary>
    [Fact]
    public void ResetRearmsTheScheduleAndTheWarning()
    {
        var retry = Make(warnAfter: 1);
        retry.RecordFailure(); // warns; the delay advances
        retry.MarkResolved();

        retry.Reset();

        Assert.False(retry.IsResolved);
        Assert.Equal(new PolicyRetryOutcome.Retry(TimeSpan.FromSeconds(30), true), retry.RecordFailure());
    }
}

public class WakeWatcherTests
{
    private const int WmPowerBroadcast = 0x0218;

    [Theory]
    [InlineData(0x0012, true)]  // PBT_APMRESUMEAUTOMATIC
    [InlineData(0x0007, true)]  // PBT_APMRESUMESUSPEND
    [InlineData(0x0004, false)] // PBT_APMSUSPEND — going to sleep is not waking up
    [InlineData(0x000A, false)] // PBT_APMPOWERSTATUSCHANGE — a charger, not a wake
    public void OnlyAResumeCountsAsWaking(int powerEvent, bool expected) =>
        Assert.Equal(expected, WakeWatcher.IsResume(WmPowerBroadcast, new IntPtr(powerEvent)));

    [Fact]
    public void AnotherMessageCarryingAResumeCodeIsNotAWake() =>
        Assert.False(WakeWatcher.IsResume(0x001A, new IntPtr(0x0012)));

    [Fact]
    public void AResumeBroadcastReachesTheCallback()
    {
        HwndSourceHook? hook = null;
        var wakes = 0;
        using var watcher = new WakeWatcher(() => wakes++, h =>
        {
            hook = h;
            return new NullHost();
        });

        Assert.NotNull(hook);

        var handled = false;
        hook(IntPtr.Zero, WmPowerBroadcast, new IntPtr(0x0004), IntPtr.Zero, ref handled);
        hook(IntPtr.Zero, WmPowerBroadcast, new IntPtr(0x0012), IntPtr.Zero, ref handled);

        Assert.Equal(1, wakes);
        Assert.False(handled); // a broadcast is observed, never swallowed
    }

    private sealed class NullHost : IMessageHost
    {
        public IntPtr Handle => IntPtr.Zero;

        public void Dispose()
        {
        }
    }
}

/// <summary>
/// The launch-resolution wiring lives in <see cref="AppDelegate"/>, which cannot be constructed in a
/// test — it builds real windows and a tray icon. So, as with <c>UpdateWiringTests</c> and
/// <c>LoginItemWiringTests</c>, the connections are asserted on the IL. Each of these was a gap
/// against the macOS client in which both halves existed and were tested on their own while
/// nothing joined them.
/// </summary>
public class LaunchResolutionWiringTests
{
    /// <summary>
    /// A failed policy fetch on the online branch must schedule another attempt. Without it, a
    /// launch before the network is up grants manual tracking and never installs idle detection —
    /// in auto mode, a clock that never starts.
    /// </summary>
    [Fact]
    public void AFailedPolicyFetchSchedulesARetry() =>
        Assert.True(
            References(Body("ProceedToPolicyAsync"), nameof(AppDelegate), "SchedulePolicyRetry"),
            "AppDelegate.ProceedToPolicyAsync no longer schedules a policy retry on failure.");

    [Fact]
    public void AnOfflineLaunchSchedulesARetry() =>
        Assert.True(
            References(Body("BootstrapAsync"), nameof(AppDelegate), "SchedulePolicyRetry"),
            "AppDelegate.BootstrapAsync no longer schedules a policy retry after an offline launch.");

    [Fact]
    public void AClosedGateOnIdleDetectionSchedulesARetry() =>
        Assert.True(
            References(Body("StartIdleDetectionAsync"), nameof(AppDelegate), "SchedulePolicyRetry"),
            "AppDelegate.StartIdleDetectionAsync no longer schedules a policy retry when the gate fails.");

    [Fact]
    public void InstallingIdleDetectionEndsTheRetryLoop() =>
        Assert.True(
            References(Body("InstallIdleDetection"), nameof(PolicyResolutionRetry), nameof(PolicyResolutionRetry.MarkResolved)),
            "AppDelegate.InstallIdleDetection no longer marks the launch retry resolved — it would " +
            "keep re-fetching the policy against the throttler for the whole session.");

    /// <summary>
    /// The retry re-enters the ONLINE branch, which re-fetches the policy before anything is
    /// installed. Scheduling it from <c>ProceedOffline</c> itself would put a path from the offline
    /// branch to the installers, which is what <see cref="OfflineCaptureUnreachableTests"/> exists
    /// to forbid — so the callers schedule it, and this pins that they still do.
    /// </summary>
    [Fact]
    public void TheOfflineBranchDoesNotScheduleTheRetryItself() =>
        Assert.False(
            References(Body("ProceedOffline"), nameof(AppDelegate), "SchedulePolicyRetry"),
            "AppDelegate.ProceedOffline must not schedule the policy retry — its callers do.");

    /// <summary>Sign-out re-arms the schedule and its single warning for the next person.</summary>
    [Fact]
    public void SignOutResetsTheRetry() =>
        Assert.True(
            References(Body("SignOutAsync"), nameof(PolicyResolutionRetry), nameof(PolicyResolutionRetry.Reset)),
            "AppDelegate.SignOutAsync no longer resets the launch retry.");

    /// <summary>
    /// The saved project selection is namespaced by user, so it outlives a sign-out on purpose: the
    /// same person signing back in gets their project back, as on the Mac. Clearing it on sign-out
    /// was the Windows-only regression.
    /// </summary>
    [Fact]
    public void SignOutKeepsTheSavedSelection() =>
        Assert.False(
            References(Body("SignOutAsync"), nameof(SelectionStore), nameof(SelectionStore.Clear)),
            "AppDelegate.SignOutAsync clears the saved project selection again.");

    /// <summary>
    /// Auto mode's "Idle for N min — still working?" nudge. The coordinator has always raised the
    /// callback; the only construction of it never passed one, so it never fired.
    /// </summary>
    [Fact]
    public void AutoModeWiresTheIdleNudge() =>
        Assert.True(
            References(Body("InstallIdleDetection"), nameof(AppDelegate), "NotifyIdleThresholdCrossed"),
            "AppDelegate.InstallIdleDetection no longer hands the idle-nudge callback to the auto coordinator.");

    [Theory]
    [InlineData(300, "Idle for 5 min — still working?")]
    [InlineData(20, "Idle for 1 min — still working?")]
    public void TheIdleNudgeSaysHowLong(int seconds, string expected) =>
        Assert.Equal(expected, AppDelegate.IdleNudgeBody(seconds));

    /// <summary>
    /// The IL walk must be able to resolve SOMETHING, or every negative assertion above passes for
    /// the wrong reason on any change that breaks token resolution.
    /// </summary>
    [Fact]
    public void TheWalkIsNotVacuous()
    {
        Assert.False(References(Body("SignOutAsync"), nameof(AppDelegate), "AMethodNameThatCannotExist"));
        Assert.True(References(Body("SignOutAsync"), nameof(AppDelegate), "TearDownIdleDetection"));
        Assert.True(References(Body("ProceedOffline"), nameof(AppDelegate), "BecomeReady"));
    }

    /// <summary>The IL of a method, or of its state machine's MoveNext when it is async.</summary>
    private static MethodBase Body(string name)
    {
        var method = typeof(AppDelegate).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException(
                $"AppDelegate.{name} is gone. If it was renamed, rename it here too — do not delete the guard.");

        var stateMachine = method.GetCustomAttribute<AsyncStateMachineAttribute>()?.StateMachineType;
        return stateMachine?.GetMethod("MoveNext", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
            ?? (MethodBase)method;
    }

    /// <summary>
    /// Whether <paramref name="method"/> calls or loads (<c>ldftn</c> — a method group handed over
    /// as a callback) <paramref name="typeName"/>.<paramref name="methodName"/>.
    /// </summary>
    private static bool References(MethodBase method, string typeName, string methodName)
    {
        var il = method.GetMethodBody()?.GetILAsByteArray() ?? Array.Empty<byte>();
        Assert.NotEmpty(il);

        for (var i = 0; i < il.Length - 4; i++)
        {
            // call = 0x28, callvirt = 0x6F, newobj = 0x73; ldftn = 0xFE 0x06.
            var isCall = il[i] is 0x28 or 0x6F or 0x73;
            var isLdftn = il[i] == 0xFE && il[i + 1] == 0x06;
            if (!isCall && !isLdftn)
            {
                continue;
            }

            var operandAt = isLdftn ? i + 2 : i + 1;
            if (operandAt + 4 > il.Length)
            {
                continue;
            }

            try
            {
                var resolved = method.Module.ResolveMethod(BitConverter.ToInt32(il, operandAt));
                if (resolved?.Name == methodName && resolved.DeclaringType?.Name == typeName)
                {
                    return true;
                }
            }
            catch (Exception e) when (e is ArgumentException or BadImageFormatException)
            {
                // A byte that merely looked like an opcode — a linear scan, not a decoder.
            }
        }

        return false;
    }
}
