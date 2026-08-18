import XCTest
@testable import TimeTrack

/// Slice 4.5 follow-up — a denied Automation (Apple Events) permission makes every SITE rule
/// silently inert: the host can't be read, so categorization falls back to the app lists and an
/// admin's `youtube.com` never matches. These pin the two pure decisions behind surfacing that.
final class AutomationPermissionTests: XCTestCase {
    // MARK: - which AppleScript failures mean "the OS is blocking us"

    func testNotPermittedIsADenial() {
        // errAEEventNotPermitted — Automation switched off for this app in System Settings.
        XCTAssertTrue(AppleScriptSiteResolver.isAutomationDenied(errorNumber: -1743))
    }

    func testWouldRequireConsentIsADenial() {
        // errAEEventWouldRequireUserConsent — never granted, and we may not prompt.
        XCTAssertTrue(AppleScriptSiteResolver.isAutomationDenied(errorNumber: -1744))
    }

    func testBenignScriptFailuresAreNotDenials() {
        // A browser with every window closed, a browser that just quit, a generic script error,
        // and "no error number in the dictionary" must NOT pin a permanent ⚠️ to the menu bar.
        for code in [-1728, -600, -1700, -1712, 0] {
            XCTAssertFalse(AppleScriptSiteResolver.isAutomationDenied(errorNumber: code),
                           "error \(code) is not a permission denial")
        }
    }

    // MARK: - tooltip precedence (most actionable first)

    func testScreenRecordingOutranksAutomation() {
        let tip = StatusItemController.tooltip(screenRecordingDenied: true, automationDenied: true,
                                               updateOverdue: true, updateVersion: "1.2.0")
        XCTAssertEqual(tip?.contains("Screen Recording"), true)
    }

    func testAutomationOutranksTheUpdateNotice() {
        let tip = StatusItemController.tooltip(screenRecordingDenied: false, automationDenied: true,
                                               updateOverdue: true, updateVersion: "1.2.0")
        XCTAssertEqual(tip?.contains("Automation"), true)
    }

    func testAutomationTooltipNamesTheSettingsPane() {
        let tip = StatusItemController.tooltip(screenRecordingDenied: false, automationDenied: true,
                                               updateOverdue: false, updateVersion: nil)
        XCTAssertEqual(tip?.contains("System Settings"), true, "tell people where to fix it")
    }

    func testNoWarningsMeansNoTooltip() {
        XCTAssertNil(StatusItemController.tooltip(screenRecordingDenied: false, automationDenied: false,
                                                  updateOverdue: false, updateVersion: nil))
    }

    func testUpdateNoticeStillShowsWhenNothingIsDenied() {
        let tip = StatusItemController.tooltip(screenRecordingDenied: false, automationDenied: false,
                                               updateOverdue: true, updateVersion: "1.2.0")
        XCTAssertEqual(tip, "Nifty Timer 1.2.0 is available — open the menu to update.")
    }
}
