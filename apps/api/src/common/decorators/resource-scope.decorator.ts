import { SetMetadata } from '@nestjs/common';

/**
 * Declares that a route is scoped to a user's data. The target user id is read from
 * the given request location; when absent it defaults to the session user (self).
 * The global `ResourceGuard` then enforces self / manager-of-team / admin.
 *
 *   @Get()
 *   @ResourceScope({ source: 'query', key: 'userId' })   // GET /x?userId=...
 *   list(...) { ... }
 *
 * Make resource authorization the default: annotate the route, don't hand-roll a check.
 */
export interface ResourceScopeOptions {
  source: 'query' | 'param';
  key: string;
}

export const RESOURCE_SCOPE = 'resourceScope';
export const ResourceScope = (options: ResourceScopeOptions) =>
  SetMetadata(RESOURCE_SCOPE, options);
