import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';
import { UnprocessableEntityException } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * CLAUDE.md §4 — Zod is the ONLY validation library. class-validator is not
 * installed and will not be. Schemas come from @timetrack/contracts so the API
 * and the dashboard break together when a contract changes.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new UnprocessableEntityException({
        type: 'https://timetrack.internal/errors/validation',
        title: 'Validation failed',
        status: 422,
        errors: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
          code: i.code,
        })),
      });
    }
    return result.data;
  }
}
