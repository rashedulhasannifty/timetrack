import AppKit

/// PRD §4.2 — the always-visible indicator. There is no build flag, config key, or API
/// response that can hide it. Its icon reflects state: idle / tracking / capturing.
final class StatusItemController {
    enum State {
        case idle, tracking, capturing
    }

    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

    func install() {
        item.button?.title = "⏱"
        // TODO(scaffold): build the dropdown (start/stop/pause, project picker, "My Data",
        // Settings) and reflect State in the icon.
    }

    func setState(_ state: State) {
        switch state {
        case .idle: item.button?.title = "⏱"
        case .tracking: item.button?.title = "▶︎"
        case .capturing: item.button?.title = "◉"
        }
    }
}
