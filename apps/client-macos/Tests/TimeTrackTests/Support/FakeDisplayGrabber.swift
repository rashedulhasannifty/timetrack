import Foundation
@testable import TimeTrack

/// Scripted grabber for scheduler tests — returns per-display captures or throws, and counts calls.
final class FakeDisplayGrabber: DisplayGrabbing {
    enum Outcome {
        /// A single-display desk: one capture, one display attempted.
        case bytes(Data)
        /// A multi-display desk. `attempted` may exceed the captures to model a display that
        /// failed on its own while the rest of the desk captured fine.
        case displays([Data], attempted: Int)
        case fail(Error)
    }
    private let outcome: Outcome
    private(set) var grabCount = 0

    init(_ outcome: Outcome) { self.outcome = outcome }

    func grabAll() async throws -> DisplayGrabResult {
        grabCount += 1
        switch outcome {
        case .bytes(let d):
            return DisplayGrabResult(captures: [DisplayCapture(index: 0, jpeg: d)], attempted: 1)
        case .displays(let images, let attempted):
            return DisplayGrabResult(
                captures: images.enumerated().map { DisplayCapture(index: $0.offset, jpeg: $0.element) },
                attempted: attempted)
        case .fail(let e):
            throw e
        }
    }
}
