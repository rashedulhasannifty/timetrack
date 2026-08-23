import Carbon.HIToolbox
import Foundation

/// One system-wide keyboard shortcut, so start/stop does not require finding the menu bar.
///
/// **This is not a key monitor, and must never become one (CLAUDE.md §1).**
/// `RegisterEventHotKey` asks the window server to deliver an event when ONE specific
/// combination is pressed. It cannot see any other key, it receives no characters, and it needs
/// no Accessibility grant. The alternative — `NSEvent.addGlobalMonitorForEvents(matching:
/// .keyDown)` — would receive every keystroke in the system and require the Accessibility
/// permission to do it. In a product that promises to record event COUNTS and never content,
/// installing a system-wide key tap would be indefensible whatever it did with the events.
/// If this file ever needs to change, keep it on the Carbon registration.
///
/// Main-thread only: the Carbon event handler is dispatched on the main run loop, and `onFire`
/// drives `MenuViewModel`, which is main-thread-only too.
final class GlobalHotKey {
    /// ⌥⌘T. Chosen to avoid the system's own reserved combinations and the common editor
    /// bindings; ⌘T alone belongs to every app with tabs.
    static let defaultKeyCode = UInt32(kVK_ANSI_T)
    static let defaultModifiers = UInt32(optionKey | cmdKey)

    private var ref: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private let onFire: () -> Void

    /// Carbon hands the callback a raw pointer, not a closure context, so the live instance is
    /// reached through this box. One hotkey per process is all we register.
    private static var active: GlobalHotKey?

    init(onFire: @escaping () -> Void) {
        self.onFire = onFire
    }

    /// Register the shortcut. Silently does nothing if it is already taken by another app —
    /// a shortcut that cannot be claimed is not worth an error dialog on launch, and the menu
    /// bar remains the way to start and stop either way.
    func register(
        keyCode: UInt32 = GlobalHotKey.defaultKeyCode,
        modifiers: UInt32 = GlobalHotKey.defaultModifiers
    ) {
        guard ref == nil else { return }
        GlobalHotKey.active = self

        var spec = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        InstallEventHandler(
            GetApplicationEventTarget(),
            { _, _, _ in
                GlobalHotKey.active?.onFire()
                return noErr
            },
            1,
            &spec,
            nil,
            &handler
        )

        let id = EventHotKeyID(signature: OSType(0x5454_4B59), id: 1) // 'TTKY'
        var newRef: EventHotKeyRef?
        let status = RegisterEventHotKey(
            keyCode,
            modifiers,
            id,
            GetApplicationEventTarget(),
            0,
            &newRef
        )
        if status == noErr { ref = newRef }
    }

    func unregister() {
        if let ref { UnregisterEventHotKey(ref) }
        ref = nil
        if let handler { RemoveEventHandler(handler) }
        handler = nil
        if GlobalHotKey.active === self { GlobalHotKey.active = nil }
    }

    deinit { unregister() }
}
