import AppKit
import SwiftUI

/// Shown on relaunch when a previous tracking span was interrupted (crash or quit-while-tracking).
/// Keep → the span is recovered as a completed entry ending at the last heartbeat; Discard drops it.
/// Discard is the default action (and the result of dismissing), mirroring the away prompt. Always
/// a visible window; no stealth. `resolve` fires exactly once.
struct RecoveryView: View {
    let minutes: Int
    let onKeep: () -> Void
    let onDiscard: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TT.Space.x4) {
            Text("Recover interrupted time?")
                .font(.ttH2)
            Text("TimeTrack was tracking for about \(minutes) minute\(minutes == 1 ? "" : "s") when it last closed. Keep this time or discard it?")
                .font(.ttBody)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("Keep", action: onKeep)
                Button("Discard", action: onDiscard)
                    .keyboardShortcut(.defaultAction)
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
    /// `windowWillClose` → `resolve(.discard)`, which clears the live-span file without
    /// enqueuing anything — the only harm is the panel having been left up.
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
