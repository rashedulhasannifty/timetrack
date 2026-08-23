import Foundation

/// The build identifier a person reads out when something is wrong.
///
/// Worth showing for two reasons this pilot has already hit. Version alone is not enough — two
/// different binaries once both called themselves 0.4.1, because a build shipped without the
/// version being bumped, so the build number is part of the answer. And with the side-by-side
/// dev install carrying its own bundle id, "which app am I actually looking at" is a real
/// question: both put a similar icon in the menu bar, and the dev build talks to localhost.
enum BuildStamp {
    /// Pure so it can be tested without a bundle. nil when there is no version to show —
    /// `swift run` has no Info.plist, and a stamp reading "v (0)" would be worse than none.
    static func text(version: String?, build: String?, variant: String?) -> String? {
        guard let version, !version.isEmpty else { return nil }
        var stamp = "v\(version)"
        if let build, !build.isEmpty { stamp += " (\(build))" }
        // Only a non-production install names itself; the release build is the unmarked case.
        if let variant, !variant.isEmpty { stamp += " · \(variant)" }
        return stamp
    }

    static func current(bundle: Bundle = .main) -> String? {
        text(version: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
             build: bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String,
             variant: AppInstall.variant(bundleId: bundle.bundleIdentifier))
    }
}
