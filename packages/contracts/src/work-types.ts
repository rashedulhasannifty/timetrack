import { z } from 'zod';
import { ImportNameSchema, NAME_MAX_LENGTH, NameSkipSchema } from './name-list.js';

/** A catalog entry: one kind of work (spec §4). "General" is reserved and never one of these. */
export const WorkTypeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  archived: z.boolean(),
});

/** GET /v1/work-types row. `teamIds` includes teams whose selection of an ARCHIVED type is kept. */
export const WorkTypeWithTeamsSchema = WorkTypeSchema.extend({
  teamIds: z.array(z.uuid()),
});
export const WorkTypeListSchema = z.array(WorkTypeWithTeamsSchema);

/** POST /v1/work-types/bulk — raw names; the API normalizes each and reports skips. */
export const BulkCreateWorkTypesSchema = z.object({
  names: z.array(ImportNameSchema).min(1).max(100),
});
export const BulkCreateWorkTypesResultSchema = z.object({
  created: z.array(WorkTypeSchema),
  skipped: z.array(NameSkipSchema),
});

/**
 * PATCH /v1/work-types/:id — rename and/or archive/restore. `.check()` not `.refine()`, so the
 * pipe keeps strict mode; no `.default()` anywhere (Zod 4 optional keys would inject it).
 */
export const UpdateWorkTypeSchema = z
  .object({
    name: z.string().min(1).max(NAME_MAX_LENGTH).optional(),
    archived: z.boolean().optional(),
  })
  .check((ctx) => {
    if (ctx.value.name === undefined && ctx.value.archived === undefined) {
      ctx.issues.push({ code: 'custom', message: 'Nothing to update', input: ctx.value, path: [] });
    }
  });

/**
 * PUT /v1/work-types/teams/:teamId — the team's full set of NON-archived work types. Links to
 * archived work types are preserved server-side (plan ruling R5).
 */
export const SetTeamWorkTypesSchema = z.object({
  workTypeIds: z.array(z.uuid()).max(100),
});
/** The stored selection after a PUT, archived links included. */
export const TeamWorkTypesSchema = z.object({
  teamId: z.uuid(),
  workTypeIds: z.array(z.uuid()),
});

const Count = z.number().int().nonnegative();
/** What a reconcile (or POST /v1/work-types/resync) changed. */
export const ReconcileCountsSchema = z.object({
  projects: Count,
  created: Count,
  linked: Count,
  restored: Count,
  renamed: Count,
  archived: Count,
});

export type WorkType = z.infer<typeof WorkTypeSchema>;
export type WorkTypeWithTeams = z.infer<typeof WorkTypeWithTeamsSchema>;
export type BulkCreateWorkTypes = z.infer<typeof BulkCreateWorkTypesSchema>;
export type BulkCreateWorkTypesResult = z.infer<typeof BulkCreateWorkTypesResultSchema>;
export type UpdateWorkType = z.infer<typeof UpdateWorkTypeSchema>;
export type SetTeamWorkTypes = z.infer<typeof SetTeamWorkTypesSchema>;
export type TeamWorkTypes = z.infer<typeof TeamWorkTypesSchema>;
export type ReconcileCounts = z.infer<typeof ReconcileCountsSchema>;
