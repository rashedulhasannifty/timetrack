import { z } from 'zod';

export const TaskSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
});

export const ProjectSchema = z.object({
  id: z.uuid(),
  teamId: z.uuid(),
  name: z.string(),
  archived: z.boolean(),
  tasks: z.array(TaskSchema).optional(),
});

export const CreateProjectSchema = z.object({
  teamId: z.uuid(),
  name: z.string().min(1).max(200),
});

export const CreateTaskSchema = z.object({
  projectId: z.uuid(),
  name: z.string().min(1).max(200),
});

export const UpdateProjectSchema = z.object({
  archived: z.boolean(),
});

// Query for GET /projects. z.stringbool() parses "true"/"false" correctly;
// z.coerce.boolean() would turn the string "false" into true. .default(false)
// makes the field optional and defaults a missing flag to "assignable only".
export const ListProjectsQuerySchema = z.object({
  includeArchived: z.stringbool().default(false),
});

export type Task = z.infer<typeof TaskSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type CreateProject = z.infer<typeof CreateProjectSchema>;
export type CreateTask = z.infer<typeof CreateTaskSchema>;
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;
