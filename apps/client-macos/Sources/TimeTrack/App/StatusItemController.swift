import AppKit
import SwiftUI

/// PRD §4.2 — the always-visible indicator. There is no build flag, config key, or API
/// response that can hide it. It reflects three states (design PDF · "STATUS ITEM · THREE
/// STATES"): idle, tracking (with a live elapsed count), and capturing (a camera glyph shown
/// briefly while a screenshot is taken). Clicking it toggles the dropdown popover.
final class StatusItemController: NSObject {
    enum State: Hashable { case idle, tracking, capturing }

    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let popover = NSPopover()
    private var currentState: State = .idle
    private var screenRecordingDenied = false
    /// macOS is blocking the Apple Event that reads the front browser's tab host, so site rules
    /// (youtube.com &c.) silently never match. Surfaced rather than swallowed.
    private var automationDenied = false
    private var updateOverdue = false
    private var updateVersion: String?
    /// refresh() runs once a second while tracking; build each status image once
    /// rather than re-reading it from the bundle on every tick.
    private var statusImages: [State: NSImage] = [:]

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

    /// Called each time the dropdown is opened (not on close). Used to refresh on-demand data —
    /// e.g. re-fetch the project list so a project added in the dashboard shows without a restart.
    var onOpen: (() -> Void)?

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
        guard let button = item.button, button.window != nil else { return }
        onOpen?()   // refresh on-demand data (e.g. the project list) as the dropdown opens
        // Activate BEFORE showing so the popover doesn't drift when the app comes forward.
        NSApp.activate(ignoringOtherApps: true)
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        pinPopover()
        // When the frontmost app is FULLSCREEN, the activate() above starts a Space transition and
        // the status bar re-lays out during it (the fullscreen app's own menu items appear/
        // disappear), so the frame read a moment ago is not where the icon ends up — the dropdown
        // landed offset to the right. Re-pin once the transition has settled, reading a FRESH
        // button frame. Cheap and idempotent on the common (non-fullscreen) path.
        DispatchQueue.main.async { [weak self] in self?.pinPopover() }
        // Global monitor fires only for events in OTHER apps, so a click on the icon or inside the
        // dropdown won't trip it — only a genuine click-away dismisses.
        outsideClickMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown]
        ) { [weak self] _ in
            self?.closePopover()
        }
    }

    /// Pin the dropdown directly beneath the status icon. NSPopover's own auto-anchoring is
    /// confused by the flipped status-bar button and drops the dropdown ~180pt down the screen,
    /// so the window is positioned by hand from the button's live on-screen frame.
    ///
    /// `.fullScreenAuxiliary` lets the dropdown render over a fullscreen app's Space at all —
    /// without it the popover can only appear once macOS has switched away from that Space,
    /// which is the relayout that moved it in the first place.
    private func pinPopover() {
        guard let button = item.button,
              let buttonFrame = button.window?.frame,
              let popWindow = popover.contentViewController?.view.window else { return }
        popWindow.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        // The screen the ICON is on — not NSScreen.main, which is the screen with the key window
        // and so points at the wrong display as soon as a second monitor is attached.
        let screen = NSScreen.screens.first { $0.frame.intersects(buttonFrame) } ?? NSScreen.main
        popWindow.setFrameOrigin(Self.popoverOrigin(
            buttonFrame: buttonFrame,
            popoverSize: popWindow.frame.size,
            visibleFrame: screen?.visibleFrame ?? buttonFrame))
    }

    /// Where the dropdown sits: centered under the status icon, its top flush beneath the menu
    /// bar, clamped so a popover near the right edge of the screen (or a narrow display) is
    /// nudged back on-screen instead of running off it. Pure so the geometry is testable without
    /// a status bar — the AppKit wiring in `pinPopover()` is manual-verify only.
    static func popoverOrigin(buttonFrame: NSRect, popoverSize: NSSize, visibleFrame: NSRect) -> NSPoint {
        let rightmost = max(visibleFrame.minX, visibleFrame.maxX - popoverSize.width)
        let x = min(max(buttonFrame.midX - popoverSize.width / 2, visibleFrame.minX), rightmost)
        // Hangs below the icon; never pushed off the bottom of a short display.
        let y = max(visibleFrame.minY, buttonFrame.minY - popoverSize.height)
        return NSPoint(x: x, y: y)
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
        item.button?.toolTip = "Nifty Timer: monitoring policy unavailable — not tracking."
    }

    /// PRD §6.2 / §4.2 — Screen Recording permission is missing while capture is enabled. Visible,
    /// never silent; tracking is unaffected. Cleared once a capture succeeds. Rendered as a "⚠️"
    /// PREPENDED to the state — never hides the tracking indicator (CLAUDE.md §1: no kill switch).
    func showScreenRecordingDenied() {
        screenRecordingDenied = true
        updateTooltip()
        refresh()
    }

    /// Screen Recording works again (a capture succeeded). Only that flag clears — an Automation
    /// or update warning is unrelated and must survive a successful screenshot.
    func clearWarning() {
        screenRecordingDenied = false
        updateTooltip()
        refresh()
    }

    /// Slice 4.5 — the front browser's tab host drives the productive/unproductive SITE rules, and
    /// reading it needs Automation (Apple Events) permission. Denied, the client can still
    /// categorize by app, so nothing breaks loudly — the site lists just never match. That silence
    /// is the bug this surfaces. Only raised while the team actually has site rules configured.
    func setAutomationDenied(_ denied: Bool) {
        guard automationDenied != denied else { return }
        automationDenied = denied
        updateTooltip()
        refresh()
    }

    /// A newer build has been available past the grace period. Advisory only — tracking is
    /// unaffected, and this never gates capture (CLAUDE.md §1). Screen Recording takes tooltip
    /// precedence because it is the one the person can act on immediately.
    func setUpdateOverdue(_ overdue: Bool, version: String? = nil) {
        guard updateOverdue != overdue else { return }
        updateOverdue = overdue
        updateVersion = version
        updateTooltip()
        refresh()
    }

    private func updateTooltip() {
        item.button?.toolTip = Self.tooltip(
            screenRecordingDenied: screenRecordingDenied, automationDenied: automationDenied,
            updateOverdue: updateOverdue, updateVersion: updateVersion)
    }

    /// The tooltip precedence rule, pure so the ordering is testable without a status bar.
    /// Screen Recording first (capture is actually failing), then Automation (site rules are
    /// silently inert), then the advisory update — most actionable first.
    static func tooltip(screenRecordingDenied: Bool, automationDenied: Bool,
                        updateOverdue: Bool, updateVersion: String?) -> String? {
        if screenRecordingDenied {
            return "Nifty Timer: Screen Recording permission needed for screenshots — open System Settings > Privacy > Screen Recording."
        }
        if automationDenied {
            return "Nifty Timer: Automation permission needed to categorize websites — open System Settings > Privacy > Automation and allow Nifty Timer to control your browser."
        }
        if updateOverdue {
            let v = updateVersion.map { " \($0)" } ?? ""
            return "Nifty Timer\(v) is available — open the menu to update."
        }
        return nil
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
        button.image = statusImage(for: currentState)

        var title = ""
        if currentState != .idle, let startedAt {
            title = " " + compactElapsed(since: startedAt)
        }
        // One marker covers all three conditions — several warning glyphs in the menu bar would
        // be noise, and the tooltip says which it is.
        if screenRecordingDenied || automationDenied || updateOverdue {
            title = " ⚠️" + title
        }
        button.title = title
    }

    /// The brand glyph when running from a packaged .app, else the SF Symbol.
    ///
    /// The PNGs are copied into Contents/Resources by scripts/package-app.sh and read
    /// through `Bundle.main` — SwiftPM's `Bundle.module` is deliberately not used, since
    /// that script assembles the bundle by hand and never copies SwiftPM's resource
    /// bundle out of .build. The SF Symbol fallback keeps `swift run` (no bundle, so no
    /// resources) working in development, and keeps the indicator present either way.
    private func statusImage(for state: State) -> NSImage? {
        if let cached = statusImages[state] { return cached }
        let image = makeStatusImage(for: state)
        statusImages[state] = image
        return image
    }

    private func makeStatusImage(for state: State) -> NSImage? {
        if let image = Bundle.main.image(forResource: imageName(for: state)) {
            // The @2x rep is 32px; without this NSImage reports a 32pt image and the
            // menu bar renders it at double size.
            image.size = NSSize(width: 16, height: 16)
            image.isTemplate = true   // adopt the menu-bar's monochrome light/dark tint
            image.accessibilityDescription = accessibilityLabel(for: state)
            return image
        }
        let image = NSImage(systemSymbolName: symbolName(for: state),
                            accessibilityDescription: accessibilityLabel(for: state))
        image?.isTemplate = true
        return image
    }

    private func imageName(for state: State) -> String {
        switch state {
        case .idle: return "menubar_idle"
        case .tracking: return "menubar_tracking"
        case .capturing: return "menubar_capturing"
        }
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
        case .idle: return "Nifty Timer: not tracking"
        case .tracking: return "Nifty Timer: tracking"
        case .capturing: return "Nifty Timer: capturing a screenshot"
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
