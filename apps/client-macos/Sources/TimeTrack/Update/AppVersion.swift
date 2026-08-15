import Foundation

/// A dotted release version, compared numerically rather than as a string.
///
/// String comparison gets this wrong in the one case that matters — "0.10.0" sorts before
/// "0.9.0" — which would strand everyone on the older build exactly when the version numbers
/// start getting interesting.
///
/// Parsing is deliberately lenient about a leading "v" (GitHub tags carry one) and about
/// missing components ("0.2" == "0.2.0"), and deliberately strict about everything else: an
/// unparseable version means we do not know what is installed, and the caller must treat that
/// as "cannot compare" rather than as "needs updating".
struct AppVersion: Equatable, Comparable, CustomStringConvertible {
    let components: [Int]

    init?(_ raw: String) {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("v") || text.hasPrefix("V") { text.removeFirst() }
        // Drop any pre-release/build suffix: "0.2.0-beta.1" compares as "0.2.0".
        if let cut = text.firstIndex(where: { $0 == "-" || $0 == "+" }) { text = String(text[..<cut]) }
        guard !text.isEmpty else { return nil }

        var parsed: [Int] = []
        for part in text.split(separator: ".", omittingEmptySubsequences: false) {
            guard let n = Int(part), n >= 0 else { return nil }
            parsed.append(n)
        }
        guard !parsed.isEmpty else { return nil }
        components = parsed
    }

    /// The version of the running bundle. nil under `swift run`, which has no Info.plist.
    static func current(bundle: Bundle = .main) -> AppVersion? {
        guard let s = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        else { return nil }
        return AppVersion(s)
    }

    static func < (a: AppVersion, b: AppVersion) -> Bool {
        let n = max(a.components.count, b.components.count)
        for i in 0..<n {
            let l = i < a.components.count ? a.components[i] : 0
            let r = i < b.components.count ? b.components[i] : 0
            if l != r { return l < r }
        }
        return false
    }

    static func == (a: AppVersion, b: AppVersion) -> Bool {
        !(a < b) && !(b < a)
    }

    var description: String { components.map(String.init).joined(separator: ".") }
}
