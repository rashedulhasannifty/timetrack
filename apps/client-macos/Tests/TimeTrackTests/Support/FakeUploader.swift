import Foundation
@testable import TimeTrack

/// Returns scripted results in order; once exhausted, repeats the last one. Records every payload.
final class FakeUploader: Uploading {
    private var results: [UploadResult]
    private(set) var uploadedPayloads: [Data] = []

    init(results: [UploadResult]) { self.results = results }

    func upload(_ payload: Data) async -> UploadResult {
        uploadedPayloads.append(payload)
        if results.count > 1 { return results.removeFirst() }
        return results.first ?? .success
    }
}
