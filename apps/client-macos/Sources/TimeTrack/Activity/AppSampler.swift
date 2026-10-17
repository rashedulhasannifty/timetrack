import AppKit
import CoreGraphics
import Foundation

/// Samples the frontmost app name and (only when policy allows) its window title. `windowTitle`
/// rides the existing Screen Recording grant (`kCGWindowName` is empty without it) — degrade to
/// nil, never block. Truncated to 120 UTF-16 units; never logged (CLAUDE.md §1). Title capture is gated
/// by `captureWindowTitles` (PRD §13).
protocol AppSampling {
    func sample(captureWindowTitles: Bool) -> (appName: String, bundleId: String?, windowTitle: String?)
}

final class AppSampler: AppSampling {
    func sample(captureWindowTitles: Bool) -> (appName: String, bundleId: String?, windowTitle: String?) {
        let front = NSWorkspace.shared.frontmostApplication
        let appName = Self.truncateAppName(front?.localizedName) ?? "Unknown"
        // Stable reverse-DNS bundle id (e.g. com.microsoft.VSCode); nil for apps without a bundle.
        let bundleId = Self.limitBundleId(front?.bundleIdentifier)
        guard captureWindowTitles, let pid = front?.processIdentifier else { return (appName, bundleId, nil) }
        return (appName, bundleId, Self.truncateTitle(frontWindowName(pid: pid)))
    }

    /// First on-screen window title owned by `pid` (front-to-back z-order). Empty/absent ⇒ nil.
    private func frontWindowName(pid: pid_t) -> String? {
        let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let infos = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { return nil }
        for info in infos {
            guard (info[kCGWindowOwnerPID as String] as? pid_t) == pid,
                  let name = info[kCGWindowName as String] as? String, !name.isEmpty else { continue }
            return name
        }
        return nil
    }

    /// Server limits (`ActivitySampleSchema` in @timetrack/contracts), in UTF-16 units — what
    /// Zod's `max()` measures. See `UTF16Limit`.
    static let windowTitleLimit = 120
    static let appNameLimit = 200
    static let bundleIdLimit = 255

    /// Trim to ≤120 UTF-16 units on a Character boundary; nil for nil/empty, or when the first
    /// Character alone is over the limit.
    static func truncateTitle(_ s: String?) -> String? {
        guard let s, !s.isEmpty else { return nil }
        let cut = UTF16Limit.truncate(s, to: windowTitleLimit)
        return cut.isEmpty ? nil : cut
    }

    /// Trim an app name to ≤200 UTF-16 units — the server schema is `appName: z.string().max(200)`.
    /// Same cut as `truncateTitle`. A name that cannot keep even one Character maps to nil, so the
    /// caller's "Unknown" fallback applies rather than an empty name.
    static func truncateAppName(_ s: String?) -> String? {
        guard let s else { return nil }
        let cut = UTF16Limit.truncate(s, to: appNameLimit)
        return cut.isEmpty && !s.isEmpty ? nil : cut
    }

    /// `bundleId: z.string().max(255).nullable()`. Not truncated: a cut identifier would match a
    /// different app's rule, or none. One that does not fit is sent as nil — rules still match on
    /// the app name — instead of 422ing the whole batch.
    static func limitBundleId(_ s: String?) -> String? {
        guard let s, s.utf16.count <= bundleIdLimit else { return nil }
        return s
    }
}
