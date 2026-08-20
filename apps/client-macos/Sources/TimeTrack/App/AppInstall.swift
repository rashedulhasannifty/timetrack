import Foundation

/// Which install of the app this process is: the released build, or a side-by-side dev/staging
/// build carrying its own bundle id.
///
/// Everything the client persists is keyed off this — the Application Support container and the
/// Keychain service. Both were previously hardcoded, so a dev build on an employee's Mac shared
/// them with the released app, and sharing the container is not merely untidy, it is LOSSY: both
/// processes drain the same durable buffers (take → upload → remove), so a dev build pointed at
/// localhost would upload the released app's pending records to the dev server and then delete
/// them. Real recorded time, gone.
///
/// The production bundle id keeps the historical names. An employee updating the released app
/// must still find the records the previous version left behind — a rename here would strand the
/// pending buffer exactly the way it would strand it for a dev build.
///
/// `UserDefaults` needs no help: `.standard` is already scoped to the bundle id, so the ack marker
/// and the sticky project selection separate on their own. Renaming those keys would only break
/// the released app's saved state on upgrade.
enum AppInstall {
    /// Must match the default of BUNDLE_ID in scripts/package-app.sh. If that default changes,
    /// change it here in the same commit or every released install silently re-homes its state.
    static let productionBundleId = "com.niftyitsolution.niftytimer"

    /// Nil for the released install, a short tag otherwise.
    ///
    /// `swift run` has no bundle at all, so `Bundle.main.bundleIdentifier` is nil there. That is
    /// treated as a dev install rather than silently borrowing production's state — running from
    /// a checkout is the single most likely way to collide with a real install on the same Mac.
    static func variant(bundleId: String?) -> String? {
        guard let bundleId, !bundleId.isEmpty else { return "dev" }
        guard bundleId != productionBundleId else { return nil }
        // "com.niftyitsolution.niftytimer.dev" → "dev". A bundle id from somewhere else entirely
        // is used whole: still unique, which is the only thing that matters.
        let tail = bundleId.hasPrefix(productionBundleId + ".")
            ? String(bundleId.dropFirst(productionBundleId.count + 1))
            : bundleId
        return sanitized(tail)
    }

    /// The folder under `~/Library/Application Support/`.
    static func supportDirectoryName(bundleId: String?) -> String {
        guard let variant = variant(bundleId: bundleId) else { return "TimeTrack" }
        return "TimeTrack-\(variant)"
    }

    /// The Keychain service holding the refresh token. Shared between installs, a dev sign-in
    /// overwrites the released app's token and signs the employee out of production.
    static func keychainService(bundleId: String?) -> String {
        guard let variant = variant(bundleId: bundleId) else { return "com.timetrack.client" }
        return "com.timetrack.client.\(variant)"
    }

    /// Whether this build is the released one. The self-updater is gated on it: a dev build
    /// swapping itself for the latest public release (`UpdateInstaller` replaces
    /// `Bundle.main.bundleURL`) would destroy the very build under test.
    static func isProduction(bundleId: String?) -> Bool { variant(bundleId: bundleId) == nil }

    /// A folder name, so anything that could split a path is folded away. Bundle ids do not
    /// contain these in practice; this is here so a typo cannot escape the container.
    private static func sanitized(_ s: String) -> String {
        String(s.map { $0 == "/" || $0 == ":" ? "-" : $0 })
    }

    // MARK: - live values

    static var supportDirectoryName: String {
        supportDirectoryName(bundleId: Bundle.main.bundleIdentifier)
    }

    static var keychainService: String {
        keychainService(bundleId: Bundle.main.bundleIdentifier)
    }

    static var isProduction: Bool { isProduction(bundleId: Bundle.main.bundleIdentifier) }

    /// `~/Library/Application Support/<container>[/subpath]` — the one place any store should ask
    /// for its directory.
    static func supportDirectory(_ subpath: String? = nil) -> URL {
        let base = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(supportDirectoryName, isDirectory: true)
        guard let subpath else { return base }
        return base.appendingPathComponent(subpath, isDirectory: true)
    }
}
