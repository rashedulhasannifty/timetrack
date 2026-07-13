// swift-tools-version:5.10
import PackageDescription

// PRD §7.1.6 — the macOS client is outside the pnpm graph. This SwiftPM manifest lets
// it build with `swift build`; ship as an .app via Xcode (Screen Recording + Accessibility
// entitlements, LSUIElement/menu-bar). There is no stealth target — the indicator is
// always visible (PRD §3, §4.2).
let package = Package(
    name: "TimeTrack",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "TimeTrack",
            path: "Sources/TimeTrack"
        ),
        .testTarget(
            name: "TimeTrackTests",
            dependencies: ["TimeTrack"],
            path: "Tests/TimeTrackTests"
        )
    ]
)
