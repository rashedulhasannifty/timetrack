namespace NiftyTimer.Tracking;

/// <summary>
/// A minimal local tally of today's tracked seconds, for the end-of-day summary notification that
/// lands in S4. <see cref="TimeTracker"/> keeps no daily history, so this observes each closed span
/// (via <c>SpanClosed</c>) and sums durations for the current day. A span is attributed to its END
/// day; a span whose end lands on a new day rolls the tally over, dropping the prior day — the
/// summary is a nicety, not a record of truth.
///
/// <b>This is the one place the client is allowed to do local date maths, precisely because
/// nothing it produces reaches the API.</b> The product's calendar is <c>Asia/Dhaka</c> and the
/// server returns <c>day</c>/<c>weekStart</c>/<c>monthStart</c> already resolved, so every figure
/// the user is shown as a total comes from <c>reports/my-totals</c>. If this value is ever routed
/// into a request body or displayed as an authoritative total, that rule is broken and the number
/// will disagree with the dashboard for everyone whose machine is not on Dhaka time.
///
/// Not a capture path; touches no network and no disk. UI-thread-only, fed by
/// <see cref="TimeTracker"/>.
/// </summary>
public sealed class DailyTotalAccumulator
{
    private readonly Func<DateTimeOffset, DateTimeOffset> _toLocal;

    private DateOnly? _day;
    private int _seconds;

    public DailyTotalAccumulator(Func<DateTimeOffset, DateTimeOffset>? toLocal = null) =>
        _toLocal = toLocal ?? (t => t.ToLocalTime());

    public void Add(DateTimeOffset start, DateTimeOffset end)
    {
        var duration = Math.Max(0, (int)(end - start).TotalSeconds);
        var endDay = DateOnly.FromDateTime(_toLocal(end).DateTime);

        if (_day == endDay)
        {
            _seconds += duration;
        }
        else
        {
            _day = endDay;
            _seconds = duration; // roll over to the span's end-day
        }
    }

    /// <summary>Today's tally iff the stored day matches <paramref name="now"/>; else zero.</summary>
    public int TodaySeconds(DateTimeOffset now) =>
        _day == DateOnly.FromDateTime(_toLocal(now).DateTime) ? _seconds : 0;

    public void Reset()
    {
        _day = null;
        _seconds = 0;
    }
}
