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
        XCTAssertTrue(policy.settings.screenshotsEnabled)
        XCTAssertEqual(policy.settings.screenshotIntervalMinutes, 10)
    }

    func testDecodesActivityCategorizationFields() throws {
        let json = """
        {"ackRequired":false,"policyVersion":"v1","policyText":"x","settings":{
          "idleThresholdMinutes":5,"autoStartOnLogin":false,"screenshotsEnabled":true,
          "screenshotIntervalMinutes":10,"captureWindowTitles":false,
          "productiveApps":["Xcode"],"unproductiveApps":["Twitter"]}}
        """.data(using: .utf8)!
        let policy = try JSONDecoder().decode(EffectivePolicy.self, from: json)
        XCTAssertFalse(policy.settings.captureWindowTitles)
        XCTAssertEqual(policy.settings.productiveApps, ["Xcode"])
        XCTAssertEqual(policy.settings.unproductiveApps, ["Twitter"])
    }

    func testActivityFieldsDefaultWhenAbsent() throws {
        let json = """
        {"ackRequired":false,"policyVersion":"v1","policyText":"x","settings":{
          "idleThresholdMinutes":5,"autoStartOnLogin":false,"screenshotsEnabled":true,
          "screenshotIntervalMinutes":10}}
        """.data(using: .utf8)!
        let policy = try JSONDecoder().decode(EffectivePolicy.self, from: json)
        XCTAssertTrue(policy.settings.captureWindowTitles)      // default true
        XCTAssertEqual(policy.settings.productiveApps, [])       // default []
        XCTAssertEqual(policy.settings.unproductiveApps, [])
    }
}
