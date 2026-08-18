import { z } from 'zod';

// Single source of the project palette (dashboard imports this). `as const` → z.enum infers the union.
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

// WRITE constraint (create/recolor). Reads stay permissive strings (DB column is TEXT).
export const ProjectColorSchema = z.enum(PROJECT_PALETTE);
export type ProjectColor = z.infer<typeof ProjectColorSchema>;

export const TaskSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
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
});

export const CreateProjectSchema = z.object({
  teamId: z.uuid(),
  name: z.string().min(1).max(200),
  color: ProjectColorSchema,
});

export const CreateTaskSchema = z.object({
  projectId: z.uuid(),
  name: z.string().min(1).max(200),
});

export const UpdateTaskSchema = z.object({
  archived: z.boolean(),
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

export const ProjectTaskRowSchema = z.object({
  taskId: z.uuid().nullable(), // null → the "No task" bucket
  name: z.string(),
  trackedSeconds: z.number().int().nonnegative(),
});

export const ProjectDetailSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  projectId: z.uuid(),
  name: z.string(),
  color: z.string().nullable(),
  archived: z.boolean(),
  totalSeconds: z.number().int().nonnegative(),
  trend: z.array(ProjectHoursTrendRowSchema),
  members: z.array(ProjectMemberRowSchema),
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
