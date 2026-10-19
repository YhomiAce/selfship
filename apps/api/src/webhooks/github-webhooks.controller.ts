import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  type RawBodyRequest,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  InstallationEventSchema,
  InstallationRepositoriesEventSchema,
  PushEventSchema,
  verifyWebhookSignature,
} from '@selfship/github';
import { ErrorCode, GithubErrorCode } from '@selfship/shared';
import { Public } from '../auth/decorators/public.decorator';
import { AppConfigService } from '../config/app-config.service';
import { AutoDeployService } from '../deployments/auto-deploy.service';
import { GithubInstallationsService } from '../github/github-installations.service';

/** Acknowledgement returned to GitHub. */
export interface WebhookAck {
  received: true;
  /** For pushes: how many deployments were queued. */
  deployments?: number;
  /** What we did with it, for debugging in GitHub's delivery log. */
  handled:
    'installation' | 'installation_repositories' | 'push' | 'ping' | 'ignored' | 'invalid_payload';
}

/**
 * Receives GitHub App webhooks. Every delivery must carry a valid
 * `X-Hub-Signature-256`; anything else is rejected before parsing.
 *
 * Public (GitHub has no session) and not rate-limited (bursts are normal).
 */
@Public()
@SkipThrottle()
@Controller('webhooks')
export class GithubWebhooksController {
  private readonly logger = new Logger(GithubWebhooksController.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly installations: GithubInstallationsService,
    private readonly autoDeploy: AutoDeployService,
  ) {}

  /**
   * Handles one webhook delivery.
   *
   * @param req - Request with the raw body (needed for the signature)
   * @param event - `X-GitHub-Event` header
   * @param signature - `X-Hub-Signature-256` header
   * @param delivery - `X-GitHub-Delivery` header (for logs)
   * @returns Acknowledgement
   * @throws {ServiceUnavailableException} If no webhook secret is configured
   * @throws {UnauthorizedException} If the signature is missing or wrong
   */
  @Post('github')
  @HttpCode(HttpStatus.ACCEPTED)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-github-event') event: string | undefined,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-delivery') delivery: string | undefined,
  ): Promise<WebhookAck> {
    const secret = this.config.get('GITHUB_WEBHOOK_SECRET');
    if (!secret) {
      throw new ServiceUnavailableException({
        code: GithubErrorCode.GITHUB_NOT_CONFIGURED,
        message: 'GitHub webhooks are not configured.',
      });
    }
    if (!req.rawBody || !verifyWebhookSignature(secret, req.rawBody, signature)) {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Invalid webhook signature.',
      });
    }

    const body: unknown = req.body;
    const label = `${event ?? 'unknown'} (${delivery ?? 'no delivery id'})`;

    switch (event) {
      case 'ping':
        return { received: true, handled: 'ping' };

      case 'installation': {
        const parsed = InstallationEventSchema.safeParse(body);
        if (!parsed.success) return this.invalid(label);
        await this.installations.applyInstallationEvent(parsed.data);
        this.logger.log(`Installation ${parsed.data.installation.id} ${parsed.data.action}`);
        return { received: true, handled: 'installation' };
      }

      case 'installation_repositories': {
        const parsed = InstallationRepositoriesEventSchema.safeParse(body);
        if (!parsed.success) return this.invalid(label);
        await this.installations.applyRepositoriesEvent(parsed.data);
        return { received: true, handled: 'installation_repositories' };
      }

      case 'push': {
        const parsed = PushEventSchema.safeParse(body);
        if (!parsed.success) return this.invalid(label);
        const result = await this.autoDeploy.handlePush(parsed.data);
        return { received: true, handled: 'push', deployments: result.queued };
      }

      default:
        return { received: true, handled: 'ignored' };
    }
  }

  /**
   * Acknowledges a signed but unexpected payload. Returning 2xx stops GitHub
   * from retrying something that will never parse; the log keeps a trace.
   */
  private invalid(label: string): WebhookAck {
    this.logger.warn(`Ignoring malformed webhook payload: ${label}`);
    return { received: true, handled: 'invalid_payload' };
  }
}
