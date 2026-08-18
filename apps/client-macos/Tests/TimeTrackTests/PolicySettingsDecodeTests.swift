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
          "productiveApps":["Xcode"],"unproductiveApps":["Twitter"],
          "productiveSites":["docs.google.com"],"unproductiveSites":["youtube.com"]}}
        """.data(using: .utf8)!
        let policy = try JSONDecoder().decode(EffectivePolicy.self, from: json)
        XCTAssertFalse(policy.settings.captureWindowTitles)
        XCTAssertEqual(policy.settings.productiveApps, ["Xcode"])
        XCTAssertEqual(policy.settings.unproductiveApps, ["Twitter"])
        XCTAssertEqual(policy.settings.productiveSites, ["docs.google.com"])
        XCTAssertEqual(policy.settings.unproductiveSites, ["youtube.com"])
    }

    /// The bug class this guards: a field exists in @timetrack/contracts `TeamSettingsSchema`,
    /// the server sends it, and the client's `Settings` simply never declares it — `Decodable`
    /// ignores unknown keys, so nothing fails and the setting is silently inert (this is exactly
    /// what happened to `distractionAlertsEnabled`). This body is a full TeamSettings at its
    /// server defaults, with every value the client acts on set to a NON-default so a missing
    /// `CodingKey` or a dropped `decodeIfPresent` shows up as a wrong value, not a pass.
    func testDecodesEveryFieldTheClientActsOnFromAFullServerBody() throws {
        let json = """
        {
          "ackRequired": false,
          "policyVersion": "2026-08-01",
          "policyText": "We monitor…",
          "settings": {
            "screenshotsEnabled": false,
            "screenshotIntervalMinutes": 25,
            "screenshotBlur": "BLUR",
            "screenshotRetentionDays": 45,
            "activityRetentionDays": 120,
            "idleThresholdMinutes": 12,
            "captureWindowTitles": false,
            "autoStartOnLogin": true,
            "distractionAlertsEnabled": true,
            "distractionThresholdMinutes": 3,
            "distractionRepeatMinutes": 7,
            "timesheetReminderHours": 32,
            "unproductiveApps": ["Twitter"],
            "productiveApps": ["Xcode"],
            "unproductiveSites": ["youtube.com"],
            "productiveSites": ["github.com"]
          }
        }
        """.data(using: .utf8)!

        let s = try JSONDecoder().decode(EffectivePolicy.self, from: json).settings

        XCTAssertEqual(s.idleThresholdMinutes, 12)
        XCTAssertTrue(s.autoStartOnLogin)
        XCTAssertFalse(s.screenshotsEnabled)
        XCTAssertEqual(s.screenshotIntervalMinutes, 25)
        XCTAssertFalse(s.captureWindowTitles)
        XCTAssertTrue(s.distractionAlertsEnabled)
        XCTAssertEqual(s.distractionThresholdMinutes, 3)
        XCTAssertEqual(s.distractionRepeatMinutes, 7)
        XCTAssertEqual(s.productiveApps, ["Xcode"])
        XCTAssertEqual(s.unproductiveApps, ["Twitter"])
        XCTAssertEqual(s.productiveSites, ["github.com"])
        XCTAssertEqual(s.unproductiveSites, ["youtube.com"])

        // Adding a property to `Settings` without extending this test fails here — the count is
        // the tripwire that keeps "declared but never asserted" from happening again.
        XCTAssertEqual(Mirror(reflecting: s).children.count, 12,
                       "a new Settings field must be decoded from a real body and asserted above")
    }

    func testDistractionSettingsDefaultWhenAbsent() throws {
        let json = """
        {"ackRequired":false,"policyVersion":"v1","policyText":"x","settings":{
          "idleThresholdMinutes":5,"autoStartOnLogin":false,"screenshotsEnabled":true,
          "screenshotIntervalMinutes":10}}
        """.data(using: .utf8)!
        let s = try JSONDecoder().decode(EffectivePolicy.self, from: json).settings
        // Alerts are opt-in server-side; a policy that omits the switch must not nudge.
        XCTAssertFalse(s.distractionAlertsEnabled)
        XCTAssertEqual(s.distractionThresholdMinutes, 10)   // the client's old hardcoded value
        XCTAssertEqual(s.distractionRepeatMinutes, 5)
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
        XCTAssertEqual(policy.settings.productiveSites, [])      // default []
        XCTAssertEqual(policy.settings.unproductiveSites, [])
    }
}
