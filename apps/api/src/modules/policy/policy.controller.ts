import { Controller, Get } from '@nestjs/common';
import type { EffectivePolicy } from '@timetrack/contracts';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { PolicyService } from './policy.service.js';

@Controller('policy')
export class PolicyController {
  constructor(private readonly service: PolicyService) {}

  /** GET /policy/effective — the client calls this before it may capture anything. */
  @Get('effective')
  effective(@CurrentUser() user: SessionUser): Promise<EffectivePolicy> {
    return this.service.effective(user);
  }
}
