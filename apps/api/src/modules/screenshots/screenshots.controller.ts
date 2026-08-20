import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  ListScreenshotsQuerySchema,
  RedactScreenshotSchema,
  UploadScreenshotMetaSchema,
  type ListScreenshotsQuery,
  type RedactScreenshot,
  type Screenshot,
  type UploadScreenshotMeta,
} from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ResourceScope } from '../../common/decorators/resource-scope.decorator.js';
import { ScreenshotsService } from './screenshots.service.js';

@Controller('screenshots')
export class ScreenshotsController {
  private readonly metaPipe = new ZodValidationPipe(UploadScreenshotMetaSchema);

  constructor(private readonly service: ScreenshotsService) {}

  @Get()
  @ResourceScope({ source: 'query', key: 'userId' })
  list(
    @Query(new ZodValidationPipe(ListScreenshotsQuerySchema)) query: ListScreenshotsQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<Screenshot[]> {
    return this.service.list(query, user);
  }

  /** PRD §7.4 — multipart image streamed to storage. Owner is the session, never a field. */
  @Post()
  async upload(@Req() req: FastifyRequest, @CurrentUser() user: SessionUser): Promise<Screenshot> {
    const part = await req.file();
    if (!part) throw new BadRequestException('a file part is required');
    if (part.mimetype !== 'image/png' && part.mimetype !== 'image/jpeg') {
      throw new UnsupportedMediaTypeException('only image/png or image/jpeg is accepted');
    }
    // Text fields MUST precede the file part in the body (see spec §5 client contract) —
    // req.file() only exposes fields parsed before the file.
    // Named fields are picked out one by one rather than passing the whole form through: the
    // pipe parses bodies strictly, and a client that adds a field before the API knows about it
    // would otherwise 422 on every upload. Unknown fields are ignored instead.
    const field = (name: string): string | undefined =>
      (part.fields[name] as { value?: string } | undefined)?.value;
    const meta = this.metaPipe.transform(
      {
        id: field('id'),
        timestamp: field('timestamp'),
        // Multi-display grouping. Absent from any client older than multi-display capture, and
        // optional in the schema for exactly that reason.
        captureGroupId: field('captureGroupId'),
        displayIndex: field('displayIndex'),
        displayCount: field('displayCount'),
      },
      { type: 'body' },
    ) as UploadScreenshotMeta;
    const shot = await this.service.upload(part.file, meta, user);
    // @fastify/multipart flags a mid-stream cutoff at the 10 MB limit; don't keep a half-object.
    if (part.file.truncated) {
      await this.service.deleteForTruncatedUpload(meta, user);
      throw new PayloadTooLargeException('screenshot exceeds the 10MB limit');
    }
    return shot;
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
