import AppKit
import SwiftUI

/// Presents the monitoring policy for explicit acknowledgement (design PDF · "FIRST RUN · CONSENT
/// GATE"). There is no "skip" that starts capture — declining simply leaves the AckGate closed
/// (PRD §4.1). Monitoring is stated plainly, never hidden.
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
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 600),
            styleMask: [.titled],
            backing: .buffered, defer: false)
        window.title = "Welcome to Nifty Timer"
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

    @State private var hasRead = false
    @State private var showFullPolicy = false
    @State private var error: String?
    @State private var busy = false

    /// What is captured — derived from the live policy, not hardcoded, so the consent matches
    /// what the app will actually do (window titles / screenshots are policy-gated).
    private var recorded: [String] {
        var items = [
            "Time entries and durations",
            "Active app & website category",
            "Activity level (%)",
        ]
        if policy.settings.screenshotsEnabled {
            items.append("A screenshot about every \(policy.settings.screenshotIntervalMinutes) min")
        }
        if policy.settings.captureWindowTitles {
            items.append("Active window titles")
        }
        return items
    }

    /// Fixed guarantees the app never violates (CLAUDE.md §1). Not policy-dependent — these hold
    /// regardless of settings. (No "outside work hours" claim: the app has no work-hours concept.)
    private let neverRecorded = [
        "Keystrokes — what you type",
        "Message or document content",
        "Passwords",
        "Webcam, microphone, or clipboard",
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TT.Space.x4) {
                HStack(spacing: TT.Space.x2) {
                    RoundedRectangle(cornerRadius: TT.Radius.sm)
                        .fill(TT.Palette.accent)
                        .frame(width: 26, height: 26)
                        .overlay(
                            Image(systemName: "clock.fill")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(.white))
                    Text("Nifty Timer").font(.ttH2).foregroundStyle(TT.Palette.text)
                    Spacer()
                }

                VStack(alignment: .leading, spacing: TT.Space.x1) {
                    Text("Here's what Nifty Timer records")
                        .font(.ttH1).foregroundStyle(TT.Palette.text)
                    Text("Before anything is tracked, here's exactly what's captured — and what never is.")
                        .font(.ttBody).foregroundStyle(TT.Palette.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack(alignment: .top, spacing: TT.Space.x3) {
                    listCard(title: "RECORDED", items: recorded, recorded: true)
                    listCard(title: "NEVER RECORDED", items: neverRecorded, recorded: false)
                }

                HStack(alignment: .top, spacing: TT.Space.x2) {
                    Image(systemName: "checkmark.shield.fill")
                        .foregroundStyle(TT.Palette.accent)
                    Text("You can see everything recorded about you and redact any screenshot. The recording indicator is always visible and can't be switched off.")
                        .font(.ttCaption).foregroundStyle(TT.Palette.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(TT.Space.x3)
                .background(TT.Palette.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: TT.Radius.md))

                if showFullPolicy {
                    ScrollView {
                        Text(policy.policyText)
                            .font(.ttCaption).foregroundStyle(TT.Palette.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(TT.Space.x3)
                    }
                    .frame(maxHeight: 140)
                    .background(TT.Palette.surfaceRaised, in: RoundedRectangle(cornerRadius: TT.Radius.md))
                    .overlay(RoundedRectangle(cornerRadius: TT.Radius.md).stroke(TT.Palette.separator, lineWidth: 1))
                }

                Toggle(isOn: $hasRead) {
                    Text("I've read what Nifty Timer records.").font(.ttBody).foregroundStyle(TT.Palette.text)
                }
                .toggleStyle(.checkbox)

                if let error {
                    Text(error).font(.ttCaption).foregroundStyle(TT.Palette.destructive)
                }

                HStack {
                    Button(showFullPolicy ? "Hide the full policy" : "Read the full policy") {
                        showFullPolicy.toggle()
                    }
                    .buttonStyle(.link)
                    Spacer()
                    Button(busy ? "Recording…" : "Start Nifty Timer") { acknowledge() }
                        .keyboardShortcut(.defaultAction)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .tint(TT.Palette.accent)
                        .disabled(busy || !hasRead)
                }

                Text("Tracking can't begin until you acknowledge this. Policy \(policy.policyVersion).")
                    .font(.ttCaption).foregroundStyle(TT.Palette.textSecondary)
            }
            .padding(TT.Space.x6)
        }
        .frame(width: 520)
        .background(TT.Palette.surface)
    }

    private func listCard(title: String, items: [String], recorded: Bool) -> some View {
        VStack(alignment: .leading, spacing: TT.Space.x2) {
            Text(title).font(.ttCaption).foregroundStyle(TT.Palette.textSecondary)
            ForEach(items, id: \.self) { item in
                HStack(alignment: .top, spacing: TT.Space.x2) {
                    if recorded {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(TT.Palette.accent)
                            .frame(width: 14, alignment: .center)
                        Text(item).font(.ttLabel).foregroundStyle(TT.Palette.text)
                    } else {
                        Text(item).font(.ttLabel).foregroundStyle(TT.Palette.textSecondary)
                    }
                    Spacer(minLength: 0)
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TT.Space.x3)
        .background(TT.Palette.surfaceRaised, in: RoundedRectangle(cornerRadius: TT.Radius.md))
        .overlay(RoundedRectangle(cornerRadius: TT.Radius.md).stroke(TT.Palette.separator, lineWidth: 1))
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
