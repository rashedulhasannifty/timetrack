import { describe, it, expect } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const Schema = z.object({ name: z.string(), count: z.number() });
const body = (): ArgumentMetadata => ({ type: 'body', metatype: undefined, data: undefined });
const query = (): ArgumentMetadata => ({ type: 'query', metatype: undefined, data: undefined });

describe('ZodValidationPipe', () => {
  it('returns parsed data for a valid body', () => {
    const pipe = new ZodValidationPipe(Schema);
    expect(pipe.transform({ name: 'a', count: 1 }, body())).toEqual({ name: 'a', count: 1 });
  });

  it('rejects an extra field on a body in strict mode (422, mass-assignment guard)', () => {
    const pipe = new ZodValidationPipe(Schema);
    expect(() => pipe.transform({ name: 'a', count: 1, isAdmin: true }, body())).toThrow(
      UnprocessableEntityException,
    );
  });

  it('reports the failing path/message/code on invalid input', () => {
    const pipe = new ZodValidationPipe(Schema);
    try {
      pipe.transform({ name: 'a', count: 'nope' }, body());
      expect.unreachable('should have thrown');
    } catch (e) {
      const res = (e as UnprocessableEntityException).getResponse() as {
        status: number;
        errors: { path: string }[];
      };
      expect(res.status).toBe(422);
      expect(res.errors[0]?.path).toBe('count');
    }
  });

  it('does NOT apply strict mode to non-body input (query strips unknown keys)', () => {
    const pipe = new ZodValidationPipe(Schema);
    expect(pipe.transform({ name: 'a', count: 1, extra: 'x' }, query())).toEqual({
      name: 'a',
      count: 1,
    });
  });

  it('handles a non-object schema (no .strict() coercion)', () => {
    const pipe = new ZodValidationPipe(z.string());
    expect(pipe.transform('hello', body())).toBe('hello');
    expect(() => pipe.transform(42, body())).toThrow(UnprocessableEntityException);
  });
});
