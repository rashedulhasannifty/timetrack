import AppKit
import SwiftUI

/// A dedicated login window (the app is LSUIElement, so it has no default window). On success
/// it calls `onSuccess` and closes. No token is ever shown or logged.
final class LoginWindowController {
    private let session: AuthSession
    private let onSuccess: () -> Void
    private var window: NSWindow?

    init(session: AuthSession, onSuccess: @escaping () -> Void) {
        self.session = session
        self.onSuccess = onSuccess
    }

    /// If a login window from this controller already exists, bring it to the front and report
    /// true — so the caller reuses it instead of opening a second window. (`window` is only
    /// cleared on success; a user-closed window is re-shown, which is the desired behaviour.)
    func bringToFrontIfShowing() -> Bool {
        guard let window else { return false }
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        return true
    }

    func show() {
        let view = LoginView(session: session) { [weak self] in
            self?.window?.close()
            self?.window = nil
            self?.onSuccess()
        }
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 220),
            styleMask: [.titled, .closable],
            backing: .buffered, defer: false)
        window.title = "Sign in to Nifty Timer"
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

struct LoginView: View {
    let session: AuthSession
    let onSuccess: () -> Void

    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: TT.Space.x4) {
            HStack(spacing: TT.Space.x3) {
                RoundedRectangle(cornerRadius: TT.Radius.sm)
                    .fill(TT.Palette.accent)
                    .frame(width: 32, height: 32)
                    .overlay(
                        Image(systemName: "clock.fill")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                    )
                VStack(alignment: .leading, spacing: 1) {
                    Text("Sign in to Nifty Timer")
                        .font(.ttH2).foregroundStyle(TT.Palette.text)
                    Text("Your workspace is waiting.")
                        .font(.ttCaption).foregroundStyle(TT.Palette.textSecondary)
                }
            }

            VStack(spacing: TT.Space.x2) {
                TextField("you@company.com", text: $email).textFieldStyle(.roundedBorder)
                SecureField("Password", text: $password).textFieldStyle(.roundedBorder)
            }

            if let error {
                Text(error).font(.ttCaption).foregroundStyle(TT.Palette.destructive)
            }

            Button(busy ? "Signing in…" : "Sign in") { submit() }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .tint(TT.Palette.accent)
                .frame(maxWidth: .infinity)
                .disabled(busy || email.isEmpty || password.isEmpty)
        }
        .padding(TT.Space.x6)
        .frame(width: 360, alignment: .leading)
        .background(TT.Palette.surface)
    }

    private func submit() {
        busy = true
        error = nil
        Task {
            do {
                try await session.login(email: email, password: password)
                await MainActor.run { onSuccess() }
            } catch AuthError.invalidCredentials {
                await MainActor.run { error = "Incorrect email or password."; busy = false }
            } catch {
                await MainActor.run { self.error = "Could not sign in. Check your connection."; busy = false }
            }
        }
    }
}
