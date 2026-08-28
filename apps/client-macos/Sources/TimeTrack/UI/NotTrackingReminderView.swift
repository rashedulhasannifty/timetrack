import AppKit
import SwiftUI

/// The "your time isn't being recorded" reminder.
///
/// Two situations reach it, both of which used to be completely silent:
///   • the launch-time policy resolve has failed several times running, so auto-tracking never
///     installed (the login-item case — the app starts before the network is up);
///   • auto mode is live but the clock is idle while the employee has been present for a while.
///
/// It is a WINDOW rather than a notification on purpose: the notifier silently drops everything
/// on a build macOS has not authorized (see `LocalNotifier`), and a reminder that the day is not
/// being recorded is the one that must never be lost. Always visible; dismissible; no stealth
/// (CLAUDE.md §1). It carries no app name, host, or window title — just the tracking state.
struct NotTrackingReminderView: View {
    let title: String
    let message: String
    let primaryLabel: String
    let onPrimary: () -> Void
    let onDismiss: () -> Void

    @State private var appeared = false

    var body: some View {
        VStack(spacing: TT.Space.x4) {
            // A stopped-clock glyph in a soft warning disc — the state being reported.
            ZStack {
                Circle()
                    // The amber attention tone, shared with the distraction card. Reused
                    // rather than adding a `warning` token: the palette is design-owned and
                    // a new name here would drift from the dashboard's.
                    .fill(TT.Palette.categoryUnproductive.opacity(0.16))
                    .frame(width: 60, height: 60)
                Image(systemName: "clock.badge.exclamationmark")
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

            VStack(spacing: TT.Space.x2) {
                Button(action: onPrimary) {
                    Text(primaryLabel)
                        .font(.ttLabel)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, TT.Space.x2 + 2)
                        .background(TT.Palette.accent, in: RoundedRectangle(cornerRadius: TT.Radius.sm))
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.defaultAction)

                Button(action: onDismiss) {
                    Text("Not now")
                        .font(.ttLabel)
                        .foregroundStyle(TT.Palette.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, TT.Space.x2)
                }
                .buttonStyle(.plain)
            }
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

/// Presents the reminder as a borderless, centered, non-activating card — the same shell as
/// `DistractionNudgeWindowController`. `present` replaces any reminder already on screen, so the
/// connectivity and forgot-to-start triggers can never stack two cards.
///
/// `dismissIfShowing()` is called on sign-out: a reminder left on screen carries a Start button
/// that would open an entry attributed to whoever signs in NEXT (the leak class that has already
/// bitten the away prompt and the recovery prompt).
final class NotTrackingReminderWindowController: NSWindowController {
    private static var live: NotTrackingReminderWindowController?

    static func present(title: String, message: String, primaryLabel: String,
                        onPrimary: @escaping () -> Void) {
        live?.window?.close()
        let controller = NotTrackingReminderWindowController(
            title: title, message: message, primaryLabel: primaryLabel, onPrimary: onPrimary)
        live = controller                                  // retain while shown
        // orderFrontRegardless, not makeKeyAndOrderFront: surface WITHOUT stealing focus from
        // whatever the employee is typing in (CLAUDE.md §1 — transparency, not coercion).
        controller.window?.orderFrontRegardless()
    }

    static func dismissIfShowing() {
        live?.window?.close()
        live = nil
    }

    private init(title: String, message: String, primaryLabel: String,
                 onPrimary: @escaping () -> Void) {
        let panel = NSPanel(
            contentRect: .init(x: 0, y: 0, width: 360, height: 360),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered, defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false                            // the card draws its own soft shadow
        panel.becomesKeyOnlyIfNeeded = true
        super.init(window: panel)

        let host = NSHostingView(rootView: NotTrackingReminderView(
            title: title,
            message: message,
            primaryLabel: primaryLabel,
            onPrimary: { [weak self] in
                onPrimary()
                self?.dismiss()
            },
            onDismiss: { [weak self] in self?.dismiss() }
        ))
        panel.contentView = host
        panel.setContentSize(host.fittingSize)             // shrink-wrap the window to the card
        panel.center()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func dismiss() {
        window?.close()
        Self.live = nil
    }
}
