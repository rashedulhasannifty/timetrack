# BundleId app-matching (design)

Match apps by the stable macOS **bundle identifier** (`com.microsoft.VSCode`, `us.zoom.xos`)
instead of the fragile display name (`Code` vs `Visual Studio Code`, `Adobe Photoshop 2024`,
`zoom.us`). Full, telemetry-backed approach: the picker suggests apps by friendly name while the
stored rule is a bundleId, so admins never type bundleids and rules survive renames.

## Design

- **Telemetry:** `ActivitySample` gains an optional `bundleId`. The client resolves
  `NSRunningApplication.bundleIdentifier`. Additive and nullable — the shipped client omits it and
  keeps working.
- **Matching (client `Categorizer`):** an app rule matches if it equals the app's **bundleId OR**
  its display name (both normalized). Every existing name rule keeps working; bundleId rules are
  the stable upgrade. No migration of existing rules.
- **Picker:** the observed-apps endpoint returns `{ bundleId, name }` pairs (most-recent name per
  bundleId, ranked by usage). The dashboard chip shows the friendly name and inserts the
  **bundleId** as the rule, so the admin reads names and stores stable ids.
- **Defaults:** fragile-named apps ship as bundleids; unambiguous ones can stay as names (both
  match). Readability comes from the picker/labels, not from the stored token.

## Deploy ordering (hard constraint)

The API ingest validates request bodies in **strict** mode (unknown field → 422). So a client
that sends `bundleId` must never hit an API that doesn't know the field. Therefore:

1. **Slice 1 — API accepts + stores `bundleId`** (this PR). Additive, backward-compatible, no
   behaviour change. Ship first.
2. **Slice 2 — client** sends `bundleId` and matches name-or-bundleId. Ship as a **client release**
   only after Slice 1 is deployed.
3. **Slice 3 — picker + defaults**: observed-apps returns `{bundleId,name}`; dashboard inserts
   bundleid rules; fragile defaults become bundleids. Ship after Slice 2 so telemetry exists.

Slices 1 and 3 are server/dashboard; Slice 2 is the Swift client. Each is independently
deployable in this order.

## Slice 1 scope (this PR)

- `contracts`: `ActivitySampleSchema` + optional nullable `bundleId` (≤255).
- `db`: nullable `bundleId` column on the partitioned `activity_samples` (hand-authored migration;
  `ALTER TABLE` on the parent propagates to partitions — partition key unchanged).
- `api`: ingest stores `bundleId`; the self/manager read returns it.
- Tests: contract accepts a sample with and without `bundleId`; e2e round-trips it through real
  Postgres.

Non-goals for Slice 1: no matching change, no picker change, no defaults change — those are
Slices 2–3, gated on the client release.
