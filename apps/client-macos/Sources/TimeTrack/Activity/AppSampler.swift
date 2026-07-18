import AppKit
import CoreGraphics
import Foundation

/// Samples the frontmost app name and (only when policy allows) its window title. `windowTitle`
/// rides the existing Screen Recording grant (`kCGWindowName` is empty without it) — degrade to
/// nil, never block. Truncated to 120 chars; never logged (CLAUDE.md §1). Title capture is gated
/// by `captureWindowTitles` (PRD §13).
protocol AppSampling {
    func sample(captureWindowTitles: Bool) -> (appName: String, windowTitle: String?)
}

final class AppSampler: AppSampling {
    func sample(captureWindowTitles: Bool) -> (appName: String, windowTitle: String?) {
        let front = NSWorkspace.shared.frontmostApplication
        let appName = front?.localizedName ?? "Unknown"
        guard captureWindowTitles, let pid = front?.processIdentifier else { return (appName, nil) }
        return (appName, Self.truncateTitle(frontWindowName(pid: pid)))
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

    /// Trim to 120 characters (grapheme-safe); nil for nil/empty.
    static func truncateTitle(_ s: String?) -> String? {
        guard let s, !s.isEmpty else { return nil }
        return s.count <= 120 ? s : String(s.prefix(120))
    }
}
