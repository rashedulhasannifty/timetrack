import { Module } from '@nestjs/common';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { loadEnv } from '@timetrack/config';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

const env = loadEnv();

@Module({
  imports: [
    JwtModule.register({
      secret: env.JWT_ACCESS_SECRET,
      // TTL comes from env as a string like '15m'; jsonwebtoken types want its own
      // StringValue union, so narrow it here at the single point of configuration.
      signOptions: { expiresIn: env.ACCESS_TOKEN_TTL as NonNullable<JwtSignOptions['expiresIn']> },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [JwtModule],
})
export class AuthModule {}
