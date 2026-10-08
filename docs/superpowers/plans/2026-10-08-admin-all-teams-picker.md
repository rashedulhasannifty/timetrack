# Admin All-Teams Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An ADMIN's Mac and Windows picker lists every team's clients, grouped under a header per team (own team first), while every other role's picker is unchanged.

**Architecture:** The API adds an optional `teamName` (home team) to each listed project. Each client mirrors the JWT `role` + `teamId` as a `PickerViewer`, fetches `?allTeams=true` only for an ADMIN, and runs a pure `PickerTeams` layer over the root rows and search results. That layer stamps a `section` title on each row and stable-sorts by section. The UI draws a header where the section changes. Rows stay rows, so no switch, keyboard or activation code changes.

**Tech Stack:** NestJS 11 + Prisma 7 + Zod 4 (Vitest/Testcontainers e2e); Swift/SwiftUI (`swift test`); C#/.NET 9 + WPF (xUnit, CI only).

**Spec:** `docs/superpowers/specs/2026-10-08-admin-all-teams-picker-design.md`

## Global Constraints

- `/v1` must not break: `teamName` is additive and optional, and every existing field keeps its shape (CLAUDE.md §4 API).
- No new dependency in any package or client.
- EMPLOYEE and MANAGER requests and pickers are byte-for-byte unchanged: no query string, no headers.
- Hours keep being stamped with the user's own team (`time_entries_stamp_team`): no DB change.
- The Windows `PickerCore.cs` is a line-for-line port of `PickerCore.swift`. Change both the same way.
- Commit messages follow Conventional Commits with no AI attribution (CLAUDE.md §0). Scopes: `contracts`, `api`, `client`.
- Rebuild a package's `dist` after editing it, before running an app's tests (`pnpm --filter @timetrack/contracts build`).
- Mac tests: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`.
- Windows has no local toolchain. It is verified by the `client-windows.yml` PR CI only.
- API e2e for one file: `cd apps/api && RUN_E2E=1 pnpm test:e2e -- test/<file>` (Docker running).

## Review Focus

1. **An admin's hours on a Team B client show up in Team A's report** for a client not linked to Team A. Expected: the Team A report and its client drill-down render without a 403 or a Zod parse error. Checked by hand in Task 6, step 4.
2. **Offline launch as an admin** (no access token, cache present). Expected: the picker still shows team headers. Pinned by the AuthSession "survives an offline launch" tests in Tasks 2 and 4.
3. **Promotion or demotion mid-session.** Expected: the next refresh switches mode. Pinned on the Mac by the `listURL` test, which reads the role from whichever token the request uses (the 401 retry included).
4. **Older API, or a cache with no `teamName`/`teamIds`.** Expected: no decode failure. Own team falls back to `teamId == viewer.teamId`, other teams are titled "Other team". Pinned by the "missing teamName" grouping tests in Tasks 3 and 5.
5. **Search as an admin.** Expected: results grouped by team, and Return on the first result still works. Pinned by the search grouping tests in Tasks 3 and 5. `activateHighlighted` is untouched because headers are not rows.

---

### Task 1: API returns `teamName`; pin admin cross-team sync

**Files:**

- Modify: `packages/contracts/src/projects.ts` (`ProjectSchema`, ~line 47)
- Test: `packages/contracts/src/projects.spec.ts`
- Modify: `apps/api/src/modules/projects/projects.repository.ts` (`findProjects`, ~line 108)
- Test: `apps/api/test/projects-work-types.e2e-spec.ts` (the existing `allTeams` test, ~line 287)
- Test: `apps/api/test/time-entries.e2e-spec.ts` (the `teamId stamping (trigger)` describe, ~line 726)

**Interfaces:**

- Produces: the wire field `teamName?: string` on every project from `GET /v1/projects`, which Tasks 2 and 4 decode.

- [ ] **Step 1: Write the failing contract test.** Append inside the existing top-level `describe` in `packages/contracts/src/projects.spec.ts`:

```ts
it('ProjectSchema carries an optional home-team name', () => {
  const base = {
    id: '018f9c1e-0000-7000-8000-000000000001',
    teamId: '018f9c1e-0000-7000-8000-000000000002',
    name: 'Acme',
    color: null,
    archived: false,
  };
  expect(ProjectSchema.parse(base).teamName).toBeUndefined();
  expect(ProjectSchema.parse({ ...base, teamName: 'Design' }).teamName).toBe('Design');
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `pnpm --filter @timetrack/contracts test`. Expected: FAIL, because `teamName` is stripped, so `toBe('Design')` receives `undefined`.

- [ ] **Step 3: Add the field.** In `ProjectSchema`, directly after `teamIds`:

```ts
  /**
   * Name of the home team (`teamId`). Additive: the desktop pickers use it for an ADMIN's team
   * headers; shipped clients ignore it.
   */
  teamName: z.string().optional(),
```

- [ ] **Step 4: Run it and confirm it passes, then rebuild.** Run `pnpm --filter @timetrack/contracts test && pnpm --filter @timetrack/contracts build`. Expected: PASS, then a clean build.

- [ ] **Step 5: Write the failing e2e assertions.** In `apps/api/test/projects-work-types.e2e-spec.ts`, inside `it('allTeams: an ADMIN gets every team …')`:
  - After `expect(new Set(all.map((p) => p.teamId)))…`, add:

    ```ts
    expect(all.map((p) => [p.name, p.teamName])).toEqual([
      ['Acme', 'Eng'],
      ['Initech', 'Support'],
    ]);
    ```

  - After `expect(pinned.map((p) => p.name)).toEqual(['Acme']);`, add:

    ```ts
    expect(pinned.map((p) => p.teamName)).toEqual(['Eng']);
    ```

- [ ] **Step 6: Run it and confirm it fails.** Run `cd apps/api && RUN_E2E=1 pnpm test:e2e -- test/projects-work-types.e2e-spec.ts`. Expected: FAIL, because `teamName` is `undefined`.

- [ ] **Step 7: Select and map the name.** In `findProjects`, add `team: { select: { name: true } },` next to `teams: { select: { teamId: true } },`. Then replace the return line with:

```ts
return rows.map(({ teams, team, ...p }) => ({
  ...p,
  teamName: team.name,
  teamIds: homeFirst(p.teamId, teams),
}));
```

- [ ] **Step 8: Run it and confirm it passes.** Run the same command as step 6. Expected: PASS.

- [ ] **Step 9: Pin that an admin's sync onto another team's client is accepted and stamped with the admin's own team.** In `apps/api/test/time-entries.e2e-spec.ts`:
  - Add the imports `TimeEntriesService` (from `../src/modules/time-entries/time-entries.service.js`) and `type ResourceAccessService` (from `../src/common/authz/resource-access.service.js`). Check the exact path with `ls apps/api/src/common/authz`.
  - Inside `describe('teamId stamping (trigger)')`, add:

```ts
it("an admin's synced entry on another team's client is accepted and stamped with the admin's team", async () => {
  const admin = await seedUser('admin@example.com');
  const other = await db.prisma.team.create({
    data: { name: 'Ops', settings: {} },
    select: { id: true },
  });
  const { projectId, generalId } = await seedProject(other.id);
  // upsert never consults ResourceAccessService (the entry is always the caller's own).
  const service = new TimeEntriesService(repo(), {} as ResourceAccessService);
  const id = '01920000-0000-7000-8000-00000000e502';
  await service.upsert(
    { ...createDto(id), projectId },
    { id: admin.id, role: 'ADMIN', teamId: admin.teamId },
  );
  const row = await db.prisma.timeEntry.findUniqueOrThrow({
    where: { id },
    select: { teamId: true, projectId: true, subprojectId: true },
  });
  expect(row).toEqual({ teamId: admin.teamId, projectId, subprojectId: generalId });
});
```

This is a characterization test of behaviour that already exists, so it should pass on the first run. If it fails, stop and report: the spec's claim that "sync accepts any project id" would be false.

- [ ] **Step 10: Run it and confirm it passes.** Run `cd apps/api && RUN_E2E=1 pnpm test:e2e -- test/time-entries.e2e-spec.ts`. Expected: PASS.

- [ ] **Step 11: Run typecheck and commit.**

```bash
pnpm --filter @timetrack/contracts typecheck && pnpm --filter api typecheck
git add packages/contracts/src/projects.ts packages/contracts/src/projects.spec.ts apps/api/src/modules/projects/projects.repository.ts apps/api/test/projects-work-types.e2e-spec.ts apps/api/test/time-entries.e2e-spec.ts
git commit -m "feat(api): return the home team name on listed projects"
```

---

### Task 2: Mac: decode team fields, mirror the viewer, fetch all teams for admins

**Files:**

- Modify: `apps/client-macos/Sources/TimeTrack/Projects/Project.swift`
- Modify: `apps/client-macos/Sources/TimeTrack/Projects/PickerCore.swift` (add `PickerViewer` at the top)
- Modify: `apps/client-macos/Sources/TimeTrack/Auth/AuthSession.swift` (keys ~line 35, `logout` ~line 84, `apply` ~line 124)
- Modify: `apps/client-macos/Sources/TimeTrack/Projects/ProjectClient.swift`
- Create: `apps/client-macos/Tests/TimeTrackTests/Support/TestJWT.swift`
- Test: `apps/client-macos/Tests/TimeTrackTests/ProjectClientTests.swift` (new)
- Test: `apps/client-macos/Tests/TimeTrackTests/AuthSessionTests.swift`
- Test: `apps/client-macos/Tests/TimeTrackTests/ProjectCacheTests.swift`

**Interfaces:**

- Produces:
  - `struct PickerViewer: Equatable { let role: String; let teamId: String; var isAdmin: Bool }`
  - `Project.teamName: String?` and `Project.teamIds: [String]?`
  - `AuthSession.viewer() -> PickerViewer?` (actor method)
  - `ProjectClient.listURL(baseURL: URL, token: String) -> URL`
  - The test helper `testJWT(role: String, teamId: String) -> String`

- [ ] **Step 1: Add the test JWT helper.** Create `Support/TestJWT.swift`:

```swift
import Foundation

/// An unsigned JWT carrying the claims the client reads (`sub`, `role`, `teamId`).
func testJWT(sub: String = "11111111-1111-7111-8111-111111111111", role: String, teamId: String) -> String {
    func b64url(_ s: String) -> String {
        Data(s.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
    return b64url(#"{"alg":"HS256"}"#) + "." + b64url(#"{"sub":"\#(sub)","role":"\#(role)","teamId":"\#(teamId)"}"#) + ".sig"
}
```

- [ ] **Step 2: Write the failing tests.**
  - Create `ProjectClientTests.swift`:

```swift
import XCTest
@testable import TimeTrack

final class ProjectClientTests: XCTestCase {
    private let base = URL(string: "https://api.example.com/v1")!

    func testAnAdminAsksForEveryTeam() {
        let url = ProjectClient.listURL(baseURL: base, token: testJWT(role: "ADMIN", teamId: "t1"))
        XCTAssertEqual(url.absoluteString, "https://api.example.com/v1/projects?allTeams=true")
    }

    func testEveryOtherRoleSendsTheUnchangedRequest() {
        for role in ["EMPLOYEE", "MANAGER"] {
            let url = ProjectClient.listURL(baseURL: base, token: testJWT(role: role, teamId: "t1"))
            XCTAssertEqual(url.absoluteString, "https://api.example.com/v1/projects", role)
        }
    }

    func testAnUndecodableTokenFallsBackToTheUnchangedRequest() {
        XCTAssertEqual(ProjectClient.listURL(baseURL: base, token: "garbage").absoluteString,
                       "https://api.example.com/v1/projects")
    }
}
```

- Append to `AuthSessionTests` (it already has `freshDefaults()`, `InMemoryTokenStore`, `FakeAuthClient`):

```swift
    // MARK: - Picker viewer (admin all-teams picker)

    func testTheViewerSurvivesAnOfflineLaunchAndLogoutClearsIt() async throws {
        let defaults = freshDefaults()
        let store = InMemoryTokenStore()
        let admin = TokenPair(accessToken: testJWT(role: "ADMIN", teamId: "t1"), refreshToken: "r", expiresIn: 900)
        let first = AuthSession(client: FakeAuthClient(loginResult: .success(admin)), store: store, defaults: defaults)
        try await first.login(email: "a@b.c", password: "pw")
        let online = await first.viewer()
        XCTAssertEqual(online, PickerViewer(role: "ADMIN", teamId: "t1"))

        // A new process has no access token: the mirrored claims answer.
        let relaunched = AuthSession(client: FakeAuthClient(), store: store, defaults: defaults)
        let offline = await relaunched.viewer()
        XCTAssertEqual(offline, PickerViewer(role: "ADMIN", teamId: "t1"))

        await relaunched.logout()
        let afterLogout = await relaunched.viewer()
        XCTAssertNil(afterLogout)
    }
```

Check the login method's exact name in `AuthSession.swift` (around line 78). It is the method that calls `client.login(email:password:)`. Adjust the call if it differs.

- Append to `ProjectCacheTests` a round-trip test. It writes a `Project(id:teamId:name:archived:tasks:subprojects:teamName: "Eng", teamIds: ["t1","t2"])`, then `load()`s it and asserts equality. A second test decodes the JSON `[{"id":"p","teamId":"t","name":"N","archived":false}]` (an old cache) and asserts `teamName` and `teamIds` are nil.

- [ ] **Step 3: Run them and confirm they fail.** Run `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`. Expected: compile failure, because `listURL`, `PickerViewer`, `viewer()` and the new `Project` arguments don't exist yet.

- [ ] **Step 4: Implement.**
  - **`Project.swift`:** add `let teamName: String?` and `let teamIds: [String]?` after `subprojects`, with a doc comment saying they're optional because an ADMIN's picker groups by them and an old cache or older API has neither. Extend the init so existing call sites compile:

```swift
    init(id: String, teamId: String, name: String, archived: Bool,
         tasks: [ProjectTask]?, subprojects: [Subproject]? = nil,
         teamName: String? = nil, teamIds: [String]? = nil) {
        self.id = id
        self.teamId = teamId
        self.name = name
        self.archived = archived
        self.tasks = tasks
        self.subprojects = subprojects
        self.teamName = teamName
        self.teamIds = teamIds
    }
```

- **`PickerCore.swift`:** add after the file's header comment:

```swift
/// Who is looking at the picker: an ADMIN's root list and search are grouped by team. Read from
/// the access token, or from the claims `AuthSession` mirrored for an offline launch.
struct PickerViewer: Equatable {
    let role: String
    let teamId: String
    var isAdmin: Bool { role == "ADMIN" }
}
```

- **`AuthSession.swift`:** next to `lastUserIdKey`, add:

```swift
    private static let lastRoleKey = "auth.lastRole"
    private static let lastTeamIdKey = "auth.lastTeamId"
```

    Then, after `userId()`, add:

```swift
    /// The picker's viewer. Same fallback as `userId()`: an offline launch has no access token,
    /// so the claims mirrored at the last sign-in or refresh answer.
    func viewer() -> PickerViewer? {
        if let access, let claims = try? JWTDecoder.claims(from: access) {
            return PickerViewer(role: claims.role, teamId: claims.teamId)
        }
        guard let role = defaults.string(forKey: Self.lastRoleKey),
              let teamId = defaults.string(forKey: Self.lastTeamIdKey) else { return nil }
        return PickerViewer(role: role, teamId: teamId)
    }
```

    In `logout()`, add `defaults.removeObject(forKey: Self.lastRoleKey)` and `defaults.removeObject(forKey: Self.lastTeamIdKey)`. In `apply(_:)`, replace the `if let sub` block with:

```swift
        if let claims = try? JWTDecoder.claims(from: pair.accessToken) {
            defaults.set(claims.sub, forKey: Self.lastUserIdKey)
            defaults.set(claims.role, forKey: Self.lastRoleKey)
            defaults.set(claims.teamId, forKey: Self.lastTeamIdKey)
        }
```

- **`ProjectClient.swift`:** add a doc line to the type comment: "An ADMIN asks for every team (`allTeams=true`); the role is read from the token each request carries, so a refresh after a promotion switches it." Then add:

```swift
    /// `URLComponents`, never `appendingPathComponent("projects?…")`, which would encode the `?`.
    static func listURL(baseURL: URL, token: String) -> URL {
        let url = baseURL.appendingPathComponent("projects")
        guard (try? JWTDecoder.claims(from: token))?.role == "ADMIN",
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return url }
        components.queryItems = [URLQueryItem(name: "allTeams", value: "true")]
        return components.url ?? url
    }
```

    In `fetch(token:)`, replace `URLRequest(url: baseURL.appendingPathComponent("projects"))` with `URLRequest(url: Self.listURL(baseURL: baseURL, token: token))`.

- [ ] **Step 5: Run the tests and confirm they pass.** Run the same `swift test` command. Expected: all pass, including the existing suite.

- [ ] **Step 6: Commit.**

```bash
git add apps/client-macos
git commit -m "feat(client): fetch every team's projects for a macOS admin"
```

---

### Task 3: Mac: group an admin's picker by team

**Files:**

- Modify: `apps/client-macos/Sources/TimeTrack/Projects/PickerCore.swift` (`PickerRow` ~line 70; new `PickerTeams` enum after `PickerSearch`)
- Modify: `apps/client-macos/Sources/TimeTrack/App/MenuViewModel.swift` (`projects` ~line 26, `pickerRows` ~line 131, `reset()` ~line 347)
- Modify: `apps/client-macos/Sources/TimeTrack/UI/MenuBarView.swift` (`pickerListHeight` ~line 197, the `ForEach` ~line 319)
- Modify: `apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift` (`becomeReady` ~line 428, `refreshProjects` ~line 444 and ~line 502)
- Test: `apps/client-macos/Tests/TimeTrackTests/PickerCoreTests.swift`
- Test: `apps/client-macos/Tests/TimeTrackTests/MenuViewModelTests.swift`

**Interfaces:**

- Consumes: `PickerViewer`, `Project.teamName/teamIds`, `AuthSession.viewer()` (Task 2)
- Produces:
  - `PickerRow.section: String?`
  - `PickerTeams.sections(for:viewer:) -> [String: PickerTeams.Section]`
  - `PickerTeams.group(_:by:) -> [PickerRow]`
  - `PickerTeams.startsSection(_ rows: [PickerRow], at index: Int) -> Bool`
  - `MenuViewModel.viewer: PickerViewer?`

- [ ] **Step 1: Write the failing core tests.** Append to `PickerCoreTests`:

```swift
    // MARK: admin team grouping

    // Own team t1 ("Design"): Acme (home), Shared (home t3, shared into t1).
    // Others: Initech (t2 "Engineering"), Umbrella (t3 "Accounts"), Zed (t2).
    private let teamProjects: [Project] = [
        Project(id: "a", teamId: "t1", name: "Acme", archived: false, tasks: nil, teamName: "Design", teamIds: ["t1"]),
        Project(id: "i", teamId: "t2", name: "Initech", archived: false, tasks: nil, teamName: "Engineering", teamIds: ["t2"]),
        Project(id: "s", teamId: "t3", name: "Shared", archived: false, tasks: nil, teamName: "Accounts", teamIds: ["t3", "t1"]),
        Project(id: "u", teamId: "t3", name: "Umbrella", archived: false, tasks: nil, teamName: "Accounts", teamIds: ["t3"]),
        Project(id: "z", teamId: "t2", name: "Zed", archived: false, tasks: nil, teamName: "Engineering", teamIds: ["t2"]),
    ]
    private let admin = PickerViewer(role: "ADMIN", teamId: "t1")

    private func groupedRoot(_ projects: [Project], _ viewer: PickerViewer?) -> [PickerRow] {
        PickerTeams.group(PickerNavigation.rows(at: .root, in: PickerTree.build(projects)),
                          by: PickerTeams.sections(for: projects, viewer: viewer))
    }

    func testAnAdminSeesOwnTeamFirstIncludingSharedInThenOtherTeamsAToZ() {
        let rows = groupedRoot(teamProjects, admin)
        XCTAssertEqual(rows.map(\.title), ["Acme", "Shared", "Umbrella", "Initech", "Zed"])
        XCTAssertEqual(rows.map(\.section), ["My team (Design)", "My team (Design)", "Accounts", "Engineering", "Engineering"])
    }

    func testAClientSharedBetweenTwoOtherTeamsAppearsOnceUnderItsHomeTeam() {
        let projects = [
            Project(id: "x", teamId: "t2", name: "X", archived: false, tasks: nil, teamName: "Engineering", teamIds: ["t2", "t3"]),
        ]
        XCTAssertEqual(groupedRoot(projects, admin).map(\.section), ["Engineering"])
    }

    func testNonAdminsGetTheUnchangedFlatList() {
        for viewer in [PickerViewer(role: "EMPLOYEE", teamId: "t1"), PickerViewer(role: "MANAGER", teamId: "t1"), nil] {
            let rows = groupedRoot(teamProjects, viewer)
            XCTAssertEqual(rows, PickerNavigation.rows(at: .root, in: PickerTree.build(teamProjects)))
            XCTAssertTrue(rows.allSatisfy { $0.section == nil })
        }
    }

    func testMissingTeamNamesAndTeamIdsFallBack() {
        // An old cache or an API without teamName/teamIds.
        let projects = [
            Project(id: "a", teamId: "t1", name: "Acme", archived: false, tasks: nil),
            Project(id: "i", teamId: "t2", name: "Initech", archived: false, tasks: nil),
        ]
        let rows = groupedRoot(projects, admin)
        XCTAssertEqual(rows.map(\.section), ["My team", "Other team"])
    }

    func testSearchResultsAreGroupedTheSameWay() {
        let tree = PickerTree.build(teamProjects)
        let rows = PickerTeams.group(PickerSearch.results(for: "a", in: tree),
                                     by: PickerTeams.sections(for: teamProjects, viewer: admin))
        // "a" matches Acme, Shared, Umbrella; Initech and Zed don't → Engineering has no header.
        XCTAssertEqual(rows.map(\.title), ["Acme", "Shared", "Umbrella"])
        XCTAssertEqual(rows.map(\.section), ["My team (Design)", "My team (Design)", "Accounts"])
    }

    func testAHeaderStartsWhereTheSectionChanges() {
        let rows = groupedRoot(teamProjects, admin)
        XCTAssertEqual(rows.indices.map { PickerTeams.startsSection(rows, at: $0) },
                       [true, false, true, true, false])
        let flat = groupedRoot(teamProjects, nil)
        XCTAssertFalse(flat.indices.contains { PickerTeams.startsSection(flat, at: $0) })
    }
```

- [ ] **Step 2: Write the failing view-model tests.** Append to `MenuViewModelTests`:

```swift
    func testAnAdminsRootIsGroupedButADrilledLevelIsNot() {
        let vm = makeVM()
        vm.markReady()
        vm.viewer = PickerViewer(role: "ADMIN", teamId: "t1")
        vm.projects = [
            Project(id: "a", teamId: "t1", name: "Acme", archived: false,
                    tasks: [ProjectTask(id: "k", projectId: "a", name: "Task", subprojectId: "s")],
                    subprojects: [Subproject(id: "s", projectId: "a", name: "General", archived: false, isDefault: true)],
                    teamName: "Design", teamIds: ["t1"]),
            Project(id: "i", teamId: "t2", name: "Initech", archived: false, tasks: nil, teamName: "Eng", teamIds: ["t2"]),
        ]
        XCTAssertEqual(vm.pickerRows.map(\.section), ["My team (Design)", "Eng"])
        vm.activate(vm.pickerRows[0]) // opens Acme's task level
        XCTAssertTrue(vm.pickerRows.allSatisfy { $0.section == nil })
    }

    func testResetDropsTheViewer() {
        let vm = makeVM()
        vm.viewer = PickerViewer(role: "ADMIN", teamId: "t1")
        vm.reset()
        XCTAssertNil(vm.viewer)
    }
```

- [ ] **Step 3: Run them and confirm they fail.** Run the `swift test` command. Expected: compile failure, because `section`, `PickerTeams` and `viewer` are missing.

- [ ] **Step 4: Implement the core.**
  - In `PickerRow`, after `let action: Action`, add:

```swift
    /// The team header this row sits under: set only on an ADMIN's root list and search results
    /// (`PickerTeams.group`), nil everywhere else. The UI draws a header where it changes.
    var section: String? = nil
```

- After `enum PickerSearch { … }`, add:

```swift
/// An ADMIN's root list and search results split by team (spec 2026-10-08 §4). A layer over the
/// rows `PickerNavigation`/`PickerSearch` already build: it stamps `section` and stable-sorts —
/// rows stay rows, so activation, highlight and search Return are untouched.
enum PickerTeams {
    static let ownTeamTitle = "My team"
    static let otherTeamTitle = "Other team"

    struct Section: Equatable {
        let order: Int
        let title: String
    }

    /// Each project's section by project id. Empty unless the viewer is an ADMIN. Own team:
    /// every project linked to it (home or shared in); everything else under its home team,
    /// teams A→Z by name (ties by id, so the order is stable).
    static func sections(for projects: [Project], viewer: PickerViewer?) -> [String: Section] {
        guard let viewer, viewer.isAdmin else { return [:] }
        func isOwn(_ p: Project) -> Bool { (p.teamIds ?? [p.teamId]).contains(viewer.teamId) }
        let ownName = projects.first { $0.teamId == viewer.teamId }?.teamName
        let own = Section(order: 0, title: ownName.map { "\(ownTeamTitle) (\($0))" } ?? ownTeamTitle)
        let others = Dictionary(grouping: projects.filter { !isOwn($0) }, by: \.teamId)
            .map { (teamId: $0.key, title: $0.value.first?.teamName ?? otherTeamTitle) }
            .sorted { a, b in
                a.title.caseInsensitiveCompare(b.title) == .orderedSame
                    ? a.teamId < b.teamId
                    : PickerTree.precedes(a.title, b.title)
            }
        var byTeam: [String: Section] = [:]
        for (index, team) in others.enumerated() {
            byTeam[team.teamId] = Section(order: index + 1, title: team.title)
        }
        var result: [String: Section] = [:]
        for project in projects {
            result[project.id] = isOwn(project) ? own : byTeam[project.teamId]
        }
        return result
    }

    /// Stamps each row with its project's section and stable-sorts by section order. Rows pass
    /// through untouched when `sections` is empty (not an ADMIN).
    static func group(_ rows: [PickerRow], by sections: [String: Section]) -> [PickerRow] {
        guard !sections.isEmpty else { return rows }
        return rows.enumerated()
            .map { index, row -> (order: Int, index: Int, row: PickerRow) in
                let section = projectId(of: row).flatMap { sections[$0] }
                var stamped = row
                stamped.section = section?.title
                return (section?.order ?? Int.max, index, stamped)
            }
            .sorted { ($0.order, $0.index) < ($1.order, $1.index) }
            .map(\.row)
    }

    /// Whether the UI draws a header above `rows[index]`.
    static func startsSection(_ rows: [PickerRow], at index: Int) -> Bool {
        guard let section = rows[index].section else { return false }
        return index == 0 || rows[index - 1].section != section
    }

    private static func projectId(of row: PickerRow) -> String? {
        switch row.action {
        case let .open(.project(id)): return id
        case let .open(.subproject(projectId, _)): return projectId
        case .open(.root): return nil
        case let .track(selection): return selection.projectId
        }
    }
}
```

- [ ] **Step 5: Implement the view model.**
  - After `@Published var projects`, add:

```swift
    /// Who is looking: an ADMIN's root list and search are grouped by team. Set by AppDelegate
    /// before `projects`, from the token or the mirrored claims (offline).
    @Published var viewer: PickerViewer?
```

- Replace `pickerRows` with:

```swift
    /// Search results while searching, else the drill-down level's rows. The level survives a
    /// search, so clearing the text returns to it. An ADMIN's root and search are grouped by team;
    /// a drilled level is one project, so it never is.
    var pickerRows: [PickerRow] {
        let tree = tree
        let sections = PickerTeams.sections(for: projects, viewer: viewer)
        if PickerSearch.isSearching(query) {
            return PickerTeams.group(PickerSearch.results(for: query, in: tree), by: sections)
        }
        let rows = PickerNavigation.rows(at: level, in: tree)
        return PickerNavigation.normalize(level, in: tree) == .root ? PickerTeams.group(rows, by: sections) : rows
    }
```

- In `reset()`, after `projects = []`, add `viewer = nil`.

- [ ] **Step 6: Implement the view.** In `MenuBarView.swift`:
  - Replace `pickerListHeight` with:

```swift
    private var pickerListHeight: CGFloat {
        let rows = viewModel.pickerRows
        let headers = rows.indices.filter { PickerTeams.startsSection(rows, at: $0) }.count
        return min(CGFloat(max(rows.count, 1)) * 32 + CGFloat(headers) * 24, 300)
    }
```

- Replace the `ForEach(viewModel.pickerRows) { row in … }` block with:

```swift
                    let rows = viewModel.pickerRows
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        // An ADMIN's team header: outside the Button, so it is never clickable.
                        if PickerTeams.startsSection(rows, at: index), let section = row.section {
                            Text(section.uppercased())
                                .font(.ttCaption).foregroundStyle(TT.Palette.textSecondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.top, index == 0 ? 2 : 10).padding(.bottom, 4)
                        }
                        Button { viewModel.activate(row) } label: { pickerRow(row) }
                            .buttonStyle(.plain)
                    }
```

- [ ] **Step 7: Wire the viewer in `AppDelegate.swift`.**
  - In `becomeReady`, replace `await MainActor.run { menuViewModel.projects = projectCache.load() }` with:

```swift
        let viewer = await session.viewer()
        await MainActor.run {
            menuViewModel.viewer = viewer
            menuViewModel.projects = projectCache.load() // instant, offline-safe
        }
```

- In `refreshProjects()`, right after `guard let fresh = …` and `projectCache.save(fresh)`, add `let viewer = await session.viewer()`. Then, in the `MainActor.run` block that does `menuViewModel.projects = fresh` (~line 502), put `menuViewModel.viewer = viewer` on the line before it.

- [ ] **Step 8: Run the tests and confirm they pass.** Run the `swift test` command. Expected: all pass, including the existing `PickerCoreTests` and `MenuViewModelTests`. `section` defaults to nil, so existing `PickerRow` equality is unchanged.

- [ ] **Step 9: Commit.**

```bash
git add apps/client-macos
git commit -m "feat(client): group a macOS admin's picker by team"
```

---

### Task 4: Windows: decode team fields, mirror the viewer, fetch all teams for admins

**Files:**

- Modify: `apps/client-windows/src/NiftyTimer/Projects/Project.cs`
- Modify: `apps/client-windows/src/NiftyTimer/Projects/PickerCore.cs` (add `PickerViewer` after `PickerTask`)
- Modify: `apps/client-windows/src/NiftyTimer/Auth/AuthSession.cs` (keys ~line 55, `UserId` ~line 84, `Logout` ~line 137, `Apply` ~line 221)
- Modify: `apps/client-windows/src/NiftyTimer/Projects/ProjectClient.cs`
- Modify: `apps/client-windows/src/NiftyTimer/App/AppDelegate.cs` (~line 173)
- Test: `apps/client-windows/tests/NiftyTimer.Tests/AuthTests.cs`
- Test: `apps/client-windows/tests/NiftyTimer.Tests/AppAndProjectTests.cs` (append a `ProjectClient` and `Project` decode section; `grep -n "class " AppAndProjectTests.cs` to find the right class, or add a new `public class ProjectClientPathTests`)

**Interfaces:**

- Produces:
  - `public sealed record PickerViewer(string Role, string TeamId) { public bool IsAdmin { get; } }`
  - `Project.TeamName: string?` and `Project.TeamIds: IReadOnlyList<string>?` (trailing optional positional parameters)
  - `AuthSession.Viewer: PickerViewer?`
  - `ProjectClient.ListPath(PickerViewer?) -> string`
  - `new ProjectClient(AuthorizedJsonClient json, Func<PickerViewer?>? viewer = null)`

- [ ] **Step 1: Write the failing tests.**
  - In `AuthTests.cs`, next to `TheUserIdSurvivesAnOfflineLaunch`:

```csharp
    /// <summary>
    /// An admin's picker groups by team even on an offline launch, so role and team are mirrored
    /// with the user id — and dropped with it at sign-out.
    /// </summary>
    [Fact]
    public async Task TheViewerSurvivesAnOfflineLaunchAndLogoutClearsIt()
    {
        var settings = new InMemoryUserSettings();
        var store = new InMemoryTokenStore();
        var client = new FakeAuthClient { Next = new TokenPair(Jwt.ForSubject("user-77", "ADMIN", "t1"), "r", 900) };

        var first = NewSession(client, store, settings);
        await first.LoginAsync("a@b.c", "pw");
        Assert.Equal(new PickerViewer("ADMIN", "t1"), first.Viewer);

        client.RefreshFailure = AuthFailure.Transport;
        var second = NewSession(client, store, settings);
        Assert.Equal(BootstrapOutcome.Offline, await second.BootstrapAsync());
        Assert.Equal(new PickerViewer("ADMIN", "t1"), second.Viewer);

        second.Logout();
        Assert.Null(second.Viewer);
    }
```

Add `using NiftyTimer.Projects;` if it's missing.

- In the project tests file:

```csharp
public class ProjectClientPathTests
{
    [Fact]
    public void AnAdminAsksForEveryTeamAndResolvesUnderV1()
    {
        var path = ProjectClient.ListPath(new PickerViewer("ADMIN", "t1"));
        Assert.Equal("projects?allTeams=true", path);
        Assert.Equal("https://api.example.com/v1/projects?allTeams=true",
            new Uri(new Uri("https://api.example.com/v1/"), path).ToString());
    }

    [Theory]
    [InlineData("EMPLOYEE")]
    [InlineData("MANAGER")]
    public void EveryOtherRoleSendsTheUnchangedRequest(string role) =>
        Assert.Equal("projects", ProjectClient.ListPath(new PickerViewer(role, "t1")));

    [Fact]
    public void NoViewerSendsTheUnchangedRequest() => Assert.Equal("projects", ProjectClient.ListPath(null));

    [Fact]
    public void TeamFieldsAreOptionalOnTheWire()
    {
        var old = System.Text.Json.JsonSerializer.Deserialize<Project>(
            """{"id":"p","teamId":"t","name":"N","archived":false}""")!;
        Assert.Null(old.TeamName);
        Assert.Null(old.TeamIds);
        var fresh = System.Text.Json.JsonSerializer.Deserialize<Project>(
            """{"id":"p","teamId":"t","name":"N","archived":false,"teamName":"Eng","teamIds":["t","u"]}""")!;
        Assert.Equal("Eng", fresh.TeamName);
        Assert.Equal(["t", "u"], fresh.TeamIds!);
    }
}
```

- [ ] **Step 2: Implement.**
  - **`Project.cs`:** after the `Subprojects` parameter, add:

```csharp
    [property: JsonPropertyName("subprojects")] IReadOnlyList<Subproject>? Subprojects = null,
    // Optional: an admin's picker groups by them; a cache or API from before 2026-10 has neither.
    [property: JsonPropertyName("teamName")] string? TeamName = null,
    [property: JsonPropertyName("teamIds")] IReadOnlyList<string>? TeamIds = null);
```

    (Replace the existing `Subprojects = null);` line. The record's closing `);` moves to the new last parameter.)

- **`PickerCore.cs`:** after `public sealed record PickerTask…`, add:

```csharp
/// <summary>
/// Who is looking at the picker: an ADMIN's root list and search are grouped by team. Read from
/// the access token, or the claims <c>AuthSession</c> mirrored for an offline launch.
/// </summary>
public sealed record PickerViewer(string Role, string TeamId)
{
    public bool IsAdmin => Role == "ADMIN";
}
```

- **`AuthSession.cs`:** add `using NiftyTimer.Projects;`. Next to `LastUserIdKey`, add:

```csharp
    private const string LastRoleKey = "auth.lastRole";
    private const string LastTeamIdKey = "auth.lastTeamId";
```

    After `UserId`, add:

```csharp
    /// <summary>The picker's viewer. Same offline fallback as <see cref="UserId"/>.</summary>
    public PickerViewer? Viewer
    {
        get
        {
            if (JwtDecoder.TryReadClaims(_access) is { } claims)
            {
                return new PickerViewer(claims.Role, claims.TeamId);
            }

            return _settings.GetString(LastRoleKey) is { } role && _settings.GetString(LastTeamIdKey) is { } teamId
                ? new PickerViewer(role, teamId)
                : null;
        }
    }
```

    In `Logout()`, add `_settings.Remove(LastRoleKey);` and `_settings.Remove(LastTeamIdKey);`. In `Apply`, inside the `if (JwtDecoder.TryReadClaims(pair.AccessToken) is { } claims)` block, add `_settings.SetString(LastRoleKey, claims.Role);` and `_settings.SetString(LastTeamIdKey, claims.TeamId);`.

- **`ProjectClient.cs`:** replace the class body with:

```csharp
public sealed class ProjectClient : IProjectClient
{
    private readonly AuthorizedJsonClient _json;
    private readonly Func<PickerViewer?> _viewer;

    /// <param name="viewer">Who is asking; an ADMIN gets every team's projects. Null → today's request.</param>
    public ProjectClient(AuthorizedJsonClient json, Func<PickerViewer?>? viewer = null)
    {
        _json = json;
        _viewer = viewer ?? (() => null);
    }

    /// <summary>
    /// Relative to the <c>/</c>-terminated <c>…/v1/</c> base (see <c>AppConfig</c>), so the query
    /// string survives <c>new Uri(base, path)</c>.
    /// </summary>
    public static string ListPath(PickerViewer? viewer) =>
        viewer is { IsAdmin: true } ? "projects?allTeams=true" : "projects";

    public async Task<IReadOnlyList<Project>> ListAsync(CancellationToken cancellationToken = default) =>
        await _json.GetAsync<List<Project>>(ListPath(_viewer()), cancellationToken).ConfigureAwait(false);
}
```

    Also add a sentence to the class's doc summary: "An ADMIN asks for every team (`allTeams=true`)."

- **`AppDelegate.cs` ~line 173:** replace `new ProjectClient(json)` with `new ProjectClient(json, () => _session.Viewer)`. Check that `_session` is assigned before this line: `grep -n "_session = " AppDelegate.cs`. If it's assigned later, the lambda still works, because it only reads `_session` when called.

- [ ] **Step 3: Commit.** Tests run in PR CI only (no dotnet on the Mac).

```bash
git add apps/client-windows
git commit -m "feat(client): fetch every team's projects for a Windows admin"
```

---

### Task 5: Windows: group an admin's picker by team

**Files:**

- Modify: `apps/client-windows/src/NiftyTimer/Projects/PickerCore.cs` (`PickerRow` ~line 86; new `PickerTeams` after `PickerSearch`)
- Modify: `apps/client-windows/src/NiftyTimer/App/MenuViewModel.cs` (`Projects` ~line 97, `PickerRows` ~line 131, `Reset()` ~line 537)
- Modify: `apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml` (`ProjectList` ~line 164)
- Modify: `apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml.cs` (`RenderPicker` ~line 305)
- Modify: `apps/client-windows/src/NiftyTimer/App/AppDelegate.cs` (~lines 855 and 960)
- Test: `apps/client-windows/tests/NiftyTimer.Tests/PickerCoreTests.cs`, `MenuPickerTests.cs`, `TrayPopupWindowTests.cs` (`TrayPopupWindowPickerTests`)

**Interfaces:**

- Consumes: `PickerViewer`, `Project.TeamName/TeamIds`, `AuthSession.Viewer` (Task 4)
- Produces:
  - `PickerRow.Section: string?`
  - `PickerTeams.Sections(...)`
  - `PickerTeams.Group(...)`
  - `MenuViewModel.Viewer: PickerViewer?`

- [ ] **Step 1: Write the failing tests.** Port Task 3's six core tests to `PickerCoreTests.cs` with the same fixtures and the same expectations, the search query `"a"` included. The C# `Project` constructor is positional: `new Project("a", "t1", "Acme", false, null, null, "Design", ["t1"])`. Helper:

```csharp
    private static readonly PickerViewer Admin = new("ADMIN", "t1");

    private static IReadOnlyList<PickerRow> GroupedRoot(IReadOnlyList<Project> projects, PickerViewer? viewer) =>
        PickerTeams.Group(PickerNavigation.Rows(PickerLevel.Root, PickerTree.Build(projects)),
            PickerTeams.Sections(projects, viewer));
```

Write the header-start test against `PickerTeams.StartsSection(rows, index)`.

In `MenuPickerTests.cs`, port `testAnAdminsRootIsGroupedButADrilledLevelIsNot` and `testResetDropsTheViewer`, using `NewViewModel(out _)`, `vm.IsReady = true`, `vm.Viewer = new PickerViewer("ADMIN", "t1")` and `vm.Activate(vm.PickerRows[0])`.

In `TrayPopupWindowPickerTests`, add:

```csharp
    [Fact]
    public void AnAdminsListIsGroupedUnderTeamHeaders()
    {
        var groups = Wpf.Run(() =>
        {
            var tracker = new TimeTracker(new BufferSpy(), () => new DateTimeOffset(2026, 8, 25, 9, 0, 0, TimeSpan.Zero));
            var (viewModel, window) = Build(tracker);
            try
            {
                viewModel.Viewer = new PickerViewer("ADMIN", "team");
                viewModel.Projects =
                [
                    new Project("p1", "team", "Acme Website", false, [], [new Subproject("s1", "p1", "General", false, true)], "Design", ["team"]),
                    new Project("p2", "other", "Initech", false, [], [new Subproject("s2", "p2", "General", false, true)], "Eng", ["other"]),
                ];
                window.Dispatcher.Invoke(() => { }, DispatcherPriority.Loaded);
                return CollectionViewSource.GetDefaultView(window.ProjectList.ItemsSource).Groups!
                    .Cast<CollectionViewGroup>().Select(g => (string)g.Name).ToList();
            }
            finally
            {
                window.AllowClose = true;
                window.Close();
            }
        });
        Assert.Equal(["My team (Design)", "Eng"], groups);
    }
```

Copy the `finally` body from the neighbouring test exactly. Add `using System.Windows.Data;` if it's missing.

- [ ] **Step 2: Implement the core.**
  - Add `string? Section = null` as the last parameter of `PickerRow`, after `bool IsOnPath = false`, with a summary line: "`Section` is the team header an ADMIN's root/search row sits under; null everywhere else."
  - After `PickerSearch`, add:

```csharp
/// <summary>
/// An ADMIN's root list and search results split by team (spec 2026-10-08 §4). A layer over the
/// rows <see cref="PickerNavigation"/>/<see cref="PickerSearch"/> already build: it stamps
/// <c>Section</c> and stable-sorts. A port of PickerTeams in PickerCore.swift — change both.
/// </summary>
public sealed record PickerTeamSection(int Order, string Title);

public static class PickerTeams
{
    public const string OwnTeamTitle = "My team";
    public const string OtherTeamTitle = "Other team";

    public static IReadOnlyDictionary<string, PickerTeamSection> Sections(IReadOnlyList<Project> projects, PickerViewer? viewer)
    {
        var result = new Dictionary<string, PickerTeamSection>();
        if (viewer is not { IsAdmin: true })
        {
            return result;
        }

        bool IsOwn(Project p) => (p.TeamIds ?? [p.TeamId]).Contains(viewer.TeamId);
        var ownName = projects.FirstOrDefault(p => p.TeamId == viewer.TeamId)?.TeamName;
        var own = new PickerTeamSection(0, ownName is null ? OwnTeamTitle : $"{OwnTeamTitle} ({ownName})");
        var byTeam = projects.Where(p => !IsOwn(p))
            .GroupBy(p => p.TeamId)
            .Select(g => (TeamId: g.Key, Title: g.First().TeamName ?? OtherTeamTitle))
            .OrderBy(t => t.Title, StringComparer.OrdinalIgnoreCase)
            .ThenBy(t => t.TeamId, StringComparer.Ordinal)
            .Select((t, i) => (t.TeamId, Section: new PickerTeamSection(i + 1, t.Title)))
            .ToDictionary(t => t.TeamId, t => t.Section);
        foreach (var project in projects)
        {
            result[project.Id] = IsOwn(project) ? own : byTeam[project.TeamId];
        }

        return result;
    }

    public static IReadOnlyList<PickerRow> Group(IReadOnlyList<PickerRow> rows, IReadOnlyDictionary<string, PickerTeamSection> sections)
    {
        if (sections.Count == 0)
        {
            return rows;
        }

        return rows
            .Select((row, index) => (Row: row, Index: index,
                Section: ProjectId(row) is { } id && sections.TryGetValue(id, out var s) ? s : null))
            .OrderBy(x => x.Section?.Order ?? int.MaxValue)
            .ThenBy(x => x.Index)
            .Select(x => x.Row with { Section = x.Section?.Title })
            .ToList();
    }

    public static bool StartsSection(IReadOnlyList<PickerRow> rows, int index) =>
        rows[index].Section is { } section && (index == 0 || rows[index - 1].Section != section);

    private static string? ProjectId(PickerRow row) => row switch
    {
        { Kind: PickerRowKind.Track, Selection: { } s } => s.ProjectId,
        { Target: PickerLevel.ProjectLevel p } => p.ProjectId,
        { Target: PickerLevel.SubprojectLevel s } => s.ProjectId,
        _ => null,
    };
}
```

Note on ordering: Swift's `PickerTree.precedes` uses `.caseInsensitive` and C# uses `OrdinalIgnoreCase`. That's the same pairing the existing tree code already uses, so both clients sort alike.

- [ ] **Step 3: Implement the view model.**
  - After `Projects`, add:

```csharp
    private PickerViewer? _viewer;

    /// <summary>Who is looking: an ADMIN's root list and search are grouped by team. Set before <see cref="Projects"/>.</summary>
    public PickerViewer? Viewer
    {
        get => _viewer;
        set => Set(ref _viewer, value, [nameof(PickerRows)]);
    }
```

- In `PickerRows`, replace the first two lines of the getter body with:

```csharp
            var tree = Tree;
            var searching = PickerSearch.IsSearching(_query);
            var rows = searching ? PickerSearch.Results(_query, tree) : PickerNavigation.Rows(_level, tree);
            // A drilled level is one project, so only the root and search are grouped by team.
            if (searching || PickerNavigation.Normalize(_level, tree) is PickerLevel.RootLevel)
            {
                rows = PickerTeams.Group(rows, PickerTeams.Sections(_projects, _viewer));
            }

            return rows
```

    The existing `.Select(r => …IsOnPath…).ToList();` continues unchanged from `return rows`.

- In `Reset()`, after `Projects = [];`, add `Viewer = null;`.

- [ ] **Step 4: Implement the WPF list.**
  - In `TrayPopupWindow.xaml`, inside `<ListBox x:Name="ProjectList" …>`, before `<ListBox.ItemContainerStyle>`, add:

```xml
                <!-- An ADMIN's team headers (RenderPicker groups by PickerRow.Section). A group
                     header is not a ListBoxItem, so OnListClicked and keyboard selection skip it. -->
                <ListBox.GroupStyle>
                    <GroupStyle>
                        <GroupStyle.HeaderTemplate>
                            <DataTemplate>
                                <TextBlock Text="{Binding Name}" Style="{StaticResource CaptionText}"
                                           Margin="4,8,0,2" Focusable="False" />
                            </DataTemplate>
                        </GroupStyle.HeaderTemplate>
                    </GroupStyle>
                </ListBox.GroupStyle>
```

- In `RenderPicker`, replace the `ItemsSource` assignment block with:

```csharp
        var rows = _viewModel.PickerRows;
        if (ProjectList.ItemsSource is not IReadOnlyList<PickerRow> shown || !shown.SequenceEqual(rows))
        {
            ProjectList.ItemsSource = rows;
            // Group only when PickerTeams stamped sections (an ADMIN's root or search). Rows are
            // pre-sorted by section, and ListCollectionView keeps groups in first-seen order.
            var view = CollectionViewSource.GetDefaultView(rows);
            view.GroupDescriptions.Clear();
            if (rows.Any(r => r.Section is not null))
            {
                view.GroupDescriptions.Add(new PropertyGroupDescription(nameof(PickerRow.Section)));
            }
        }
```

    Add `using System.Windows.Data;` if it's missing. `GroupStyle.HeaderTemplate`'s `Name` is the group key, i.e. the section title.

- [ ] **Step 5: Wire the viewer in `AppDelegate.cs`.** Put `_viewModel.Viewer = _session.Viewer;` on the line before `_viewModel.Projects = _projectCache.Load();` (~line 855). Put it again on the line before `_viewModel.Projects = projects;` (~line 960).

- [ ] **Step 6: Commit.**

```bash
git add apps/client-windows
git commit -m "feat(client): group a Windows admin's picker by team"
```

---

### Task 6: Verify end to end and open the PR

- [ ] **Step 1: Run the repo gate.** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Expected: all green. Paste the tail of the output.
- [ ] **Step 2: Run the coverage gates.**
  - `cd apps/api && RUN_E2E=1 pnpm test:coverage`: the 80% gate, functions binding.
  - `pnpm --filter @timetrack/contracts test:coverage`: branches binding.
- [ ] **Step 3: Check the Mac app by hand against the local stack.**
  - `docker compose -f infra/docker-compose.yml up -d`, then kill any stale `pnpm dev` first (the API is on port 3001), then `pnpm dev`.
  - Make sure there are at least two teams with clients. Promote a user in team A to ADMIN in the dashboard.
  - Build and run the Mac client, signed in as that admin. Screenshot the picker: "MY TEAM (A)" first, then the other teams A→Z. Search a term that spans teams and screenshot that too.
  - Pick a team-B client, track a minute, stop, and confirm the entry syncs.
  - Sign out and back in as an employee: the picker is the flat team list, with no headers.
- [ ] **Step 4: Check the reports for Review Focus #1.** In the dashboard, open team A's report as a team-A manager and drill into the team-B client the admin tracked on. Expected: it renders with no 403 and no error boundary. If it breaks, stop and report. Don't patch it in this branch without asking.
- [ ] **Step 5: Push and open the PR.** Use `gh pr create --repo rashedulhasannifty/timetrack --head feat/admin-all-teams-picker --base main`, with the work account active. The body lists the rollout order (API first) and attaches the screenshots. Wait for `client-windows.yml` to go green, and fix any Windows failures on the branch.
- [ ] **Step 6:** Hand the merge to the user.
