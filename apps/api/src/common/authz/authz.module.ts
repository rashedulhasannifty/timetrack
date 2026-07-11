import { Global, Module } from '@nestjs/common';
import { MembershipRepository } from './membership.repository.js';
import { ResourceAccessService } from './resource-access.service.js';

/** Global so the ResourceGuard (APP_GUARD) and any service can resolve access. */
@Global()
@Module({
  providers: [MembershipRepository, ResourceAccessService],
  exports: [MembershipRepository, ResourceAccessService],
})
export class AuthzModule {}
