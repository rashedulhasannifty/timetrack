import Foundation
import ScreenCaptureKit
import AppKit

/// Why grabbing failed. `.notPermitted` drives the menu-bar Screen Recording warning (§5.6);
/// the scheduler keeps running so capture self-heals once permission is granted. Other capture
/// failures (transient ScreenCaptureKit errors, no permission change involved) map to
/// `.captureFailed` so they don't falsely trigger the permission prompt.
enum DisplayGrabError: Error { case notPermitted, noDisplay, captureFailed, encodeFailed }

/// One display's frame from a single capture tick.
struct DisplayCapture {
    /// Stable position within the tick: 0 is the main display, the rest follow by display id.
    /// Derived from a deterministic sort, NOT from ScreenCaptureKit's enumeration order, which is
    /// not guaranteed stable across calls — otherwise the same physical monitor would swap places
    /// in the dashboard grid between one capture and the next.
    let index: Int
    let jpeg: Data
}

/// The outcome of fanning one tick out across every attached display.
struct DisplayGrabResult {
    let captures: [DisplayCapture]
    /// How many displays were attached and attempted. Can exceed `captures.count`: one flaky
    /// external monitor fails on its own without taking the rest of the desk down with it, and
    /// the shortfall is what tells the dashboard the group is incomplete.
    let attempted: Int
}

/// The single seam over the actual screen capture. Everything around it (schedule, buffer,
/// upload) is faked in tests; only this concrete impl needs a real display + TCC permission
/// and cannot run in CI.
protocol DisplayGrabbing {
    /// Grab every attached display. Throws `DisplayGrabError` only when NOTHING could be
    /// captured; a partial result is a success carrying whichever displays did work.
    func grabAll() async throws -> DisplayGrabResult
}

/// PRD §6.2 — periodic screenshots via ScreenCaptureKit. Captures EVERY attached display in one
/// tick, so a two-monitor desk is recorded as two frames of the same moment rather than whichever
/// one happened to be main. Encodes JPEG (well under the server's 10 MB cap; a retina PNG can
/// exceed it). The client captures RAW — blur/thumbnail-only is server-side (2.2a). Created and
/// driven only behind `AckGate` (via `ScreenshotScheduler`). Build-verified, not CI-tested.
final class ScreenCaptureKitGrabber: DisplayGrabbing {
    private let jpegQuality: Double

    init(jpegQuality: Double = 0.6) { self.jpegQuality = jpegQuality }

    func grabAll() async throws -> DisplayGrabResult {
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        } catch {
            // ScreenCaptureKit surfaces missing Screen Recording permission as a content error,
            // but the same call can also fail transiently for other reasons — check actual
            // permission state rather than assuming every failure is a permission failure.
            throw ScreenRecordingPermission.isGranted() ? DisplayGrabError.captureFailed : DisplayGrabError.notPermitted
        }
        let displays = Self.ordered(content.displays)
        guard !displays.isEmpty else { throw DisplayGrabError.noDisplay }

        var captures: [DisplayCapture] = []
        var sawPermissionFailure = false
        for (index, display) in displays.enumerated() {
            do {
                captures.append(DisplayCapture(index: index, jpeg: try await capture(display)))
            } catch DisplayGrabError.notPermitted {
                sawPermissionFailure = true
            } catch {
                // One display failed — an external monitor asleep or mid-reconnect. Keep going:
                // losing the whole desk because one screen blinked would be a worse record than
                // a group that is honestly marked incomplete.
                continue
            }
        }
        guard !captures.isEmpty else {
            throw sawPermissionFailure ? DisplayGrabError.notPermitted : DisplayGrabError.captureFailed
        }
        return DisplayGrabResult(captures: captures, attempted: displays.count)
    }

    /// Main display first, then by display id. Pure and deterministic so `index` means the same
    /// monitor from one tick to the next.
    static func ordered(_ displays: [SCDisplay]) -> [SCDisplay] {
        let main = CGMainDisplayID()
        return displays.sorted { a, b in
            if (a.displayID == main) != (b.displayID == main) { return a.displayID == main }
            return a.displayID < b.displayID
        }
    }

    private func capture(_ display: SCDisplay) async throws -> Data {
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
