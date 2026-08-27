using System.Net.Http;
using System.Windows;
using System.Windows.Threading;
using NiftyTimer.Activity;
using NiftyTimer.Auth;
using NiftyTimer.Capture;
using NiftyTimer.Notifications;
using NiftyTimer.Policy;
using NiftyTimer.Projects;
using NiftyTimer.Reports;
using NiftyTimer.Storage;
using NiftyTimer.Sync;
using NiftyTimer.Tracking;
using NiftyTimer.UI;
using NiftyTimer.Update;

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

    /// <summary>How long someone may be present and not tracking before the nudge fires.</summary>
    private const int ForgotToStartSeconds = 600;

    /// <summary>
    /// The UI dispatcher, captured at construction — i.e. on the UI thread. Read directly rather
    /// than through <c>Application.Current.Dispatcher</c> so it stays correct from a background
    /// continuation, where <c>Application.Current</c> is fine but the intent is easy to lose.
    /// </summary>
    private readonly Dispatcher _dispatcher = Dispatcher.CurrentDispatcher;

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
    private LiveSpanStore _liveSpanStore = null!;
    private SyncEngine _sync = null!;
    private LiveEntryPublisher _livePublisher = null!;
    private MenuViewModel _viewModel = null!;
    private LocalNotifier _notifier = null!;
    private EndOfDayScheduler _endOfDay = null!;
    private UpdateCoordinator _updates = null!;
    private UpdateInstaller _updateInstaller = null!;
    private bool _updateInProgress;
    private GlobalHotKey? _hotKey;

    // The capture BUFFERS and their drains are built unconditionally, on both branches. Draining
    // what was already captured is not capturing — an offline launch must still be able to deliver
    // yesterday's screenshots — and the buffers must exist before sign-out can clear them.
    private ImageBufferStore _imageBuffer = null!;
    private ActivitySampleStore _activityStore = null!;
    private ScreenshotSyncEngine _screenshotSync = null!;
    private ActivityBatchSyncEngine _activitySync = null!;

    private TrayIconController _tray = null!;
    private TrayPopupWindow _popup = null!;
    private LoginWindow? _login;
    private AckWindow? _ack;

    private readonly TimePrompt _awayPrompt = new();
    private readonly TimePrompt _recoveryPrompt = new();

    private SessionObserver? _sessionObserver;
    private AutoTrackingCoordinator? _autoCoordinator;
    private ManualIdleCoordinator? _manualIdleCoordinator;
    private bool _hasAttemptedRecovery;

    // The capture SUBSYSTEMS, by contrast, are null until the gated branch installs them — and
    // back to null on sign-out. Their nullability is the invariant, not an accident: there is no
    // code path that assigns any of these outside InstallCapture.
    private EventCounter? _eventCounter;
    private ActivitySampler? _activitySampler;
    private ScreenshotScheduler? _screenshotScheduler;

    // Manual-mode only, and gated with the rest of the observation: it reads the same continuous
    // idle scalar. It never stops a clock, but it does watch the person, which is what decides
    // where it may be installed.
    private ManualNudgeMonitor? _nudgeMonitor;

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

        // The live-span record is what makes a crash survivable: it is the only trace of a span
        // that has started but not finished, and it is deliberately separate from the durable
        // buffer, which holds completed records only.
        _liveSpanStore = new LiveSpanStore(
            Path.Combine(support, "live-span.json"),
            () => _session.UserId);
        _tracker = new TimeTracker(_buffer, liveSpan: _liveSpanStore);

        _imageBuffer = new ImageBufferStore(Path.Combine(support, "screenshots"));
        _activityStore = new ActivitySampleStore(Path.Combine(support, "activity"));

        var uploader = new TimeEntryUploader(_http, _config.ApiBaseUri, _session);
        var idleUploader = new TimeEntryUploader(_http, _config.ApiBaseUri, _session, "idle-events");

        // The activity batch reuses TimeEntryUploader pointed at a different path: the JSON POST,
        // the single 401 refresh-retry and the status classification are identical, and a second
        // copy of them is how the two paths drift apart.
        var activityUploader = new TimeEntryUploader(
            _http, _config.ApiBaseUri, _session, "activity-samples/batch");

        _sync = new SyncEngine(_buffer, uploader, idleUploader);
        _screenshotSync = new ScreenshotSyncEngine(
            _imageBuffer,
            new ScreenshotUploader(_http, _config.ApiBaseUri, _session));
        _activitySync = new ActivityBatchSyncEngine(_activityStore, activityUploader);
        _livePublisher = new LiveEntryPublisher(uploader);

        _viewModel = new MenuViewModel(_tracker, _selectionStore);

        // ── The indicator comes first, and is never conditional. ─────────────────────────────
        _tray = new TrayIconController(Path.Combine(AppContext.BaseDirectory, "Resources"));
        _popup = new TrayPopupWindow(_viewModel, _config.DashboardUri, BuildStamp.Describe(_config.AppId));

        // The notifier rides the tray icon that already exists, so there is nothing extra to
        // register with the shell and nothing to fail at launch.
        _notifier = new LocalNotifier(_tray);
        _endOfDay = new EndOfDayScheduler(_notifier, _totalsClient);

        _updates = new UpdateCoordinator(
            new GitHubReleaseFeed(_http, _config.UpdateRepo),
            enabled: AppInstall.IsProduction(_config.AppId));
        _updateInstaller = new UpdateInstaller(_http);

        // Registration losing to another application that already owns Ctrl+Alt+T is normal and
        // must never be fatal: the tray icon is the primary control and still works.
        _hotKey = new GlobalHotKey(() => OnUi(() => _viewModel.ToggleTracking()));

        WireEvents();

        _endOfDay.Start();
        _updates.Start();
        _sync.Start();
        _screenshotSync.Start();
        _activitySync.Start();
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

        // Quit must settle the same things sign-out does. Without this, quitting with an away
        // window pending loses its UNRESOLVED idle event — the two exit paths would disagree about
        // whether that window was ever recorded, and only one of them would be right.
        TearDownIdleDetection();

        // Quit does not join the in-flight capture cycle the way sign-out does, and does not need
        // to: nothing here clears a buffer, so a cycle that finishes late enqueues for the SAME
        // user and simply drains on the next launch. Unregistering Raw Input still matters, and
        // that is what disposing the counter does.
        _screenshotScheduler?.Stop();
        _activitySampler?.Stop();
        _screenshotScheduler?.Dispose();
        _activitySampler?.Dispose();
        _eventCounter?.Dispose();

        _hotKey?.Dispose();
        _endOfDay?.Dispose();
        _updates?.Dispose();

        _shutdown.Cancel();

        _sync?.Dispose();
        _screenshotSync?.Dispose();
        _activitySync?.Dispose();
        _tray?.Dispose();
        _session?.Dispose();
        _http.Dispose();
        _shutdown.Dispose();
    }

    private void WireEvents()
    {
        _tray.Activated += () =>
        {
            _popup.ShowNearTray();

            // Throttled to once every thirty minutes inside the coordinator, so opening the menu
            // repeatedly cannot spend the unauthenticated GitHub rate limit.
            _ = _updates.CheckOnMenuOpenAsync(_shutdown.Token);
        };
        _tray.ContextMenuRequested += () => _popup.ShowNearTray();

        // An out-of-date build keeps tracking. The strongest thing this may do is put a marker on
        // the tray and a line in the menu — never stop the clock, never block a start.
        _updates.StatusChanged += status => OnUi(() =>
        {
            _viewModel.UpdateAvailable = status.ManifestOrNull is not null;
            _viewModel.UpdateOverdue = status.IsOverdue;
            UpdateTray();
        });

        _popup.SignOutRequested += () => _ = SignOutAsync();
        _popup.UpdateRequested += () => _ = ApplyUpdateAsync();
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

        _tracker.SpanClosed += span =>
        {
            RefreshPendingCount();

            // Publish the close immediately, ahead of the buffer's next drain. Every close here is
            // followed within milliseconds by an open — project switch, resume, away resolution,
            // recovery-then-start — and the server allows one open entry per user, so a close that
            // arrives ninety seconds late means that open is refused with a 409.
            _ = _livePublisher.PublishCloseAsync(span, _shutdown.Token);
        };

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
                // Bump the local record too. This is what bounds how much a crash can cost: the
                // recovered span closes at the last heartbeat, so downtime is never counted and at
                // most one interval of real work is lost.
                _liveSpanStore.Heartbeat(DateTimeOffset.UtcNow);
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

        // Deliberately OUTSIDE the AckGate: this launches the app at the next login and captures
        // nothing. Gating it would be ceremony, and would also mean the setting silently failed to
        // apply on every launch where the policy fetch succeeded but a capture check did not.
        //
        // Best-effort by design — the Outcome is not acted on. A registry failure leaves the item
        // as it was, and there is nothing here worth interrupting an employee's launch over.
        LoginItemSync.Apply(policy.Settings.AutoStartOnLogin, new RunKeyLoginItem(_config.AppId));

        await StartIdleDetectionAsync(policy.Settings).ConfigureAwait(true);
        await StartCaptureAsync(policy.Settings).ConfigureAwait(true);
    }

    /// <summary>
    /// Screenshot capture and activity sampling. Installed ONLY here, on the online acknowledged
    /// branch, and only through <see cref="AckGate"/> — the same shape as
    /// <see cref="StartIdleDetectionAsync"/>, for the same reason, and with the same dispatcher hop
    /// (the gate resumes on the thread pool, where <c>HwndSource</c> throws).
    ///
    /// Each subsystem re-checks the gate on every tick of its own, so this install-time check is
    /// the first of many rather than the only one: revoking acknowledgement stops capture within
    /// one interval, not at the next launch.
    /// </summary>
    private async Task StartCaptureAsync(PolicySettings settings)
    {
        try
        {
            await _ackGate.WithCaptureAllowedAsync(
                async _ => await _dispatcher.InvokeAsync(() => InstallCapture(settings)),
                _shutdown.Token).ConfigureAwait(true);
        }
        catch (Exception e) when (e is AckGateException or NotAuthenticatedException
                                      or AuthException or OperationCanceledException)
        {
            // Gate closed or policy unreadable → capture simply does not start. Manual tracking,
            // already enabled, continues. Fail-safe; there is no fallback path.
        }
    }

    private void InstallCapture(PolicySettings settings)
    {
        InstallActivitySampling();
        InstallScreenshotCapture(settings);
    }

    /// <summary>
    /// Activity sampling runs whenever the gate is open — there is no separate team switch for it,
    /// unlike screenshots.
    /// </summary>
    private void InstallActivitySampling()
    {
        if (_activitySampler is not null)
        {
            return; // idempotent — a second policy fetch must not start a second sampler
        }

        // Arming Raw Input is itself gated (see EventCounter): subscribing to every keystroke on
        // the machine is the observation, so it is the thing that needs authorizing. It reads only
        // the message header, so no key identity ever enters this process.
        // StartAsync reports failure rather than throwing, so this fire-and-forget cannot become an
        // unobserved task fault. An unarmed counter means activity percentages read zero while the
        // rest of the sample stays true — the fail-safe outcome, not a crash.
        var counter = new EventCounter(_ackGate);
        _eventCounter = counter;
        _ = counter.StartAsync(_shutdown.Token);

        _activitySampler = new ActivitySampler(
            _ackGate,
            counter,
            new AppSampler(_ackGate, _livePolicy),
            _livePolicy,
            _activityStore,
            isTracking: () => _tracker.State is TrackerState.Tracking,
            onSampled: () => OnUi(RefreshPendingCount));
        _activitySampler.Start();
    }

    private void InstallScreenshotCapture(PolicySettings settings)
    {
        if (_screenshotScheduler is not null || !settings.ScreenshotsEnabled)
        {
            return;
        }

        _screenshotScheduler = new ScreenshotScheduler(
            _ackGate,
            new WindowsDisplayGrabber(_ackGate, _dispatcher),
            _imageBuffer,
            settings.ScreenshotIntervalMinutes,
            isTracking: () => _tracker.State is TrackerState.Tracking,
            onCaptured: () => OnUi(RefreshPendingCount));
        _screenshotScheduler.Start();
    }

    /// <summary>
    /// Idle detection is a CAPTURE path (CLAUDE.md §1): it watches the person continuously, and in
    /// auto mode it starts and stops the clock on their behalf. So it is installed ONLY here, on
    /// the live-policy acknowledged branch, and ONLY through <see cref="AckGate"/> — never from
    /// <see cref="BecomeReady"/>, which the offline-marker branch also reaches.
    ///
    /// Two mutually-exclusive modes, keyed on <c>autoStartOnLogin</c>. Exactly one poller runs.
    /// (The setting selects the tracking MODE; it is not a login item.)
    /// </summary>
    private async Task StartIdleDetectionAsync(PolicySettings settings)
    {
        try
        {
            await _ackGate.WithCaptureAllowedAsync(
                async _ =>
                {
                    // Hop back to the UI thread inside the gate's body. The gate awaits the policy
                    // fetch with ConfigureAwait(false) — correct for it, since a capture body has no
                    // general reason to need a UI thread — so the body resumes on the thread pool.
                    // Everything installed below is UI-thread-bound: DispatcherTimer would attach to
                    // a pool thread's dispatcher and never tick, and HwndSource needs an STA thread.
                    // The failure is silent in the first case and an exception in the second.
                    await _dispatcher.InvokeAsync(() => InstallIdleDetection(settings));
                },
                _shutdown.Token).ConfigureAwait(true);
        }
        catch (Exception e) when (e is AckGateException or NotAuthenticatedException
                                      or AuthException or OperationCanceledException)
        {
            // Gate closed or policy unreadable → idle detection simply does not start. Manual
            // tracking, already enabled, continues. Fail-safe; there is no fallback path.
        }
    }

    private void InstallIdleDetection(PolicySettings settings)
    {
        if (_sessionObserver is not null)
        {
            return; // idempotent — a second policy fetch must not start a second poller
        }

        var thresholdSeconds = Math.Max(60, settings.IdleThresholdMinutes * 60);

        // The manual coordinator exists in BOTH modes. Someone in auto mode can still start a span
        // by hand, and that span needs the same away prompt — the auto layer deliberately stands
        // down for the duration of a manual session.
        var manual = new ManualIdleCoordinator(
            _tracker,
            _buffer,
            thresholdSeconds,
            presentAwayPrompt: (minutes, resolve) => _awayPrompt.PresentAway(minutes, resolve),
            onEntryReplaced: displayStart => _viewModel.ContinueClockAfterDiscard(displayStart),
            dismissPrompt: () => _awayPrompt.DismissIfShowing());
        _manualIdleCoordinator = manual;

        ISignalReceiver receiver = manual;

        if (!settings.AutoStartOnLogin)
        {
            // Manual mode only. In auto mode the coordinator starts the clock itself, so a
            // "you have been active without tracking" nudge would be telling the person about a
            // situation the app just created and is about to resolve.
            var nudges = new ManualNudgeMonitor(
                _notifier,
                thresholdSeconds,
                ForgotToStartSeconds,
                isTracking: () => _tracker.State is TrackerState.Tracking,
                isPaused: () => _tracker.State is TrackerState.Paused);
            _nudgeMonitor = nudges;
            receiver = new FanOutSignalReceiver(manual, new NudgeSignalAdapter(nudges, thresholdSeconds));
        }

        if (settings.AutoStartOnLogin)
        {
            var auto = new AutoTrackingCoordinator(
                _tracker,
                _buffer,
                thresholdSeconds,
                currentSelection: () => _viewModel.SelectionForAuto,
                presentAwayPrompt: (minutes, resolve) => _awayPrompt.PresentAway(minutes, resolve),
                onTrackingStateChanged: () => _viewModel.RefreshFromTracker());
            _autoCoordinator = auto;
            receiver = new FanOutSignalReceiver(auto, manual);
        }

        _sessionObserver = new SessionObserver(receiver);
        _sessionObserver.Start();

        // Auto mode opens its first span immediately; the manual coordinator self-arms on the first
        // manual signal, so it needs no activation.
        _autoCoordinator?.Activate();
    }

    /// <summary>
    /// Offer to recover a span that was interrupted — a crash, a power loss, or a quit while the
    /// clock was running.
    ///
    /// Called from <see cref="BecomeReady"/> and not from the gated branch: an interrupted span is
    /// the person's own already-recorded work, not new observation, so it is recoverable offline
    /// exactly as manual tracking is.
    ///
    /// One attempt per session, and the attempt is reset on sign-out so the next user on this
    /// machine gets their own rather than being skipped because a previous one "used" it.
    /// </summary>
    private void RecoverLiveSpanIfNeeded()
    {
        if (_hasAttemptedRecovery)
        {
            return;
        }

        _hasAttemptedRecovery = true;

        if (_liveSpanStore.Load() is not { } span)
        {
            return;
        }

        if (!LiveSpanStore.ShouldRecover(span, _session.UserId))
        {
            // Someone else's span on a shared machine. Dropped locally, never enqueued — the buffer
            // uploads by token, so replaying it would bill their work to this user.
            _liveSpanStore.Clear();
            return;
        }

        var recovery = new LiveSpanRecovery(_tracker, _liveSpanStore, () => _session.UserId);
        var minutes = AwayMinutes.Of((int)(span.LastAlive - span.StartTime).TotalSeconds);
        _recoveryPrompt.PresentRecovery(minutes, action => recovery.Apply(action, span));
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

        // After the userId is known, and before the person can start anything new.
        RecoverLiveSpanIfNeeded();

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

    /// <summary>
    /// Everything still waiting to reach the server, across all three buffers — the menu's
    /// "pending" figure means unsent work, and a person looking at it after a day offline would be
    /// misled by a count that omitted their screenshots. All three read their directory listings
    /// rather than any file contents, which is what makes this cheap enough to run on every menu
    /// open.
    /// </summary>
    private void RefreshPendingCount() =>
        _viewModel.PendingCount =
            _buffer.PendingCount() + _imageBuffer.PendingCount() + _activityStore.PendingCount();

    private void UpdateTray()
    {
        _tray.State = _viewModel.IsTracking ? TrayState.Tracking : TrayState.Idle;

        var status = _viewModel.IsTracking
            ? $"Nifty Timer — tracking {_viewModel.ElapsedLabel}"
            : "Nifty Timer — not tracking";

        // The update marker rides the tooltip rather than changing the icon. The icon carries one
        // meaning — whether the clock is running — and overloading it with a second would make the
        // always-visible indicator ambiguous about the thing it exists to show.
        _tray.Tooltip = _viewModel.UpdateOverdue ? status + " (update available)" : status;
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

        // Idle detection comes down FIRST, and it must, because tearing it down WRITES: each
        // monitor records any pending away window as UNRESOLVED, and dismissing a recovery prompt
        // closes its span. Both are records belonging to the user who is leaving, so both have to
        // reach the buffer before the final drain below — otherwise Clear() discards them, or worse
        // they drain later under the next person's token.
        TearDownIdleDetection();

        // Capture comes down and SETTLES before anything drains. Stopping a scheduler does not
        // abort a cycle that is already inside a grab or a measurement window, and such a cycle
        // resumes later and enqueues — so joining it here does two things: it keeps that last
        // capture out of a buffer we are about to clear (where it would be lost) and, more
        // importantly, out of one we have already cleared (where it would upload under the NEXT
        // person's token, because the server attributes by bearer token and not by any field we
        // send). Joining first rather than last also means anything the final cycle produced is
        // still included in the drain below, credited to the person it belongs to.
        await TearDownCaptureAsync().ConfigureAwait(true);

        if (_tracker.State is TrackerState.Tracking)
        {
            _tracker.Stop();
        }

        _sync.Stop();
        _screenshotSync.Stop();
        _activitySync.Stop();

        try
        {
            // FlushAsync, not SyncNowAsync: the latter returns immediately when a cycle is already
            // in flight, so the "final drain" would silently not happen and Clear() below would
            // discard real tracked time. The same applies to each capture buffer.
            await _sync.FlushAsync(_shutdown.Token).ConfigureAwait(true);
            await _screenshotSync.FlushAsync(_shutdown.Token).ConfigureAwait(true);
            await _activitySync.FlushAsync(_shutdown.Token).ConfigureAwait(true);
        }
        catch (OperationCanceledException)
        {
        }

        _buffer.Clear();
        _imageBuffer.Clear();
        _activityStore.Clear();
        _projectCache.Clear();
        _liveSpanStore.Clear();

        if (userId is not null)
        {
            _ackMarker.Clear(userId);
            _selectionStore.Clear(userId);
        }

        _session.Logout();

        // Both hold per-person state: the notifier suppresses a repeat of the same nudge, and the
        // scheduler remembers that today's summary was sent. Carried over, the next person on this
        // machine would silently lose a nudge because the previous one saw it.
        _notifier.Reset();
        _endOfDay.Reset();

        _viewModel.Reset();
        UpdateTray();

        _sync.Start();
        _screenshotSync.Start();
        _activitySync.Start();
        ShowLogin();
    }

    /// <summary>
    /// Apply a pending update: verify, stage, hand the swap to a detached script, and quit.
    ///
    /// **Nothing on this path may stop tracking, and nothing on it may lose time.** Every failure
    /// leaves the app running on the current build with a notice — never a stopped clock and never
    /// a cleared buffer. The running entry is closed before quitting, exactly as Quit does, so the
    /// span is recorded rather than left for crash recovery to find; and the buffer is left intact
    /// so the new build drains it on first launch.
    ///
    /// Deliberately requires the person to ask. An update that applied itself would restart the
    /// app under them mid-task, which for a time tracker means restarting the thing that is
    /// recording their day.
    /// </summary>
    private async Task ApplyUpdateAsync()
    {
        if (_updateInProgress || _updates.Status.ManifestOrNull is not { } manifest)
        {
            return;
        }

        _updateInProgress = true;
        try
        {
            if (!_updateInstaller.CanInstall())
            {
                // A machine-wide or MDM-deployed install. Checked before anything is downloaded,
                // so the person is told rather than failing halfway through a swap.
                _viewModel.Notice = "This copy can't update itself — ask IT, or download it again.";
                return;
            }

            _viewModel.Notice = "Downloading update…";
            var staged = await _updateInstaller.StageAsync(manifest, _shutdown.Token).ConfigureAwait(true);

            // Close the running span first. The swap script waits for this process to exit, so a
            // span left open here would be recovered as an interrupted one on the next launch and
            // cost the person a keep-or-discard prompt for time that was never interrupted.
            if (_tracker.State is TrackerState.Tracking)
            {
                _tracker.Stop();
            }

            try
            {
                await _sync.FlushAsync(_shutdown.Token).ConfigureAwait(true);
            }
            catch (OperationCanceledException)
            {
            }

            _updateInstaller.LaunchDetachedSwap(staged);
            _popup.AllowClose = true;
            Application.Current.Shutdown();
        }
        catch (Exception e) when (e is UpdateInstallException or HttpRequestException
                                      or OperationCanceledException)
        {
            // A bad digest, a refused publisher transition, a dead network. The current build keeps
            // running and keeps recording; that is always the better of the two outcomes.
            _viewModel.Notice = "Update failed. You're still on the current version.";
        }
        finally
        {
            _updateInProgress = false;
        }
    }

    /// <summary>
    /// Stop capturing, and wait for whatever was mid-cycle to finish.
    ///
    /// <c>Stop</c> cancels the cycle's token as well as killing the timer, so the join returns
    /// promptly instead of waiting out a sixty-second measurement window — which is the difference
    /// between a sign-out that feels instant and one that appears to hang.
    /// </summary>
    private async Task TearDownCaptureAsync()
    {
        _screenshotScheduler?.Stop();
        _activitySampler?.Stop();

        if (_screenshotScheduler is { } scheduler)
        {
            await scheduler.FinishInFlightAsync().ConfigureAwait(true);
            scheduler.Dispose();
            _screenshotScheduler = null;
        }

        if (_activitySampler is { } sampler)
        {
            await sampler.FinishInFlightAsync().ConfigureAwait(true);
            sampler.Dispose();
            _activitySampler = null;
        }

        // Last, so nothing is still counting input while a cycle drains. Disposing this
        // unregisters Raw Input: leaving it registered would keep the process subscribed to every
        // keystroke on the machine after the person has signed out.
        _eventCounter?.Dispose();
        _eventCounter = null;
    }

    /// <summary>
    /// Stop watching, and settle anything left mid-cycle.
    ///
    /// The order inside this method is as load-bearing as its position in
    /// <see cref="SignOutAsync"/>: stop the signal source, then deactivate the monitors (which
    /// records any pending away window as UNRESOLVED and leaves them inactive), and only THEN close
    /// the prompts. A prompt closed while its monitor is still armed resolves to Discard and would
    /// trim an entry on the way out; closed after, the same Discard lands on an inactive monitor and
    /// does nothing, which is what we want — the window is already recorded.
    /// </summary>
    private void TearDownIdleDetection()
    {
        _sessionObserver?.Stop();
        _sessionObserver?.Dispose();
        _sessionObserver = null;

        _autoCoordinator?.Deactivate();
        _manualIdleCoordinator?.Deactivate();
        _autoCoordinator = null;
        _manualIdleCoordinator = null;
        _nudgeMonitor = null;

        _awayPrompt.DismissIfShowing();

        // The recovery prompt belongs to the user signing out, so it goes too — and its dismissal
        // resolves to Discard, closing their still-open server row rather than leaving it open
        // forever. Reset the one-shot so the next user gets their own recovery attempt.
        _recoveryPrompt.DismissIfShowing();
        _hasAttemptedRecovery = false;
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
