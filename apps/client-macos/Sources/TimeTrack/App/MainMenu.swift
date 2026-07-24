import AppKit

/// A menu-bar (`.accessory`) app displays no menu bar, but macOS still dispatches keyboard
/// shortcuts through `NSApp.mainMenu` to the key window's responder chain. With no Edit menu,
/// ⌘X/⌘C/⌘V/⌘A never reach a focused text field — so the login and policy-ack fields can't
/// cut, copy, paste, or select-all. Installing the standard Edit menu (plus a minimal App menu
/// for Quit) restores them. Actions are the field editor's first-responder selectors.
func makeMainMenu() -> NSMenu {
    let mainMenu = NSMenu()

    // The first submenu is treated as the application menu.
    let appItem = NSMenuItem()
    mainMenu.addItem(appItem)
    let appMenu = NSMenu()
    appItem.submenu = appMenu
    appMenu.addItem(
        withTitle: "Quit TimeTrack",
        action: #selector(NSApplication.terminate(_:)),
        keyEquivalent: "q")

    let editItem = NSMenuItem()
    mainMenu.addItem(editItem)
    let editMenu = NSMenu(title: "Edit")
    editItem.submenu = editMenu
    editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
    editMenu.addItem(.separator())
    editMenu.addItem(withTitle: "Cut", action: Selector(("cut:")), keyEquivalent: "x")
    editMenu.addItem(withTitle: "Copy", action: Selector(("copy:")), keyEquivalent: "c")
    editMenu.addItem(withTitle: "Paste", action: Selector(("paste:")), keyEquivalent: "v")
    editMenu.addItem(withTitle: "Select All", action: Selector(("selectAll:")), keyEquivalent: "a")

    return mainMenu
}
