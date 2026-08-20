import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtClaimsSchema } from '@timetrack/contracts';
import type { FastifyRequest } from 'fastify';
import { IS_PUBLIC } from '../decorators/public.decorator.js';
import type { SessionUser } from '../decorators/current-user.decorator.js';

/**
 * CLAUDE.md §4 — the API is deny-by-default. This guard runs on every route;
 * only routes explicitly marked @Public() skip it. It verifies the access JWT,
 * validates the claims through the shared Zod schema, and attaches the identity
 * that the services authorize against.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest & { user?: SessionUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw this.unauthorized();

    try {
      const payload: unknown = await this.jwt.verifyAsync(header.slice('Bearer '.length));
      const claims = JwtClaimsSchema.parse(payload);
      req.user = { id: claims.sub, role: claims.role, teamId: claims.teamId };
      return true;
    } catch {
      throw this.unauthorized();
    }
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      type: 'https://timetrack.internal/errors/unauthorized',
      title: 'Authentication required',
      status: 401,
    });
  }
}
