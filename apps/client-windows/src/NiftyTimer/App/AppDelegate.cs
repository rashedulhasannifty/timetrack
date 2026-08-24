using System.Net.Http;
using System.Windows;
using System.Windows.Threading;
using NiftyTimer.Auth;
using NiftyTimer.Policy;
using NiftyTimer.Projects;
using NiftyTimer.Reports;
using NiftyTimer.Storage;
using NiftyTimer.Sync;
using NiftyTimer.Tracking;
using NiftyTimer.UI;

namespace NiftyTimer.App;

/// <summary>
/// The wiring hub. Owns every long-lived object and the launch sequence.
///
/// Two structural properties of this file are load-bearing and must survive any refactor:
///
/// 1. The tray indicator is created FIRST and unconditionally. Not after sign-in, not after the
///    policy fetch, not behind any flag (PRD §4.2).
/// 2. Capture subsystems are installed ONLY on the online, acknowledged branch of
///    <see cref="ProceedToPolicyAsync"/>. The offline branch re-enables manual tracking and
///    nothing else, so an offline launch cannot reach a capture API even in principle — there is
///    no code path from it to one. Do not "simplify" the two branches into one with a boolean.
/// </summary>
public sealed class AppDelegate : IDisposable
{
    private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromSeconds(60);

    private readonly AppConfig _config = AppConfig.Load();
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private readonly CancellationTokenSource _shutdown = new();

    private BufferStore _buffer = null!;
    private JsonUserSettings _settings = null!;
    private AuthSession _session = null!;
    private AckMarker _ackMarker = null!;
    private LivePolicy _livePolicy = null!;
    private AckGate _ackGate = null!;
    private PolicyClient _policyClient = null!;
    private AckClient _ackClient = null!;
    private ProjectClient _projectClient = null!;
    private ProjectCache _projectCache = null!;
    private SelfTotalsClient _totalsClient = null!;
    private SelectionStore _selectionStore = null!;
    private TimeTracker _tracker = null!;
    private SyncEngine _sync = null!;
    private LiveEntryPublisher _livePublisher = null!;
    private MenuViewModel _viewModel = null!;

    private TrayIconController _tray = null!;
    private TrayPopupWindow _popup = null!;
    private LoginWindow? _login;
    private AckWindow? _ack;

    private DispatcherTimer? _heartbeat;
    private DispatcherTimer? _refresh;
    private bool _disposed;

    public void Start()
    {
        var support = AppInstall.SupportDirectory(_config.AppId);
        Directory.CreateDirectory(support);

        _settings = new JsonUserSettings(Path.Combine(support, "settings.json"));
        _buffer = new BufferStore(Path.Combine(support, "buffer"));
        _projectCache = new ProjectCache(Path.Combine(support, "projects.json"));

        var tokenStore = new DpapiTokenStore(
            Path.Combine(support, AppInstall.TokenFileName(_config.AppId)));

        _session = new AuthSession(
            new AuthClient(_http, _config.ApiBaseUri),
            tokenStore,
            _settings);

        var json = new AuthorizedJsonClient(_http, _config.ApiBaseUri, _session);
        _policyClient = new PolicyClient(_http, _config.ApiBaseUri, _session);
        _ackClient = new AckClient(_http, _config.ApiBaseUri, _session);
        _projectClient = new ProjectClient(json);
        _totalsClient = new SelfTotalsClient(json);

        _ackMarker = new AckMarker(_settings);
        _livePolicy = new LivePolicy();
        _ackGate = new AckGate(_policyClient, policy => _livePolicy.Update(policy.Settings));

        _selectionStore = new SelectionStore(_settings);
        _tracker = new TimeTracker(_buffer);

        var uploader = new TimeEntryUploader(_http, _config.ApiBaseUri, _session);
        var idleUploader = new TimeEntryUploader(_http, _config.ApiBaseUri, _session, "idle-events");
        _sync = new SyncEngine(_buffer, uploader, idleUploader);
        _livePublisher = new LiveEntryPublisher(uploader);

        _viewModel = new MenuViewModel(_tracker, _selectionStore);

        // ── The indicator comes first, and is never conditional. ─────────────────────────────
        _tray = new TrayIconController(Path.Combine(AppContext.BaseDirectory, "Resources"));
        _popup = new TrayPopupWindow(_viewModel, _config.DashboardUri, BuildStamp.Describe(_config.AppId));

        WireEvents();

        _sync.Start();
        StartTimers();

        _ = BootstrapAsync();
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        _heartbeat?.Stop();
        _refresh?.Stop();
        _shutdown.Cancel();

        _sync?.Dispose();
        _tray?.Dispose();
        _session?.Dispose();
        _http.Dispose();
        _shutdown.Dispose();
    }

    private void WireEvents()
    {
        _tray.Activated += () => _popup.ShowNearTray();
        _tray.ContextMenuRequested += () => _popup.ShowNearTray();

        _popup.SignOutRequested += () => _ = SignOutAsync();
        _popup.QuitRequested += () =>
        {
            // The popup cancels its own Closing so that dismissing it never ends the process —
            // the tray icon is the app's real lifetime. Application.Shutdown() closes every window
            // on the way out, so without lifting that guard first the quit is refused by the very
            // handler that keeps the app alive.
            _popup.AllowClose = true;
            Application.Current.Shutdown();
        };

        _tracker.SpanOpened += (id, start, selection, source) =>
            _ = _livePublisher.PublishAsync(id, start, selection, source, _shutdown.Token);

        _tracker.SpanClosed += (_, _) => RefreshPendingCount();

        _livePublisher.BlockedChanged += blocked =>
            OnUi(() => _viewModel.LiveSyncBlocked = blocked);

        // The one collision a second client platform introduces: this user is already tracking on
        // another machine, so the server refused to open the entry. Roll the clock back rather
        // than leave it running against a span that was never accepted.
        _livePublisher.ConflictDetected += entryId =>
            OnUi(() =>
            {
                _viewModel.HandleTrackingConflict(entryId);
                UpdateTray();
            });

        _viewModel.PropertyChanged += (_, _) => UpdateTray();
        _viewModel.TrackingStarted += UpdateTray;
    }

    private void StartTimers()
    {
        // Re-POST the running entry so the server's heartbeatAt stays fresh. There is no
        // dedicated heartbeat route — the upsert IS the heartbeat. The server's freshness window
        // defaults to 300s, so 60s leaves room for several missed ticks before live time starts
        // being truncated.
        _heartbeat = new DispatcherTimer(DispatcherPriority.Background)
        {
            Interval = HeartbeatInterval,
        };
        _heartbeat.Tick += (_, _) =>
        {
            if (_tracker.State is TrackerState.Tracking span)
            {
                _ = _livePublisher.HeartbeatAsync(span, _shutdown.Token);
            }
        };
        _heartbeat.Start();

        _refresh = new DispatcherTimer(DispatcherPriority.Background)
        {
            Interval = RefreshInterval,
        };
        _refresh.Tick += (_, _) =>
        {
            RefreshPendingCount();
            UpdateTray();
            if (_viewModel.IsReady)
            {
                _ = RefreshTotalsAsync();
            }
        };
        _refresh.Start();
    }

    private async Task BootstrapAsync()
    {
        var outcome = await _session.BootstrapAsync(_shutdown.Token).ConfigureAwait(true);

        switch (outcome)
        {
            case BootstrapOutcome.Authenticated:
                await ProceedToPolicyAsync().ConfigureAwait(true);
                break;

            case BootstrapOutcome.Offline:
                ProceedOffline();
                break;

            case BootstrapOutcome.Unauthenticated:
            default:
                ShowLogin();
                break;
        }
    }

    /// <summary>
    /// The ONLINE branch. This is the only place capture subsystems may ever be installed.
    /// </summary>
    private async Task ProceedToPolicyAsync()
    {
        EffectivePolicy policy;
        try
        {
            policy = await _policyClient.EffectivePolicyAsync(_shutdown.Token).ConfigureAwait(true);
        }
        catch (Exception e) when (e is AckGateException or NotAuthenticatedException or AuthException)
        {
            // Could not read the policy: treat exactly like an offline launch. Manual tracking may
            // resume if this user acknowledged previously; capture may not, because it is not
            // installed on this path at all.
            ProceedOffline();
            return;
        }

        _livePolicy.Update(policy.Settings);

        if (policy.AckRequired)
        {
            ShowAck(policy);
            return;
        }

        if (_session.UserId is { } userId)
        {
            _ackMarker.Record(userId, policy.PolicyVersion);
        }

        BecomeReady();

        // ── S3 installs screenshot capture and activity sampling HERE, and nowhere else. ─────
        // Every such subsystem must be constructed with `_ackGate` and must re-check the gate on
        // every tick, so a revoked acknowledgement stops capture mid-session.
    }

    /// <summary>
    /// The OFFLINE branch. Re-enables MANUAL tracking for a user who acknowledged on a previous
    /// launch, and nothing else.
    ///
    /// This is the asymmetry that makes the acknowledgement gate real rather than advisory: there
    /// is no capture installer on this path, so no amount of local state can start capture
    /// without a live, acknowledged policy.
    /// </summary>
    private void ProceedOffline()
    {
        if (_session.UserId is { } userId && _ackMarker.HasAcknowledged(userId))
        {
            BecomeReady();
            return;
        }

        // Never acknowledged, and we cannot ask the server. Nothing is enabled.
        _viewModel.IsReady = false;
        _viewModel.Notice = "Can't reach the server. Tracking is paused until you're back online.";
        UpdateTray();
    }

    private void BecomeReady()
    {
        _viewModel.IsReady = true;
        _viewModel.Notice = null;

        // Projects first: RestoreSelection resolves the stored selection AGAINST the project list,
        // and against an empty list every selection looks stale and is dropped.
        _viewModel.Projects = _projectCache.Load();
        if (_session.UserId is { } userId)
        {
            _viewModel.RestoreSelection(userId);
        }

        RefreshPendingCount();
        UpdateTray();

        _ = RefreshProjectsAsync();
        _ = RefreshTotalsAsync();
    }

    private void ShowLogin()
    {
        _login ??= CreateLoginWindow();
        _login.Show();
        _login.Activate();
    }

    private LoginWindow CreateLoginWindow()
    {
        var window = new LoginWindow(_session, _config.ApiBaseUri);
        window.SignedIn += () => _ = ProceedToPolicyAsync();
        return window;
    }

    private void ShowAck(EffectivePolicy policy)
    {
        if (_session.UserId is not { } userId)
        {
            ShowLogin();
            return;
        }

        _ack = new AckWindow(_ackClient, policy, userId);
        _ack.Acknowledged += version =>
        {
            _ackMarker.Record(userId, version);

            // Re-enter the online branch rather than calling BecomeReady directly: the second
            // fetch is what confirms the server now agrees the gate is open, and in S3 it is what
            // installs capture.
            _ = ProceedToPolicyAsync();
        };
        _ack.Show();
        _ack.Activate();
    }

    private async Task RefreshProjectsAsync()
    {
        try
        {
            var projects = await _projectClient.ListAsync(_shutdown.Token).ConfigureAwait(true);
            _projectCache.Save(projects);
            _viewModel.Projects = projects;
            if (_session.UserId is { } userId)
            {
                _viewModel.RestoreSelection(userId);
            }
        }
        catch (Exception e) when (e is ResourceUnavailableException or NotAuthenticatedException
                                      or AuthException or OperationCanceledException)
        {
            // Keep whatever the cache gave us; an empty picker is worse than a stale one.
        }
    }

    private async Task RefreshTotalsAsync()
    {
        try
        {
            _viewModel.Totals = await _totalsClient.FetchAsync(_shutdown.Token).ConfigureAwait(true);
        }
        catch (Exception e) when (e is ResourceUnavailableException or NotAuthenticatedException
                                      or AuthException or OperationCanceledException)
        {
            // Leave the previous figures rather than showing a wrong number.
        }
    }

    private void RefreshPendingCount() => _viewModel.PendingCount = _buffer.PendingCount();

    private void UpdateTray()
    {
        _tray.State = _viewModel.IsTracking ? TrayState.Tracking : TrayState.Idle;
        _tray.Tooltip = _viewModel.IsTracking
            ? $"Nifty Timer — tracking {_viewModel.ElapsedLabel}"
            : "Nifty Timer — not tracking";
    }

    /// <summary>
    /// Sign-out teardown. The ORDER matters and is ported deliberately from the macOS client,
    /// where it encodes several production bugs.
    ///
    /// <c>CreateTimeEntry</c> carries no userId — the server attributes by token — so anything
    /// left in the buffer after the session changes would be uploaded as the NEXT person's time.
    /// Hence: stop the timer first (so no cycle starts behind us), do a best-effort final drain on
    /// the still-valid token, then clear.
    /// </summary>
    private async Task SignOutAsync()
    {
        var userId = _session.UserId;

        if (_tracker.State is TrackerState.Tracking)
        {
            _tracker.Stop();
        }

        _sync.Stop();

        try
        {
            // FlushAsync, not SyncNowAsync: the latter returns immediately when a cycle is already
            // in flight, so the "final drain" would silently not happen and Clear() below would
            // discard real tracked time.
            await _sync.FlushAsync(_shutdown.Token).ConfigureAwait(true);
        }
        catch (OperationCanceledException)
        {
        }

        _buffer.Clear();
        _projectCache.Clear();

        if (userId is not null)
        {
            _ackMarker.Clear(userId);
            _selectionStore.Clear(userId);
        }

        _session.Logout();

        _viewModel.Reset();
        UpdateTray();

        _sync.Start();
        ShowLogin();
    }

    private static void OnUi(Action action)
    {
        var dispatcher = Application.Current?.Dispatcher;
        if (dispatcher is null || dispatcher.CheckAccess())
        {
            action();
        }
        else
        {
            dispatcher.BeginInvoke(action);
        }
    }
}
