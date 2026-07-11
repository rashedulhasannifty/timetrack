import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
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

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  logger.log(`api listening on :${env.API_PORT}`);
}

void bootstrap();
