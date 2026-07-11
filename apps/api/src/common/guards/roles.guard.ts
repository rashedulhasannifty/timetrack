import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@timetrack/contracts';
import { ROLES } from '../decorators/roles.decorator.js';
import type { SessionUser } from '../decorators/current-user.decorator.js';

/**
 * CLAUDE.md §4 — RBAC via a @Roles() decorator. Runs after JwtAuthGuard, so
 * `req.user` is present. A route with no @Roles() is open to any authenticated
 * user; resource-level checks (owning the team, reading only yourself) still live
 * in the services, not here — this guard only gates by role.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: SessionUser }>();
    if (user && required.includes(user.role)) return true;

    throw new ForbiddenException({
      type: 'https://timetrack.internal/errors/forbidden',
      title: 'Insufficient role',
      status: 403,
    });
  }
}
