import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { Logger } from 'nestjs-pino';
import { loadEnv } from '@timetrack/config';
import { AppModule } from './app.module.js';
import { ProblemJsonFilter } from './common/filters/problem-json.filter.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv(); // fail fast — invalid env never reaches runtime

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 10 * 1024 * 1024 }),
    { bufferLogs: true },
  );

  const logger = app.get(Logger);
  app.useLogger(logger);
  app.useGlobalFilters(new ProblemJsonFilter(logger));

  // Security headers (HSTS, nosniff, frame-deny, referrer policy, ...). CSP is off
  // by default here — this API serves JSON, and the dashboard sets its own CSP.
  await app.register(helmet, { contentSecurityPolicy: false });

  // Strict CORS: only the configured dashboard origin(s) may call the API, and only
  // then are credentials allowed. Never '*' with credentials.
  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });

  // Screenshot uploads are multipart/form-data streamed straight to storage (PRD §7.4).
  // One file, 10 MB cap; the screenshots controller enforces the image/* mimetype.
  await app.register(multipart, { limits: { files: 1, fileSize: 10 * 1024 * 1024 } });

  // API versioning from day one — a shipped Mac client pins /v1 and cannot be rolled
  // back, so every route is /v1/* and we add /v2 later without breaking clients.
  // Health probes are VERSION_NEUTRAL (see HealthController) so infra hits /health.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  logger.log(`api listening on :${env.API_PORT} (routes under /v1)`);
}

void bootstrap();
