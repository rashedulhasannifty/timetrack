import XCTest
@testable import TimeTrack

final class ProjectClientTests: XCTestCase {
    private let base = URL(string: "https://api.example.com/v1")!

    func testAnAdminAsksForEveryTeam() {
        let url = ProjectClient.listURL(baseURL: base, token: testJWT(role: "ADMIN", teamId: "t1"))
        XCTAssertEqual(url.absoluteString, "https://api.example.com/v1/projects?allTeams=true")
    }

    func testEveryOtherRoleSendsTheUnchangedRequest() {
        for role in ["EMPLOYEE", "MANAGER"] {
            let url = ProjectClient.listURL(baseURL: base, token: testJWT(role: role, teamId: "t1"))
            XCTAssertEqual(url.absoluteString, "https://api.example.com/v1/projects", role)
        }
    }

    func testAnUndecodableTokenFallsBackToTheUnchangedRequest() {
        XCTAssertEqual(ProjectClient.listURL(baseURL: base, token: "garbage").absoluteString,
                       "https://api.example.com/v1/projects")
    }
}
