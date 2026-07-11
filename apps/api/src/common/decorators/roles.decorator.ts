import { SetMetadata } from '@nestjs/common';
import type { Role } from '@timetrack/contracts';

export const ROLES = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
