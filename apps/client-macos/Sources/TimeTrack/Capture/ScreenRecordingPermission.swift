import CoreGraphics
import AppKit

/// PRD §6.2 — Screen Recording (TCC) is required for ScreenCaptureKit. When it's missing the
/// client shows a visible menu-bar warning and keeps tracking time (§5.6) — never silent, never
/// blocks the clock. There is no capture without this permission and no way to hide that.
enum ScreenRecordingPermission {
    static func isGranted() -> Bool { CGPreflightScreenCaptureAccess() }

    /// Triggers the one-time system prompt (no-op if already decided).
    @discardableResult
    static func request() -> Bool { CGRequestScreenCaptureAccess() }

    static func openSystemSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            NSWorkspace.shared.open(url)
        }
    }
}
