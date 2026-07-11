# Postman collection

`timetrack.postman_collection.json` — the full TimeTrack API surface (Postman v2.1).

## Use

1. Import the collection into Postman (or run it with `newman run docs/postman/timetrack.postman_collection.json`).
2. Set the collection variables if your setup differs from the defaults:
   - `apiRoot` (default `http://localhost:3001`) → `baseUrl` is `{{apiRoot}}/v1`.
   - `seedAdminEmail` / `seedAdminPassword` — the seeded bootstrap admin (`SEED_ADMIN_*` + `pnpm db:seed`).
3. Run **Auth → Login** — it captures `accessToken` / `refreshToken` automatically; all protected requests inherit the Bearer token.

### Invite → accept → login flow

- **Users → Invite user** (admin) — in `NODE_ENV=development` the response carries `devToken`, which the test script stores as `inviteToken`.
- **Auth → Accept invite** — consumes `inviteToken`, sets the new user's password, and auto-logs-in (swaps in the new user's tokens).

All routes are under `/v1`; `Health` is VERSION_NEUTRAL at `{{apiRoot}}/health`. The `Auth` and `Health` folders are unauthenticated; everything else sends `Authorization: Bearer {{accessToken}}`.

## Keep it in sync

When a slice adds, changes, or removes an endpoint, update this collection **in the same change** — new/renamed routes, changed request bodies, or new auth semantics. Treat it like the contracts and redaction "same commit" rules.
