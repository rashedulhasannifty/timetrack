import { SetMetadata } from '@nestjs/common';

/**
 * CLAUDE.md §4 — the API is deny-by-default. Every controller has a guard.
 * @Public() must be explicit and is code-reviewed. Do not add it casually.
 */
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
