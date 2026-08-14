import { describe, expect, it } from 'vitest';
import { UpdateUserSchema } from './users.js';

/**
 * UpdateUserSchema is `.strict().refine(...)` — a ZodEffects, so the ZodValidationPipe cannot
 * add strictness (its `.strict()` branch only fires for a bare ZodObject). These assert that
 * the baked-in strict + the "at least one field" refine both survive the wrap and hold, since
 * every service/e2e test drives the schema with pre-shaped object literals, not the pipe.
 */
describe('UpdateUserSchema', () => {
  it('rejects an empty body (refine: at least one field)', () => {
    expect(UpdateUserSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown field (strict survives the refine wrap — no mass assignment)', () => {
    // Deliberately a field that is NOT in the schema. `teamId` served as the unknown key here
    // until it became a real field; leaving it would have passed for the wrong reason (bad uuid).
    expect(UpdateUserSchema.safeParse({ role: 'MANAGER', email: 'a@b.co' }).success).toBe(false);
  });

  it('accepts a teamId-only update — this is how a user is reassigned to a manager', () => {
    expect(
      UpdateUserSchema.safeParse({ teamId: '019797a0-0000-7000-8000-000000000001' }).success,
    ).toBe(true);
  });

  it('rejects a teamId that is not a uuid', () => {
    expect(UpdateUserSchema.safeParse({ teamId: 'team-1' }).success).toBe(false);
  });

  it('accepts a role-only update', () => {
    expect(UpdateUserSchema.safeParse({ role: 'MANAGER' }).success).toBe(true);
  });

  it('accepts a deactivated-only update', () => {
    expect(UpdateUserSchema.safeParse({ deactivated: true }).success).toBe(true);
  });

  it('accepts both fields together', () => {
    expect(UpdateUserSchema.safeParse({ deactivated: false, role: 'ADMIN' }).success).toBe(true);
  });

  it('rejects an invalid role value', () => {
    expect(UpdateUserSchema.safeParse({ role: 'SUPERUSER' }).success).toBe(false);
  });
});
