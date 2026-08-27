/**
 * One-off: repair time entries that ran unattended.
 *
 * Manual tracking used to count straight through an away window and keep it, so a Mac left awake
 * produced a single unbroken span — 47 hours in the case that prompted this — and its start day
 * reported more hours than a day holds. The client now times out on inactivity, but that fix
 * cannot reach rows already written.
 *
 * All the logic lives in `src/processors/runaway-entry-trim.ts`, which the worker Testcontainers
 * suite exercises. This file is only wiring and printing.
 *
 * DRY RUN BY DEFAULT. It rewrites people's recorded hours, so it prints exactly what it would do
 * and changes nothing until `--apply` is passed. Read the report first — in particular the
 * "removes" figure per entry, which is time somebody will otherwise be paid for.
 *
 *   pnpm --filter worker exec tsx scripts/trim-runaway-entries.ts
 *   pnpm --filter worker exec tsx scripts/trim-runaway-entries.ts --min-hours 8
 *   pnpm --filter worker exec tsx scripts/trim-runaway-entries.ts --apply
 *
 * Idempotent: a repaired span is bounded, so a second run reports it as `already-bounded`.
 */
import { PrismaClient, pgAdapter } from '@timetrack/db';
import { loadEnv } from '@timetrack/config';
import { trimRunawayEntries, type EntryOutcome } from '../src/processors/runaway-entry-trim.js';

const DEFAULT_MIN_HOURS = 12;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function hhmm(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function describe(o: EntryOutcome): string[] {
  const head = `${o.userName}  ${o.startTime.toISOString()} → ${o.endTime.toISOString()}  (${hhmm(o.originalSeconds)})`;
  if (o.skipped === 'no-capture-evidence') {
    return [`  SKIP  ${head}`, `        no activity samples in the span — no evidence of when they stopped`];
  }
  if (o.skipped === 'already-bounded') {
    return [`  OK    ${head}`, `        already matches the sample timeline; nothing to remove`];
  }
  return [
    `  FIX   ${head}`,
    ...o.stretches.map(
      (s, i) =>
        `        [${i + 1}] ${s.start.toISOString()} → ${s.end.toISOString()}  ` +
        `(${hhmm((s.end.getTime() - s.start.getTime()) / 1000)})`,
    ),
    `        removes ${hhmm(o.removedSeconds)} of unattended time ` +
      `(idle threshold ${o.thresholdMinutes}m, ${o.sampleCount} samples)`,
  ];
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const minHours = Number(arg('min-hours') ?? DEFAULT_MIN_HOURS);
  if (!Number.isFinite(minHours) || minHours <= 0) {
    console.error(`--min-hours must be a positive number (got ${arg('min-hours')})`);
    process.exitCode = 1;
    return;
  }

  const env = loadEnv();
  const prisma = new PrismaClient({ adapter: pgAdapter(env.DATABASE_URL) });

  try {
    console.log(apply ? '=== APPLYING ===' : '=== DRY RUN — nothing will be written ===');
    console.log(`entries longer than ${minHours}h\n`);

    const report = await trimRunawayEntries(prisma, { minHours, apply, now: new Date() });

    if (report.outcomes.length === 0) {
      console.log(`no entries longer than ${minHours}h — nothing to do`);
      return;
    }
    for (const o of report.outcomes) console.log(describe(o).join('\n'));

    console.log('');
    console.log(
      `${report.candidates} candidates · ${report.repaired} to repair · ${report.skipped} left alone · ` +
        `${hhmm(report.removedSeconds)} of unattended time removed`,
    );
    if (!apply && report.repaired > 0) {
      console.log('');
      console.log('Nothing was written. Re-run with --apply once the report above looks right.');
      console.log('Every repair writes an audit_log row snapshotting the original span.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
