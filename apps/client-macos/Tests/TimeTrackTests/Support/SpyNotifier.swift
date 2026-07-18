import Foundation
@testable import TimeTrack

final class SpyNotifier: LocalNotifying {
    private(set) var authRequested = false
    private(set) var posted: [(id: String, title: String, body: String)] = []
    private(set) var clearedCount = 0

    func requestAuthorization() { authRequested = true }
    func notify(id: String, title: String, body: String) { posted.append((id, title, body)) }
    func clearAll() { clearedCount += 1 }
}
