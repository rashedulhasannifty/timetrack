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

export const UpdateProjectSchema = z.object({
  archived: z.boolean().optional(),
  color: ProjectColorSchema.optional(),
});

// Query for GET /projects. z.stringbool() parses "true"/"false" correctly;
// z.coerce.boolean() would turn the string "false" into true. .default(false)
// makes the field optional and defaults a missing flag to "assignable only".
export const ListProjectsQuerySchema = z.object({
  includeArchived: z.stringbool().default(false),
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
