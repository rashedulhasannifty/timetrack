using System.ComponentModel;
using System.Runtime.CompilerServices;
using NiftyTimer.Projects;
using NiftyTimer.Reports;
using NiftyTimer.Tracking;

namespace NiftyTimer.App;

/// <summary>One row in the project picker: a project on its own, or one of its tasks.</summary>
public sealed record PickerChoice(string ProjectId, string? TaskId, string ProjectName, string? TaskName);

/// <summary>
/// What the tray dropdown shows and what it can do. UI-thread-only.
///
/// This is where readiness is enforced for MANUAL tracking: <see cref="TimeTracker"/> is not
/// behind <see cref="Policy.AckGate"/> (it is not a capture path — CLAUDE.md §1), so the rule
/// that an un-acknowledged user cannot start the clock lives here, in <see cref="IsReady"/>.
/// Capture paths do NOT rely on this; they are gated structurally and are installed only on the
/// online, acknowledged branch.
/// </summary>
public sealed class MenuViewModel : INotifyPropertyChanged
{
    private readonly TimeTracker _tracker;
    private readonly SelectionStore _selectionStore;
    private readonly Func<DateTimeOffset> _clock;

    private bool _isReady;
    private string? _userId;
    private IReadOnlyList<Project> _projects = [];
    private StoredSelection? _selection;
    private SelfTotals? _totals;
    private int _pendingCount;
    private bool _liveSyncBlocked;
    private bool _updateAvailable;
    private bool _updateOverdue;
    private string? _notice;
    private string _note = string.Empty;
    private string _query = string.Empty;
    private DateTimeOffset? _displayStart;
    private DateTimeOffset? _totalsFetchedAt;
    private bool _wasTracking;

    public MenuViewModel(
        TimeTracker tracker,
        SelectionStore selectionStore,
        Func<DateTimeOffset>? clock = null)
    {
        _tracker = tracker;
        _selectionStore = selectionStore;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the user asks to start tracking and the view model allowed it.</summary>
    public event Action? TrackingStarted;

    /// <summary>
    /// The clock went from running to not running — stopped, paused, rolled back, or auto-stopped.
    /// The live increment on the totals ends at that moment, so the figures would drop back to the
    /// last fetch; this is the cue to fetch fresh ones rather than show time going backwards.
    /// </summary>
    public event Action? TrackingStopped;

    /// <summary>
    /// True once the session is usable for manual tracking: signed in, and the monitoring policy
    /// acknowledged (either confirmed online this launch, or recorded locally by
    /// <see cref="Policy.AckMarker"/> on a previous one).
    /// </summary>
    public bool IsReady
    {
        get => _isReady;
        set => Set(ref _isReady, value, [nameof(CanStart), nameof(CanStop)]);
    }

    public string? UserId
    {
        get => _userId;
        set => Set(ref _userId, value);
    }

    public IReadOnlyList<Project> Projects
    {
        get => _projects;
        set => Set(ref _projects, value, [nameof(Choices), nameof(FilteredChoices)]);
    }

    /// <summary>
    /// What the person has typed into the picker's search field. Kept here rather than in the
    /// popup so it survives the popup hiding and showing, as the macOS dropdown's does, and so the
    /// filter is testable without a window.
    /// </summary>
    public string Query
    {
        get => _query;
        set => Set(ref _query, value ?? string.Empty, [nameof(FilteredChoices)]);
    }

    /// <summary>Every row the picker can offer: each project, then each of its tasks.</summary>
    public IReadOnlyList<PickerChoice> Choices => ChoicesFor(_projects);

    /// <summary>The rows matching <see cref="Query"/>. See <see cref="Filter"/>.</summary>
    public IReadOnlyList<PickerChoice> FilteredChoices => Filter(Choices, _query);

    /// <summary>
    /// A row matches when the query appears ANYWHERE in its project or task name, ignoring case —
    /// the macOS client's rule. The combo box this replaced only matched a prefix of the whole
    /// label, so "design" could not find "Website · Design review" at all.
    /// </summary>
    public static IReadOnlyList<PickerChoice> Filter(IReadOnlyList<PickerChoice> choices, string query)
    {
        if (string.IsNullOrEmpty(query))
        {
            return choices;
        }

        return choices
            .Where(c => c.ProjectName.Contains(query, StringComparison.OrdinalIgnoreCase)
                        || (c.TaskName?.Contains(query, StringComparison.OrdinalIgnoreCase) ?? false))
            .ToList();
    }

    private static List<PickerChoice> ChoicesFor(IReadOnlyList<Project> projects)
    {
        var choices = new List<PickerChoice>();
        foreach (var project in projects)
        {
            choices.Add(new PickerChoice(project.Id, null, project.Name, null));
            foreach (var task in project.Tasks ?? [])
            {
                choices.Add(new PickerChoice(project.Id, task.Id, project.Name, task.Name));
            }
        }

        return choices;
    }

    public StoredSelection? Selection
    {
        get => _selection;
        private set => Set(ref _selection, value, [nameof(SelectionLabel)]);
    }

    /// <summary>
    /// The server's figures, as of the moment they were assigned. That moment is what makes them
    /// live rather than a snapshot — see <see cref="LiveTotal"/>.
    /// </summary>
    public SelfTotals? Totals
    {
        get => _totals;
        set
        {
            // Stamped on every arrival, even an identical one: the base was true at THIS instant,
            // and the live increment counts from here.
            _totalsFetchedAt = value is null ? null : _clock();
            if (!Set(ref _totals, value, [nameof(TodayLabel), nameof(WeekLabel), nameof(MonthLabel)]))
            {
                Raise(nameof(TodayLabel), nameof(WeekLabel), nameof(MonthLabel));
            }
        }
    }

    /// <summary>How many records are still waiting to reach the server.</summary>
    public int PendingCount
    {
        get => _pendingCount;
        set => Set(ref _pendingCount, value, [nameof(PendingLabel), nameof(HasPending)]);
    }

    /// <summary>
    /// The running entry has failed to reach the server several times running. Surfaced because
    /// the alternative — a clock that looks like it is recording while the server hears nothing —
    /// is invisible from both ends.
    /// </summary>
    public bool LiveSyncBlocked
    {
        get => _liveSyncBlocked;
        set => Set(ref _liveSyncBlocked, value);
    }

    /// <summary>
    /// A newer build has been published. Advisory only — nothing in the update path may stop,
    /// block or alter tracking, so this drives a menu line and nothing else.
    /// </summary>
    public bool UpdateAvailable
    {
        get => _updateAvailable;
        set => Set(ref _updateAvailable, value);
    }

    /// <summary>The newer build has been available past the grace period. Adds a tray marker.</summary>
    public bool UpdateOverdue
    {
        get => _updateOverdue;
        set => Set(ref _updateOverdue, value);
    }

    /// <summary>A one-line message for the user; null when there is nothing to say.</summary>
    public string? Notice
    {
        get => _notice;
        set => Set(ref _notice, value, [nameof(HasNotice)]);
    }

    public bool HasNotice => !string.IsNullOrEmpty(_notice);

    /// <summary>The free-text note applied to the running span, in place.</summary>
    public string Note
    {
        get => _note;
        set
        {
            if (Set(ref _note, value))
            {
                _tracker.SetNote(string.IsNullOrWhiteSpace(value) ? null : value);
            }
        }
    }

    public bool IsTracking => _tracker.IsRunning;

    public bool IsPaused => _tracker.IsPaused;

    public bool CanStart => IsReady && !IsTracking;

    public bool CanStop => IsReady && (IsTracking || IsPaused);

    public bool HasPending => _pendingCount > 0;

    public string PendingLabel => _pendingCount == 1 ? "1 record pending" : $"{_pendingCount} records pending";

    public string ElapsedLabel => WorkTotalFormat.Elapsed(Elapsed);

    /// <summary>
    /// How long the dropdown says you have been working on this stretch.
    ///
    /// Usually the running entry's own age. The exception is a discarded idle window: that trims
    /// the entry and opens a fresh one, so the entry's age restarts at zero even though the person
    /// worked for an hour before stepping away. <see cref="ContinueClockAfterDiscard"/> supplies the
    /// instant to count from instead, so the clock keeps reading accumulated WORKED time.
    /// </summary>
    public TimeSpan Elapsed =>
        _tracker.State is TrackerState.Tracking t ? _clock() - (_displayStart ?? t.StartedAt) : TimeSpan.Zero;

    /// <summary>
    /// The selection an auto-started span should carry. Never a note: a note is something the
    /// person typed about work they chose to record, and attaching it to time the machine started
    /// on their behalf would put words in their mouth.
    /// </summary>
    public TimeTracker.Selection SelectionForAuto => new(_selection?.ProjectId, _selection?.TaskId);

    public string TodayLabel => _totals is null ? "—" : WorkTotalFormat.Short(Live(_totals.TodaySeconds));

    public string WeekLabel => _totals is null ? "—" : WorkTotalFormat.Short(Live(_totals.WeekSeconds));

    public string MonthLabel => _totals is null ? "—" : WorkTotalFormat.Short(Live(_totals.MonthSeconds));

    /// <summary>
    /// A total as it stands right now: the server's figure plus the tracked time accrued since it
    /// was fetched. The same increment applies to all three — a minute worked now is a minute of
    /// today, of this week and of this month.
    ///
    /// Anchored on <c>max(fetchedAt, runningSince)</c>, which is the whole trick:
    /// <list type="bullet">
    ///   <item>the fetched figure ALREADY counts the running session up to the fetch, so counting
    ///   from the session start would count most of it twice;</item>
    ///   <item>a session that began AFTER the fetch has only run since its start, so counting from
    ///   the fetch would add time that was never tracked.</item>
    /// </list>
    /// Only while the clock actually runs — paused or stopped accrues nothing.
    /// </summary>
    public static int LiveTotal(int baseSeconds, DateTimeOffset? runningSince, DateTimeOffset? fetchedAt, DateTimeOffset now)
    {
        if (runningSince is not { } start || fetchedAt is not { } fetched)
        {
            return baseSeconds;
        }

        var since = fetched > start ? fetched : start;
        return baseSeconds + Math.Max(0, (int)(now - since).TotalSeconds);
    }

    // The entry's REAL start, not the display anchor: the server counts the entry itself, so the
    // anchor a discarded idle window leaves behind would double-count the discarded minutes.
    private int Live(int baseSeconds) =>
        LiveTotal(
            baseSeconds,
            _tracker.State is TrackerState.Tracking t ? t.StartedAt : null,
            _totalsFetchedAt,
            _clock());

    public string SelectionLabel
    {
        get
        {
            if (_selection is null)
            {
                return "No project";
            }

            var project = _projects.FirstOrDefault(p => p.Id == _selection.ProjectId);
            if (project is null)
            {
                return "No project";
            }

            var task = _selection.TaskId is null
                ? null
                : project.Tasks?.FirstOrDefault(t => t.Id == _selection.TaskId);

            return task is null ? project.Name : $"{project.Name} · {task.Name}";
        }
    }

    public void Start()
    {
        if (!CanStart)
        {
            return;
        }

        Notice = null;
        _displayStart = null;
        _tracker.Start(_selection?.ProjectId, _selection?.TaskId, NoteOrNull());
        TrackingStarted?.Invoke();
        RaiseTrackingState();
    }

    /// <summary>
    /// What the global hotkey does: resume if paused, stop if running, start if we can, and
    /// otherwise do nothing at all. Silence is the right answer for the last case — the hotkey
    /// fires from whatever application has focus, so a person who pressed it before signing in
    /// should not be interrupted by an error they did not ask for.
    ///
    /// Paused resumes rather than stops, matching the macOS client: a pause is a break the person
    /// means to come back from, and the one-key way back should not end the session instead.
    /// </summary>
    public void ToggleTracking()
    {
        if (IsPaused)
        {
            Resume();
        }
        else if (IsTracking)
        {
            Stop();
        }
        else if (CanStart)
        {
            Start();
        }
    }

    public void Stop()
    {
        if (!CanStop)
        {
            return;
        }

        _displayStart = null;
        _tracker.Stop();
        RaiseTrackingState();
    }

    public void Pause()
    {
        _displayStart = null;
        _tracker.Pause();
        RaiseTrackingState();
    }

    public void Resume()
    {
        if (!IsReady)
        {
            return;
        }

        _displayStart = null;
        _tracker.Resume();
        RaiseTrackingState();
    }

    /// <summary>
    /// Re-read the tracker and republish the derived state.
    ///
    /// The manual affordances all mutate the tracker THROUGH this view model, so they can raise as
    /// they go. The AUTO path does not — <see cref="AutoTrackingCoordinator"/> writes straight to
    /// <see cref="TimeTracker"/> — so an auto open or close is invisible from here until something
    /// asks. This is that seam, and it derives everything from the tracker rather than taking a
    /// state argument, so it cannot drift from what the tracker actually holds.
    /// </summary>
    public void RefreshFromTracker()
    {
        _displayStart = null;
        RaiseTrackingState();
    }

    /// <summary>
    /// A discarded idle window replaced the running entry (see
    /// <see cref="ManualIdleCoordinator"/>). <paramref name="displayStart"/> is the instant the
    /// clock should count from so it keeps reading worked time rather than jumping back to zero —
    /// the swap happens directly on <see cref="TimeTracker"/> and is invisible from here otherwise.
    /// </summary>
    public void ContinueClockAfterDiscard(DateTimeOffset displayStart)
    {
        _displayStart = displayStart;
        RaiseTrackingState();
    }

    /// <summary>
    /// The server refused to open <paramref name="entryId"/>: this user is already tracking on
    /// another machine. The clock is rolled back rather than left running against a span the
    /// server never accepted.
    ///
    /// Ignored if that span is no longer the running one — the 409 answers a fire-and-forget
    /// publish, so it can arrive after the span was superseded, and rolling back the current span
    /// on a stale answer would stop a clock the server never objected to.
    /// </summary>
    public void HandleTrackingConflict(string entryId)
    {
        if (!_tracker.AbandonRunningSpan(entryId))
        {
            return;
        }

        _displayStart = null;
        LiveSyncBlocked = false;
        Notice = "Already tracking on another machine — stop it there first.";
        RaiseTrackingState();
    }

    public void SelectProject(string projectId, string? taskId)
    {
        _displayStart = null;
        Selection = new StoredSelection(projectId, taskId);
        if (_userId is { } userId)
        {
            _selectionStore.Save(Selection, userId);
        }

        // A project switch DOES re-attribute the time, so a running span is closed and reopened
        // under the new selection. (A note change does not — see TimeTracker.SetNote.)
        if (_tracker.State is TrackerState.Tracking)
        {
            _tracker.Stop();
            _tracker.Start(projectId, taskId, NoteOrNull());
            TrackingStarted?.Invoke();
        }
        else if (_tracker.State is TrackerState.Paused)
        {
            _tracker.Reselect(new TimeTracker.Selection(projectId, taskId, NoteOrNull()));
        }

        RaiseTrackingState();
    }

    /// <summary>Restore the sticky selection for this user, dropping anything now stale.</summary>
    public void RestoreSelection(string userId)
    {
        UserId = userId;
        Selection = SelectionResolver.Resolve(_selectionStore.Load(userId), _projects);
    }

    /// <summary>
    /// Sign-out: drop everything user-specific from memory so the next person to sign in on this
    /// machine cannot inherit it (CLAUDE.md §1).
    /// </summary>
    public void Reset()
    {
        IsReady = false;
        UserId = null;
        Projects = [];
        Selection = null;
        Totals = null;
        PendingCount = 0;
        LiveSyncBlocked = false;
        Notice = null;
        Note = string.Empty;
        Query = string.Empty;
        _displayStart = null;
        RaiseTrackingState();
    }

    /// <summary>Called once a second while the popup is open, to advance the live elapsed clock.</summary>
    public void Tick() =>
        Raise(nameof(ElapsedLabel), nameof(Elapsed), nameof(TodayLabel), nameof(WeekLabel), nameof(MonthLabel));

    private string? NoteOrNull() => string.IsNullOrWhiteSpace(_note) ? null : _note;

    private void RaiseTrackingState()
    {
        Raise(
            nameof(IsTracking),
            nameof(IsPaused),
            nameof(CanStart),
            nameof(CanStop),
            nameof(ElapsedLabel),
            nameof(Elapsed),
            nameof(TodayLabel),
            nameof(WeekLabel),
            nameof(MonthLabel));

        // Every path that changes the tracker's state ends here, the auto layer included (through
        // RefreshFromTracker), so this is the one place a stop can be observed.
        var tracking = IsTracking;
        if (_wasTracking && !tracking)
        {
            TrackingStopped?.Invoke();
        }

        _wasTracking = tracking;
    }

    private bool Set<T>(
        ref T field,
        T value,
        string[]? also = null,
        [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(propertyName!);
        if (also is not null)
        {
            Raise(also);
        }

        return true;
    }

    private void Raise(params string[] names)
    {
        foreach (var name in names)
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
        }
    }
}
