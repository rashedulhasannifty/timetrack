import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import {
  RESOURCE_SCOPE,
  type ResourceScopeOptions,
} from '../decorators/resource-scope.decorator.js';
import type { SessionUser } from '../decorators/current-user.decorator.js';
import { ResourceAccessService } from '../authz/resource-access.service.js';

/**
 * Runs after JwtAuthGuard + RolesGuard. If a route declares `@ResourceScope`, this
 * guard resolves the target user id and enforces the shared access rule — so a route
 * gets resource authorization by annotation, not by copy-pasted logic. Routes without
 * the decorator are unaffected.
 */
@Injectable()
export class ResourceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: ResourceAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const opts = this.reflector.getAllAndOverride<ResourceScopeOptions | undefined>(
      RESOURCE_SCOPE,
      [context.getHandler(), context.getClass()],
    );
    if (!opts) return true;

    const req = context.switchToHttp().getRequest<
      FastifyRequest & {
        user?: SessionUser;
        params?: Record<string, string>;
        query?: Record<string, unknown>;
      }
    >();
    const user = req.user;
    if (!user) return true; // no session (e.g. @Public) — nothing to scope

    const raw = opts.source === 'param' ? req.params?.[opts.key] : req.query?.[opts.key];
    // Absent id → the caller is asking about themselves.
    const targetUserId = typeof raw === 'string' && raw.length > 0 ? raw : user.id;

    await this.access.assertCanAccessUser(user, targetUserId);
    return true;
  }
}
