import Foundation
@testable import TimeTrack

final class FakeLiveSpanRecorder: LiveSpanRecording {
    struct Begin: Equatable {
        let entryId: String; let startTime: Date
        let selection: TimeTracker.Selection; let source: TimeTracker.Source
    }
    private(set) var begins: [Begin] = []
    private(set) var clears = 0

    func begin(entryId: String, startTime: Date, selection: TimeTracker.Selection, source: TimeTracker.Source) {
        begins.append(Begin(entryId: entryId, startTime: startTime, selection: selection, source: source))
    }
    func clear() { clears += 1 }
}
