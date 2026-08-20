import { Module } from '@nestjs/common';
import { loadEnv } from '@timetrack/config';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { ProjectsRepository } from './projects.repository.js';
import { TRACKING_FRESHNESS_SECONDS } from './projects.tokens.js';

export { TRACKING_FRESHNESS_SECONDS };

@Module({
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    ProjectsRepository,
    { provide: TRACKING_FRESHNESS_SECONDS, useFactory: () => loadEnv().TRACKING_FRESHNESS_SECONDS },
  ],
  exports: [ProjectsService],
})
export class ProjectsModule {}
