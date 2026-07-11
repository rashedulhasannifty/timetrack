import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

// PrismaService is provided by the global PrismaModule (PRD §8 readiness ping).
@Module({ controllers: [HealthController] })
export class HealthModule {}
