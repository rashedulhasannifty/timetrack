import AppKit
import SwiftUI

/// Presents the monitoring policy for explicit acknowledgement. There is no "skip" that starts
/// capture — declining simply leaves the AckGate closed (PRD §4.1). Monitoring is stated plainly,
/// never hidden.
final class AckWindowController {
    private let policy: EffectivePolicy
    private let userId: String
    private let ackClient: AckClient
    private let onAcknowledged: () -> Void
    private var window: NSWindow?

    init(policy: EffectivePolicy, userId: String, ackClient: AckClient, onAcknowledged: @escaping () -> Void) {
        self.policy = policy
        self.userId = userId
        self.ackClient = ackClient
        self.onAcknowledged = onAcknowledged
    }

    func show() {
        let view = AckView(policy: policy, userId: userId, ackClient: ackClient) { [weak self] in
            self?.window?.close()
            self?.window = nil
            self?.onAcknowledged()
        }
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 420),
            styleMask: [.titled],
            backing: .buffered, defer: false)
        window.title = "Monitoring policy"
        window.contentView = NSHostingView(rootView: view)
        window.center()
        // ARC owns this window via `self.window`; without this, AppKit ALSO releases it on
        // close() (isReleasedWhenClosed defaults to true) → double-free → SIGSEGV in the
        // close-animation teardown. Matches RecoveryView/AwayResolutionView.
        window.isReleasedWhenClosed = false
        self.window = window
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }
}

struct AckView: View {
    let policy: EffectivePolicy
    let userId: String
    let ackClient: AckClient
    let onAcknowledged: () -> Void

    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: TT.Space.x3) {
            Text("Monitoring policy (\(policy.policyVersion))")
                .font(.ttH2).foregroundStyle(TT.Palette.text)
            ScrollView {
                Text(policy.policyText)
                    .font(.ttBody).foregroundStyle(TT.Palette.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(TT.Space.x3)
            }
            .frame(maxHeight: 260)
            .background(TT.Palette.surfaceRaised, in: RoundedRectangle(cornerRadius: TT.Radius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TT.Radius.md)
                    .stroke(TT.Palette.separator, lineWidth: 1)
            )
            Text("While tracking, TimeTrack monitors activity as described above. The menu-bar indicator is always visible.")
                .font(.ttCaption).foregroundStyle(TT.Palette.textSecondary)
            if let error {
                Text(error).font(.ttCaption).foregroundStyle(TT.Palette.destructive)
            }
            HStack {
                Spacer()
                Button(busy ? "Recording…" : "I acknowledge") { acknowledge() }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .tint(TT.Palette.accent)
                    .disabled(busy)
            }
        }
        .padding(TT.Space.x6)
        .frame(width: 460, alignment: .leading)
        .background(TT.Palette.surface)
    }

    private func acknowledge() {
        busy = true
        error = nil
        Task {
            do {
                try await ackClient.acknowledge(userId: userId, policyVersion: policy.policyVersion)
                await MainActor.run { onAcknowledged() }
            } catch {
                await MainActor.run { self.error = "Could not record acknowledgement. Try again."; busy = false }
            }
        }
    }
}
