import Foundation
import ScreenCaptureKit
import AppKit

/// Why grabbing failed. `.notPermitted` drives the menu-bar Screen Recording warning (§5.6);
/// the scheduler keeps running so capture self-heals once permission is granted. Other capture
/// failures (transient ScreenCaptureKit errors, no permission change involved) map to
/// `.captureFailed` so they don't falsely trigger the permission prompt.
enum DisplayGrabError: Error { case notPermitted, noDisplay, captureFailed, encodeFailed }

/// The single seam over the actual screen capture. Everything around it (schedule, buffer,
/// upload) is faked in tests; only this concrete impl needs a real display + TCC permission
/// and cannot run in CI.
protocol DisplayGrabbing {
    /// Grab the main display, return encoded JPEG bytes. Throws `DisplayGrabError` on failure.
    func grab() async throws -> Data
}

/// PRD §6.2 — periodic screenshots via ScreenCaptureKit. Captures the MAIN display only
/// (multi-display deferred) and encodes JPEG (well under the server's 10 MB cap; a retina PNG
/// can exceed it). The client captures RAW — blur/thumbnail-only is server-side (2.2a). Created
/// and driven only behind `AckGate` (via `ScreenshotScheduler`). Build-verified, not CI-tested.
final class ScreenCaptureKitGrabber: DisplayGrabbing {
    private let jpegQuality: Double

    init(jpegQuality: Double = 0.6) { self.jpegQuality = jpegQuality }

    func grab() async throws -> Data {
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        } catch {
            // ScreenCaptureKit surfaces missing Screen Recording permission as a content error,
            // but the same call can also fail transiently for other reasons — check actual
            // permission state rather than assuming every failure is a permission failure.
            throw ScreenRecordingPermission.isGranted() ? DisplayGrabError.captureFailed : DisplayGrabError.notPermitted
        }
        guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() })
                ?? content.displays.first else {
            throw DisplayGrabError.noDisplay
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        // SCDisplay.width/height are in POINTS; SCStreamConfiguration.width/height expect PIXELS.
        // Use the display mode's backing pixel dimensions so Retina displays capture at native
        // resolution instead of half-resolution.
        if let mode = CGDisplayCopyDisplayMode(display.displayID) {
            config.width = mode.pixelWidth
            config.height = mode.pixelHeight
        } else {
            config.width = display.width
            config.height = display.height
        }

        let cgImage: CGImage
        do {
            cgImage = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        } catch {
            throw ScreenRecordingPermission.isGranted() ? DisplayGrabError.captureFailed : DisplayGrabError.notPermitted
        }

        let rep = NSBitmapImageRep(cgImage: cgImage)
        guard let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: jpegQuality]) else {
            throw DisplayGrabError.encodeFailed
        }
        return jpeg
    }
}
