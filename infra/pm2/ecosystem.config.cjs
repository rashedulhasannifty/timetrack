'use strict';

/**
 * PM2 process definitions for the VPS. See docs/deployment.md.
 *
 * Copied to /srv/timetrack/shared/ on every deploy (with env-file.cjs) rather than referenced
 * inside a release: PM2 keeps the path, and a release directory is pruned eventually.
 *
 * ── ONE instance each, on purpose ─────────────────────────────────────────────────────────
 * - worker: it registers BullMQ job schedulers (retention, rollups, email, timesheets). Two
 *   copies would not break correctness, but they would double the consumers competing for the
 *   same queues and the partition/retention work would race itself. Fork mode, one process.
 * - api: @nestjs/throttler keeps its counters in process memory, so N workers silently mean N×
 *   every rate limit. Cluster mode with one instance still gives a zero-downtime `pm2 reload`
 *   (a replacement is started and must listen before the old one is retired).
 * - dashboard: same reasoning for reload; it is a BFF with no state of its own.
 * Raise any of these only together with the change that makes it safe.
 *
 * Ports are loopback-only or firewalled. This VPS also hosts other apps (3000/4000 are taken),
 * and Caddy is the sole public entrypoint (infra/caddy/timetrack.caddy).
 */

const path = require('node:path');
const { readEnvFile } = require('./env-file.cjs');

const APP_ROOT = process.env.APP_ROOT || '/srv/timetrack';
const CURRENT = path.join(APP_ROOT, 'current');
const sharedEnv = readEnvFile(path.join(APP_ROOT, 'shared', '.env'));

// Captured from the invoking shell here, not left to --update-env: PM2 only re-applies env
// vars declared in this file. remote-deploy.sh exports it before `pm2 startOrReload`.
const APP_VERSION = process.env.APP_VERSION || 'unknown';

const API_PORT = sharedEnv.API_PORT || '3001';

module.exports = {
  apps: [
    {
      name: 'timetrack-api',
      cwd: path.join(CURRENT, 'api'),
      script: 'dist/main.js',
      exec_mode: 'cluster',
      instances: 1,
      max_memory_restart: '768M',
      // Room for in-flight requests (screenshot uploads) to drain before SIGKILL.
      kill_timeout: 15000,
      listen_timeout: 20000,
      env: { ...sharedEnv, NODE_ENV: 'production', API_PORT, APP_VERSION },
    },
    {
      name: 'timetrack-worker',
      cwd: path.join(CURRENT, 'worker'),
      script: 'dist/main.js',
      exec_mode: 'fork',
      instances: 1,
      // sharp decodes screenshots in memory.
      max_memory_restart: '768M',
      // A BullMQ worker finishes its active job on SIGINT; give thumbnailing/email time.
      kill_timeout: 30000,
      env: { ...sharedEnv, NODE_ENV: 'production', APP_VERSION },
    },
    {
      name: 'timetrack-dashboard',
      // Next standalone output: server.js sits under apps/dashboard/ because the build traces
      // from the monorepo root (outputFileTracingRoot in next.config.ts).
      cwd: path.join(CURRENT, 'dashboard'),
      script: 'apps/dashboard/server.js',
      exec_mode: 'cluster',
      instances: 1,
      max_memory_restart: '512M',
      kill_timeout: 10000,
      listen_timeout: 20000,
      env: {
        ...sharedEnv,
        NODE_ENV: 'production',
        APP_VERSION,
        PORT: '3100',
        // Loopback only — Caddy is the public entrypoint.
        HOSTNAME: '127.0.0.1',
        // The dashboard is a BFF: it calls the API server-side over loopback, never by
        // hairpinning through Cloudflare and the proxy. Overrides the public API_URL.
        API_URL: `http://127.0.0.1:${API_PORT}`,
      },
    },
  ],
};
