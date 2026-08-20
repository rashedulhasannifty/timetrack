# Dhaka Day Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "a day" mean an Asia/Dhaka (UTC+6) calendar day everywhere the product derives one — dashboard labels and navigation, API day series, and the worker's stored activity rollup — instead of a UTC day.

**Architecture:** One shared constant plus four pure helpers in `packages/contracts/src/time.ts`, imported by both the dashboard and the API so no layer re-derives a boundary. The dashboard's ad-hoc `.toISOString().slice(0,10)` calls are replaced with those helpers. The API's SQL `AT TIME ZONE 'UTC'` literals become `'Asia/Dhaka'`. The worker's rollup shifts its **sample window** to Dhaka while keeping its stored **day label** as a UTC-midnight `Date`, and a backfill script rebuilds existing rows.

**Tech Stack:** TypeScript, Zod 4, Vitest, Testcontainers (real Postgres 18), NestJS 11 (Fastify), Next.js 16 App Router, Prisma 7, BullMQ.

**Spec:** `docs/superpowers/specs/2026-08-20-dhaka-time-and-live-entries-design.md` (§3)

## Global Constraints

- Branch is `feat/dhaka-time-and-live-entries`, already created. Do not commit to `main`.
- **No AI attribution** in any commit message, trailer, author, or branch name (CLAUDE.md §0).
- Commit format: `<type>(<scope>): <imperative summary ≤72 chars>`, scope ∈ `api|worker|dashboard|client|db|contracts|infra`.
- `packages/*` never import `apps/*`. Packages do not import each other — **except** that anything may import `contracts`. This is why the shared constant lives in contracts.
- Packages compile to `dist` and are consumed as built output. After changing `packages/contracts`, run `pnpm --filter @timetrack/contracts build` before an app will see the change.
- Types are **inferred** from Zod schemas, never hand-written. The new `time.ts` exports plain functions and one `const`, no schema — that is correct; it is not a DTO.
- `noUncheckedIndexedAccess` is on. Array indexing and destructuring yield `T | undefined` — guard it, or `pnpm typecheck` fails even while `pnpm test` passes (vitest does not typecheck specs).
- `exactOptionalPropertyTypes` is on in the dashboard. Never pass `{ key: string | undefined }` for an optional key — conditionally spread it in.
- Dashboard vitest runs in **node** env, no jsdom. Unit-test pure view-transform functions, never React components.
- `console.log` is banned outside `scripts/`. Use the injected Pino logger; log objects, not concatenated strings.
- Prettier is scoped to touched apps only — `pnpm format:check` already fails on ~23 unrelated files on `main`.
- Timezone identifier is exactly `Asia/Dhaka`. Never hardcode a `+06:00` offset.

---

### Task 1: Shared Dhaka day helpers in contracts

**Files:**

- Create: `packages/contracts/src/time.ts`
- Create: `packages/contracts/src/time.spec.ts`
- Modify: `packages/contracts/src/index.ts` (add one export line)

**Interfaces:**

- Consumes: nothing.
- Produces — every later task in this plan imports these from `@timetrack/contracts`:
  - `APP_TIMEZONE: 'Asia/Dhaka'`
  - `dayOf(instant: Date): string` → `'YYYY-MM-DD'`, the Dhaka calendar day containing `instant`
  - `dayStartInstant(day: string): Date` → the UTC instant at which that Dhaka day begins
  - `shiftDay(day: string, days: number): string` → calendar arithmetic on the label
  - `clockOf(instant: Date): string` → `'HH:MM'` Dhaka wall clock, 24-hour
  - `isValidDay(day: string): boolean` → `'YYYY-MM-DD'` shape and real calendar date

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/time.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { APP_TIMEZONE, clockOf, dayOf, dayStartInstant, isValidDay, shiftDay } from './time.js';

describe('APP_TIMEZONE', () => {
  it('is Dhaka', () => {
    expect(APP_TIMEZONE).toBe('Asia/Dhaka');
  });
});

describe('dayOf', () => {
  // The whole point of this slice: these two instants are the SAME UTC day
  // (2026-08-19) but DIFFERENT Dhaka days. Today's code buckets them together.
  it('puts 23:30 Dhaka on that Dhaka day', () => {
    // 2026-08-19T17:30Z === 2026-08-19 23:30 Dhaka
    expect(dayOf(new Date('2026-08-19T17:30:00.000Z'))).toBe('2026-08-19');
  });

  it('puts 00:30 Dhaka on the NEXT Dhaka day', () => {
    // 2026-08-19T18:30Z === 2026-08-20 00:30 Dhaka
    expect(dayOf(new Date('2026-08-19T18:30:00.000Z'))).toBe('2026-08-20');
  });

  it('treats 18:00Z exactly as the start of the next Dhaka day', () => {
    expect(dayOf(new Date('2026-08-19T18:00:00.000Z'))).toBe('2026-08-20');
    expect(dayOf(new Date('2026-08-19T17:59:59.999Z'))).toBe('2026-08-19');
  });
});

describe('dayStartInstant', () => {
  it('returns the UTC instant of Dhaka midnight', () => {
    expect(dayStartInstant('2026-08-20').toISOString()).toBe('2026-08-19T18:00:00.000Z');
  });

  it('round-trips with dayOf', () => {
    for (const day of ['2026-01-01', '2026-08-20', '2026-12-31']) {
      expect(dayOf(dayStartInstant(day))).toBe(day);
    }
  });

  it('the last millisecond before the next day still belongs to this day', () => {
    const nextStart = dayStartInstant('2026-08-21').getTime();
    expect(dayOf(new Date(nextStart - 1))).toBe('2026-08-20');
  });
});

describe('shiftDay', () => {
  it('moves forward and backward', () => {
    expect(shiftDay('2026-08-20', 1)).toBe('2026-08-21');
    expect(shiftDay('2026-08-20', -1)).toBe('2026-08-19');
  });

  it('crosses month and year boundaries', () => {
    expect(shiftDay('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('clockOf', () => {
  it('renders Dhaka wall-clock time in 24-hour form', () => {
    expect(clockOf(new Date('2026-08-19T17:30:00.000Z'))).toBe('23:30');
    expect(clockOf(new Date('2026-08-19T18:30:00.000Z'))).toBe('00:30');
  });

  it('renders Dhaka midnight as 00:00, never 24:00', () => {
    expect(clockOf(new Date('2026-08-19T18:00:00.000Z'))).toBe('00:00');
  });
});

describe('isValidDay', () => {
  it('accepts a real calendar day', () => {
    expect(isValidDay('2026-08-20')).toBe(true);
  });

  it('rejects malformed or impossible days', () => {
    expect(isValidDay('2026-8-20')).toBe(false);
    expect(isValidDay('2026-13-01')).toBe(false);
    expect(isValidDay('2026-02-30')).toBe(false);
    expect(isValidDay('not-a-day')).toBe(false);
    expect(isValidDay('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @timetrack/contracts test -- time.spec`
Expected: FAIL — `Failed to resolve import "./time.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/contracts/src/time.ts`:

```ts
/**
 * The organisation's single time zone. Every day boundary in the product — dashboard
 * navigation, API day series, the worker's daily rollup — is a calendar day in THIS zone.
 *
 * Deliberately org-wide, not per-user (spec §2): a per-user zone would mean the rollup can
 * no longer store one `activity_daily_summaries` row per user-day.
 *
 * These helpers derive the offset from the zone via `Intl` rather than assuming +06:00, so
 * they stay correct if this constant is ever changed to a zone that observes DST. Bangladesh
 * does not currently observe DST, so no fold/gap case arises today.
 */
export const APP_TIMEZONE = 'Asia/Dhaka';

// en-CA formats as YYYY-MM-DD, which is exactly our day-label shape.
const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// hourCycle 'h23' pins midnight to 00, not 24 (which some ICU builds emit for hour12:false).
const CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const PARTS_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The 'YYYY-MM-DD' Dhaka calendar day containing `instant`. */
export function dayOf(instant: Date): string {
  return DAY_FORMAT.format(instant);
}

/** 'HH:MM' Dhaka wall-clock time for `instant`, 24-hour. */
export function clockOf(instant: Date): string {
  return CLOCK_FORMAT.format(instant);
}

/** True when `day` is a 'YYYY-MM-DD' string naming a real calendar date. */
export function isValidDay(day: string): boolean {
  if (!DAY_PATTERN.test(day)) return false;
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return false;
  // Date.parse accepts 2026-02-30 in some engines by rolling over; round-trip to reject it.
  return new Date(ms).toISOString().slice(0, 10) === day;
}

/**
 * Shift a 'YYYY-MM-DD' day label by `days`. Pure calendar arithmetic on the label — no zone
 * is involved, because a label is not an instant.
 */
export function shiftDay(day: string, days: number): string {
  const parts = day.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const dayOfMonth = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(dayOfMonth)) {
    throw new RangeError(`shiftDay: not a YYYY-MM-DD day: ${day}`);
  }
  return new Date(Date.UTC(year, month - 1, dayOfMonth + days)).toISOString().slice(0, 10);
}

/** The UTC instant at which the Dhaka day `day` begins. */
export function dayStartInstant(day: string): Date {
  if (!isValidDay(day)) throw new RangeError(`dayStartInstant: not a YYYY-MM-DD day: ${day}`);
  // Treat the label as if it were UTC midnight, then walk back by the zone's offset. Applying
  // the offset a second time at the candidate instant settles any DST transition; for a
  // fixed-offset zone the second pass is a no-op.
  const asUtcMidnight = new Date(`${day}T00:00:00.000Z`);
  const candidate = new Date(asUtcMidnight.getTime() - offsetMsAt(asUtcMidnight));
  return new Date(asUtcMidnight.getTime() - offsetMsAt(candidate));
}

/** How far ahead of UTC `APP_TIMEZONE` runs at `at`, in milliseconds. */
function offsetMsAt(at: Date): number {
  const parts = PARTS_FORMAT.formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`offsetMsAt: missing ${type} part`);
    return Number(found.value);
  };
  const wallClockAsUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  // Compare against `at` truncated to whole seconds — the formatted parts carry no millis.
  return wallClockAsUtc - (at.getTime() - at.getMilliseconds());
}
```

- [ ] **Step 4: Export it from the package index**

Add to `packages/contracts/src/index.ts`, after the `./common.js` line:

```ts
export * from './time.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @timetrack/contracts test -- time.spec`
Expected: PASS, all cases green.

- [ ] **Step 6: Typecheck and build the package**

Run: `pnpm --filter @timetrack/contracts typecheck && pnpm --filter @timetrack/contracts lint && pnpm --filter @timetrack/contracts build`
Expected: all clean. The build is required — apps consume `dist`, not `src`, so without it Task 2 and Task 3 cannot import these helpers.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/time.ts packages/contracts/src/time.spec.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add Asia/Dhaka day helpers"
```

---

### Task 2: Dashboard renders days and times in Dhaka

**Files:**

- Modify: `apps/dashboard/src/lib/format.ts:11,14-20`
- Modify: `apps/dashboard/src/components/day/DayHeader.tsx:8-12,14-22,50`
- Modify: `apps/dashboard/src/lib/person-day-view.ts:96,100,217,460`
- Modify: `apps/dashboard/src/lib/reports-view.ts:7`
- Modify: `apps/dashboard/src/app/(app)/me/page.tsx:101`
- Modify: `apps/dashboard/src/app/(app)/people/[userId]/page.tsx:141`
- Test: `apps/dashboard/src/lib/format.spec.ts`, `apps/dashboard/src/lib/person-day-view.spec.ts`

**Interfaces:**

- Consumes: `APP_TIMEZONE`, `dayOf`, `dayStartInstant`, `shiftDay`, `clockOf`, `isValidDay` from `@timetrack/contracts` (Task 1).
- Produces: no new exports. `formatDate`, `formatTimeRange`, `resolveDayDate` keep their existing signatures — only their behaviour changes.

- [ ] **Step 1: Write the failing tests**

Append to `apps/dashboard/src/lib/format.spec.ts`:

```ts
describe('Dhaka day boundary', () => {
  it('formatDate puts a 00:30-Dhaka instant on the Dhaka day, not the UTC day', () => {
    // 2026-08-19T18:30Z === 2026-08-20 00:30 Dhaka
    expect(formatDate('2026-08-19T18:30:00.000Z')).toBe('2026-08-20');
  });

  it('formatTimeRange renders Dhaka wall-clock times', () => {
    expect(formatTimeRange('2026-08-19T17:30:00.000Z', '2026-08-19T18:30:00.000Z')).toBe(
      '23:30–00:30',
    );
  });

  it('formatTimeRange still marks an open entry', () => {
    expect(formatTimeRange('2026-08-19T17:30:00.000Z', null)).toBe('23:30–…');
  });
});
```

Append to `apps/dashboard/src/lib/person-day-view.spec.ts`:

```ts
describe('resolveDayDate (Dhaka)', () => {
  it('defaults to the Dhaka day, not the UTC day', () => {
    // 18:30Z is already tomorrow in Dhaka.
    expect(resolveDayDate(undefined, new Date('2026-08-19T18:30:00.000Z'))).toBe('2026-08-20');
  });

  it('accepts an explicit valid day', () => {
    expect(resolveDayDate('2026-08-20', new Date('2026-08-19T18:30:00.000Z'))).toBe('2026-08-20');
  });

  it('falls back to today when the param is not a real day', () => {
    expect(resolveDayDate('2026-02-30', new Date('2026-08-19T18:30:00.000Z'))).toBe('2026-08-20');
    expect(resolveDayDate('garbage', new Date('2026-08-19T18:30:00.000Z'))).toBe('2026-08-20');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @timetrack/dashboard test -- format.spec person-day-view.spec`
Expected: FAIL — `formatDate` returns `'2026-08-19'`, `formatTimeRange` returns `'17:30–18:30'`, `resolveDayDate` returns `'2026-08-19'`.

- [ ] **Step 3: Rewrite `format.ts`**

Replace the bodies of `formatDate` and `formatTimeRange` in `apps/dashboard/src/lib/format.ts`:

```ts
import { clockOf, dayOf } from '@timetrack/contracts';

/** Presentation helpers. Pure functions — unit-tested in format.spec.ts. */

export function formatDuration(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** The Dhaka calendar day an instant falls on (spec §3.2). */
export function formatDate(iso: string): string {
  return dayOf(new Date(iso));
}

/** Dhaka wall-clock range. A null end means the entry is still running. */
export function formatTimeRange(startIso: string, endIso: string | null): string {
  const startLabel = clockOf(new Date(startIso));
  if (!endIso) return `${startLabel}–…`;
  return `${startLabel}–${clockOf(new Date(endIso))}`;
}
```

- [ ] **Step 4: Rewrite the day helpers in `DayHeader.tsx`**

In `apps/dashboard/src/components/day/DayHeader.tsx`, delete `DAY_MS` and `shiftDateUTC` and import the shared helpers instead:

```tsx
import { APP_TIMEZONE, dayOf, dayStartInstant, shiftDay } from '@timetrack/contracts';

function formatDayLabel(date: string): string {
  return dayStartInstant(date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: APP_TIMEZONE,
  });
}
```

Then inside the component body replace the three derived values:

```tsx
const prevDate = shiftDay(date, -1);
const nextDate = shiftDay(date, 1);
const today = dayOf(new Date());
```

Note both changes are needed together: `formatDayLabel` must render the _instant_ of Dhaka midnight in the _Dhaka_ zone, or the label reads as the previous day.

- [ ] **Step 5: Rewrite the day derivations in `person-day-view.ts`**

At the top of `apps/dashboard/src/lib/person-day-view.ts` add:

```ts
import { dayOf, dayStartInstant, isValidDay, shiftDay } from '@timetrack/contracts';
```

`:96,100` — `resolveDayDate` currently validates by round-tripping through `toISOString().slice(0,10)`, which will start rejecting valid Dhaka days. Replace its body with:

```ts
export function resolveDayDate(raw: string | undefined, now: Date): string {
  if (raw && isValidDay(raw)) return raw;
  return dayOf(now);
}
```

`:217` — `isToday`:

```ts
const isToday = date === dayOf(now);
```

`:460` — the bucketing that turns an instant into a day key:

```ts
const date = dayOf(new Date(ms));
```

Wherever this file builds a day's `[start, end)` window from a `'YYYY-MM-DD'`, use `dayStartInstant(date)` and `dayStartInstant(shiftDay(date, 1))` rather than concatenating `T00:00:00.000Z`.

- [ ] **Step 6: Rewrite the report range default**

`apps/dashboard/src/lib/reports-view.ts:7`:

```ts
const dayStart = dayStartInstant(dayOf(now));
```

with `import { dayOf, dayStartInstant } from '@timetrack/contracts';` added at the top.

- [ ] **Step 7: Rewrite the two remaining page-level `today` values**

`apps/dashboard/src/app/(app)/me/page.tsx:101` and
`apps/dashboard/src/app/(app)/people/[userId]/page.tsx:141`:

```ts
const today = dayOf(new Date());
```

and in the `people` page the inline `new Date().toISOString().slice(0, 10)` argument to `weekStrip` becomes `dayOf(new Date())`. Add `import { dayOf } from '@timetrack/contracts';` to both files.

These are Server Components, so `new Date()` is the server clock — correct, because the day boundary is an org property, not a viewer property.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @timetrack/dashboard test`
Expected: PASS. Existing specs that asserted UTC day labels will now fail — **read each one before changing it**: if it asserted the old UTC behaviour, update the expectation; if it asserted something zone-independent, the change is a real regression and needs investigating.

- [ ] **Step 9: Verify nothing derives a day the old way**

Run: `grep -rn "toISOString().slice(0, 10)\|toISOString().slice(0,10)\|slice(11, 16)" apps/dashboard/src --include="*.ts" --include="*.tsx" | grep -v spec`
Expected: no output. Any remaining hit is a day boundary this task missed.

- [ ] **Step 10: Typecheck, lint, build**

Run: `pnpm --filter @timetrack/dashboard typecheck && pnpm --filter @timetrack/dashboard lint && pnpm --filter @timetrack/dashboard build`
Expected: clean. `typecheck` is the gate that catches spec type errors — vitest does not typecheck.

- [ ] **Step 11: Commit**

```bash
git add apps/dashboard/src
git commit -m "feat(dashboard): render days and times in Asia/Dhaka"
```

---

### Task 3: API buckets day series in Dhaka

**Files:**

- Modify: `apps/api/src/modules/reports/reports.service.ts:42`
- Modify: `apps/api/src/modules/reports/reports.repository.ts:156,253-254,264,272-273,278-279,337`
- Modify: `apps/api/src/modules/projects/projects.repository.ts:161`
- Modify: `apps/api/src/modules/activity/activity.repository.ts:80-82`
- Test: `apps/api/src/modules/reports/reports.e2e-spec.ts`

**Interfaces:**

- Consumes: `dayOf`, `dayStartInstant` from `@timetrack/contracts` (Task 1).
- Produces: no signature changes. `GET /v1/reports/*` response shapes are unchanged; only which day a given instant lands on changes.

**Read this before editing any SQL.** In Postgres, `AT TIME ZONE` means two different things depending on its input type:

| Input type    | Expression                                     | Result        | Role                                                        |
| ------------- | ---------------------------------------------- | ------------- | ----------------------------------------------------------- |
| `timestamptz` | `${from} AT TIME ZONE 'Asia/Dhaka'`            | `timestamp`   | instant → wall clock, then `::date` gives the **day label** |
| `timestamp`   | `(d.day::timestamp) AT TIME ZONE 'Asia/Dhaka'` | `timestamptz` | day label → the **instant** that day starts                 |

Both directions appear in `reports.repository.ts`, and both change from `'UTC'` to `'Asia/Dhaka'` — but for different reasons. Direction 2 (`:272,273,278,279`) is the one that actually re-buckets tracked seconds; direction 1 selects which day rows to read.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/modules/reports/reports.e2e-spec.ts`, inside the existing describe block that already has a seeded app and users:

```ts
it('buckets a 00:30-Dhaka entry onto the Dhaka day, not the UTC day', async () => {
  // 2026-08-19T18:30Z is 2026-08-20 00:30 in Dhaka: same UTC day as 17:30Z, different Dhaka day.
  await prisma.timeEntry.createMany({
    data: [
      {
        id: '01920000-0000-7000-8000-00000000ea01',
        userId: employeeId,
        projectId: null,
        taskId: null,
        source: 'MANUAL',
        startTime: new Date('2026-08-19T17:30:00.000Z'), // 23:30 Dhaka, Aug 19
        endTime: new Date('2026-08-19T17:45:00.000Z'),
      },
      {
        id: '01920000-0000-7000-8000-00000000ea02',
        userId: employeeId,
        projectId: null,
        taskId: null,
        source: 'MANUAL',
        startTime: new Date('2026-08-19T18:30:00.000Z'), // 00:30 Dhaka, Aug 20
        endTime: new Date('2026-08-19T18:45:00.000Z'),
      },
    ],
  });

  const res = await app.inject({
    method: 'GET',
    url: `/v1/reports/trends?from=2026-08-19T00:00:00.000Z&to=2026-08-21T00:00:00.000Z`,
    headers: { authorization: `Bearer ${employeeToken}` },
  });

  expect(res.statusCode).toBe(200);
  const days = res.json() as Array<{ day: string; trackedSeconds: number }>;
  const aug19 = days.find((d) => d.day === '2026-08-19');
  const aug20 = days.find((d) => d.day === '2026-08-20');

  // 15 minutes on each Dhaka day — NOT 30 minutes on 2026-08-19.
  expect(aug19?.trackedSeconds).toBe(900);
  expect(aug20?.trackedSeconds).toBe(900);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- reports.e2e-spec`
Expected: FAIL — `aug19.trackedSeconds` is `1800` and `aug20` is `0`, because both entries land on the same UTC day.

Note: this needs Docker running for Testcontainers. Use `test:e2e -- <file>`, **not** `test -- <file>` — the plain `test` script excludes e2e specs and would silently run nothing.

- [ ] **Step 3: Fix the default report date**

`apps/api/src/modules/reports/reports.service.ts:42`:

```ts
const date = query.date ?? dayOf(new Date());
```

with `import { dayOf } from '@timetrack/contracts';` at the top.

- [ ] **Step 4: Fix the overview activity window (direction 1, and a session-tz bug)**

`apps/api/src/modules/reports/reports.repository.ts:156` currently uses a bare cast, which depends on the database session timezone — the exact pattern the comment at `:309` warns against. Replace:

```sql
WHERE ads."day" BETWEEN (${from} AT TIME ZONE 'Asia/Dhaka')::date AND (${to} AT TIME ZONE 'Asia/Dhaka')::date
```

- [ ] **Step 5: Fix the trends day series (both directions)**

In the `trends` query, `:253-254` (direction 1 — build the series of day labels):

```sql
WITH days AS (
  SELECT generate_series(
    (${from} AT TIME ZONE 'Asia/Dhaka')::date,
    (${to} AT TIME ZONE 'Asia/Dhaka')::date,
    interval '1 day'
  )::date AS day
),
```

`:264` (direction 1 — select which summary rows to read):

```sql
WHERE ads."day" BETWEEN (${from} AT TIME ZONE 'Asia/Dhaka')::date AND (${to} AT TIME ZONE 'Asia/Dhaka')::date
```

`:272-273` and `:278-279` (direction 2 — turn each day label back into the instants it spans). **This is the change that re-buckets tracked seconds:**

```sql
tracked AS (
  SELECT d.day,
         FLOOR(SUM(GREATEST(
           EXTRACT(EPOCH FROM (
             LEAST(COALESCE(te."endTime", now()), ((d.day + 1)::timestamp) AT TIME ZONE 'Asia/Dhaka')
             - GREATEST(te."startTime", (d.day::timestamp) AT TIME ZONE 'Asia/Dhaka')
           )), 0
         )))::int AS "trackedSeconds"
  FROM days d
  JOIN time_entries te
    ON te."startTime" < ((d.day + 1)::timestamp) AT TIME ZONE 'Asia/Dhaka'
   AND COALESCE(te."endTime", now()) > (d.day::timestamp) AT TIME ZONE 'Asia/Dhaka'
   AND (${this.scopeSql(scope, Prisma.sql`te."userId"`)})
  GROUP BY d.day
)
```

- [ ] **Step 6: Fix the idle series (direction 1)**

`apps/api/src/modules/reports/reports.repository.ts:337`:

```sql
WHERE ads."day" BETWEEN (${from} AT TIME ZONE 'Asia/Dhaka')::date AND (${to} AT TIME ZONE 'Asia/Dhaka')::date
```

Update the doc comment above it (`:309-310`), which currently says the window is "UTC-pinned", to say Dhaka-pinned. Leaving a comment that contradicts the code is worse than no comment.

- [ ] **Step 7: Fix the per-project day grouping**

`apps/api/src/modules/projects/projects.repository.ts:161`:

```sql
SELECT to_char(GREATEST(te."startTime", ${from}::timestamptz) AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD') AS "day",
```

- [ ] **Step 8: Fix the activity summary range filter**

`apps/api/src/modules/activity/activity.repository.ts:80-82` compares a `@db.Date` column against raw instants. Convert to Dhaka **day labels** first:

```ts
day: {
  gte: new Date(`${dayOf(new Date(query.from))}T00:00:00.000Z`),
  lte: new Date(`${dayOf(new Date(query.to))}T00:00:00.000Z`),
},
```

with `import { dayOf } from '@timetrack/contracts';` at the top.

**Do not change `:89`** (`r.day.toISOString().slice(0, 10)`). That reads a `@db.Date` column back, which Prisma hands over as UTC midnight of the stored label — so slicing it yields the correct label already. Task 4 keeps storing labels as UTC-midnight `Date`s precisely so this stays true. (The spec's §3.3 listed `:89` as changing; that is an error in the spec, corrected here and in Step 11.)

- [ ] **Step 9: Run the test to verify it passes**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- reports.e2e-spec`
Expected: PASS — 900 seconds on each Dhaka day.

- [ ] **Step 10: Run the whole API suite**

Run: `RUN_E2E=1 pnpm --filter api test:e2e && pnpm --filter api test`
Expected: PASS. Other e2e specs asserting day labels near a boundary may need their expectations updated — read each failure and confirm it is a boundary shift, not a real break.

- [ ] **Step 11: Correct the spec's `:89` claim**

In `docs/superpowers/specs/2026-08-20-dhaka-time-and-live-entries-design.md` §3.3, remove `modules/activity/activity.repository.ts:89` from the list of sites that change and replace it with `modules/activity/activity.repository.ts:80-82`, noting that `:89` correctly reads a UTC-midnight day label and must be left alone.

- [ ] **Step 12: Commit**

```bash
git add apps/api/src docs/superpowers/specs
git commit -m "feat(api): bucket day series in Asia/Dhaka"
```

---

### Task 4: Worker rolls up activity on Dhaka days, with a backfill

**Files:**

- Modify: `apps/worker/src/processors/rollup-daily.processor.ts:8-17,34-37,66`
- Create: `apps/worker/src/processors/rollup-daily.util.ts`
- Create: `apps/worker/src/processors/rollup-daily.util.spec.ts`
- Create: `apps/worker/scripts/backfill-dhaka-rollups.ts`
- Test: `apps/worker/src/processors/rollup-daily.e2e-spec.ts`

**Interfaces:**

- Consumes: `dayOf`, `dayStartInstant`, `shiftDay` from `@timetrack/contracts` (Task 1).
- Produces:
  - `dhakaWindow(day: string): { dayLabel: Date; from: Date; to: Date }` — `dayLabel` is UTC midnight of the label (what gets stored), `from`/`to` are the UTC instants bracketing the Dhaka day (what the sample query uses).
  - `previousDhakaDay(now: Date): string` — the `'YYYY-MM-DD'` Dhaka day before the one containing `now`.

**The critical distinction in this task.** `ActivityDailySummary.day` is `@db.Date`. Prisma writes a JS `Date` to that column by taking its **UTC** date part. So the stored label must remain UTC midnight of the day _name_ (`2026-08-20T00:00:00.000Z` → stored `2026-08-20`), while the **sample window** shifts to the Dhaka day's real instants (`2026-08-19T18:00Z` → `2026-08-20T18:00Z`). Storing `dayStartInstant('2026-08-20')` directly would persist the label `2026-08-19` — off by one, and every read in Task 3 would silently disagree.

- [ ] **Step 1: Write the failing unit test**

Create `apps/worker/src/processors/rollup-daily.util.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dhakaWindow, previousDhakaDay } from './rollup-daily.util.js';

describe('dhakaWindow', () => {
  it('brackets the Dhaka day with UTC instants', () => {
    const w = dhakaWindow('2026-08-20');
    expect(w.from.toISOString()).toBe('2026-08-19T18:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-08-20T18:00:00.000Z');
  });

  it('stores the day LABEL as UTC midnight, not the window start', () => {
    // @db.Date takes the UTC date part. Storing the window start would persist 2026-08-19.
    const w = dhakaWindow('2026-08-20');
    expect(w.dayLabel.toISOString()).toBe('2026-08-20T00:00:00.000Z');
    expect(w.dayLabel.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('spans exactly 24 hours', () => {
    const w = dhakaWindow('2026-08-20');
    expect(w.to.getTime() - w.from.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('previousDhakaDay', () => {
  it('returns the Dhaka day before the one containing now', () => {
    // 2026-08-19T18:30Z is already 2026-08-20 in Dhaka, so the previous day is 2026-08-19.
    expect(previousDhakaDay(new Date('2026-08-19T18:30:00.000Z'))).toBe('2026-08-19');
  });

  it('is still on the earlier day just before the Dhaka boundary', () => {
    // 2026-08-19T17:30Z is 2026-08-19 in Dhaka, so the previous day is 2026-08-18.
    expect(previousDhakaDay(new Date('2026-08-19T17:30:00.000Z'))).toBe('2026-08-18');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter worker test -- rollup-daily.util.spec`
Expected: FAIL — `Failed to resolve import "./rollup-daily.util.js"`.

- [ ] **Step 3: Write the util**

Create `apps/worker/src/processors/rollup-daily.util.ts`:

```ts
import { dayOf, dayStartInstant, shiftDay } from '@timetrack/contracts';

/** Pure Dhaka-day window math for the daily rollup — unit-tested without a DB. */

export interface DhakaWindow {
  /**
   * What gets STORED in `activity_daily_summaries.day` (`@db.Date`). Prisma persists the UTC
   * date part of a JS Date, so this must be UTC midnight of the day's NAME — not the instant
   * the Dhaka day begins, which would persist the previous date.
   */
  dayLabel: Date;
  /** UTC instant the Dhaka day begins (inclusive). */
  from: Date;
  /** UTC instant the Dhaka day ends (exclusive). */
  to: Date;
}

export function dhakaWindow(day: string): DhakaWindow {
  return {
    dayLabel: new Date(`${day}T00:00:00.000Z`),
    from: dayStartInstant(day),
    to: dayStartInstant(shiftDay(day, 1)),
  };
}

/** The Dhaka day before the one containing `now`. */
export function previousDhakaDay(now: Date): string {
  return shiftDay(dayOf(now), -1);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter worker test -- rollup-daily.util.spec`
Expected: PASS.

- [ ] **Step 5: Write the failing integration test**

Append to `apps/worker/src/processors/rollup-daily.e2e-spec.ts`:

```ts
it('splits samples either side of Dhaka midnight onto different days', async () => {
  // Both instants are the same UTC day (2026-08-19) but different Dhaka days.
  // Timestamps must sit inside a seeded partition month (2026-07..2026-12).
  await prisma.activitySample.createMany({
    data: [
      {
        userId,
        timestamp: new Date('2026-08-19T17:30:00.000Z'), // 23:30 Dhaka, Aug 19
        appName: 'Xcode',
        category: 'PRODUCTIVE',
        activityPct: 80,
      },
      {
        userId,
        timestamp: new Date('2026-08-19T18:30:00.000Z'), // 00:30 Dhaka, Aug 20
        appName: 'Xcode',
        category: 'PRODUCTIVE',
        activityPct: 40,
      },
    ],
  });

  await processor.process({ data: { day: '2026-08-19' } } as never);
  await processor.process({ data: { day: '2026-08-20' } } as never);

  const rows = await prisma.activityDailySummary.findMany({
    where: { userId },
    orderBy: { day: 'asc' },
  });

  expect(rows.map((r) => r.day.toISOString().slice(0, 10))).toEqual(['2026-08-19', '2026-08-20']);
  expect(rows[0]?.avgActivityPct).toBe(80);
  expect(rows[1]?.avgActivityPct).toBe(40);
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `RUN_E2E=1 pnpm --filter worker test:e2e -- rollup-daily.e2e-spec`
Expected: FAIL — both samples land on `2026-08-19` and the average is 60.

- [ ] **Step 7: Rewrite the processor to use the Dhaka window**

In `apps/worker/src/processors/rollup-daily.processor.ts`, delete `utcDay` and `previousUtcDay`, and import the util:

```ts
import { dhakaWindow, previousDhakaDay } from './rollup-daily.util.js';
```

Replace the head of `process`:

```ts
async process(job: Job<{ day?: string }>): Promise<void> {
  const day = job.data?.day ?? previousDhakaDay(new Date());
  const { dayLabel, from, to } = dhakaWindow(day);

  const samples = await this.prisma.activitySample.findMany({
    where: { timestamp: { gte: from, lt: to } },
    select: { userId: true, appName: true, category: true, activityPct: true },
  });
```

Replace every `day: dayStart` and `day: dayStart` key in the `upsert` with `day: dayLabel`:

```ts
  where: { userId_day: { userId: r.userId, day: dayLabel } },
  create: {
    userId: r.userId,
    day: dayLabel,
    // ...unchanged
```

And the closing log:

```ts
this.logger.log({ day, users: rollups.length, samples: samples.length }, 'rollup-daily complete');
```

Update the class doc comment: it says "the previous UTC day's activity_samples" — make it Dhaka.

- [ ] **Step 8: Run the integration test to verify it passes**

Run: `RUN_E2E=1 pnpm --filter worker test:e2e -- rollup-daily.e2e-spec`
Expected: PASS — two rows, 80 and 40.

- [ ] **Step 9: Write the backfill script**

Create `apps/worker/scripts/backfill-dhaka-rollups.ts`. Existing rows were bucketed on UTC days and are misaligned by six hours; this rebuilds them by re-running the rollup for each Dhaka day. `console.log` is permitted here — this is `scripts/`.

```ts
/**
 * One-off: rebuild activity_daily_summaries on Dhaka day boundaries.
 *
 * Existing rows were bucketed on UTC days. This re-runs the rollup for every Dhaka day that
 * still has surviving activity_samples. Days whose samples retention has already purged
 * CANNOT be rebuilt — their rows keep their old UTC-shaped numbers, and the script reports
 * the date from which the data is trustworthy so nobody reads older figures as Dhaka-aligned.
 *
 * Run AFTER deploying the Dhaka rollup processor. Idempotent: re-running is a no-op.
 */
import { dayOf, shiftDay } from '@timetrack/contracts';
import { PrismaClient, pgAdapter } from '@timetrack/db';
import { loadEnv } from '@timetrack/config';
import { aggregateSamples } from '../src/processors/rollup-aggregate.js';
import { dhakaWindow } from '../src/processors/rollup-daily.util.js';

const env = loadEnv();
const prisma = new PrismaClient({ adapter: pgAdapter(env.DATABASE_URL) });

async function main(): Promise<void> {
  const oldest = await prisma.activitySample.findFirst({
    orderBy: { timestamp: 'asc' },
    select: { timestamp: true },
  });
  if (!oldest) {
    console.log('no activity samples — nothing to rebuild');
    return;
  }

  const firstDay = dayOf(oldest.timestamp);
  const lastDay = shiftDay(dayOf(new Date()), -1);
  console.log(`rebuilding Dhaka rollups from ${firstDay} to ${lastDay}`);

  let rebuilt = 0;
  for (let day = firstDay; day <= lastDay; day = shiftDay(day, 1)) {
    const { dayLabel, from, to } = dhakaWindow(day);
    const samples = await prisma.activitySample.findMany({
      where: { timestamp: { gte: from, lt: to } },
      select: { userId: true, appName: true, category: true, activityPct: true },
    });
    if (samples.length === 0) continue;

    for (const r of aggregateSamples(samples)) {
      await prisma.activityDailySummary.upsert({
        where: { userId_day: { userId: r.userId, day: dayLabel } },
        create: {
          userId: r.userId,
          day: dayLabel,
          avgActivityPct: r.avgActivityPct,
          activeMinutes: r.activeMinutes,
          byApp: r.byApp,
          byCategory: r.byCategory,
        },
        update: {
          avgActivityPct: r.avgActivityPct,
          activeMinutes: r.activeMinutes,
          byApp: r.byApp,
          byCategory: r.byCategory,
        },
      });
    }
    rebuilt += 1;
  }

  console.log(`rebuilt ${rebuilt} Dhaka days`);
  console.log(`ACTIVITY ROLLUPS ARE DHAKA-ALIGNED FROM ${firstDay} ONWARD.`);
  console.log(
    `Rows before ${firstDay} keep UTC-shaped numbers — their samples are already purged.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e: unknown) => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
```

Before running, confirm `aggregateSamples` is the actual exported name in `rollup-aggregate.ts` (the processor imports it at the top of `rollup-daily.processor.ts`), and that `@timetrack/config` exports `loadEnv` and `@timetrack/db` exports `pgAdapter` — the API and worker both construct their client as `new PrismaClient({ adapter: pgAdapter(env.DATABASE_URL) })`, so copy that call shape rather than inventing one.

- [ ] **Step 10: Verify the script typechecks**

Run: `pnpm --filter worker typecheck && pnpm --filter worker lint`
Expected: clean. Fix any import-path mismatch surfaced here rather than at run time.

- [ ] **Step 11: Run the full worker suite**

Run: `pnpm --filter worker test && RUN_E2E=1 pnpm --filter worker test:e2e`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): roll up activity on Dhaka days"
```

---

### Task 5: Full verification

- [ ] **Step 1: Build everything from clean**

Run: `pnpm build`
Expected: clean. This is what proves `packages/contracts` `dist` is consistent with both consumers.

- [ ] **Step 2: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all green. Paste the actual output into the completion report — do not claim a pass you did not see.

- [ ] **Step 3: Run the e2e suites**

Run: `RUN_E2E=1 pnpm --filter api test:e2e && RUN_E2E=1 pnpm --filter worker test:e2e`
Expected: PASS. Requires Docker.

- [ ] **Step 4: Check API coverage**

Run: `RUN_E2E=1 pnpm --filter api test:coverage`
Expected: ≥80%, `functions` being the binding metric. Note the 80% gate is measured by `test:coverage` (combined unit + e2e), **not** by `pnpm test`.

- [ ] **Step 5: Format only what this plan touched**

Run: `pnpm exec prettier --write "packages/contracts/src/**" "apps/dashboard/src/**" "apps/api/src/**" "apps/worker/**/*.ts"`
Do **not** run repo-wide `pnpm format` — `format:check` already fails on unrelated files on `main`, and reformatting them is scope creep.

- [ ] **Step 6: Commit any formatting drift**

```bash
git add -A
git commit -m "chore: format Dhaka day boundary changes" || echo "nothing to format"
```

---

## Deployment note

The processor change (Task 4) and the backfill script must go out **together**. Deploying the processor alone leaves a six-hour seam between rows written before and after the change. Run `backfill-dhaka-rollups.ts` immediately after deploy and record the reported trustworthy-from date.
