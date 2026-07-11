import SwiftUI

/// PRD §7.1.6 — the dropdown UI. Siblings: MyDataView (the employee self-view — same data
/// the manager sees, PRD §4.3) and SettingsView. Kept minimal so the module compiles.
struct MenuBarView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("TimeTrack").font(.headline)
            Text("Not tracking").font(.caption).foregroundStyle(.secondary)
            // TODO(scaffold): start/stop/pause, project picker, links to My Data + Settings.
        }
        .padding()
    }
}
