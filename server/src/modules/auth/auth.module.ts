import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { requiredEnv } from '../../config/environment';
import { AccessTokenGuard } from './access-token.guard';
import { AdminGuard } from './admin.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { SecurityStateService } from './security-state.service';
import { TotpService } from './totp.service';
import { PermissionService } from './permission.service';

@Module({
  imports: [JwtModule.register({ secret: requiredEnv('JWT_SECRET') })],
  controllers: [AuthController],
  providers: [AuthService, AuthTokenService, TotpService, SecurityStateService, PermissionService, AccessTokenGuard, AdminGuard],
  exports: [AccessTokenGuard, AdminGuard, AuthTokenService, PermissionService],
})
export class AuthModule {}
