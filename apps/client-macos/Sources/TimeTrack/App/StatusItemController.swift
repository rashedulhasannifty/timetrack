import AppKit
import SwiftUI

/// PRD §4.2 — the always-visible indicator. There is no build flag, config key, or API
/// response that can hide it. Its icon reflects state: idle / tracking. (The "capturing"
/// state lands with screenshots in Phase 2.) Clicking it toggles the dropdown popover.
final class StatusItemController: NSObject {
    enum State { case idle, tracking, capturing }

    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let popover = NSPopover()
    private var currentState: State = .idle
    private var screenRecordingDenied = false

    /// Installs the indicator and attaches the SwiftUI dropdown as the popover content.
    func install<Content: View>(content: Content) {
        item.button?.title = "⏱"
        item.button?.target = self
        item.button?.action = #selector(togglePopover)
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(rootView: content)
    }

    @objc private func togglePopover() {
        guard let button = item.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func setState(_ state: State) {
        currentState = state
        refreshTitle()
    }

    /// Surfaces that the policy could not be fetched — the gate stays closed, Start is inert.
    func showPolicyUnavailable() {
        item.button?.toolTip = "TimeTrack: monitoring policy unavailable — not tracking."
    }

    /// PRD §6.2 / §4.2 — Screen Recording permission is missing while capture is enabled. Visible,
    /// never silent; tracking is unaffected. Cleared once a capture succeeds. Rendered as a "⚠️"
    /// glyph PREPENDED to the current state glyph — never hides the tracking indicator (CLAUDE.md
    /// §1: no kill switch, always visible).
    func showScreenRecordingDenied() {
        screenRecordingDenied = true
        item.button?.toolTip = "TimeTrack: Screen Recording permission needed for screenshots — open System Settings > Privacy > Screen Recording."
        refreshTitle()
    }

    func clearWarning() {
        screenRecordingDenied = false
        item.button?.toolTip = nil
        refreshTitle()
    }

    private func refreshTitle() {
        item.button?.title = (screenRecordingDenied ? "⚠️" : "") + glyph(for: currentState)
    }

    private func glyph(for state: State) -> String {
        switch state {
        case .idle: return "⏱"
        case .tracking: return "▶︎"
        case .capturing: return "◉"
        }
    }
}
