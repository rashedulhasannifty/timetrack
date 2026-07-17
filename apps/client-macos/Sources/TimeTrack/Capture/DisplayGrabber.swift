import Foundation
import ScreenCaptureKit
import AppKit

/// Why grabbing failed. `.notPermitted` drives the menu-bar Screen Recording warning (§5.6);
/// the scheduler keeps running so capture self-heals once permission is granted.
enum DisplayGrabError: Error { case notPermitted, noDisplay, encodeFailed }

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
            // ScreenCaptureKit surfaces missing Screen Recording permission as a content error.
            throw DisplayGrabError.notPermitted
        }
        guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() })
                ?? content.displays.first else {
            throw DisplayGrabError.noDisplay
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.width = display.width
        config.height = display.height

        let cgImage: CGImage
        do {
            cgImage = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        } catch {
            throw DisplayGrabError.notPermitted
        }

        let rep = NSBitmapImageRep(cgImage: cgImage)
        guard let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: jpegQuality]) else {
            throw DisplayGrabError.encodeFailed
        }
        return jpeg
    }
}
