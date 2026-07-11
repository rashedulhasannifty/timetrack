import { Body, Controller, HttpCode, Post, UsePipes } from '@nestjs/common';
import {
  LoginSchema,
  RefreshSchema,
  type Login,
  type Refresh,
  type TokenPair,
} from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { AuthService } from './auth.service.js';

/**
 * PRD §6.8 — email/password at launch. All three routes are @Public (they mint the
 * session that everything else requires). SSO (SAML/OIDC) is Phase 4.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(LoginSchema))
  login(@Body() dto: Login): Promise<TokenPair> {
    return this.service.login(dto);
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(RefreshSchema))
  refresh(@Body() dto: Refresh): Promise<TokenPair> {
    return this.service.refresh(dto);
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  @UsePipes(new ZodValidationPipe(RefreshSchema))
  logout(@Body() dto: Refresh): Promise<void> {
    return this.service.logout(dto);
  }
}
