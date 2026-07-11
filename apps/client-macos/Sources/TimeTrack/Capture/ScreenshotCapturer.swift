import Foundation

/// PRD §6.2 / §7.4 — periodic screenshots via ScreenCaptureKit. MUST be created behind the
/// AckGate; the local file is deleted only after a CONFIRMED upload (HTTP 201 + storage key).
final class ScreenshotCapturer {
    private let interval: TimeInterval

    init(intervalMinutes: Int) {
        self.interval = TimeInterval(intervalMinutes * 60)
    }

    func captureOnce() async throws {
        // TODO(scaffold): import ScreenCaptureKit, grab the display, write to the offline
        // buffer with a UUIDv7 key, and hand to the UploadQueue. Respect the team blur setting.
        _ = interval
    }
}
