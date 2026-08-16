import type { NextConfig } from 'next';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// `next dev` runs from apps/dashboard, so Next only auto-loads env files in THIS
// directory — the repo-root .env (the single source of truth shared with api/worker)
// is invisible to it. Load it here so server code (route handlers, Server Actions)
// sees DASHBOARD_SESSION_SECRET / API_URL without a duplicated dashboard-local copy.
// This file is evaluated once per Node process Next spawns, so the values land in
// every worker. Precedence is preserved: an already-set var — the real environment,
// or Next's own .env.local — always wins; we only fill what's missing.
function loadRootEnv(): void {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const raw = readFileSync(resolve(root, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key in process.env) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // No root .env (e.g. CI/prod where real env vars are injected) — nothing to load.
  }
}

loadRootEnv();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next otherwise writes apps/dashboard/AGENTS.md + CLAUDE.md on every dev run. They are
  // unreviewed, regenerate constantly, and a dashboard-local CLAUDE.md competes with the
  // repo-root one that actually governs work here.
  agentRules: false,
  // NOTE: `eslint: { ignoreDuringBuilds: true }` used to sit here. Next 16 removed the key
  // (and `next lint` with it) and warned "Unrecognized key(s) in object: 'eslint'" on every
  // build, so it was dead config. The dashboard is linted by the repo-root
  // eslint.config.mjs in CI, which is what the removed key was there to defer to.
};

export default nextConfig;
