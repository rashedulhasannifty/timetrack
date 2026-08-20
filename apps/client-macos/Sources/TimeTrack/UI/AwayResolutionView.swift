import AppKit
import SwiftUI

/// PRD §6.1 — on resume from idle: "You were away for X minutes — keep or discard?" Discard is
/// the default action (and the result if the panel is dismissed). Always a visible window; no
/// stealth. `resolve` is guaranteed to fire exactly once.
/// PRD §6.1 — on resume from idle: "You were away for X minutes — keep or discard?" Discard is
/// the default action (and the result if the panel is dismissed). Always a visible window; no
/// stealth. `resolve` is guaranteed to fire exactly once. The card itself is `TimePromptView`,
/// shared with the recovery prompt; only the copy and the DEFAULT differ.
struct AwayResolutionView: View {
    let minutes: Int
    let onKeep: () -> Void
    let onDiscard: () -> Void

    var body: some View {
        TimePromptView(
            symbol: "moon.zzz.fill",
            title: "You were away",
            minutes: minutes,
            message: "The clock kept running while your Mac was idle. Keep this time or discard it?",
            defaultChoice: .discard,          // PRD §6.1 — never invent time by default
            onKeep: onKeep,
            onDiscard: onDiscard)
    }
}

final class AwayResolutionWindowController: NSWindowController, NSWindowDelegate {
    private var resolve: ((AwayResolution) -> Void)?
    private static var live: AwayResolutionWindowController?

    static func present(minutes: Int, resolve: @escaping (AwayResolution) -> Void) {
        let controller = AwayResolutionWindowController(minutes: minutes, resolve: resolve)
        live = controller                                  // retain while shown
        NSApp.activate(ignoringOtherApps: true)
        controller.showWindow(nil)
        controller.window?.makeKeyAndOrderFront(nil)
    }

    /// Close the prompt if it's still on screen (e.g. on sign-out, once auto-tracking is torn
    /// down). Closing routes through `windowWillClose` → `resolve(.discard)`; call this AFTER the
    /// monitor is deactivated so that `resolve` is a harmless no-op on the now-inactive monitor
    /// (the away window is already recorded UNRESOLVED). Leaving the panel up is the only harm.
    static func dismissIfShowing() {
        live?.window?.close()
    }

    private init(minutes: Int, resolve: @escaping (AwayResolution) -> Void) {
        self.resolve = resolve
        let window = TimePromptWindow.make(width: 340, height: 300)
        super.init(window: window)
        window.delegate = self
        TimePromptWindow.fit(window, to: NSHostingView(rootView: AwayResolutionView(
            minutes: minutes,
            onKeep: { [weak self] in self?.finish(.keep) },
            onDiscard: { [weak self] in self?.finish(.discard) }
        )))
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func finish(_ action: AwayResolution) {
        guard let resolve else { return }
        self.resolve = nil                                 // fire exactly once
        resolve(action)
        window?.close()
        Self.live = nil
    }

    /// Dismissing the panel (red close button) defaults to Discard (PRD §6.1).
    func windowWillClose(_ notification: Notification) {
        if let resolve {
            self.resolve = nil
            resolve(.discard)
            Self.live = nil
        }
    }
}
