import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller.js';
import { ClientsService } from './clients.service.js';
import { ClientsRepository } from './clients.repository.js';

// PrismaModule and LoggerModule are global. Exported so AuthModule can record the calling
// app's version on login/refresh.
@Module({
  controllers: [ClientsController],
  providers: [ClientsService, ClientsRepository],
  exports: [ClientsService],
})
export class ClientsModule {}
