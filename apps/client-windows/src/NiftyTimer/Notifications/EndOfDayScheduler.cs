using System.Globalization;
using NiftyTimer.Reports;

namespace NiftyTimer.Notifications;

/// <summary>
/// The end-of-day summary nudge: once per day, at a local wall-clock hour, "you tracked 6h 20m
/// today".
///
/// **Two different clocks are involved here and conflating them is the trap.** WHEN to show the
/// notification is a question about the person's own evening, so it uses the machine's local time
/// — 18:00 means six in the evening where they are sitting. WHAT NUMBER to show is a question
/// about the product's calendar, which is <c>APP_TIMEZONE = 'Asia/Dhaka'</c>, so it comes from
/// <c>reports/my-totals</c> with the day boundary already resolved by the server.
///
/// This is why <c>DailyTotalAccumulator</c> was deleted rather than wired in. It tallied closed
/// spans against the machine's local calendar, which is correct for a Dhaka-based employee and
/// silently wrong for a remote one — their toast would have disagreed with the dashboard they
/// check right after reading it. Its own documentation predicted exactly that. The fix is not to
/// adjust the tally, it is to not have a second definition of "today" in the client at all.
///
/// Advisory only: it never starts, stops or alters tracking.
/// </summary>
public sealed class EndOfDayScheduler : IDisposable
{
    /// <summary>The notification id, shared with the notifier's de-duplication.</summary>
    public const string NotificationId = "end-of-day";

    private readonly ILocalNotifier _notifier;
    private readonly ISelfTotalsFetcher _totals;
    private readonly TimeOnly _at;
    private readonly Func<DateTimeOffset> _localClock;
    private readonly TimeSpan _pollInterval;
    private readonly Lock _gate = new();

    private DateOnly? _lastFired;
    private Timer? _timer;
    private bool _disposed;

    public EndOfDayScheduler(
        ILocalNotifier notifier,
        ISelfTotalsFetcher totals,
        TimeOnly? at = null,
        Func<DateTimeOffset>? localClock = null,
        TimeSpan? pollInterval = null)
    {
        _notifier = notifier;
        _totals = totals;
        _at = at ?? new TimeOnly(18, 0);
        _localClock = localClock ?? (() => DateTimeOffset.Now);
        _pollInterval = pollInterval ?? TimeSpan.FromMinutes(5);
    }

    public void Start()
    {
        lock (_gate)
        {
            if (_timer is not null || _disposed)
            {
                return;
            }

            _timer = new Timer(
                static state => _ = ((EndOfDayScheduler)state!).TickAsync(),
                this,
                TimeSpan.Zero,
                _pollInterval);
        }
    }

    public void Stop()
    {
        lock (_gate)
        {
            _timer?.Dispose();
            _timer = null;
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Stop();
    }

    /// <summary>
    /// Whether the summary is due. Pure, and the tested surface.
    ///
    /// Deliberately does NOT fire for a day it missed entirely — a laptop opened at 09:00 must not
    /// greet the person with yesterday's summary, and one opened at 23:00 has nothing useful to
    /// say about a day that is over. Late is fine within the same day; a day skipped is skipped.
    /// </summary>
    internal bool IsDue(DateTimeOffset localNow)
    {
        var today = DateOnly.FromDateTime(localNow.DateTime);
        if (_lastFired == today)
        {
            return false;
        }

        return TimeOnly.FromDateTime(localNow.DateTime) >= _at;
    }

    /// <summary>One poll. Returns whether it notified.</summary>
    public async Task<bool> TickAsync(CancellationToken cancellationToken = default)
    {
        var localNow = _localClock();

        lock (_gate)
        {
            if (!IsDue(localNow))
            {
                return false;
            }

            // Claim the day BEFORE the await. Two polls overlapping across a slow fetch would
            // otherwise both pass the check and send two summaries.
            _lastFired = DateOnly.FromDateTime(localNow.DateTime);
        }

        SelfTotals totals;
        try
        {
            totals = await _totals.FetchAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception e) when (e is Auth.ResourceUnavailableException or Auth.NotAuthenticatedException
                                      or Auth.AuthException or OperationCanceledException)
        {
            // No number, no notification. A summary reading "0m" because the network was down
            // would be worse than silence — it looks like a claim about the person's day.
            return false;
        }

        _notifier.Notify(
            NotificationId,
            "Today's tracked time",
            string.Create(
                CultureInfo.InvariantCulture,
                $"You tracked {WorkTotalFormat.Short(totals.TodaySeconds)} today."));

        return true;
    }

    /// <summary>Forget that today's summary was sent. Called on sign-out, so the next person on
    /// this machine gets their own.</summary>
    public void Reset()
    {
        lock (_gate)
        {
            _lastFired = null;
        }
    }
}
