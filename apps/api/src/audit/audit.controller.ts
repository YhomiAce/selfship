import { Controller, Get, Query } from '@nestjs/common';
import type { User } from '@selfship/db';
import type { AuditEventListResponse } from '@selfship/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { queryString } from '../common/http';
import { AuditService } from './audit.service';

/** The signed-in user's activity log. */
@Controller('audit-events')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /**
   * Recent security-relevant events on the account.
   *
   * @param before - Cursor from the previous page
   * @returns Events, newest first
   */
  @Get()
  list(
    @CurrentUser() user: User,
    @Query('before') before: unknown,
  ): Promise<AuditEventListResponse> {
    const cursor = queryString(before);
    return this.audit.list(user.id, cursor && /^[0-9a-f-]{36}$/.test(cursor) ? cursor : undefined);
  }
}
