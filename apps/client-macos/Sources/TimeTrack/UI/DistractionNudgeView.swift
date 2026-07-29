import AppKit
import SwiftUI

/// Slice 3.4 fallback — when macOS won't deliver the distraction nudge as a system notification
/// (e.g. an un-notarized dev build the OS refuses to register for notifications), show it as a
/// small, dismissible, NON-modal card instead, so the nudge is never silently lost. Always
/// visible; no stealth (CLAUDE.md §1). Carries only the generic, category-derived nudge text —
/// never an app name, host, or window title.
struct DistractionNudgeView: View {
    let title: String
    let message: String
    let onDismiss: () -> Void

    @State private var appeared = false

    var body: some View {
        VStack(spacing: TT.Space.x4) {
            // Time-on-distractions glyph in a soft, category-tinted disc.
            ZStack {
                Circle()
                    .fill(TT.Palette.categoryUnproductive.opacity(0.16))
                    .frame(width: 60, height: 60)
                Image(systemName: "hourglass")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(TT.Palette.categoryUnproductive)
            }

            VStack(spacing: TT.Space.x1) {
                Text(title.uppercased())
                    .font(.ttCaption)
                    .tracking(0.8)
                    .foregroundStyle(TT.Palette.textSecondary)
                Text(message)
                    .font(.ttH2)
                    .foregroundStyle(TT.Palette.text)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button(action: onDismiss) {
                Text("Got it")
                    .font(.ttLabel)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, TT.Space.x2 + 2)
                    .background(TT.Palette.accent, in: RoundedRectangle(cornerRadius: TT.Radius.sm))
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.defaultAction)
            .padding(.top, TT.Space.x1)
        }
        .padding(TT.Space.x6)
        .frame(width: 288)
        .background(TT.Palette.surfaceRaised, in: RoundedRectangle(cornerRadius: TT.Radius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: TT.Radius.lg)
                .strokeBorder(TT.Palette.separator, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.22), radius: 28, y: 10)
        .padding(TT.Space.x6)   // breathing room inside the clear window so the shadow isn't clipped
        .scaleEffect(appeared ? 1 : 0.94)
        .opacity(appeared ? 1 : 0)
        .onAppear {
            withAnimation(.spring(response: 0.36, dampingFraction: 0.82)) { appeared = true }
        }
    }
}

/// Presents the distraction nudge as a borderless, centered, non-activating card — reads like a
/// gentle banner, not a system modal. `present` replaces any nudge already on screen (the monitor
/// only fires once per streak, but this stays defensive). Dismiss on sign-out via
/// `dismissIfShowing()` so a prior user's nudge never lingers into the next sign-in (same teardown
/// discipline as `AwayResolutionWindowController`).
final class DistractionNudgeWindowController: NSWindowController {
    private static var live: DistractionNudgeWindowController?

    static func present(title: String, message: String) {
        live?.window?.close()
        let controller = DistractionNudgeWindowController(title: title, message: message)
        live = controller                                  // retain while shown
        // orderFrontRegardless (not makeKeyAndOrderFront / NSApp.activate): show WITHOUT stealing
        // focus from whatever the employee is typing in — a distraction nudge must not itself
        // interrupt (CLAUDE.md §1: transparency, not coercion).
        controller.window?.orderFrontRegardless()
    }

    static func dismissIfShowing() {
        live?.window?.close()
        live = nil
    }

    private init(title: String, message: String) {
        let panel = NSPanel(
            contentRect: .init(x: 0, y: 0, width: 360, height: 320),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered, defer: false
        )
        // A floating, transparent shell so the SwiftUI card supplies the rounded corners + shadow.
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false                            // the card draws its own soft shadow
        panel.becomesKeyOnlyIfNeeded = true                // the Dismiss button can click without activating
        super.init(window: panel)

        let host = NSHostingView(rootView: DistractionNudgeView(
            title: title,
            message: message,
            onDismiss: { [weak self] in self?.dismiss() }
        ))
        panel.contentView = host
        panel.setContentSize(host.fittingSize)             // shrink-wrap the window to the card
        panel.center()                                     // open in the middle of the screen
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func dismiss() {
        window?.close()
        Self.live = nil
    }
}
