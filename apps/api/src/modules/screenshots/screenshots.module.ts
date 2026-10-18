import { Module } from '@nestjs/common';
import { StorageModule } from '../../infra/storage/storage.module.js';
import { PartitionsModule } from '../../common/partitions/partitions.module.js';
import { ScreenshotsController } from './screenshots.controller.js';
import { ScreenshotsService } from './screenshots.service.js';
import { ScreenshotsRepository } from './screenshots.repository.js';

// StorageModule (MinioService) + the @Global QueueModule back the upload/derive pipeline;
// PartitionsModule range-checks the timestamp before anything is streamed.
@Module({
  imports: [StorageModule, PartitionsModule],
  controllers: [ScreenshotsController],
  providers: [ScreenshotsService, ScreenshotsRepository],
  exports: [ScreenshotsService],
})
export class ScreenshotsModule {}
