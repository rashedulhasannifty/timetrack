import { z } from 'zod';
import { ImportNameSchema, NameSkipSchema } from './name-list.js';

// The preset swatches (dashboard imports this) and the fallback color for a project with none.
// Presets, not a whitelist: any #rrggbb is a valid project color (see ProjectColorSchema).
export const PROJECT_PALETTE = [
  '#007aff',
  '#5e5ce6',
  '#30b0c7',
  '#34c759',
  '#ff9500',
  '#ff2d55',
  '#af52de',
  '#ffcc00',
] as const;

// WRITE constraint (create/recolor): any 6-digit hex, stored lowercase so one color never
// round-trips as two spellings. It used to be the palette enum; the dashboard now offers a custom
// picker. Only the dashboard renders project colors — the native clients never read them — so
// widening this breaks no shipped client. Reads stay permissive strings (DB column is TEXT).
export const ProjectColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb color')
  .toLowerCase();
export type ProjectColor = z.infer<typeof ProjectColorSchema>;

/** The name every project's default subproject is created with (and the migration backfilled). */
export const DEFAULT_SUBPROJECT_NAME = 'General';

export const SubprojectSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  archived: z.boolean(),
  /** The project's "General" bucket: exactly one per project, never archivable. */
  isDefault: z.boolean(),
});

export const TaskSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  subprojectId: z.uuid(),
  name: z.string(),
  archived: z.boolean(),
});

export const ProjectSchema = z.object({
  id: z.uuid(),
  teamId: z.uuid(),
  name: z.string(),
  color: z.string().nullable(),
  archived: z.boolean(),
  /**
   * Every team linked to the project, home (`teamId`) first. Additive: shipped desktop clients
   * decode `teamId` only. More than one entry means the client is shared.
   */
  teamIds: z.array(z.uuid()).optional(),
  /**
   * Name of the home team (`teamId`). Additive: the desktop pickers use it for an ADMIN's team
   * headers; shipped clients ignore it.
   */
  teamName: z.string().optional(),
  tasks: z.array(TaskSchema).optional(),
  subprojects: z.array(SubprojectSchema).optional(),
});

export const CreateProjectSchema = z.object({
  teamId: z.uuid(),
  name: z.string().min(1).max(200),
  color: ProjectColorSchema,
});

/**
 * POST /v1/projects/bulk (ADMIN) — import clients into one team. Raw names: the API normalizes
 * each. A name that is a new client is CREATED in the team; a name that is an active client of
 * another team is SHARED into the team (one client record, time split by team). Skipped: names
 * already in the team, archived clients, names several clients have, and in-list repeats.
 */
export const BulkCreateProjectsSchema = z.object({
  teamId: z.uuid(),
  names: z.array(ImportNameSchema).min(1).max(500),
});
export const BulkCreateProjectsResultSchema = z.object({
  created: z.array(ProjectSchema),
  /** Existing clients of other teams now linked to this team too, with their `teamIds`. */
  shared: z.array(ProjectSchema),
  skipped: z.array(NameSkipSchema),
});

/** The project is derived from the subproject server-side, so a task can never straddle two. */
export const CreateTaskSchema = z.object({
  subprojectId: z.uuid(),
  name: z.string().min(1).max(200),
});

/**
 * PATCH /v1/projects/tasks/:id — archive/restore, and/or move to another subproject of the SAME
 * project. `.check()` not `.refine()`, so the pipe keeps strict mode.
 */
export const UpdateTaskSchema = z
  .object({
    archived: z.boolean().optional(),
    subprojectId: z.uuid().optional(),
  })
  .check((ctx) => {
    if (ctx.value.archived === undefined && ctx.value.subprojectId === undefined) {
      ctx.issues.push({ code: 'custom', message: 'Nothing to update', input: ctx.value, path: [] });
    }
  });

export const CreateSubprojectSchema = z.object({
  projectId: z.uuid(),
  name: z.string().min(1).max(200),
});

/** No `.default()`s anywhere: Zod 4 `.partial()`/optional keys would otherwise inject them. */
export const UpdateSubprojectSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    archived: z.boolean().optional(),
  })
  .check((ctx) => {
    if (ctx.value.name === undefined && ctx.value.archived === undefined) {
      ctx.issues.push({ code: 'custom', message: 'Nothing to update', input: ctx.value, path: [] });
    }
  });

/**
 * PATCH /v1/projects/:id. `teamId` MOVES the project to another team — ADMIN only, because a
 * team is an org-wide boundary. It is here rather than on a route of its own so the one
 * "edit a project" call stays one call; the service audits a move separately from a rename.
 *
 * Moving does not rewrite history: project reports scope by the ENTRY's user, joining projects
 * only for the name, so hours already tracked stay with the team whose people tracked them.
 * The team controls who can assign the project from here on, and who can administer it.
 */
export const UpdateProjectSchema = z.object({
  archived: z.boolean().optional(),
  color: ProjectColorSchema.optional(),
  teamId: z.uuid().optional(),
});

/**
 * PUT /v1/projects/:id/teams (ADMIN) — the FULL set of teams linked to the project. Must include
 * the home team (the API 422s otherwise). `.check()` not `.refine()`, so the pipe keeps strict mode.
 */
export const SetProjectTeamsSchema = z
  .object({ teamIds: z.array(z.uuid()).min(1).max(100) })
  .check((ctx) => {
    if (new Set(ctx.value.teamIds).size !== ctx.value.teamIds.length) {
      ctx.issues.push({
        code: 'custom',
        message: 'Each team may appear once',
        input: ctx.value,
        path: ['teamIds'],
      });
    }
  });

/** One team's share of a client's time. `teamId` null → "Unassigned" (no team stamped). */
export const ProjectTeamRowSchema = z.object({
  teamId: z.uuid().nullable(),
  teamName: z.string(),
  trackedSeconds: z.number().int().nonnegative(),
});

// Query for GET /projects. z.stringbool() parses "true"/"false" correctly;
// z.coerce.boolean() would turn the string "false" into true. .default(false)
// makes the field optional and defaults a missing flag to "assignable only".
export const ListProjectsQuerySchema = z.object({
  includeArchived: z.stringbool().default(false),
  /**
   * ADMIN only: read another team's projects. A MANAGER naming a team other than their own is
   * a 403; an EMPLOYEE is pinned to their own team whatever they send. Without this an
   * org-wide admin had no way to SEE a project outside their own team, which is what made a
   * project stranded by a team change invisible rather than merely unassignable.
   */
  teamId: z.uuid().optional(),
  /**
   * ADMIN only: every team's projects in ONE call, instead of one `teamId` call per team (the
   * clients & work types page has dozens of teams and tripped the throttler). A MANAGER sending
   * `allTeams=true` is a 403; an EMPLOYEE is pinned to their own team whatever they send, like
   * `teamId`. Additive: shipped desktop clients never send it, and the response shape is
   * unchanged.
   */
  allTeams: z.stringbool().default(false),
});

export const ProjectHoursTrendRowSchema = z.object({
  day: z.iso.date(), // 'YYYY-MM-DD' — UTC start-day bucket
  trackedSeconds: z.number().int().nonnegative(),
});

export const ProjectMemberRowSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  trackedSeconds: z.number().int().nonnegative(),
});

export const ProjectSubprojectRowSchema = z.object({
  subprojectId: z.uuid().nullable(), // null → "No subproject" (entry naming no/unknown subproject)
  name: z.string(),
  trackedSeconds: z.number().int().nonnegative(),
});

export const ProjectTaskRowSchema = z.object({
  taskId: z.uuid().nullable(), // null → the "No task" bucket
  subprojectId: z.uuid().nullable(), // the task's subproject; null for "No task"
  name: z.string(),
  trackedSeconds: z.number().int().nonnegative(),
});

export const ProjectDetailSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  projectId: z.uuid(),
  /** The team that owns the project now — what the admin "move to team" control starts from. */
  teamId: z.uuid(),
  /** Linked teams, home first. More than one → shared. */
  teamIds: z.array(z.uuid()),
  name: z.string(),
  color: z.string().nullable(),
  archived: z.boolean(),
  totalSeconds: z.number().int().nonnegative(),
  /** The total split by the team each entry was tracked under; sums to `totalSeconds`. */
  byTeam: z.array(ProjectTeamRowSchema),
  trend: z.array(ProjectHoursTrendRowSchema),
  members: z.array(ProjectMemberRowSchema),
  subprojects: z.array(ProjectSubprojectRowSchema),
  tasks: z.array(ProjectTaskRowSchema),
});

export const ProjectDetailQuerySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
});

export const ProjectTopAppRowSchema = z.object({
  appName: z.string(),
  trackedSeconds: z.number().int().nonnegative(),
});

export const ProjectTopAppsSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  projectId: z.uuid(),
  apps: z.array(ProjectTopAppRowSchema),
  coveredSeconds: z.number().int().nonnegative(),
  totalSeconds: z.number().int().nonnegative(),
  coveragePct: z.number().int().min(0).max(100),
});

export type Subproject = z.infer<typeof SubprojectSchema>;
export type CreateSubproject = z.infer<typeof CreateSubprojectSchema>;
export type UpdateSubproject = z.infer<typeof UpdateSubprojectSchema>;
export type ProjectSubprojectRow = z.infer<typeof ProjectSubprojectRowSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type CreateProject = z.infer<typeof CreateProjectSchema>;
export type CreateTask = z.infer<typeof CreateTaskSchema>;
export type UpdateTask = z.infer<typeof UpdateTaskSchema>;
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;
export type SetProjectTeams = z.infer<typeof SetProjectTeamsSchema>;
export type ProjectTeamRow = z.infer<typeof ProjectTeamRowSchema>;
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;
export type ProjectHoursTrendRow = z.infer<typeof ProjectHoursTrendRowSchema>;
export type ProjectMemberRow = z.infer<typeof ProjectMemberRowSchema>;
export type ProjectTaskRow = z.infer<typeof ProjectTaskRowSchema>;
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;
export type ProjectDetailQuery = z.infer<typeof ProjectDetailQuerySchema>;
export type ProjectTopAppRow = z.infer<typeof ProjectTopAppRowSchema>;
export type ProjectTopApps = z.infer<typeof ProjectTopAppsSchema>;
export type BulkCreateProjects = z.infer<typeof BulkCreateProjectsSchema>;
export type BulkCreateProjectsResult = z.infer<typeof BulkCreateProjectsResultSchema>;
