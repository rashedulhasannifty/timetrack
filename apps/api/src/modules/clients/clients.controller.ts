import { Controller, Get } from '@nestjs/common';
import type { ClientInstall } from '@timetrack/contracts';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ClientsService } from './clients.service.js';

@Controller('clients')
export class ClientsController {
  constructor(private readonly service: ClientsService) {}

  // Deployment-wide admin list for the Users page, not a per-user read, so no @ResourceScope.
  // The service re-checks ADMIN.
  @Get()
  @Roles('ADMIN')
  list(@CurrentUser() actor: SessionUser): Promise<ClientInstall[]> {
    return this.service.list(actor);
  }
}
