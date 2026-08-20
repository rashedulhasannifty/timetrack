import SwiftUI

/// PRD §7.1.6 — the menu-bar dropdown, the primary UI. Recreated from the design bundle's
/// "Menu-bar dropdown" mockup. Bound to MenuViewModel; no logic here. The recording state is
/// always disclosed and Start is inert until the policy is acknowledged (PRD §4.1/§4.2).
struct MenuBarView: View {
    @ObservedObject var viewModel: MenuViewModel
    @ObservedObject var updates: UpdateCoordinator

    var body: some View {
        Group {
            if viewModel.isSignedIn {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    controls
                    Divider()
                    picker
                    Divider()
                    footer
                }
            } else {
                signedOut
            }
        }
        .frame(width: 340)
        .background(TT.Palette.surfaceRaised)
    }

    // MARK: Signed-out — no My Data / Sign Out (those belong to a session)

    @ViewBuilder private var signedOut: some View {
        VStack(alignment: .leading, spacing: TT.Space.x3) {
            HStack(spacing: 6) {
                Circle().fill(TT.Palette.textSecondary).frame(width: 7, height: 7)
                Text("Not signed in").font(.ttLabel)
            }
            .foregroundStyle(TT.Palette.textSecondary)
            Text("Sign in to start tracking your time.")
                .font(.ttCaption).foregroundStyle(TT.Palette.textSecondary)
            Button(action: viewModel.signIn) {
                Text("Sign In").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(TT.Palette.accent)
            HStack {
                Spacer()
                Button("Quit", action: viewModel.quit).buttonStyle(.link)
            }
            .font(.ttCaption)
        }
        .padding(.horizontal, TT.Space.x4)
        .padding(.vertical, TT.Space.x3)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Header — status + elapsed

    @ViewBuilder private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            switch viewModel.phase {
            case .idle:
                HStack(spacing: 6) {
                    Circle().fill(TT.Palette.textSecondary).frame(width: 7, height: 7)
                    Text("Idle · Not tracking").font(.ttLabel)
                }
                .foregroundStyle(TT.Palette.textSecondary)
            case .tracking, .paused:
                HStack(spacing: 6) {
                    Circle().fill(TT.Palette.accent).frame(width: 7, height: 7)
                    Text(viewModel.phase == .paused ? "Paused" : "Recording").font(.ttLabel)
                }
                .foregroundStyle(TT.Palette.accent)
                elapsedView
            }
            totalsView
        }
        .padding(.horizontal, TT.Space.x4)
        .padding(.top, TT.Space.x3)
        .padding(.bottom, TT.Space.x2)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Totals — today / this week / this month

    /// Shown whether or not the clock is running: "how much have I worked" is the question this
    /// answers, and it does not stop being interesting when tracking stops.
    ///
    /// These come from the server, which already counts a currently-running entry (clamped to the
    /// last heartbeat). The live elapsed counter above must NOT be added on top of them — that
    /// would count the current session twice.
    @ViewBuilder private var totalsView: some View {
        HStack(spacing: 0) {
            totalCell("Today", seconds: viewModel.totals?.todaySeconds)
            divider
            totalCell("This week", seconds: viewModel.totals?.weekSeconds)
            divider
            totalCell("This month", seconds: viewModel.totals?.monthSeconds)
        }
        .padding(.top, TT.Space.x2)
    }

    private var divider: some View {
        Rectangle()
            .fill(TT.Palette.separator)
            .frame(width: 1, height: 22)
    }

    /// `nil` seconds renders an em dash, not "0m". The totals are unknown until the first
    /// successful fetch, and a confident zero would misreport someone's day.
    @ViewBuilder private func totalCell(_ label: String, seconds: Int?) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label.uppercased())
                .font(.ttCaption)
                .tracking(0.5)
                .foregroundStyle(TT.Palette.textSecondary)
            Text(seconds.map(WorkTotalFormat.short) ?? "—")
                .font(.ttNumeric(15, weight: .semibold))
                .foregroundStyle(TT.Palette.text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var elapsedView: some View {
        if let startedAt = viewModel.startedAt {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                Text(elapsed(from: startedAt, to: context.date))
                    .font(.ttNumeric(34, weight: .light))
                    .foregroundStyle(TT.Palette.text)
            }
        }
    }

    private func elapsed(from start: Date, to now: Date) -> String {
        let s = max(0, Int(now.timeIntervalSince(start)))
        return String(format: "%02d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
    }

    // MARK: Controls — start / pause / stop

    @ViewBuilder private var controls: some View {
        HStack(spacing: TT.Space.x2) {
            switch viewModel.phase {
            case .idle:
                Button(action: viewModel.start) {
                    Label("Start", systemImage: "play.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!viewModel.isReady)
                .help(viewModel.isReady ? "Start tracking" : "Acknowledge policy to begin")
            case .paused:
                Button(action: viewModel.resume) {
                    Label("Resume", systemImage: "play.fill").frame(maxWidth: .infinity)
                }.buttonStyle(.borderedProminent)
                Button(action: viewModel.stop) {
                    Label("Stop", systemImage: "stop.fill").frame(maxWidth: .infinity)
                }.buttonStyle(.bordered)
            case .tracking:
                Button(action: viewModel.pause) {
                    Label("Pause", systemImage: "pause.fill").frame(maxWidth: .infinity)
                }.buttonStyle(.bordered)
                Button(action: viewModel.stop) {
                    Label("Stop", systemImage: "stop.fill").frame(maxWidth: .infinity)
                }.buttonStyle(.borderedProminent)
            }
        }
        .padding(.horizontal, TT.Space.x4)
        .padding(.bottom, TT.Space.x3)
    }

    // MARK: Project picker

    /// A DEFINITE list height (not `maxHeight`). A flexible ScrollView gets squeezed to almost
    /// nothing when the tracking header adds the large elapsed timer — SwiftUI shrinks the list
    /// to keep the popover's ideal height ~constant, collapsing the picker to ~2 rows while
    /// tracking (idle shows ~6). A definite height keeps the list stable and lets the popover
    /// grow to fit the header. Per-row estimate (project rows are single-line; task rows add a
    /// subtitle and run a little taller), capped so a long list scrolls.
    private var pickerListHeight: CGFloat {
        let rows = max(viewModel.filteredChoices.count, 1)
        return min(CGFloat(rows) * 36, 300)
    }

    @ViewBuilder private var picker: some View {
        VStack(alignment: .leading, spacing: TT.Space.x2) {
            Text("SWITCH PROJECT")
                .font(.ttCaption).foregroundStyle(TT.Palette.textSecondary)
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(TT.Palette.textSecondary)
                TextField("Search projects and tasks", text: $viewModel.query)
                    .textFieldStyle(.plain)
            }
            .padding(.horizontal, 9).padding(.vertical, 6)
            .background(TT.Palette.surface, in: RoundedRectangle(cornerRadius: TT.Radius.sm))

            ScrollView {
                VStack(spacing: 0) {
                    ForEach(viewModel.filteredChoices) { choice in
                        Button { viewModel.select(choice) } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(choice.projectName).font(.ttLabel)
                                    if let taskName = choice.taskName {
                                        Text(taskName).font(.ttCaption)
                                            .foregroundStyle(TT.Palette.textSecondary)
                                    }
                                }
                                Spacer()
                                if viewModel.selectedChoice?.id == choice.id {
                                    Image(systemName: "checkmark").foregroundStyle(TT.Palette.accent)
                                }
                            }
                            .contentShape(Rectangle())
                            .padding(.horizontal, 8).padding(.vertical, 7)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            // Definite height (see pickerListHeight) so the list isn't squeezed to ~2 rows once
            // the tracking header grows; caps at ~8 rows before it starts scrolling.
            .frame(height: pickerListHeight)
        }
        .padding(.horizontal, TT.Space.x4)
        .padding(.vertical, TT.Space.x3)
    }

    // MARK: Footer — my data / sign out / quit

    /// Update row. Present only when there is genuinely something newer — a failed or
    /// rate-limited check shows nothing, because it is not something the reader can act on.
    @ViewBuilder private var updateRow: some View {
        if let manifest = updates.status.manifest {
            VStack(alignment: .leading, spacing: TT.Space.x1) {
                if updates.isInstalling {
                    Text("Updating to \(manifest.version.description)…")
                        .foregroundStyle(TT.Palette.textSecondary)
                } else {
                    Button(updates.canInstallInPlace
                           ? "Update to \(manifest.version.description)"
                           : "Download \(manifest.version.description)") {
                        updates.canInstallInPlace ? updates.installNow() : updates.openReleasesPage()
                    }
                    .buttonStyle(.link)
                    .foregroundStyle(updates.status.isOverdue ? TT.Palette.destructive : TT.Palette.accent)
                }
                if let error = updates.lastInstallError {
                    Text(error).foregroundStyle(TT.Palette.destructive)
                }
            }
        }
    }

    @ViewBuilder private var footer: some View {
        VStack(alignment: .leading, spacing: TT.Space.x2) {
            updateRow
            Button("My Data", action: viewModel.openMyData)
                .buttonStyle(.link)
            HStack {
                Button("Sign Out", action: viewModel.signOut).buttonStyle(.link)
                Spacer()
                Button("Quit", action: viewModel.quit).buttonStyle(.link)
            }
        }
        .font(.ttCaption)
        .padding(.horizontal, TT.Space.x4)
        .padding(.vertical, TT.Space.x3)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
