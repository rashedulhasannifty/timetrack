import { Module } from '@nestjs/common';
import { WorkTypesController } from './work-types.controller.js';
import { WorkTypesService } from './work-types.service.js';
import { WorkTypesRepository } from './work-types.repository.js';

/**
 * Exports the REPOSITORY, not the service: ProjectsRepository calls `reconcile` inside its own
 * transactions (project create, bulk import, team move), which a service boundary cannot offer.
 */
@Module({
  controllers: [WorkTypesController],
  providers: [WorkTypesService, WorkTypesRepository],
  exports: [WorkTypesRepository],
})
export class WorkTypesModule {}
