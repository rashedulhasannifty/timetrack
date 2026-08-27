import XCTest
@testable import TimeTrack

final class LoginItemSyncTests: XCTestCase {
    private final class FakeLoginItem: LoginItemControlling {
        var status: LoginItemStatus
        var registerCalls = 0
        var unregisterCalls = 0
        var throwsOnWrite = false

        init(_ status: LoginItemStatus) { self.status = status }

        func register() throws {
            registerCalls += 1
            if throwsOnWrite { throw NSError(domain: "test", code: 1) }
            status = .registered
        }

        func unregister() throws {
            unregisterCalls += 1
            if throwsOnWrite { throw NSError(domain: "test", code: 1) }
            status = .notRegistered
        }
    }

    // The whole point of the setting: a Mac that never opened the app can never start tracking
    // on it, so turning the team policy on has to put the app in Login Items.
    func testTurningTheTeamSettingOnRegistersTheApp() {
        let item = FakeLoginItem(.notRegistered)
        XCTAssertEqual(LoginItemSync.apply(autoStartOnLogin: true, to: item), .registered)
        XCTAssertEqual(item.status, .registered)
        XCTAssertEqual(item.registerCalls, 1)
    }

    func testTurningTheTeamSettingOffUnregistersTheApp() {
        let item = FakeLoginItem(.registered)
        XCTAssertEqual(LoginItemSync.apply(autoStartOnLogin: false, to: item), .unregistered)
        XCTAssertEqual(item.status, .notRegistered)
        XCTAssertEqual(item.unregisterCalls, 1)
    }

    // This runs on EVERY launch that resolves a policy, so the steady state must be a no-op —
    // not a privileged ServiceManagement call repeated for the life of the install.
    func testAlreadyInTheWantedStateIsANoOp() {
        let on = FakeLoginItem(.registered)
        XCTAssertEqual(LoginItemSync.apply(autoStartOnLogin: true, to: on), .unchanged)
        XCTAssertEqual(on.registerCalls, 0)

        let off = FakeLoginItem(.notRegistered)
        XCTAssertEqual(LoginItemSync.apply(autoStartOnLogin: false, to: off), .unchanged)
        XCTAssertEqual(off.unregisterCalls, 0)
    }

    // `.requiresApproval` means the employee switched the item off in System Settings. macOS
    // requires THEM to switch it back on; re-registering each launch would be the app arguing
    // with its user about their own machine, and would not work anyway.
    func testAnEmployeeDisabledItemIsNotReRegistered() {
        let item = FakeLoginItem(.requiresApproval)
        XCTAssertEqual(LoginItemSync.apply(autoStartOnLogin: true, to: item), .unchanged)
        XCTAssertEqual(item.registerCalls, 0)
        XCTAssertEqual(item.status, .requiresApproval)
    }

    // Turning the policy OFF must still clear an item sitting in `.requiresApproval`, otherwise
    // a stale entry outlives the setting that created it.
    func testTurningOffClearsAnItemAwaitingApproval() {
        let item = FakeLoginItem(.requiresApproval)
        XCTAssertEqual(LoginItemSync.apply(autoStartOnLogin: false, to: item), .unregistered)
        XCTAssertEqual(item.unregisterCalls, 1)
    }

    // Best-effort: a ServiceManagement failure is reported, never thrown into the launch path.
    func testAFailedWriteIsReportedAndDoesNotThrow() {
        let item = FakeLoginItem(.notRegistered)
        item.throwsOnWrite = true
        XCTAssertEqual(LoginItemSync.apply(autoStartOnLogin: true, to: item), .failed)
        XCTAssertEqual(item.status, .notRegistered)
    }
}
