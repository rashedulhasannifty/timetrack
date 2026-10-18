import Foundation

/// String limits as the server measures them.
///
/// The API validates with Zod, and `z.string().max(n)` checks JavaScript `length` — UTF-16 code
/// units, not Swift `Character`s. The two agree for ASCII and drift apart everywhere else: an
/// emoji is one Character and two UTF-16 units, a flag is one Character and four. A title cut to
/// 120 Characters could be 480 units long, the server answers 422, and the batch it rode in was
/// thrown away. Every client-side limit that mirrors a contract `max()` goes through here.
enum UTF16Limit {
    /// The longest prefix of `s` that is at most `limit` UTF-16 units long and ends on a
    /// `Character` boundary — a cut never splits a surrogate pair, a flag, an emoji sequence, or a
    /// letter from its combining accents, so the result is always a valid, renderable string.
    /// Unchanged when it already fits. Can be empty when the first Character alone is too long.
    static func truncate(_ s: String, to limit: Int) -> String {
        guard s.utf16.count > limit else { return s }
        var used = 0
        var end = s.startIndex
        for index in s.indices {
            let next = s.index(after: index)
            let width = s.utf16.distance(from: index, to: next)
            if used + width > limit { break }
            used += width
            end = next
        }
        return String(s[..<end])
    }
}
