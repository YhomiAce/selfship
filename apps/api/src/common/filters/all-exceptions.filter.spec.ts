import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter.toApiError', () => {
  const filter = new AllExceptionsFilter();

  it('maps zod validation errors to field errors', () => {
    const result = z.object({ email: z.email(), age: z.number() }).safeParse({ email: 'x' });
    const body = filter.toApiError(new ZodValidationException(result.error));

    expect(body.statusCode).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(body.fieldErrors ?? {})).toEqual(['email', 'age']);
  });

  it('keeps custom code and message from HttpException bodies', () => {
    const body = filter.toApiError(
      new ConflictException({ code: 'EMAIL_TAKEN', message: 'Email already in use.' }),
    );
    expect(body).toEqual({
      statusCode: 409,
      code: 'EMAIL_TAKEN',
      message: 'Email already in use.',
    });
  });

  it('derives the code from the status for plain HttpExceptions', () => {
    expect(filter.toApiError(new NotFoundException('Project not found')).code).toBe('NOT_FOUND');
  });

  it('maps throttling to RATE_LIMITED', () => {
    expect(filter.toApiError(new ThrottlerException()).statusCode).toBe(429);
  });

  it('hides details of unknown errors', () => {
    const body = filter.toApiError(new Error('db password is hunter2'));
    expect(body.statusCode).toBe(500);
    expect(body.message).not.toContain('hunter2');
  });
});

describe('AllExceptionsFilter edge cases', () => {
  const filter = new AllExceptionsFilter();

  it('handles HttpExceptions created with a null body', () => {
    const body = filter.toApiError(new HttpException(null as unknown as string, 418));
    expect(body.statusCode).toBe(418);
    expect(body.code).toBe('INTERNAL');
  });

  it('ignores bodies whose code/message are not strings', () => {
    const body = filter.toApiError(new BadRequestException({ code: 42, message: ['a', 'b'] }));
    expect(body.code).toBe('VALIDATION_FAILED');
  });
});
