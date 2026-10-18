import Foundation

/// Turns the sync engines' `.authFailed` reports into at most ONE session-ended sign-out per
/// signed-in session.
///
/// Before this, a refresh the server rejected (a revoked token, a deactivated user) was caught as
/// a network-style failure: the client backed off and retried forever, still showing itself as
/// signed in, never presenting the login window, while buffered records aged out underneath it.
///
/// Every engine reports, possibly several at once, so the first report runs the check and the
/// rest are dropped while it runs or once the session has ended. The check is one more refresh
/// (`confirmRejected`): a 401 from an endpoint after a refresh that SUCCEEDED is not proof the
/// session is dead, and a sign-out on a hunch would throw away a working refresh token. Only a
/// confirmed rejection runs `onSessionEnded` — the same sign-out path the menu uses, which keeps
/// unsent data on disk for this user and shows the login window. `rearm()` when a session begins.
actor SessionEndMonitor {
    private let confirmRejected: () async -> Bool
    private let onSessionEnded: () async -> Void

    private var armed = false
    private var checking = false

    init(confirmRejected: @escaping () async -> Bool, onSessionEnded: @escaping () async -> Void) {
        self.confirmRejected = confirmRejected
        self.onSessionEnded = onSessionEnded
    }

    /// A session has begun (the app became ready for a signed-in user).
    func rearm() { armed = true }

    /// The session is ending by other means (the person signed out). Reports are ignored until
    /// the next `rearm()`.
    func disarm() { armed = false }

    /// An upload reported `.authFailed`.
    func authFailed() async {
        guard armed, !checking else { return }
        checking = true
        let rejected = await confirmRejected()
        checking = false
        // Re-checked after the await: a sign-out may have landed while the refresh was out.
        guard rejected, armed else { return }
        armed = false
        await onSessionEnded()
    }
}
