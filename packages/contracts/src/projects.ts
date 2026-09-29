import { z } from 'zod';

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
  tasks: z.array(TaskSchema).optional(),
  subprojects: z.array(SubprojectSchema).optional(),
});

export const CreateProjectSchema = z.object({
  teamId: z.uuid(),
  name: z.string().min(1).max(200),
  color: ProjectColorSchema,
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
  name: z.string(),
  color: z.string().nullable(),
  archived: z.boolean(),
  totalSeconds: z.number().int().nonnegative(),
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
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;
export type ProjectHoursTrendRow = z.infer<typeof ProjectHoursTrendRowSchema>;
export type ProjectMemberRow = z.infer<typeof ProjectMemberRowSchema>;
export type ProjectTaskRow = z.infer<typeof ProjectTaskRowSchema>;
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;
export type ProjectDetailQuery = z.infer<typeof ProjectDetailQuerySchema>;
export type ProjectTopAppRow = z.infer<typeof ProjectTopAppRowSchema>;
export type ProjectTopApps = z.infer<typeof ProjectTopAppsSchema>;
