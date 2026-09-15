using NiftyTimer.App;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// One running copy per install. Named mutexes need no shell, so this is exercised for real.
///
/// A mutex is re-entrant for the thread that owns it, so a claim made on the test thread would let
/// a second claim on the same thread succeed and prove nothing. The holder therefore lives on its
/// own thread, the way a second process would.
/// </summary>
public class SingleInstanceTests
{
    private static string NewAppId() => $"{AppInstall.ProductionAppId}.test-{Guid.NewGuid():N}";

    /// <summary>Claims on a separate thread and keeps it until <c>Release</c> is set.</summary>
    private static (Thread Holder, ManualResetEventSlim Release) HoldOnAnotherThread(string appId, bool letGoOnExit)
    {
        var held = new ManualResetEventSlim();
        var release = new ManualResetEventSlim();
        var holder = new Thread(() =>
        {
            var instance = SingleInstance.TryAcquire(appId, TimeSpan.Zero);
            held.Set();
            release.Wait();
            if (letGoOnExit)
            {
                instance?.Dispose();
            }
        });
        holder.Start();
        Assert.True(held.Wait(TimeSpan.FromSeconds(10)), "The holder thread never claimed the lock.");
        return (holder, release);
    }

    [Fact]
    public void ASecondClaimWhileTheFirstIsHeldIsRefused()
    {
        var appId = NewAppId();
        var (holder, release) = HoldOnAnotherThread(appId, letGoOnExit: true);

        var second = SingleInstance.TryAcquire(appId, TimeSpan.Zero);

        release.Set();
        holder.Join();
        Assert.Null(second);
    }

    [Fact]
    public void AClaimSucceedsOnceTheHolderLetsGo()
    {
        var appId = NewAppId();
        var (holder, release) = HoldOnAnotherThread(appId, letGoOnExit: true);
        release.Set();
        holder.Join();

        using var next = SingleInstance.TryAcquire(appId, TimeSpan.Zero);

        Assert.NotNull(next);
    }

    /// <summary>
    /// The copy the updater relaunches after ending a hung one, or the copy started after a crash:
    /// the lock was never released, and it must not keep the app from starting.
    /// </summary>
    [Fact]
    public void ACopyThatDiedWithoutLettingGoDoesNotBlockTheNext()
    {
        var appId = NewAppId();
        var (holder, release) = HoldOnAnotherThread(appId, letGoOnExit: false);
        release.Set();
        holder.Join();

        using var next = SingleInstance.TryAcquire(appId, TimeSpan.Zero);

        Assert.NotNull(next);
    }

    /// <summary>Double-clicking the exe while the app runs must bring its menu up.</summary>
    [Fact]
    public void SignallingTheRunningCopyAsksItToOpenItsMenu()
    {
        var appId = NewAppId();
        using var running = SingleInstance.TryAcquire(appId, TimeSpan.Zero)
            ?? throw new InvalidOperationException("A fresh app id should always be claimable.");
        // Not disposed: the callback arrives on a thread-pool thread, and disposing the event under
        // a late one would fault the test host rather than fail this test.
        var asked = new ManualResetEventSlim();
        running.ShowRequested += asked.Set;

        Assert.True(SingleInstance.SignalRunning(appId));
        Assert.True(asked.Wait(TimeSpan.FromSeconds(10)), "The running copy never heard the request.");
    }

    [Fact]
    public void SignallingWithNoCopyRunningReportsNobodyListening() =>
        Assert.False(SingleInstance.SignalRunning(NewAppId()));

    /// <summary>A dev build must never keep the released one from starting, or the reverse.</summary>
    [Fact]
    public void ADevBuildAndTheReleasedOneUseDifferentLocks()
    {
        Assert.NotEqual(SingleInstance.MutexName(null), SingleInstance.MutexName(AppInstall.ProductionAppId));
        Assert.NotEqual(SingleInstance.ShowEventName(null), SingleInstance.ShowEventName(AppInstall.ProductionAppId));
    }
}
