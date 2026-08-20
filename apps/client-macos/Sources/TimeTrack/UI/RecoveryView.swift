import AppKit
import SwiftUI

/// Shown on relaunch when a previous tracking span was interrupted (crash, shutdown, or
/// quit-while-tracking). Keep → the span is recovered as a completed entry ending at the last
/// heartbeat; Discard drops it and closes any server-side row at zero duration.
///
/// Keep is the DEFAULT action: a graceful shutdown routes through this same prompt, and
/// pressing Enter should not throw away real work. Dismissing the window still resolves to
/// Discard, so an ignored prompt never silently invents time. Always a visible window; no
/// stealth. `resolve` fires exactly once.
struct RecoveryView: View {
    let minutes: Int
    let onKeep: () -> Void
    let onDiscard: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TT.Space.x4) {
            Text("Recover interrupted time?")
                .font(.ttH2)
            Text("Nifty Timer was tracking for about \(minutes) minute\(minutes == 1 ? "" : "s") when it last closed. Keep this time or discard it?")
                .font(.ttBody)
                .foregroundStyle(TT.Palette.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("Keep", action: onKeep)
                    .keyboardShortcut(.defaultAction)
                Button("Discard", action: onDiscard)
            }
        }
        .padding(TT.Space.x6)
        .frame(width: 320)
    }
}

final class RecoveryWindowController: NSWindowController, NSWindowDelegate {
    private var resolve: ((AwayResolution) -> Void)?
    private static var live: RecoveryWindowController?

    static func present(minutes: Int, resolve: @escaping (AwayResolution) -> Void) {
        let controller = RecoveryWindowController(minutes: minutes, resolve: resolve)
        live = controller
        NSApp.activate(ignoringOtherApps: true)
        controller.showWindow(nil)
        controller.window?.makeKeyAndOrderFront(nil)
    }

    /// Close the prompt if it's still on screen (e.g. on sign-out, so a prior user's recovery
    /// window never survives into the next user's session). Closing routes through
    /// `windowWillClose` → `resolve(.discard)`, which enqueues a zero-duration close for the
    /// still-open server row and clears the live-span file — the only local state left behind is
    /// the panel having been on screen. On sign-out this runs BEFORE the final buffer drain, so
    /// that close uploads under the still-valid token of the user it belongs to.
    static func dismissIfShowing() {
        live?.window?.close()
    }

    private init(minutes: Int, resolve: @escaping (AwayResolution) -> Void) {
        self.resolve = resolve
        let window = NSWindow(
            contentRect: .init(x: 0, y: 0, width: 320, height: 170),
            styleMask: [.titled, .closable],
            backing: .buffered, defer: false
        )
        window.center()
        window.isReleasedWhenClosed = false
        super.init(window: window)
        window.delegate = self
        window.contentView = NSHostingView(rootView: RecoveryView(
            minutes: minutes,
            onKeep: { [weak self] in self?.finish(.keep) },
            onDiscard: { [weak self] in self?.finish(.discard) }
        ))
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func finish(_ action: AwayResolution) {
        guard let resolve else { return }
        self.resolve = nil
        resolve(action)
        window?.close()
        Self.live = nil
    }

    func windowWillClose(_ notification: Notification) {
        if let resolve {
            self.resolve = nil
            resolve(.discard)
            Self.live = nil
        }
    }
}
