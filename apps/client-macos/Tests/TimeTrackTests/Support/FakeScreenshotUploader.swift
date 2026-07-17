import Foundation
@testable import TimeTrack

/// Scripted results in order; repeats the last once exhausted. Records every uploaded id.
final class FakeScreenshotUploader: ScreenshotUploading {
    private var results: [UploadResult]
    private(set) var uploadedIds: [String] = []

    init(results: [UploadResult]) { self.results = results }

    func upload(id: String, capturedAt: Date, jpeg: Data) async -> UploadResult {
        uploadedIds.append(id)
        if results.count > 1 { return results.removeFirst() }
        return results.first ?? .success
    }
}
