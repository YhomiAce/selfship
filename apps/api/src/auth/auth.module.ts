import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GithubOAuthService } from './github-oauth.service';
import { AuthGuard } from './guards/auth.guard';
import { OriginGuard } from './guards/origin.guard';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

/**
 * Authentication. Registers two global guards (in this order):
 * the CSRF origin check, then session authentication.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    TokenService,
    GithubOAuthService,
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [SessionService],
})
export class AuthModule {}
