import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { type ApiError, ErrorCode } from '@selfship/shared';

/** Maps HTTP status codes to default machine-readable error codes. */
const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
};

/**
 * Error body thrown by services to control the code/message precisely:
 * `throw new ConflictException({ code: 'EMAIL_TAKEN', message: '...' })`.
 * Optional `fieldErrors` attach messages to form fields.
 */
interface CustomErrorBody {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Converts every thrown error into the shared {@link ApiError} shape.
 *
 * - Validation errors include per-field messages
 * - Known HTTP errors keep their status and message
 * - Unknown errors become a generic 500, and the details are only logged
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /**
   * Builds and sends the error response.
   *
   * @param exception - Whatever was thrown
   * @param host - Nest execution context (HTTP)
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const body = this.toApiError(exception);

    // If a response was already partly sent (e.g. a stream failed midway),
    // we can't send a JSON error anymore; just log and end it.
    if (response.headersSent) {
      this.logger.error({ err: exception }, 'Error after response headers were sent');
      response.end();
      return;
    }
    // Set by pino-http; absent if the logger middleware didn't run.
    const reqId = (request as { id?: unknown }).id;
    if (typeof reqId === 'string' || typeof reqId === 'number') body.requestId = String(reqId);

    if (body.statusCode >= 500) {
      this.logger.error(
        { err: exception, requestId: body.requestId },
        `Unhandled error on ${request.method} ${request.url}`,
      );
    }

    response.status(body.statusCode).json(body);
  }

  /**
   * Maps an exception to the API error body (without request ID).
   *
   * @param exception - Whatever was thrown
   * @returns The response body to send
   */
  toApiError(exception: unknown): ApiError {
    if (exception instanceof ZodValidationException) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Some fields are invalid.',
        fieldErrors: this.toFieldErrors(exception.getZodError()),
      };
    }

    if (exception instanceof ThrottlerException) {
      return {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: ErrorCode.RATE_LIMITED,
        message: 'Too many requests. Please wait a moment and try again.',
      };
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const payload = exception.getResponse();
      const custom = this.asCustomBody(payload);
      return {
        statusCode,
        code: custom?.code ?? STATUS_TO_CODE[statusCode] ?? ErrorCode.INTERNAL,
        message: custom?.message ?? exception.message,
        ...(custom?.fieldErrors ? { fieldErrors: custom.fieldErrors } : {}),
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL,
      message: 'Something went wrong on our side. Please try again.',
    };
  }

  /** Groups zod issues by dotted field path. */
  private toFieldErrors(error: unknown): Record<string, string[]> {
    if (!(error instanceof ZodError)) return {};
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return fieldErrors;
  }

  /** Detects `{ code, message }` bodies passed to HttpException constructors. */
  private asCustomBody(payload: unknown): CustomErrorBody | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const candidate = payload as Record<string, unknown>;
    if (typeof candidate.code !== 'string' || typeof candidate.message !== 'string') return null;
    const fieldErrors = this.asFieldErrors(candidate.fieldErrors);
    return {
      code: candidate.code,
      message: candidate.message,
      ...(fieldErrors ? { fieldErrors } : {}),
    };
  }

  /** Accepts `{ field: string[] }` objects only; anything else is dropped. */
  private asFieldErrors(value: unknown): Record<string, string[]> | null {
    if (typeof value !== 'object' || value === null) return null;
    const entries = Object.entries(value).filter(
      (entry): entry is [string, string[]] =>
        Array.isArray(entry[1]) && entry[1].every((message) => typeof message === 'string'),
    );
    return entries.length > 0 ? Object.fromEntries(entries) : null;
  }
}
