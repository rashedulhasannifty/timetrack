using System.ComponentModel;
using System.Runtime.CompilerServices;
using NiftyTimer.Projects;
using NiftyTimer.Reports;
using NiftyTimer.Tracking;

namespace NiftyTimer.App;

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
    private DateTimeOffset? _displayStart;

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
        set => Set(ref _projects, value);
    }

    public StoredSelection? Selection
    {
        get => _selection;
        private set => Set(ref _selection, value, [nameof(SelectionLabel)]);
    }

    public SelfTotals? Totals
    {
        get => _totals;
        set => Set(ref _totals, value, [nameof(TodayLabel), nameof(WeekLabel), nameof(MonthLabel)]);
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

    public string TodayLabel => _totals is null ? "—" : WorkTotalFormat.Short(_totals.TodaySeconds);

    public string WeekLabel => _totals is null ? "—" : WorkTotalFormat.Short(_totals.WeekSeconds);

    public string MonthLabel => _totals is null ? "—" : WorkTotalFormat.Short(_totals.MonthSeconds);

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
    /// What the global hotkey does: start if we can, stop if we are running, and otherwise do
    /// nothing at all. Silence is the right answer for the third case — the hotkey fires from
    /// whatever application has focus, so a person who pressed it before signing in should not be
    /// interrupted by an error they did not ask for.
    /// </summary>
    public void ToggleTracking()
    {
        if (CanStop)
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
        _displayStart = null;
        RaiseTrackingState();
    }

    /// <summary>Called once a second while the popup is open, to advance the live elapsed clock.</summary>
    public void Tick() => Raise(nameof(ElapsedLabel), nameof(Elapsed));

    private string? NoteOrNull() => string.IsNullOrWhiteSpace(_note) ? null : _note;

    private void RaiseTrackingState() =>
        Raise(
            nameof(IsTracking),
            nameof(IsPaused),
            nameof(CanStart),
            nameof(CanStop),
            nameof(ElapsedLabel),
            nameof(Elapsed));

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
