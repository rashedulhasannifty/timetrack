import AppKit
import SwiftUI

/// PRD §4.2 — the always-visible indicator. There is no build flag, config key, or API
/// response that can hide it. It reflects three states (design PDF · "STATUS ITEM · THREE
/// STATES"): idle, tracking (with a live elapsed count), and capturing (a camera glyph shown
/// briefly while a screenshot is taken). Clicking it toggles the dropdown popover.
final class StatusItemController: NSObject {
    enum State { case idle, tracking, capturing }

    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let popover = NSPopover()
    private var currentState: State = .idle
    private var screenRecordingDenied = false

    /// The tracking start, so the menu bar can show a live elapsed count (the dropdown's
    /// TimelineView can't drive the AppKit status item — it needs its own timer).
    private var startedAt: Date?
    private var ticker: Timer?
    /// Reverts the brief `.capturing` flash back to whatever state preceded it.
    private var captureRevert: Timer?
    private var stateBeforeCapture: State = .idle
    /// Dismisses the dropdown when the user clicks outside it (another app / the desktop). We do
    /// this ourselves instead of `.transient`, whose mouse-down auto-close races the button's
    /// mouse-up action and makes a click on the icon reopen the popover instead of closing it.
    private var outsideClickMonitor: Any?

    /// Installs the indicator and attaches the SwiftUI dropdown as the popover content.
    func install<Content: View>(content: Content) {
        item.button?.target = self
        item.button?.action = #selector(togglePopover)
        item.button?.imagePosition = .imageLeading
        popover.behavior = .applicationDefined
        popover.contentViewController = NSHostingController(rootView: content)
        refresh()
    }

    /// Dismiss the dropdown — on a second click of the icon, an outside click, or when a Sign In /
    /// policy window is presented over it.
    func closePopover() {
        if let monitor = outsideClickMonitor {
            NSEvent.removeMonitor(monitor)
            outsideClickMonitor = nil
        }
        if popover.isShown { popover.performClose(nil) }
    }

    @objc private func togglePopover() {
        if popover.isShown {
            closePopover()
            return
        }
        guard let button = item.button else { return }
        // Activate BEFORE showing so the popover doesn't drift when the app comes forward.
        NSApp.activate(ignoringOtherApps: true)
        // NSStatusBarButton is FLIPPED (isFlipped == true), so its visual bottom edge is .maxY,
        // not .minY. Anchoring to .minY (the visual top) drops the dropdown ~180pt down the
        // screen; .maxY hangs it flush under the menu-bar icon.
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .maxY)
        // Global monitor fires only for events in OTHER apps, so a click on the icon or inside the
        // dropdown won't trip it — only a genuine click-away dismisses.
        outsideClickMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown]
        ) { [weak self] _ in
            self?.closePopover()
        }
    }

    /// Set idle or tracking. Pass the tracking start so the menu bar shows a live elapsed count;
    /// nil (e.g. paused) still shows the tracking indicator but without a ticking time.
    func setState(_ state: State, startedAt: Date? = nil) {
        currentState = state
        self.startedAt = startedAt
        if state == .tracking, startedAt != nil {
            startTicking()
        } else {
            stopTicking()
        }
        refresh()
    }

    /// PRD §6.2 — briefly flash the camera glyph while a screenshot is taken ("Saving a
    /// screenshot right now"), then revert to the state that preceded it. Honest over-disclosure:
    /// the capture moment is surfaced, never silent.
    func flashCapturing() {
        captureRevert?.invalidate()
        if currentState != .capturing { stateBeforeCapture = currentState }
        currentState = .capturing
        refresh()
        captureRevert = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { [weak self] _ in
            guard let self else { return }
            self.currentState = self.stateBeforeCapture
            self.refresh()
        }
    }

    /// Surfaces that the policy could not be fetched — the gate stays closed, Start is inert.
    func showPolicyUnavailable() {
        item.button?.toolTip = "TimeTrack: monitoring policy unavailable — not tracking."
    }

    /// PRD §6.2 / §4.2 — Screen Recording permission is missing while capture is enabled. Visible,
    /// never silent; tracking is unaffected. Cleared once a capture succeeds. Rendered as a "⚠️"
    /// PREPENDED to the state — never hides the tracking indicator (CLAUDE.md §1: no kill switch).
    func showScreenRecordingDenied() {
        screenRecordingDenied = true
        item.button?.toolTip = "TimeTrack: Screen Recording permission needed for screenshots — open System Settings > Privacy > Screen Recording."
        refresh()
    }

    func clearWarning() {
        screenRecordingDenied = false
        item.button?.toolTip = nil
        refresh()
    }

    private func startTicking() {
        ticker?.invalidate()
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.refresh() }
        // .common so the count keeps updating even while the popover/menu is tracking events.
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer
    }

    private func stopTicking() {
        ticker?.invalidate()
        ticker = nil
    }

    private func refresh() {
        guard let button = item.button else { return }
        let symbol = symbolName(for: currentState)
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: accessibilityLabel(for: currentState))
        image?.isTemplate = true   // adopt the menu-bar's monochrome light/dark tint
        button.image = image

        var title = ""
        if currentState != .idle, let startedAt {
            title = " " + compactElapsed(since: startedAt)
        }
        if screenRecordingDenied {
            title = " ⚠️" + title
        }
        button.title = title
    }

    private func symbolName(for state: State) -> String {
        switch state {
        case .idle: return "clock"
        case .tracking: return "record.circle.fill"
        case .capturing: return "camera.fill"
        }
    }

    private func accessibilityLabel(for state: State) -> String {
        switch state {
        case .idle: return "TimeTrack: not tracking"
        case .tracking: return "TimeTrack: tracking"
        case .capturing: return "TimeTrack: capturing a screenshot"
        }
    }

    /// Compact menu-bar time: "M:SS" under an hour, "H:MM" beyond — matches the design PDF's
    /// short "1:24" status-item count (the dropdown carries the full HH:MM:SS).
    private func compactElapsed(since start: Date) -> String {
        let total = max(0, Int(Date().timeIntervalSince(start)))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d", h, m) : String(format: "%d:%02d", m, s)
    }
}
