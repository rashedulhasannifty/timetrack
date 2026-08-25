using System.Globalization;
using System.Text.Json.Serialization;
using NiftyTimer.Auth;

namespace NiftyTimer.Reports;

/// <summary>
/// The signed-in person's own tracked totals, as the dropdown shows them.
///
/// Every boundary — which Dhaka day it is, when the week starts, when the month starts — is
/// decided by the server and arrives already resolved. Nothing here does date arithmetic: the
/// product's calendar is <c>APP_TIMEZONE = 'Asia/Dhaka'</c>, not UTC and not the machine's local
/// zone, so a second definition of "when does the week start" living in the client is exactly
/// what would quietly drift out of step with the dashboard.
/// </summary>
public sealed record SelfTotals(
    [property: JsonPropertyName("day")] string Day,
    [property: JsonPropertyName("weekStart")] string WeekStart,
    [property: JsonPropertyName("monthStart")] string MonthStart,
    [property: JsonPropertyName("todaySeconds")] int TodaySeconds,
    [property: JsonPropertyName("weekSeconds")] int WeekSeconds,
    [property: JsonPropertyName("monthSeconds")] int MonthSeconds);

public interface ISelfTotalsFetcher
{
    Task<SelfTotals> FetchAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// <c>GET /v1/reports/my-totals</c>. Available to any authenticated user and scoped to them
/// server-side — the route takes no user parameter at all. Any failure propagates so the caller
/// can show that the totals are unknown rather than showing a wrong number.
/// </summary>
public sealed class SelfTotalsClient : ISelfTotalsFetcher
{
    private readonly AuthorizedJsonClient _json;

    public SelfTotalsClient(AuthorizedJsonClient json) => _json = json;

    public Task<SelfTotals> FetchAsync(CancellationToken cancellationToken = default) =>
        _json.GetAsync<SelfTotals>("reports/my-totals", cancellationToken);
}

/// <summary>
/// "8h 12m", "12m", "0m" — the dropdown's format for a tracked duration.
///
/// Whole minutes: these are day/week/month figures, and a ticking seconds place next to the live
/// timer above would read as a second stopwatch. Hours are only shown once there is an hour.
/// </summary>
public static class WorkTotalFormat
{
    public static string Short(int seconds)
    {
        var total = Math.Max(0, seconds);
        var hours = total / 3600;
        var minutes = (total % 3600) / 60;
        return hours > 0
            ? string.Create(CultureInfo.InvariantCulture, $"{hours}h {minutes}m")
            : string.Create(CultureInfo.InvariantCulture, $"{minutes}m");
    }

    /// <summary>"0:00:00" — the live elapsed clock in the tray tooltip and the popup header.</summary>
    public static string Elapsed(TimeSpan elapsed)
    {
        var total = elapsed < TimeSpan.Zero ? TimeSpan.Zero : elapsed;
        return string.Create(
            CultureInfo.InvariantCulture,
            $"{(int)total.TotalHours}:{total.Minutes:D2}:{total.Seconds:D2}");
    }
}
