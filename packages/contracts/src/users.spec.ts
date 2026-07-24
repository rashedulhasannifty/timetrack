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
    expect(UpdateUserSchema.safeParse({ role: 'MANAGER', teamId: 'x' }).success).toBe(false);
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
