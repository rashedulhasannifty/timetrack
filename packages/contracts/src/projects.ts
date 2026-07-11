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

export type Task = z.infer<typeof TaskSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type CreateProject = z.infer<typeof CreateProjectSchema>;
export type CreateTask = z.infer<typeof CreateTaskSchema>;
