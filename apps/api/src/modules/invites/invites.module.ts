import { Module } from '@nestjs/common';
import { InvitesService } from './invites.service.js';
import { InvitesRepository } from './invites.repository.js';

// PrismaModule and QueueModule are @Global, so InvitesService/Repository get
// PrismaService and QueueService without importing anything here.
@Module({
  providers: [InvitesService, InvitesRepository],
  exports: [InvitesService],
})
export class InvitesModule {}
