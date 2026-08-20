import AppKit
import SwiftUI

/// The shared keep-or-discard card behind both time prompts — "You were away" (resume from idle)
/// and "Recover interrupted time?" (relaunch after a crash/shutdown). Same question, same two
/// answers, deliberately OPPOSITE defaults, so the default stays a parameter rather than being
/// baked in: PRD §6.1 makes Discard the default on the away prompt, while recovery defaults to
/// Keep because a graceful shutdown routes through it and Enter must not throw away real work.
///
/// The emphasized button is always the one Enter will press. That is the point of emphasizing
/// it — the user should be able to see what the default is, not discover it.
struct TimePromptView: View {
    enum DefaultChoice { case keep, discard }

    let symbol: String
    let title: String
    /// The span in question, shown as the hero number — the one fact the decision turns on.
    let minutes: Int
    let message: String
    let defaultChoice: DefaultChoice
    let onKeep: () -> Void
    let onDiscard: () -> Void

    @State private var appeared = false

    var body: some View {
        VStack(spacing: TT.Space.x4) {
            ZStack {
                Circle()
                    .fill(TT.Palette.accent.opacity(0.14))
                    .frame(width: 56, height: 56)
                Image(systemName: symbol)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(TT.Palette.accent)
            }

            VStack(spacing: TT.Space.x2) {
                Text(title)
                    .font(.ttH2)
                    .foregroundStyle(TT.Palette.text)
                    .multilineTextAlignment(.center)
                Text(durationText)
                    .font(.ttNumeric(28, weight: .semibold))
                    .foregroundStyle(TT.Palette.text)
                Text(message)
                    .font(.ttBody)
                    .foregroundStyle(TT.Palette.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: TT.Space.x2) {
                HStack(spacing: TT.Space.x2) {
                    choiceButton("Keep", emphasized: defaultChoice == .keep, action: onKeep)
                    choiceButton("Discard", emphasized: defaultChoice == .discard, action: onDiscard)
                }
                // Honest about what walking away does. Dismissing the window resolves to Discard
                // for BOTH prompts, which is invisible from the buttons alone.
                Text("Closing this window discards the time.")
                    .font(.ttCaption)
                    .foregroundStyle(TT.Palette.textSecondary)
            }
        }
        .padding(TT.Space.x6)
        .frame(width: 340)
        .scaleEffect(appeared ? 1 : 0.96)
        .opacity(appeared ? 1 : 0)
        .onAppear {
            withAnimation(.spring(response: 0.32, dampingFraction: 0.85)) { appeared = true }
        }
    }

    private var durationText: String {
        "\(minutes) minute\(minutes == 1 ? "" : "s")"
    }

    /// The emphasized choice is filled and carries `.defaultAction`, so Enter and the visual
    /// weight can never disagree.
    @ViewBuilder
    private func choiceButton(_ label: String, emphasized: Bool, action: @escaping () -> Void) -> some View {
        let button = Button(action: action) {
            Text(label)
                .font(.ttLabel)
                .foregroundStyle(emphasized ? Color.white : TT.Palette.text)
                .frame(maxWidth: .infinity)
                .padding(.vertical, TT.Space.x2 + 2)
                .background {
                    if emphasized {
                        RoundedRectangle(cornerRadius: TT.Radius.sm).fill(TT.Palette.accent)
                    } else {
                        RoundedRectangle(cornerRadius: TT.Radius.sm)
                            .strokeBorder(TT.Palette.separator, lineWidth: 1)
                    }
                }
        }
        .buttonStyle(.plain)

        if emphasized {
            button.keyboardShortcut(.defaultAction)
        } else {
            button
        }
    }
}

/// Window chrome shared by both prompts. Two things here are load-bearing:
///
///  * `.fullScreenAuxiliary` + `.floating` — a plain `NSWindow` at default level lands on a
///    DIFFERENT Space than a fullscreen app, so the prompt was simply never seen by anyone
///    working fullscreen. That is the "not visible" half of the complaint.
///  * centering on the ACTIVE screen — `NSWindow.center()` targets the main screen, which on a
///    multi-monitor desk is routinely not the one being looked at.
///
/// `.titled`/`.closable` stays: dismissing via the close button is a documented resolution path
/// (→ Discard), not an accident to design away.
enum TimePromptWindow {
    static func make(width: CGFloat, height: CGFloat) -> NSWindow {
        let window = NSWindow(
            contentRect: .init(x: 0, y: 0, width: width, height: height),
            styleMask: [.titled, .closable],
            backing: .buffered, defer: false
        )
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.backgroundColor = NSColor.windowBackgroundColor
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.isReleasedWhenClosed = false
        return window
    }

    /// Shrink-wrap to the SwiftUI card and center on the screen the user is actually on.
    static func fit(_ window: NSWindow, to host: NSView) {
        window.contentView = host
        window.setContentSize(host.fittingSize)
        if let screen = activeScreen() {
            let f = screen.visibleFrame
            let size = window.frame.size
            window.setFrameOrigin(NSPoint(
                x: f.midX - size.width / 2,
                y: f.midY - size.height / 2))
        } else {
            window.center()
        }
    }

    /// The screen under the pointer, falling back to the main screen. The pointer is the best
    /// available proxy for "where the person is looking" from a background agent.
    private static func activeScreen() -> NSScreen? {
        let mouse = NSEvent.mouseLocation
        return NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main
    }
}
