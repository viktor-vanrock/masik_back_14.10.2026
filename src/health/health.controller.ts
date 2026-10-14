import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@/common/decorators/public.decorator';

import { HealthService } from './health.service';
import type { Response } from 'express';

@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness probe' })
  liveness() {
    return this.health.liveness();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'PostgreSQL and pgvector readiness with search index diagnostics',
  })
  async readiness(
    @Res({ passthrough: true }) response: Response
  ) {
    const report = await this.health.readiness();

    if ('down' === report.status) {
      response.status(503);
    }

    return report;
  }
}
