// =============================================================================
//  TimeTrackTokens.swift
//  Shared design tokens for the TimeTrack macOS menu-bar client.
//  Semantic names are identical to the web dashboard's globals.css, so both
//  surfaces derive from one source and never drift.
//
//  Two ways to consume the palette:
//   (A) Asset catalog — create a Color Set per name below (e.g. "surface"),
//       fill in the Any/Dark hex values, then `Color("surface")`.
//   (B) The `TT.Palette` extension here — dynamic NSColor, no catalog needed.
//  Use whichever your target prefers; the hex values match exactly.
// =============================================================================

import SwiftUI
import AppKit

// MARK: - Hex → dynamic Color helper

private extension NSColor {
    convenience init(hex: String) {
        var s = hex.trimmingCharacters(in: .init(charactersIn: "#"))
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        var v: UInt64 = 0; Scanner(string: s).scanHexInt64(&v)
        self.init(srgbRed: CGFloat((v >> 16) & 0xFF) / 255,
                  green:   CGFloat((v >> 8)  & 0xFF) / 255,
                  blue:    CGFloat(v & 0xFF) / 255,
                  alpha: 1)
    }
    /// Resolves light vs dark against the current NSAppearance.
    static func dynamic(_ light: String, _ dark: String) -> NSColor {
        NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return NSColor(hex: isDark ? dark : light)
        }
    }
}

// MARK: - Semantic palette

enum TT {
    enum Palette {
        //                                          light        dark
        static let surface              = Color(nsColor: .dynamic("#F4F4F6", "#1C1C1E"))
        static let surfaceRaised        = Color(nsColor: .dynamic("#FFFFFF", "#2C2C2E"))
        static let separator            = Color(nsColor: .dynamic("#D6D6DB", "#3A3A3C"))
        static let text                 = Color(nsColor: .dynamic("#1D1D1F", "#F5F5F7"))
        static let textSecondary        = Color(nsColor: .dynamic("#6E6E73", "#A1A1A6"))
        static let accent               = Color(nsColor: .dynamic("#007AFF", "#0A84FF"))
        static let accentHover          = Color(nsColor: .dynamic("#0063CC", "#409CFF"))
        static let destructive          = Color(nsColor: .dynamic("#D70015", "#FF453A"))
        static let categoryProductive   = Color(nsColor: .dynamic("#5E5CE6", "#7D7AFF"))
        static let categoryNeutral      = Color(nsColor: .dynamic("#8E8E93", "#98989D"))
        static let categoryUnproductive = Color(nsColor: .dynamic("#FF9500", "#FF9F0A"))
        static let recording            = Color(nsColor: .dynamic("#30B0C7", "#40CBE0"))
    }

    // MARK: - Radius (matches macOS control / card / popover metrics)
    enum Radius {
        static let sm: CGFloat = 6   // buttons, chips
        static let md: CGFloat = 10  // cards, table containers
        static let lg: CGFloat = 14  // menu-bar popover, sheets
    }

    // MARK: - Spacing (4pt base)
    enum Space {
        static let x1: CGFloat = 4,  x2: CGFloat = 8,  x3: CGFloat = 12
        static let x4: CGFloat = 16, x6: CGFloat = 24, x8: CGFloat = 32
        static let x12: CGFloat = 48, x16: CGFloat = 64
    }
}

// MARK: - Type scale (SF Pro system font, mapped to the shared scale)
//  Numeric styles carry .monospacedDigit() — the SF equivalent of tabular-nums,
//  applied to every duration, %, timestamp, and date range and right-aligned.

extension Font {
    /// Hero numbers — the one deliberate display treatment. Tight, large SF Pro Display.
    static let ttDisplay = Font.system(size: 48, weight: .bold,     design: .default)
    static let ttH1      = Font.system(size: 32, weight: .bold,     design: .default)
    static let ttH2      = Font.system(size: 22, weight: .semibold, design: .default)
    static let ttBody    = Font.system(size: 15, weight: .regular,  design: .default)
    static let ttLabel   = Font.system(size: 13, weight: .medium,   design: .default)
    static let ttCaption = Font.system(size: 12, weight: .regular,  design: .default)

    /// Numeric role: pass the contextual size; digits are monospaced (tabular).
    static func ttNumeric(_ size: CGFloat, weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight, design: .default).monospacedDigit()
    }
    /// The hero number, tabular.
    static let ttDisplayNumeric = Font.system(size: 48, weight: .bold, design: .default).monospacedDigit()
}

//  Usage example:
//  Text("142:30").font(.ttDisplayNumeric).tracking(-0.9).foregroundStyle(TT.Palette.text)
//  Circle().fill(TT.Palette.recording).frame(width: 8, height: 8)   // menu-bar "recording" dot
