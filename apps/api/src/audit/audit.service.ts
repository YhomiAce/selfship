import { Injectable, Logger } from '@nestjs/common';
import type { AuditEvent, Prisma } from '@selfship/db';
import {
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditEventDto,
  type AuditEventListResponse,
} from '@selfship/shared';
import { currentRequestInfo } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

/** What an event was about. */
export interface AuditTarget {
  type: string;
  id: string;
  name?: string;
}

/** Events per page in the activity list. */
const PAGE_SIZE = 50;

/**
 * The audit log: security-relevant actions on a user's account, with the IP
 * address and browser they came from. Recording never fails the action
 * itself (a lost audit entry is logged instead).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records an event for an account.
   *
   * @param userId - Account the event belongs to
   * @param action - What happened
   * @param target - What it was about (server, project, variable…)
   * @param metadata - Extra details; never put secrets here
   */
  async record(
    userId: string,
    action: AuditAction,
    target?: AuditTarget,
    metadata: Record<string, string> = {},
  ): Promise<void> {
    const { ipAddress, userAgent } = currentRequestInfo();
    try {
      await this.prisma.auditEvent.create({
        data: {
          userId,
          action,
          targetType: target?.type ?? null,
          targetId: target?.id ?? null,
          targetName: target?.name ?? null,
          metadata,
          ipAddress,
          userAgent,
        },
      });
    } catch (error) {
      this.logger.error(`Could not record audit event ${action} for ${userId}: ${String(error)}`);
    }
  }

  /**
   * The account's events, newest first.
   *
   * @param userId - Signed-in user
   * @param before - Cursor (an event ID) to continue after
   * @returns One page and the cursor for the next
   */
  async list(userId: string, before?: string): Promise<AuditEventListResponse> {
    const cursor = before
      ? await this.prisma.auditEvent.findFirst({
          where: { id: before, userId },
          select: { createdAt: true, id: true },
        })
      : null;
    const where: Prisma.AuditEventWhereInput = cursor
      ? {
          userId,
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }
      : { userId };
    const events = await this.prisma.auditEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
    });
    const page = events.slice(0, PAGE_SIZE);
    return {
      items: page.map(toAuditEventDto),
      nextCursor: events.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
    };
  }
}

/** Public shape of an event (unknown actions are kept as-is, metadata as strings). */
function toAuditEventDto(event: AuditEvent): AuditEventDto {
  const metadata: Record<string, string> = {};
  if (event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)) {
    for (const [key, value] of Object.entries(event.metadata)) {
      if (typeof value === 'string') metadata[key] = value;
    }
  }
  return {
    id: event.id,
    action: (AUDIT_ACTIONS as readonly string[]).includes(event.action)
      ? (event.action as AuditAction)
      : 'auth.login',
    targetType: event.targetType,
    targetId: event.targetId,
    targetName: event.targetName,
    metadata,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
    createdAt: event.createdAt.toISOString(),
  };
}
