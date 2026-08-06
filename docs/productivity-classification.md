# Productivity classification (apps & sites)

How the client decides whether activity is `PRODUCTIVE`, `UNPRODUCTIVE`, or `NEUTRAL`, what
ships as defaults, and the follow-up work we deliberately deferred.

## Model

- Three categories: `PRODUCTIVE`, `UNPRODUCTIVE`, `NEUTRAL` (default). Defined in
  `packages/contracts/src/enums.ts`, `packages/db/prisma/schema.prisma`, and the client
  `Categorizer.swift`.
- Classification runs **on the macOS client** at sample time (`Categorizer`), from the admin
  policy lists delivered via `GET /v1/policy/effective`. Only the resulting `category` is
  uploaded — **the host/URL never leaves the device** (see `SiteResolver.swift`).
- Rules are four per-team lists in `Team.settings` (JSON), validated by `TeamSettingsSchema`
  (`packages/contracts/src/team-settings.ts`): `productiveApps`, `unproductiveApps`,
  `productiveSites`, `unproductiveSites`.

## Matching semantics (`Categorizer.swift`)

Apps and sites are matched separately; a site match wins over an app match, else `NEUTRAL`.
All matching is case-insensitive and trimmed.

- **Apps** — exact equality against the macOS frontmost app **name** (`localizedName`). On
  overlap, `UNPRODUCTIVE` wins.
- **Sites** — a term matches a host by:
  - equality, or dotted-**suffix** (`youtube.com` matches `m.youtube.com`) — so registrable
    domains cover their subdomains; or
  - a leading-label **wildcard**: `api.*` matches any host whose first label is `api`
    (`api.stripe.com`). A bare `*` matches nothing.
- **Most-specific term wins across both site lists.** A longer/more-specific match outranks a
  broader one; on equal specificity, `UNPRODUCTIVE` wins. This is why a broad `amazon.com` in
  the unproductive list does **not** silently flip a specific `aws.amazon.com` (productive).
  Wildcards are intentionally low-specificity (they lose to any real-domain rule).

## Defaults stance

- **Productive** ships an opinionated, high-confidence dev/knowledge-work seed (see
  `TeamSettingsSchema`). App names are only seeded when **stable and unversioned** — e.g. we do
  not seed `Adobe Photoshop 2024` or `zoom.us` (see bundleId note below).
- **Unproductive ships empty.** The product stays neutral until an admin classifies;
  distraction lists are an explicit opt-in, not a shipped judgment about employees. Dev-culture
  ambiguous sites (YouTube, Reddit, X, Hacker News, Discord, LinkedIn, Spotify) are left neutral
  by design — they are the most-overridden domains across every comparable tool.
- No blanket `api.*` / `docs.*` in the seeded defaults — as defaults they'd mark every
  `api.`/`docs.` host productive. The wildcard **feature** remains available to admins.

## Shipped

- **Settings UI validation.** The matcher fails silently on bad input (mistyped app name,
  leading wildcard, full URL, path, `www.`, spaces), so the settings textareas surface live,
  non-blocking hints (`lib/classification-hints.ts`).
- **App picker from telemetry.** `GET /admin/observed-apps` (ADMIN-only, team from session) ranks
  the apps the fleet reported in the last 30 days and returns each with its stable `bundleId` (when
  a client sent one); the settings app fields show them as "seen recently" chips that display the
  name but insert the bundleId. Sites get no picker — hosts are never stored server-side.
- **BundleId app-matching.** An app rule matches the frontmost app's display name OR its bundleId,
  so a rule survives a rename. The client sends `bundleId` with each sample; fragile-named apps
  (e.g. Zoom, `zoom.us`) are seeded as bundleids. See `docs/bundleid-app-matching.md`.

## Deferred follow-ups

- **Optional richer model** (per RescueTime/Time Doctor): numeric per-category score, an explicit
  `UNRATED` state distinct from `NEUTRAL`, and scope override (team/user).

Path-based matching (`/api`, `/docs`) is **out of scope** by design — the client keeps only the
host, never the URL path.
