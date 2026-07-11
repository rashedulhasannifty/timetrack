import { z } from 'zod';

/**
 * PRD §7.2 — errors are RFC 9457 problem+json. This is the wire shape the global
 * exception filter emits and the dashboard's api-client can parse when a call fails.
 */
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
        code: z.string(),
      }),
    )
    .optional(),
});

export type Problem = z.infer<typeof ProblemSchema>;
