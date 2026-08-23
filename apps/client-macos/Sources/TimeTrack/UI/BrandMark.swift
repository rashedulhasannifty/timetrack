import SwiftUI

/// The product mark — the elapsed-time ring, the same one the dashboard and the app icon wear.
///
/// Drawn rather than loaded from AppIcon.icns: the icon is 1024px artwork with its own ground
/// and reads as mud at 26px, and `Bundle.main` has no icon at all under `swift run`. The
/// geometry mirrors the dashboard's BrandMark exactly (24×24 box, r=7.3, stroke 3.4) so the two
/// cannot drift.
///
/// Angles are measured from the +x axis in SwiftUI's y-down space, so increasing angle runs
/// clockwise on screen. The elapsed arc covers ~248° from twelve o'clock; the remaining arc
/// closes the other ~112°. They meet flush — butt caps, no gap, which is what keeps the ring
/// readable this small.
struct BrandMark: View {
    var size: CGFloat = 18
    /// The crown tick sits with whatever text it is set beside, like the dashboard's
    /// `currentColor`. On the accent chip that means white, not the body text colour.
    var tickColor: Color = TT.Palette.text

    /// Solved from the dashboard's own arc (`M 5.06,14.76 A 7.3,7.3 0 0,1 12,5.2`) rather than
    /// eyeballed: the circle of radius 7.3 through those two points is centred at (12, 12.5) —
    /// half a unit BELOW the box centre, which is what leaves room for the crown tick. Reading
    /// it as (12,12) puts the ring 0.5 out and the arcs 4° apart, which shows as a seam.
    private static let centerY: CGFloat = 12.5
    private static let twelveOClock = Angle(degrees: -90)
    /// Where the two arcs hand over — 161.97°, giving a 252° elapsed sweep (~70%). One
    /// constant, so they cannot be adjusted independently and leave a gap.
    private static let handover = Angle(degrees: 161.97)

    var body: some View {
        Canvas { context, canvasSize in
            let scale = min(canvasSize.width, canvasSize.height) / 24
            let center = CGPoint(x: 12 * scale, y: Self.centerY * scale)
            let radius = 7.3 * scale
            let stroke = StrokeStyle(lineWidth: 3.4 * scale, lineCap: .butt)

            var elapsed = Path()
            elapsed.addArc(center: center, radius: radius,
                           startAngle: Self.twelveOClock, endAngle: Self.handover,
                           clockwise: false)
            context.stroke(elapsed, with: .color(TT.Palette.markElapsed), style: stroke)

            var remaining = Path()
            remaining.addArc(center: center, radius: radius,
                             startAngle: Self.handover, endAngle: Angle(degrees: 270),
                             clockwise: false)
            context.stroke(remaining, with: .color(TT.Palette.markRemaining), style: stroke)

            // Crown tick. Overlaps the ring so the two never separate when scaled.
            let tick = Path(roundedRect: CGRect(x: 11.1 * scale, y: 1.7 * scale,
                                                width: 1.8 * scale, height: 3.4 * scale),
                            cornerRadius: 0.9 * scale)
            context.fill(tick, with: .color(tickColor))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
