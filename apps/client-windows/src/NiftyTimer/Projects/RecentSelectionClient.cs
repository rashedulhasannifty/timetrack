using System.Text.Json.Serialization;
using NiftyTimer.Auth;
using NiftyTimer.Tracking;

namespace NiftyTimer.Projects;

/// <summary>
/// What <see cref="RecentSelectionClient.MostRecentSelectionAsync"/> learned. Split three ways so
/// the caller can tell "the server answered and there is nothing to restore" apart from "no answer
/// was obtained" — a 429 from the throttler or a 503 mid-deploy must not burn the caller's
/// one-shot attempt the way a real answer does.
/// </summary>
public abstract record RecentSelectionOutcome
{
    public sealed record Found(StoredSelection Selection) : RecentSelectionOutcome;

    public sealed record NotFound : RecentSelectionOutcome;

    public sealed record TransientFailure : RecentSelectionOutcome;
}

/// <summary>The fields of a <c>GET /v1/time-entries</c> row this reads, and nothing else.</summary>
public sealed record RecentEntryRow(
    [property: JsonPropertyName("startTime")] string StartTime,
    [property: JsonPropertyName("projectId")] string? ProjectId,
    [property: JsonPropertyName("taskId")] string? TaskId);

/// <summary>
/// Fallback for a FRESH INSTALL: which project was this person last tracking against? Ported from
/// the macOS client's <c>RecentSelectionClient</c>.
///
/// Reads the existing <c>GET /v1/time-entries</c> — no new endpoint, no <c>/v1</c> change. Strictly
/// a fallback: consulted only when <see cref="SelectionStore"/> has nothing for this user, and a
/// failure leaves nothing pre-selected rather than blocking anything. Not a capture path.
/// </summary>
public sealed class RecentSelectionClient
{
    /// <summary>
    /// A fortnight covers a holiday or a new laptop arriving mid-sprint without dragging back a
    /// project abandoned months ago.
    /// </summary>
    private const int LookbackDays = 14;

    private readonly AuthorizedJsonClient _json;
    private readonly Func<DateTimeOffset> _clock;

    public RecentSelectionClient(AuthorizedJsonClient json, Func<DateTimeOffset>? clock = null)
    {
        _json = json;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public async Task<RecentSelectionOutcome> MostRecentSelectionAsync(CancellationToken cancellationToken = default)
    {
        var now = _clock();
        var path = "time-entries?from=" + Uri.EscapeDataString(UuidV7.Iso(now.AddDays(-LookbackDays)))
            + "&to=" + Uri.EscapeDataString(UuidV7.Iso(now));

        try
        {
            var rows = await _json.GetAsync<List<RecentEntryRow>>(path, cancellationToken).ConfigureAwait(false);
            return NewestSelection(rows) is { } selection
                ? new RecentSelectionOutcome.Found(selection)
                : new RecentSelectionOutcome.NotFound();
        }
        catch (Exception e) when (e is ResourceUnavailableException or NotAuthenticatedException
                                      or AuthException or OperationCanceledException)
        {
            return new RecentSelectionOutcome.TransientFailure();
        }
    }

    /// <summary>The newest row that actually names a project. Pure, and the tested surface.</summary>
    public static StoredSelection? NewestSelection(IEnumerable<RecentEntryRow> rows) =>
        rows
            .Where(r => r.ProjectId is not null)
            .OrderByDescending(r => r.StartTime, StringComparer.Ordinal)
            .Select(r => new StoredSelection(r.ProjectId!, r.TaskId))
            .FirstOrDefault();
}
