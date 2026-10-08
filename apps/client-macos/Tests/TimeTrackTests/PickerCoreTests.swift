import XCTest
@testable import TimeTrack

final class PickerCoreTests: XCTestCase {
    // Acme: General + Checkout (two subprojects → subproject level shown).
    // Borealis: only General (skips the subproject level).
    // Legacy: a cache written before subprojects existed (implicit default, id nil).
    private let projects: [Project] = [
        Project(id: "p1", teamId: "t", name: "Acme", archived: false,
                tasks: [ProjectTask(id: "k2", projectId: "p1", name: "pay form", subprojectId: "s2"),
                        ProjectTask(id: "k1", projectId: "p1", name: "Audit", subprojectId: "s1"),
                        ProjectTask(id: "k3", projectId: "p1", name: "Cart", subprojectId: "s2")],
                subprojects: [Subproject(id: "s2", projectId: "p1", name: "checkout", archived: false, isDefault: false),
                              Subproject(id: "s1", projectId: "p1", name: "General", archived: false, isDefault: true)]),
        Project(id: "p2", teamId: "t", name: "Borealis", archived: false,
                tasks: [ProjectTask(id: "k4", projectId: "p2", name: "Hero copy", subprojectId: "s3")],
                subprojects: [Subproject(id: "s3", projectId: "p2", name: "General", archived: false, isDefault: true)]),
        Project(id: "p3", teamId: "t", name: "Legacy", archived: false,
                tasks: [ProjectTask(id: "k5", projectId: "p3", name: "Old task")]),
    ]
    private var tree: [PickerProject] { PickerTree.build(projects) }

    // MARK: tree

    func testOrdersSubprojectsDefaultFirstThenByNameAndTasksByName() {
        let acme = tree[0]
        XCTAssertEqual(acme.subprojects.map(\.id), ["s1", "s2"])
        XCTAssertEqual(acme.subprojects[1].tasks.map(\.name), ["Cart", "pay form"])
        XCTAssertEqual(acme.subprojects[0].tasks.map(\.id), ["k1"])
    }

    func testSkipsTheSubprojectLevelOnlyWhenTheDefaultIsAlone() {
        XCTAssertFalse(tree[0].skipsSubprojectLevel)
        XCTAssertTrue(tree[1].skipsSubprojectLevel)
    }

    func testALegacyCacheProjectBecomesOneImplicitDefaultHoldingEveryTask() {
        let legacy = tree[2]
        XCTAssertTrue(legacy.skipsSubprojectLevel)
        XCTAssertNil(legacy.subprojects[0].id)
        XCTAssertEqual(legacy.subprojects[0].tasks.map(\.id), ["k5"])
    }

    func testArchivedProjectsAndSubprojectsAreAbsentAndTheirTasksDropped() {
        let withArchived = [
            Project(id: "px", teamId: "t", name: "Gone", archived: true, tasks: nil),
            Project(id: "p1", teamId: "t", name: "Acme", archived: false,
                    tasks: [ProjectTask(id: "k9", projectId: "p1", name: "Hidden", subprojectId: "s9")],
                    subprojects: [Subproject(id: "s1", projectId: "p1", name: "General", archived: false, isDefault: true),
                                  Subproject(id: "s9", projectId: "p1", name: "Old", archived: true, isDefault: false)]),
        ]
        let built = PickerTree.build(withArchived)
        XCTAssertEqual(built.map(\.id), ["p1"])
        XCTAssertEqual(built[0].subprojects.map(\.id), ["s1"])
        XCTAssertTrue(built[0].subprojects[0].tasks.isEmpty)
    }

    // MARK: navigation

    func testRootRowsOpenEachProjectAtTheRightLevel() {
        let rows = PickerNavigation.rows(at: .root, in: tree)
        XCTAssertEqual(rows.map(\.title), ["Acme", "Borealis", "Legacy"])
        XCTAssertEqual(rows[0].action, .open(.project("p1")))
        XCTAssertEqual(rows[1].action, .open(.subproject(projectId: "p2", subprojectId: "s3")))
    }

    // Back is the breadcrumb bar now, not a row that looks like something to pick.
    func testProjectScreenListsOnlySubprojects() {
        let rows = PickerNavigation.rows(at: .project("p1"), in: tree)
        XCTAssertEqual(rows.map(\.title), ["General", "checkout"])
        XCTAssertEqual(rows[1].action, .open(.subproject(projectId: "p1", subprojectId: "s2")))
    }

    func testTaskScreenOfAShownSubproject() {
        let rows = PickerNavigation.rows(at: .subproject(projectId: "p1", subprojectId: "s2"), in: tree)
        XCTAssertEqual(rows.map(\.title), ["checkout (no task)", "Cart", "pay form"])
        XCTAssertEqual(rows[0].action, .track(StoredSelection(projectId: "p1", subprojectId: "s2", taskId: nil)))
        XCTAssertEqual(rows[1].action, .track(StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "k3")))
    }

    func testTaskScreenOfASkippedProjectIsTitledWithTheProject() {
        let rows = PickerNavigation.rows(at: .subproject(projectId: "p2", subprojectId: "s3"), in: tree)
        XCTAssertEqual(rows.map(\.title), ["Borealis (no task)", "Hero copy"])
    }

    func testBackGoesUpOneLevelAndSkipsTheOmittedScreen() {
        XCTAssertEqual(PickerNavigation.back(from: .subproject(projectId: "p1", subprojectId: "s2"), in: tree), .project("p1"))
        XCTAssertEqual(PickerNavigation.back(from: .subproject(projectId: "p2", subprojectId: "s3"), in: tree), .root)
        XCTAssertEqual(PickerNavigation.back(from: .project("p1"), in: tree), .root)
        XCTAssertEqual(PickerNavigation.back(from: .root, in: tree), .root)
    }

    func testALevelARefreshRemovedFallsBackToAValidOne() {
        XCTAssertEqual(PickerNavigation.normalize(.project("gone"), in: tree), .root)
        XCTAssertEqual(PickerNavigation.normalize(.subproject(projectId: "p1", subprojectId: "gone"), in: tree), .project("p1"))
        XCTAssertEqual(PickerNavigation.normalize(.project("p2"), in: tree), .subproject(projectId: "p2", subprojectId: "s3"))
        XCTAssertEqual(PickerNavigation.rows(at: .project("gone"), in: tree).map(\.title), ["Acme", "Borealis", "Legacy"])
    }

    func testMoveHighlightClampsAndStartsAtAnEnd() {
        let rows = PickerNavigation.rows(at: .root, in: tree)   // p:p1, p:p2, p:p3
        XCTAssertEqual(PickerNavigation.moveHighlight(nil, by: 1, in: rows), rows[0].id)
        XCTAssertEqual(PickerNavigation.moveHighlight(nil, by: -1, in: rows), rows[2].id)
        XCTAssertEqual(PickerNavigation.moveHighlight(rows[2].id, by: 1, in: rows), rows[2].id)
        XCTAssertEqual(PickerNavigation.moveHighlight(rows[1].id, by: -1, in: rows), rows[0].id)
        XCTAssertNil(PickerNavigation.moveHighlight(nil, by: 1, in: []))
    }

    // MARK: task-free projects (what production has: work types, no tasks)

    // Energy: two subprojects, no tasks. Solo: only its default, no tasks.
    private let taskFree: [Project] = [
        Project(id: "e1", teamId: "t", name: "Energy", archived: false, tasks: [],
                subprojects: [Subproject(id: "d1", projectId: "e1", name: "General", archived: false, isDefault: true),
                              Subproject(id: "d2", projectId: "e1", name: "Software", archived: false, isDefault: false)]),
        Project(id: "o1", teamId: "t", name: "Solo", archived: false, tasks: [],
                subprojects: [Subproject(id: "d3", projectId: "o1", name: "General", archived: false, isDefault: true)]),
    ]
    private var freeTree: [PickerProject] { PickerTree.build(taskFree) }

    // A subproject with nothing under it is the choice itself: one click, not a screen whose
    // only useful row is "(no task)".
    func testASubprojectWithoutTasksIsPickedInOneClick() {
        let rows = PickerNavigation.rows(at: .project("e1"), in: freeTree)
        XCTAssertEqual(rows.map(\.title), ["General", "Software"])
        XCTAssertEqual(rows[1].action, .track(StoredSelection(projectId: "e1", subprojectId: "d2", taskId: nil)))
    }

    func testAProjectWithOnlyItsDefaultAndNoTasksIsPickedFromTheRoot() {
        let rows = PickerNavigation.rows(at: .root, in: freeTree)
        XCTAssertEqual(rows[0].action, .open(.project("e1")))
        XCTAssertEqual(rows[1].action, .track(StoredSelection(projectId: "o1", subprojectId: "d3", taskId: nil)))
    }

    // MARK: breadcrumb

    func testBreadcrumbNamesEachLevelAndSkipsTheOmittedScreen() {
        XCTAssertEqual(PickerNavigation.breadcrumb(at: .root, in: tree), [])
        XCTAssertEqual(PickerNavigation.breadcrumb(at: .project("p1"), in: tree),
                       [PickerCrumb(title: "All projects", level: .root), PickerCrumb(title: "Acme", level: .project("p1"))])
        XCTAssertEqual(PickerNavigation.breadcrumb(at: .subproject(projectId: "p1", subprojectId: "s2"), in: tree),
                       [PickerCrumb(title: "All projects", level: .root),
                        PickerCrumb(title: "Acme", level: .project("p1")),
                        PickerCrumb(title: "checkout", level: .subproject(projectId: "p1", subprojectId: "s2"))])
        XCTAssertEqual(PickerNavigation.breadcrumb(at: .subproject(projectId: "p2", subprojectId: "s3"), in: tree),
                       [PickerCrumb(title: "All projects", level: .root),
                        PickerCrumb(title: "Borealis", level: .subproject(projectId: "p2", subprojectId: "s3"))])
    }

    // MARK: where you are

    func testTheCurrentPathIsMarkedAtEveryLevel() {
        let sel = StoredSelection(projectId: "e1", subprojectId: "d2", taskId: nil)
        let root = PickerNavigation.rows(at: .root, in: freeTree)
        XCTAssertEqual(root.map { PickerNavigation.isOnCurrentPath($0, selection: sel, in: freeTree) }, [true, false])
        let subs = PickerNavigation.rows(at: .project("e1"), in: freeTree)
        XCTAssertEqual(subs.map { PickerNavigation.isOnCurrentPath($0, selection: sel, in: freeTree) }, [false, true])
        XCTAssertFalse(PickerNavigation.isOnCurrentPath(root[0], selection: nil, in: freeTree))
    }

    // A task sits under its subproject: that subproject row (which opens the tasks) is on the path.
    func testATaskSelectionMarksItsSubprojectAndTheTask() {
        let sel = StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "k3")
        let subs = PickerNavigation.rows(at: .project("p1"), in: tree)
        XCTAssertEqual(subs.map { PickerNavigation.isOnCurrentPath($0, selection: sel, in: tree) }, [false, true])
        let tasks = PickerNavigation.rows(at: .subproject(projectId: "p1", subprojectId: "s2"), in: tree)
        XCTAssertEqual(tasks.map { PickerNavigation.isOnCurrentPath($0, selection: sel, in: tree) }, [false, true, false])
    }

    // A selection stored without a subproject means the project's default.
    func testASelectionWithoutASubprojectMeansTheDefault() {
        let sel = StoredSelection(projectId: "e1", subprojectId: nil, taskId: nil)
        let subs = PickerNavigation.rows(at: .project("e1"), in: freeTree)
        XCTAssertEqual(subs.map { PickerNavigation.isOnCurrentPath($0, selection: sel, in: freeTree) }, [true, false])
    }

    func testThePickerOpensWhereTheSelectionIs() {
        XCTAssertEqual(PickerNavigation.home(for: nil, in: tree), .root)
        XCTAssertEqual(PickerNavigation.home(for: StoredSelection(projectId: "gone", taskId: nil), in: tree), .root)
        XCTAssertEqual(PickerNavigation.home(for: StoredSelection(projectId: "e1", subprojectId: "d2", taskId: nil), in: freeTree),
                       .project("e1"))
        // Nothing to show below a lone-default project without tasks: the root is where it is picked.
        XCTAssertEqual(PickerNavigation.home(for: StoredSelection(projectId: "o1", subprojectId: "d3", taskId: nil), in: freeTree),
                       .root)
        XCTAssertEqual(PickerNavigation.home(for: StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "k3"), in: tree),
                       .subproject(projectId: "p1", subprojectId: "s2"))
    }

    func testWorkingOnSplitsTheProjectFromWhatIsUnderIt() {
        XCTAssertNil(PickerNavigation.workingOn(nil, in: tree))
        XCTAssertNil(PickerNavigation.workingOn(StoredSelection(projectId: "gone", taskId: nil), in: tree))
        XCTAssertEqual(PickerNavigation.workingOn(StoredSelection(projectId: "e1", subprojectId: "d2", taskId: nil), in: freeTree),
                       PickerWorkingOn(project: "Energy", detail: "Software"))
        XCTAssertEqual(PickerNavigation.workingOn(StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "k3"), in: tree),
                       PickerWorkingOn(project: "Acme", detail: "checkout › Cart"))
        XCTAssertEqual(PickerNavigation.workingOn(StoredSelection(projectId: "o1", subprojectId: "d3", taskId: nil), in: freeTree),
                       PickerWorkingOn(project: "Solo", detail: nil))
        // A task deleted since it was picked: the subproject still names the place.
        XCTAssertEqual(PickerNavigation.workingOn(StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "gone"), in: tree),
                       PickerWorkingOn(project: "Acme", detail: "checkout"))
    }

    // MARK: search

    func testSearchListsFullPathsAndOmitsALoneDefault() {
        let titles = PickerSearch.results(for: "o", in: tree).map(\.title)
        XCTAssertTrue(titles.contains("Acme › checkout"))
        XCTAssertTrue(titles.contains("Acme › checkout › Cart"))
        XCTAssertTrue(titles.contains("Borealis"))
        XCTAssertTrue(titles.contains("Borealis › Hero copy"))
        XCTAssertFalse(titles.contains { $0.contains("Borealis › General") })
    }

    func testSearchIsCaseInsensitiveTrimmedAndMatchesAnyComponent() {
        let rows = PickerSearch.results(for: "  PAY ", in: tree)
        XCTAssertEqual(rows.map(\.title), ["Acme › checkout › pay form"])
        XCTAssertEqual(rows[0].action, .track(StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "k2")))
        XCTAssertEqual(PickerSearch.results(for: "checkout", in: tree).map(\.title),
                       ["Acme › checkout", "Acme › checkout › Cart", "Acme › checkout › pay form"])
    }

    func testBlankQueryIsNotSearching() {
        XCTAssertFalse(PickerSearch.isSearching("   "))
        XCTAssertTrue(PickerSearch.results(for: " ", in: tree).isEmpty)
        XCTAssertTrue(PickerSearch.isSearching("a"))
    }

    func testALegacyProjectSearchResultSendsANilSubproject() {
        let rows = PickerSearch.results(for: "old task", in: tree)
        XCTAssertEqual(rows.map(\.title), ["Legacy › Old task"])
        XCTAssertEqual(rows[0].action, .track(StoredSelection(projectId: "p3", subprojectId: nil, taskId: "k5")))
    }

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
}
