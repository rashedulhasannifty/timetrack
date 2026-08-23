import SwiftUI

/// A password field with a reveal toggle.
///
/// Typing a password blind into a menu-bar popover is unusually error-prone: the popover can
/// close on a stray click and take the half-typed value with it, and the only feedback on a
/// typo is a failed sign-in several seconds later.
///
/// Safe to reveal here specifically: this view is only ever shown when nobody is signed in,
/// and capture cannot run without a signed-in, policy-acknowledged user (`AckGate`). So there
/// is no path by which a screenshot records the revealed text.
struct RevealableSecureField: View {
    let title: String
    @Binding var text: String

    @State private var revealed = false
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: TT.Space.x1) {
            Group {
                if revealed {
                    TextField(title, text: $text)
                } else {
                    SecureField(title, text: $text)
                }
            }
            .textFieldStyle(.roundedBorder)
            .focused($focused)

            Button {
                revealed.toggle()
                // SwiftUI tears down the NSTextField and builds the other kind, so focus is
                // lost on every toggle. Without this the caret vanishes mid-password and the
                // person has to click back into the field to keep typing.
                DispatchQueue.main.async { focused = true }
            } label: {
                Image(systemName: revealed ? "eye.slash" : "eye")
                    .font(.system(size: 13))
                    .foregroundStyle(TT.Palette.textSecondary)
                    .frame(width: 22, height: 22)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // Not in the tab order: Tab from the password field belongs on Sign in, not here.
            .focusable(false)
            .help(revealed ? "Hide password" : "Show password")
            .accessibilityLabel(revealed ? "Hide password" : "Show password")
        }
    }
}
