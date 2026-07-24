import AppKit

// PRD §7.1.6 — menu bar agent entry point. `.accessory` keeps it out of the Dock; the
// status item is the always-visible indicator (PRD §4.2). No stealth target exists.
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
// Even with no visible menu bar, this gives ⌘X/⌘C/⌘V/⌘A somewhere to route so the login/ack
// text fields can copy and paste (see MainMenu.swift).
application.mainMenu = makeMainMenu()
let appDelegate = AppDelegate()
application.delegate = appDelegate
application.run()
