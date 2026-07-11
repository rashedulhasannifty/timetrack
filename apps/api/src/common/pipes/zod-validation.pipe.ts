import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';
import { UnprocessableEntityException } from '@nestjs/common';
import { ZodObject, type ZodType } from 'zod';

/**
 * CLAUDE.md §4 — Zod is the ONLY validation library. class-validator is not
 * installed and will not be. Schemas come from @timetrack/contracts so the API
 * and the dashboard break together when a contract changes.
 *
 * Security baseline (the Zod-native equivalent of class-validator's
 * `whitelist` + `forbidNonWhitelisted`): request BODIES are parsed in strict mode,
 * so an unexpected/extra field is REJECTED (422), not silently accepted — this
 * blocks mass-assignment. Zod already strips unknown keys elsewhere (query/params),
 * so nothing extra ever reaches a handler.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const schema =
      metadata.type === 'body' && this.schema instanceof ZodObject
        ? this.schema.strict()
        : this.schema;

    const result = schema.safeParse(value);
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
