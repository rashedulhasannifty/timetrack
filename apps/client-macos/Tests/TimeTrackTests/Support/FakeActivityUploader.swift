@testable import TimeTrack

final class FakeActivityUploader: ActivitySampleUploading {
    var results: [UploadResult]
    private(set) var batches: [[ActivitySample]] = []
    init(results: [UploadResult]) { self.results = results }
    func upload(_ samples: [ActivitySample]) async -> UploadResult {
        batches.append(samples)
        return results.isEmpty ? .success : results.removeFirst()
    }
}
