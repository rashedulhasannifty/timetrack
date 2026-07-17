import Foundation
@testable import TimeTrack

/// Scripted grabber for scheduler tests — returns bytes or throws, and counts calls.
final class FakeDisplayGrabber: DisplayGrabbing {
    enum Outcome { case bytes(Data); case fail(Error) }
    private let outcome: Outcome
    private(set) var grabCount = 0

    init(_ outcome: Outcome) { self.outcome = outcome }

    func grab() async throws -> Data {
        grabCount += 1
        switch outcome {
        case .bytes(let d): return d
        case .fail(let e): throw e
        }
    }
}
