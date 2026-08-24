using NiftyTimer.Tracking;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The system edge. Its decision logic lives in the monitors, so what is left to test here is the
/// part that only the real OS can answer.
/// </summary>
[Collection("wpf")]
public class SessionObserverTests
{
    private sealed class Spy : ISignalReceiver
    {
        public List<int> Ticks { get; } = [];

        public int AwayCount { get; private set; }

        public int ResumeCount { get; private set; }

        public void Tick(int idleSeconds) => Ticks.Add(idleSeconds);

        public void MarkAway() => AwayCount++;

        public void Resume() => ResumeCount++;
    }

    /// <summary>
    /// The question the design could not answer from documentation: whether
    /// <c>WTSRegisterSessionNotification</c> accepts our hidden window. If it refuses, lock and
    /// unlock stop marking away immediately and every away window silently starts late — with no
    /// error, because polling still works.
    /// </summary>
    [Fact]
    public void RegistersForLockAndUnlockNotifications()
    {
        var registered = Wpf.Run(() =>
        {
            using var observer = new SessionObserver(new Spy(), idleSeconds: () => 0);
            observer.Start();
            return observer.IsRegisteredForSessionNotifications;
        });

        Assert.True(registered, "The OS refused WTSRegisterSessionNotification for the observer's window.");
    }

    /// <summary>Reads the real idle scalar. A wrong struct size makes this fail rather than lie.</summary>
    [Fact]
    public void ReadsAPlausibleIdleDurationFromTheSystem()
    {
        var seconds = SessionObserver.IdleSecondsFromSystem();

        Assert.InRange(seconds, 0, (int)TimeSpan.FromDays(60).TotalSeconds);
    }

    [Fact]
    public void PollsTheInjectedIdleSourceOnItsInterval()
    {
        var spy = Wpf.Run(() =>
        {
            var s = new Spy();
            using var observer = new SessionObserver(s, TimeSpan.FromMilliseconds(20), () => 42);
            observer.Start();

            // Let the dispatcher run its timer a few times without blocking the UI thread it lives on.
            var deadline = DateTime.UtcNow.AddMilliseconds(400);
            while (DateTime.UtcNow < deadline && s.Ticks.Count < 3)
            {
                System.Windows.Threading.Dispatcher.CurrentDispatcher.Invoke(
                    () => { },
                    System.Windows.Threading.DispatcherPriority.Background);
                Thread.Sleep(10);
            }

            observer.Stop();
            return s;
        });

        Assert.True(spy.Ticks.Count >= 3, $"expected repeated ticks, saw {spy.Ticks.Count}");
        Assert.All(spy.Ticks, t => Assert.Equal(42, t));
    }

    [Fact]
    public void StoppingUnregistersAndCanBeCalledTwice()
    {
        Wpf.Run(() =>
        {
            var observer = new SessionObserver(new Spy(), idleSeconds: () => 0);
            observer.Start();
            observer.Stop();
            Assert.False(observer.IsRegisteredForSessionNotifications);

            observer.Stop();
            observer.Dispose();
            return 0;
        });
    }

    /// <summary>Restarting must not leave the previous window registered behind it.</summary>
    [Fact]
    public void CanBeRestarted()
    {
        var registered = Wpf.Run(() =>
        {
            using var observer = new SessionObserver(new Spy(), idleSeconds: () => 0);
            observer.Start();
            observer.Stop();
            observer.Start();
            return observer.IsRegisteredForSessionNotifications;
        });

        Assert.True(registered);
    }
}

/// <summary>One system-edge timer feeding both coordinators.</summary>
public class FanOutSignalReceiverTests
{
    private sealed class Spy : ISignalReceiver
    {
        public List<string> Calls { get; } = [];

        public void Tick(int idleSeconds) => Calls.Add($"tick:{idleSeconds}");

        public void MarkAway() => Calls.Add("away");

        public void Resume() => Calls.Add("resume");
    }

    [Fact]
    public void ForwardsEverySignalToEveryReceiverInOrder()
    {
        var first = new Spy();
        var second = new Spy();
        var fanOut = new FanOutSignalReceiver(first, second);

        fanOut.Tick(30);
        fanOut.MarkAway();
        fanOut.Resume();

        Assert.Equal(["tick:30", "away", "resume"], first.Calls);
        Assert.Equal(["tick:30", "away", "resume"], second.Calls);
    }

    [Fact]
    public void ToleratesHavingNoReceivers()
    {
        new FanOutSignalReceiver().Tick(1); // must not throw
    }
}
