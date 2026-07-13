import XCTest
@testable import TimeTrack

final class AckGateTests: XCTestCase {
    struct ProbeError: Error {}

    func testCaptureRefusedWhileAckRequired() async {
        let gate = AckGate(policyProvider: FakePolicyProvider(ackRequired: true))
        var ran = false
        do {
            _ = try await gate.withCaptureAllowed { ran = true; return 1 }
            XCTFail("expected notAcknowledged")
        } catch AckGateError.notAcknowledged {
            XCTAssertFalse(ran, "capture body must not run while ackRequired")
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testCaptureAllowedWhenAcknowledged() async throws {
        let gate = AckGate(policyProvider: FakePolicyProvider(ackRequired: false))
        let result = try await gate.withCaptureAllowed { 42 }
        XCTAssertEqual(result, 42)
    }

    func testGateClosedWhenPolicyFails() async {
        let gate = AckGate(policyProvider: FakePolicyProvider(error: ProbeError()))
        var ran = false
        do {
            _ = try await gate.withCaptureAllowed { ran = true; return 1 }
            XCTFail("expected error")
        } catch {
            XCTAssertFalse(ran)
        }
    }
}
