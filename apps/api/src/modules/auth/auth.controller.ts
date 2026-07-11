import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  AcceptInviteSchema,
  LoginSchema,
  RefreshSchema,
  type AcceptInvite,
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
 * The Zod pipe is scoped to the @Body param, not method-level @UsePipes.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(LoginSchema)) dto: Login): Promise<TokenPair> {
    return this.service.login(dto);
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  refresh(@Body(new ZodValidationPipe(RefreshSchema)) dto: Refresh): Promise<TokenPair> {
    return this.service.refresh(dto);
  }

  @Post('accept-invite')
  @Public()
  @HttpCode(200)
  acceptInvite(
    @Body(new ZodValidationPipe(AcceptInviteSchema)) dto: AcceptInvite,
  ): Promise<TokenPair> {
    return this.service.acceptInvite(dto);
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  logout(@Body(new ZodValidationPipe(RefreshSchema)) dto: Refresh): Promise<void> {
    return this.service.logout(dto);
  }
}
