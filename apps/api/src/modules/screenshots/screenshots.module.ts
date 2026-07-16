import { Module } from '@nestjs/common';
import { StorageModule } from '../../infra/storage/storage.module.js';
import { ScreenshotsController } from './screenshots.controller.js';
import { ScreenshotsService } from './screenshots.service.js';
import { ScreenshotsRepository } from './screenshots.repository.js';

// StorageModule (MinioService) + the @Global QueueModule back the upload/derive pipeline.
@Module({
  imports: [StorageModule],
  controllers: [ScreenshotsController],
  providers: [ScreenshotsService, ScreenshotsRepository],
  exports: [ScreenshotsService],
})
export class ScreenshotsModule {}
