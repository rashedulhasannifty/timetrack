import AppKit
import Foundation

/// Resolves the FRONT browser's active-tab host, used ONLY to categorize the current activity
/// sample. The raw URL is read transiently and discarded here; it is NEVER stored, transmitted,
/// or logged (CLAUDE.md §1). Scripts only the frontmost app, and only when it is a known browser
/// (never arbitrary apps). Requires Automation (Apple Events) permission — denied/absent/error ⇒
/// nil ⇒ app-only categorization. Never blocks a sample.
protocol SiteResolving {
    func currentHost() -> String?
}

final class AppleScriptSiteResolver: SiteResolving {
    /// bundle id → AppleScript returning the active-tab URL of the front window.
    private static let scripts: [String: String] = [
        "com.apple.Safari": "tell application \"Safari\" to return URL of current tab of front window",
        "com.google.Chrome": "tell application \"Google Chrome\" to return URL of active tab of front window",
        "com.microsoft.edgemac": "tell application \"Microsoft Edge\" to return URL of active tab of front window",
        "com.brave.Browser": "tell application \"Brave Browser\" to return URL of active tab of front window",
        "company.thebrowser.Browser": "tell application \"Arc\" to return URL of active tab of front window",
    ]

    func currentHost() -> String? {
        guard let bundleId = NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
              let script = Self.scripts[bundleId],
              let apple = NSAppleScript(source: script) else { return nil }
        var err: NSDictionary?
        let out = apple.executeAndReturnError(&err)
        guard err == nil, let url = out.stringValue else { return nil }
        return Self.host(from: url)
    }

    /// Pure host extraction: scheme/path/query stripped, leading `www.` removed, lowercased.
    /// Only `http`/`https` URLs resolve to a host; internal browser schemes (e.g. `chrome://newtab`)
    /// return nil since they are not a "site" to categorize.
    static func host(from url: String) -> String? {
        guard let components = URLComponents(string: url),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = components.host?.lowercased(), !host.isEmpty else { return nil }
        if host.hasPrefix("www.") { return String(host.dropFirst(4)) }
        return host
    }
}
