import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/currentUser.decorator';
import { BenchmarkJobsService } from './benchmark-jobs.service';
import type { RequestUser } from '@/common/types/request.type';

@Controller('conversations/:id/generation')
export class GenerationController {
  constructor(private readonly jobs: BenchmarkJobsService) {}

  @Get()
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: RequestUser) {
    return this.jobs.getForOwner(id, user.id);
  }

  @Post('retry')
  @HttpCode(200)
  retry(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: RequestUser) {
    return this.jobs.retryForOwner(id, user.id);
  }

  @Post(':jobId/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('jobId', new ParseUUIDPipe()) jobId: string,
    @CurrentUser() user: RequestUser
  ) {
    return this.jobs.cancelForOwner(id, user.id, jobId);
  }
}
