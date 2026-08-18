import Foundation

/// Owns the update lifecycle: poll, evaluate, expose state, and install on request.
///
/// Checking is best-effort and silent on failure. No network, GitHub rate-limited, malformed
/// release — all of it collapses to `.unknownOrCurrent`. A person whose laptop cannot reach
/// GitHub has not done anything wrong, and an error badge in the menu bar would be noise they
/// cannot act on.
///
/// Nothing here can stop tracking. The strongest state is a visible warning.
final class UpdateCoordinator: ObservableObject {
    /// Background poll interval. Deliberately slow: GitHub's unauthenticated API allows 60
    /// requests/hour per IP, and a pilot office sits behind one NAT. Twenty machines at this
    /// cadence is ~80 requests a day in total.
    static let pollInterval: TimeInterval = 6 * 60 * 60

    /// Floor between menu-open checks. The background poll alone means a release published just
    /// after an app launched stays unseen for up to six hours; opening the dropdown is the one
    /// moment a person could actually act on an update, so look then too.
    ///
    /// Same rate-limit budget as above: worst case is every machine in the office opening the
    /// menu at least twice an hour, all hour — twenty machines × 2 = 40 requests/hour against the
    /// 60/hour ceiling. Realistically far below that, and exceeding it is handled anyway
    /// (`UpdateFeedError.rateLimited` collapses to `.unknownOrCurrent` and the timer carries on).
    static let menuOpenMinInterval: TimeInterval = 30 * 60

    @Published private(set) var status: UpdateStatus = .unknownOrCurrent
    @Published private(set) var isInstalling = false
    @Published private(set) var lastInstallError: String?

    private let feed: UpdateFeed
    private let evaluator: UpdateEvaluator
    private let installer: UpdateInstaller
    private let currentVersion: AppVersion?
    private let now: () -> Date
    private let openReleases: (URL) -> Void
    private let onQuit: () -> Void
    private let releasesURL: URL
    private let menuOpenThrottle: RefreshThrottle
    private var timer: Timer?

    init(feed: UpdateFeed = GitHubReleaseFeed(),
         evaluator: UpdateEvaluator = UpdateEvaluator(),
         installer: UpdateInstaller = UpdateInstaller(),
         currentVersion: AppVersion? = AppVersion.current(),
         releasesURL: URL = URL(string: "https://github.com/\(GitHubReleaseFeed.defaultRepo)/releases/latest")!,
         menuOpenThrottle: RefreshThrottle = RefreshThrottle(minInterval: UpdateCoordinator.menuOpenMinInterval),
         now: @escaping () -> Date = Date.init,
         openReleases: @escaping (URL) -> Void,
         onQuit: @escaping () -> Void) {
        self.feed = feed
        self.evaluator = evaluator
        self.installer = installer
        self.currentVersion = currentVersion
        self.releasesURL = releasesURL
        self.menuOpenThrottle = menuOpenThrottle
        self.now = now
        self.openReleases = openReleases
        self.onQuit = onQuit
    }

    func start() {
        check()
        let t = Timer(timeInterval: Self.pollInterval, repeats: true) { [weak self] _ in self?.check() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    /// The dropdown was opened. Checks at most once per `menuOpenMinInterval` (the first call
    /// after launch always goes through), so holding the menu open and closed repeatedly cannot
    /// hammer the API. Main-thread only — `RefreshThrottle` is not thread-safe, and the only
    /// caller is AppKit's popover hook.
    @MainActor func checkOnMenuOpen() {
        guard menuOpenThrottle.shouldRefresh() else { return }
        check()
    }

    func check() {
        Task { [weak self] in
            guard let self else { return }
            let manifest = try? await self.feed.latest()
            let next = self.evaluator.evaluate(current: self.currentVersion,
                                               latest: manifest,
                                               now: self.now())
            await MainActor.run { self.status = next }
        }
    }

    /// True when we can actually replace the bundle. When false the UI offers the releases page
    /// instead of an in-place update — a managed Mac with a read-only /Applications must not be
    /// offered a button that dies halfway through.
    var canInstallInPlace: Bool { installer.canInstall() }

    func openReleasesPage() { openReleases(releasesURL) }

    /// Downloads, verifies, and swaps. On any failure the running app is untouched.
    func installNow() {
        guard let manifest = status.manifest, !isInstalling else { return }
        guard canInstallInPlace else { openReleasesPage(); return }

        isInstalling = true
        lastInstallError = nil
        Task { [weak self] in
            guard let self else { return }
            do {
                let staged = try await self.installer.stage(manifest)
                try self.installer.swapAndRelaunch(staged: staged)
                // The swap script waits for this process to exit before touching anything.
                await MainActor.run { self.onQuit() }
            } catch {
                await MainActor.run {
                    self.isInstalling = false
                    self.lastInstallError = Self.describe(error)
                }
            }
        }
    }

    static func describe(_ error: Error) -> String {
        switch error {
        case UpdateInstallError.checksumMismatch:
            return "The download did not match its published checksum. Nothing was installed."
        case UpdateInstallError.signatureRejected:
            return "The downloaded build is not signed by us. Nothing was installed."
        case UpdateInstallError.destinationNotWritable:
            return "Nifty Timer cannot update itself in this location. Download it manually."
        case UpdateInstallError.download(let code):
            return "The download failed (\(code)). Try again later."
        default:
            return "The update could not be installed. Try again later."
        }
    }
}
