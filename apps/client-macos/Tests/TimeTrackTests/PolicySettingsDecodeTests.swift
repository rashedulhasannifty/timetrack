import XCTest
@testable import TimeTrack

final class PolicySettingsDecodeTests: XCTestCase {
    func testDecodesSettingsSubsetFromFullPolicy() throws {
        // A realistic /v1/policy/effective body — the server sends the full TeamSettings;
        // the client decodes only the two fields it needs and ignores the rest.
        let json = """
        {
          "ackRequired": false,
          "policyVersion": "2026-07-01",
          "policyText": "We monitor…",
          "settings": {
            "screenshotsEnabled": true,
            "screenshotIntervalMinutes": 10,
            "screenshotBlur": "NONE",
            "screenshotRetentionDays": 30,
            "activityRetentionDays": 90,
            "idleThresholdMinutes": 7,
            "captureWindowTitles": true,
            "autoStartOnLogin": true,
            "distractionAlertsEnabled": false,
            "unproductiveApps": [],
            "productiveApps": []
          }
        }
        """.data(using: .utf8)!

        let policy = try JSONDecoder().decode(EffectivePolicy.self, from: json)

        XCTAssertFalse(policy.ackRequired)
        XCTAssertEqual(policy.settings.idleThresholdMinutes, 7)
        XCTAssertTrue(policy.settings.autoStartOnLogin)
    }
}
