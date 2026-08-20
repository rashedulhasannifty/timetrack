import AppKit
import XCTest
@testable import TimeTrack

/// The dropdown's placement geometry. The AppKit wiring that feeds this (`pinPopover()`, the
/// re-pin after a fullscreen Space transition) needs a real status bar and is manual-verify;
/// what is pinned here is the arithmetic that decides where the window lands.
final class PopoverOriginTests: XCTestCase {
    /// A 1440x900 display: menu bar occupies the top 24pt, so visibleFrame starts below it.
    private let screen = NSRect(x: 0, y: 0, width: 1440, height: 876)
    private let popover = NSSize(width: 320, height: 420)

    private func button(midX: CGFloat) -> NSRect {
        NSRect(x: midX - 20, y: 876, width: 40, height: 24)   // sits on the menu bar
    }

    func testCentersUnderTheIcon() {
        let origin = StatusItemController.popoverOrigin(
            buttonFrame: button(midX: 700), popoverSize: popover, visibleFrame: screen)
        XCTAssertEqual(origin.x, 700 - 160)
        XCTAssertEqual(origin.y, 876 - 420)   // hangs below the button
    }

    /// An icon near the right edge — the common case, since status items live on the right.
    /// Centering alone would push the dropdown off-screen; it must be nudged back in.
    func testClampsToTheRightEdge() {
        let origin = StatusItemController.popoverOrigin(
            buttonFrame: button(midX: 1420), popoverSize: popover, visibleFrame: screen)
        XCTAssertEqual(origin.x, 1440 - 320)
        XCTAssertLessThanOrEqual(origin.x + popover.width, screen.maxX)
    }

    func testClampsToTheLeftEdge() {
        let origin = StatusItemController.popoverOrigin(
            buttonFrame: button(midX: 10), popoverSize: popover, visibleFrame: screen)
        XCTAssertEqual(origin.x, 0)
    }

    /// A second display to the right of the built-in one: the origin is in that screen's
    /// coordinate space, not clamped back onto the primary. This is the multi-monitor case the
    /// old `NSScreen.main` lookup got wrong.
    func testUsesTheCoordinateSpaceOfTheScreenTheIconIsOn() {
        let secondary = NSRect(x: 1440, y: 0, width: 1920, height: 1055)
        let origin = StatusItemController.popoverOrigin(
            buttonFrame: NSRect(x: 3300, y: 1055, width: 40, height: 24),
            popoverSize: popover, visibleFrame: secondary)
        XCTAssertEqual(origin.x, 1440 + 1920 - 320)
        XCTAssertGreaterThanOrEqual(origin.x, secondary.minX)
    }

    /// A popover taller than the space beneath the menu bar must not hang off the bottom.
    func testNeverFallsOffTheBottomOfAShortDisplay() {
        let short = NSRect(x: 0, y: 0, width: 1280, height: 400)
        let origin = StatusItemController.popoverOrigin(
            buttonFrame: NSRect(x: 600, y: 400, width: 40, height: 24),
            popoverSize: NSSize(width: 320, height: 600), visibleFrame: short)
        XCTAssertEqual(origin.y, short.minY)
    }

    /// The dropdown hangs from a hairline anchor centred on the icon, at the icon's bottom edge —
    /// a window the controller owns and never moves. NSPopover follows its anchor for as long as
    /// it is open, and the status item's own button is not a stable one: over a fullscreen app the
    /// menu bar auto-hides once the pointer leaves it, the status bar window moves, and the
    /// dropdown chased it into the corner of the screen while the user was reading it.
    func testAnchorSitsCentredAtTheBottomEdgeOfTheIcon() {
        let rect = StatusItemController.anchorRect(buttonFrame: button(midX: 700))
        XCTAssertEqual(rect.midX, 700, accuracy: 0.001, "centred on the icon")
        // The popover hangs from the anchor's BOTTOM edge (preferredEdge .minY), so that edge is
        // the one that has to line up with the underside of the status item.
        XCTAssertEqual(rect.minY, 876, "hangs from the underside of the status item")
        XCTAssertLessThanOrEqual(rect.height, 1, "a hairline — it must never be visible")
    }

    /// A screen narrower than the popover itself: clamping must not invert (left edge wins).
    func testDegradesToTheLeftEdgeWhenTheScreenIsNarrowerThanThePopover() {
        let narrow = NSRect(x: 0, y: 0, width: 200, height: 600)
        let origin = StatusItemController.popoverOrigin(
            buttonFrame: NSRect(x: 150, y: 600, width: 40, height: 24),
            popoverSize: popover, visibleFrame: narrow)
        XCTAssertEqual(origin.x, narrow.minX)
    }
}
