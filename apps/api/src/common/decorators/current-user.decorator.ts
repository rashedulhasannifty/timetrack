import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '@timetrack/contracts';

export interface SessionUser {
  id: string;
  role: Role;
  teamId: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser =>
    ctx.switchToHttp().getRequest<{ user: SessionUser }>().user,
);
