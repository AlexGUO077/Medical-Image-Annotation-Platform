import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.models';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.auth.login(body, request.ip ?? 'unknown');
  }

  @Post('password')
  @HttpCode(200)
  changePassword(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.auth.changePassword(authorization, body, request.ip ?? 'unknown');
  }

  @Post('2fa/setup')
  @HttpCode(200)
  setupMfa(@Headers('authorization') authorization: string | undefined) {
    return this.auth.setupMfa(authorization);
  }

  @Post('2fa/verify')
  @HttpCode(200)
  verifyMfa(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.auth.verifyMfa(authorization, body, request.ip ?? 'unknown');
  }
}
