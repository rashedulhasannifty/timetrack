using NiftyTimer.Notifications;
using NiftyTimer.Reports;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>A totals fetcher under test control.</summary>
public sealed class FakeTotalsFetcher : ISelfTotalsFetcher
{
    private readonly Func<SelfTotals> _next;

    public FakeTotalsFetcher(int todaySeconds = 3600)
        : this(() => new SelfTotals("2026-08-25", "2026-08-24", "2026-08-01", todaySeconds, 0, 0))
    {
    }

    public FakeTotalsFetcher(Func<SelfTotals> next) => _next = next;

    public int Calls { get; private set; }

    public Task<SelfTotals> FetchAsync(CancellationToken cancellationToken = default)
    {
        Calls++;
        return Task.FromResult(_next());
    }
}

public sealed class NotifierSpy : ILocalNotifier
{
    public List<(string Id, string Title, string Body)> Sent { get; } = [];

    public void Notify(string id, string title, string body) => Sent.Add((id, title, body));
}

public class LocalNotifierTests
{
    [Fact]
    public void ItPassesTheTitleAndBodyThrough()
    {
        var shown = new List<(string, string)>();
        var notifier = new LocalNotifier((t, b) => shown.Add((t, b)));

        notifier.Notify("idle", "Time tracking", "Still there?");

        Assert.Equal(("Time tracking", "Still there?"), Assert.Single(shown));
    }

    /// <summary>
    /// Two monitors reaching the same conclusion within seconds must not stack balloons on top of
    /// each other.
    /// </summary>
    [Fact]
    public void TheSameNudgeDoesNotRepeatImmediately()
    {
        var now = DateTimeOffset.Parse("2026-08-25T09:00:00Z", null);
        var shown = new List<(string, string)>();
        var notifier = new LocalNotifier((t, b) => shown.Add((t, b)), () => now);

        notifier.Notify("idle", "Time tracking", "Still there?");
        now = now.AddMinutes(1);
        notifier.Notify("idle", "Time tracking", "Still there?");

        Assert.Single(shown);
    }

    [Fact]
    public void ADifferentNudgeIsNotSuppressed()
    {
        var now = DateTimeOffset.Parse("2026-08-25T09:00:00Z", null);
        var shown = new List<(string, string)>();
        var notifier = new LocalNotifier((t, b) => shown.Add((t, b)), () => now);

        notifier.Notify("idle", "Time tracking", "a");
        notifier.Notify("forgot-to-start", "Time tracking", "b");

        Assert.Equal(2, shown.Count);
    }

    [Fact]
    public void TheSuppressionExpires()
    {
        var now = DateTimeOffset.Parse("2026-08-25T09:00:00Z", null);
        var shown = new List<(string, string)>();
        var notifier = new LocalNotifier((t, b) => shown.Add((t, b)), () => now);

        notifier.Notify("idle", "Time tracking", "a");
        now = now.AddMinutes(6);
        notifier.Notify("idle", "Time tracking", "a");

        Assert.Equal(2, shown.Count);
    }

    /// <summary>
    /// Sign-out must clear it. Otherwise the next person on a shared machine silently loses a
    /// nudge because the previous one saw the same nudge four minutes ago.
    /// </summary>
    [Fact]
    public void ResetForgetsTheSuppression()
    {
        var now = DateTimeOffset.Parse("2026-08-25T09:00:00Z", null);
        var shown = new List<(string, string)>();
        var notifier = new LocalNotifier((t, b) => shown.Add((t, b)), () => now);

        notifier.Notify("idle", "Time tracking", "a");
        notifier.Reset();
        notifier.Notify("idle", "Time tracking", "a");

        Assert.Equal(2, shown.Count);
    }
}

public class EndOfDaySchedulerTests
{
    private static DateTimeOffset Local(string time) => DateTimeOffset.Parse($"2026-08-25T{time}", null);

    private static EndOfDayScheduler Build(
        NotifierSpy notifier,
        ISelfTotalsFetcher totals,
        Func<DateTimeOffset> clock) =>
        new(notifier, totals, new TimeOnly(18, 0), clock);

    [Fact]
    public async Task NothingIsSentBeforeTheHour()
    {
        var notifier = new NotifierSpy();
        var totals = new FakeTotalsFetcher();
        var scheduler = Build(notifier, totals, () => Local("17:59:00"));

        Assert.False(await scheduler.TickAsync());
        Assert.Empty(notifier.Sent);

        // And it must not have spent a request finding that out.
        Assert.Equal(0, totals.Calls);
    }

    [Fact]
    public async Task TheSummaryIsSentOnceTheHourArrives()
    {
        var notifier = new NotifierSpy();
        var scheduler = Build(notifier, new FakeTotalsFetcher(todaySeconds: 22_800), () => Local("18:00:00"));

        Assert.True(await scheduler.TickAsync());

        var sent = Assert.Single(notifier.Sent);
        Assert.Equal(EndOfDayScheduler.NotificationId, sent.Id);
        Assert.Contains("6h 20m", sent.Body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ItIsSentOnlyOncePerDay()
    {
        var now = Local("18:00:00");
        var notifier = new NotifierSpy();
        var scheduler = Build(notifier, new FakeTotalsFetcher(), () => now);

        Assert.True(await scheduler.TickAsync());
        now = Local("19:00:00");
        Assert.False(await scheduler.TickAsync());
        now = Local("23:30:00");
        Assert.False(await scheduler.TickAsync());

        Assert.Single(notifier.Sent);
    }

    [Fact]
    public async Task ANewDayReArmsIt()
    {
        var now = Local("18:00:00");
        var notifier = new NotifierSpy();
        var scheduler = Build(notifier, new FakeTotalsFetcher(), () => now);

        await scheduler.TickAsync();
        now = now.AddDays(1);
        Assert.True(await scheduler.TickAsync());

        Assert.Equal(2, notifier.Sent.Count);
    }

    /// <summary>
    /// The number comes from the server, whose day boundary is Asia/Dhaka. That is the whole
    /// reason the local accumulator was deleted rather than wired in: a locally-tallied figure
    /// would contradict the dashboard the person checks straight after reading the toast.
    /// </summary>
    [Fact]
    public async Task TheFigureComesFromTheServerResolvedTotals()
    {
        var notifier = new NotifierSpy();
        var totals = new FakeTotalsFetcher(todaySeconds: 3_600);
        var scheduler = Build(notifier, totals, () => Local("18:30:00"));

        await scheduler.TickAsync();

        Assert.Equal(1, totals.Calls);
        Assert.Contains("1h 0m", Assert.Single(notifier.Sent).Body, StringComparison.Ordinal);
    }

    /// <summary>
    /// A failed fetch sends nothing. A summary reading "0m" because the network was down looks
    /// like a claim about the person's day, and it would be a false one.
    /// </summary>
    [Fact]
    public async Task AFailedFetchSendsNothingRatherThanZero()
    {
        var notifier = new NotifierSpy();
        var totals = new FakeTotalsFetcher(() => throw new NiftyTimer.Auth.ResourceUnavailableException("x", 503));
        var scheduler = Build(notifier, totals, () => Local("18:00:00"));

        Assert.False(await scheduler.TickAsync());
        Assert.Empty(notifier.Sent);
    }

    [Fact]
    public async Task ResetLetsTheNextUserGetTheirOwnSummary()
    {
        var notifier = new NotifierSpy();
        var scheduler = Build(notifier, new FakeTotalsFetcher(), () => Local("18:00:00"));

        await scheduler.TickAsync();
        scheduler.Reset();
        Assert.True(await scheduler.TickAsync());

        Assert.Equal(2, notifier.Sent.Count);
    }
}

public class EndOfDayBeforeSignInTests
{
    private static DateTimeOffset Local(string time) => DateTimeOffset.Parse($"2026-08-25T{time}", null);

    /// <summary>
    /// The app starts its scheduler before sign-in, and its first tick fires immediately. Someone
    /// opening their laptop at 18:30 therefore polls while signed out, the fetch fails, and — if
    /// the day were claimed before the await — they would silently never get a summary that day
    /// despite signing in a minute later.
    /// </summary>
    [Fact]
    public async Task AFetchThatFailedWhileSignedOutDoesNotConsumeTheDay()
    {
        var now = Local("18:30:00");
        var notifier = new NotifierSpy();
        var signedIn = false;

        var totals = new FakeTotalsFetcher(() => signedIn
            ? new SelfTotals("2026-08-25", "2026-08-24", "2026-08-01", 3600, 0, 0)
            : throw new NiftyTimer.Auth.NotAuthenticatedException());

        var scheduler = new EndOfDayScheduler(notifier, totals, new TimeOnly(18, 0), () => now);

        Assert.False(await scheduler.TickAsync());
        Assert.Empty(notifier.Sent);

        signedIn = true;
        now = Local("18:31:00");

        Assert.True(await scheduler.TickAsync());
        Assert.Single(notifier.Sent);
    }
}
