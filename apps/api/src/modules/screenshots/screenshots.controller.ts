import { Body, Controller, Get, Param, Post, Query, UsePipes } from '@nestjs/common';
import {
  ListScreenshotsQuerySchema,
  RedactScreenshotSchema,
  type ListScreenshotsQuery,
  type RedactScreenshot,
  type Screenshot,
} from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ScreenshotsService } from './screenshots.service.js';

@Controller('screenshots')
export class ScreenshotsController {
  constructor(private readonly service: ScreenshotsService) {}

  @Get()
  @UsePipes(new ZodValidationPipe(ListScreenshotsQuerySchema))
  list(
    @Query() query: ListScreenshotsQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<Screenshot[]> {
    return this.service.list(query, user);
  }

  /** PRD §7.4 — multipart, streamed to MinIO. Body parsing is wired when implemented. */
  @Post()
  upload(): Promise<Screenshot> {
    return this.service.upload();
  }

  @Post(':id/redact')
  redact(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RedactScreenshotSchema)) dto: RedactScreenshot,
    @CurrentUser() user: SessionUser,
  ): Promise<Screenshot> {
    return this.service.redact(id, dto, user);
  }
}
