import { createZodDto } from 'nestjs-zod';
import {
  ForgotPasswordSchema,
  LoginSchema,
  RegisterSchema,
  ResetPasswordSchema,
  VerifyEmailSchema,
} from '@selfship/shared';

/** Body of `POST /auth/register`. */
export class RegisterDto extends createZodDto(RegisterSchema) {}

/** Body of `POST /auth/login`. */
export class LoginDto extends createZodDto(LoginSchema) {}

/** Body of `POST /auth/verify-email`. */
export class VerifyEmailDto extends createZodDto(VerifyEmailSchema) {}

/** Body of `POST /auth/forgot-password`. */
export class ForgotPasswordDto extends createZodDto(ForgotPasswordSchema) {}

/** Body of `POST /auth/reset-password`. */
export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}
