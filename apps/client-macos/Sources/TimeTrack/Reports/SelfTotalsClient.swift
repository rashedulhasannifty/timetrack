import Foundation

/// The signed-in person's own tracked totals, as the dropdown shows them.
///
/// Every boundary — which Dhaka day it is, when the week starts, when the month starts — is
/// decided by the server and arrives already resolved. Nothing here does date arithmetic: a
/// second definition of "when does the week start" living in Swift is what would quietly drift
/// out of step with the dashboard.
struct SelfTotals: Decodable, Equatable {
    let day: String
    let weekStart: String
    let monthStart: String
    let todaySeconds: Int
    let weekSeconds: Int
    let monthSeconds: Int
}

enum SelfTotalsClientError: Error { case unavailable }

protocol SelfTotalsFetching {
    func fetch() async throws -> SelfTotals
}

/// GET /v1/reports/my-totals. Available to any authenticated user and scoped to them server-side
/// — the route takes no user parameter at all. On a 401 it forces a token refresh and retries
/// once (mirrors `ProjectClient`); any other failure propagates so the caller can show that the
/// totals are unknown rather than showing a wrong number.
final class SelfTotalsClient: SelfTotalsFetching {
    private let baseURL: URL
    private let session: AuthSession

    init(baseURL: URL, session: AuthSession) {
        self.baseURL = baseURL
        self.session = session
    }

    func fetch() async throws -> SelfTotals {
        let token = try await session.accessToken()
        let (data, status) = try await get(token: token)
        if status == 401 {
            let refreshed = try await session.forceRefresh()
            let (retryData, retryStatus) = try await get(token: refreshed)
            guard retryStatus == 200 else { throw SelfTotalsClientError.unavailable }
            return try JSONDecoder().decode(SelfTotals.self, from: retryData)
        }
        guard status == 200 else { throw SelfTotalsClientError.unavailable }
        return try JSONDecoder().decode(SelfTotals.self, from: data)
    }

    private func get(token: String) async throws -> (Data, Int) {
        var request = URLRequest(url: baseURL.appendingPathComponent("reports/my-totals"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
}

/// "8h 12m", "12m", "0m" — the dropdown's format for a tracked duration.
///
/// Whole minutes: these are day/week/month figures, and a ticking seconds place next to the live
/// timer above would read as a second stopwatch. Hours are only shown once there is an hour.
enum WorkTotalFormat {
    static func short(seconds: Int) -> String {
        let total = max(0, seconds)
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        return hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m"
    }
}
