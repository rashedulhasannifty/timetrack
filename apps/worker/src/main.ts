import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { loadEnv } from '@timetrack/config';
import { WorkerModule } from './worker.module.js';

/**
 * PRD §7.1.3 — the worker runs as a headless Nest application context (no HTTP server).
 * BullMQ workers start with the module; this process just stays alive to consume jobs.
 */
async function bootstrap(): Promise<void> {
  loadEnv(); // fail fast — invalid env never reaches a running processor

  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();
  logger.log('worker started — consuming queues');
}

void bootstrap();
