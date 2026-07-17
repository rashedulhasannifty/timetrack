import AppKit
import SwiftUI

/// PRD §4.2 — the always-visible indicator. There is no build flag, config key, or API
/// response that can hide it. Its icon reflects state: idle / tracking. (The "capturing"
/// state lands with screenshots in Phase 2.) Clicking it toggles the dropdown popover.
final class StatusItemController: NSObject {
    enum State { case idle, tracking, capturing }

    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let popover = NSPopover()

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
        switch state {
        case .idle: item.button?.title = "⏱"
        case .tracking: item.button?.title = "▶︎"
        case .capturing: item.button?.title = "◉"
        }
    }

    /// Surfaces that the policy could not be fetched — the gate stays closed, Start is inert.
    func showPolicyUnavailable() {
        item.button?.toolTip = "TimeTrack: monitoring policy unavailable — not tracking."
    }

    /// PRD §6.2 / §4.2 — Screen Recording permission is missing while capture is enabled. Visible,
    /// never silent; tracking is unaffected. Cleared once a capture succeeds.
    func showScreenRecordingDenied() {
        item.button?.toolTip = "TimeTrack: Screen Recording permission needed for screenshots — open System Settings > Privacy > Screen Recording."
    }

    func clearWarning() {
        item.button?.toolTip = nil
    }
}
