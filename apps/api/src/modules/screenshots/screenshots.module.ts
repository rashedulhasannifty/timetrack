import { Module } from '@nestjs/common';
import { ScreenshotsController } from './screenshots.controller.js';
import { ScreenshotsService } from './screenshots.service.js';
import { ScreenshotsRepository } from './screenshots.repository.js';

// When upload is implemented, import StorageModule (MinioService) and QueueModule here.
@Module({
  controllers: [ScreenshotsController],
  providers: [ScreenshotsService, ScreenshotsRepository],
  exports: [ScreenshotsService],
})
export class ScreenshotsModule {}
