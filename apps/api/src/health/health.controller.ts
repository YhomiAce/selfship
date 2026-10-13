import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { HealthResponse } from '@platform/shared';
import { HealthService } from './health.service';

/** Liveness/readiness endpoint for load balancers and uptime monitors. */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Reports dependency health.
   *
   * @returns 200 when all dependencies are up, 503 when degraded
   */
  @Get()
  async get(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const result = await this.health.check();
    res.status(result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
