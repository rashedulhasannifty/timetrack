import Foundation
@testable import TimeTrack

/// Scripted results in order; repeats the last once exhausted. Records every uploaded id, and the
/// capture group each upload carried — the group has to survive the durable buffer round-trip, so
/// the drain is where a dropped group would show up.
final class FakeScreenshotUploader: ScreenshotUploading {
    private var results: [UploadResult]
    private(set) var uploadedIds: [String] = []
    private(set) var uploadedGroups: [CaptureGroup?] = []

    init(results: [UploadResult]) { self.results = results }

    func upload(id: String, capturedAt: Date, group: CaptureGroup?, jpeg: Data) async -> UploadResult {
        uploadedIds.append(id)
        uploadedGroups.append(group)
        if results.count > 1 { return results.removeFirst() }
        return results.first ?? .success
    }
}
