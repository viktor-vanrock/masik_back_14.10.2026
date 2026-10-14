import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CsrfExempt } from '@/common/decorators/csrf-exempt.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { InterviewerServiceTokenGuard } from './interviewer-service-token.guard';
import { ProductionJobsService } from './production-jobs.service';

@Public()
@CsrfExempt()
@UseGuards(InterviewerServiceTokenGuard)
@Controller('internal/v1/production-jobs')
export class ProductionJobsController {
  constructor(private readonly jobs: ProductionJobsService) {}

  @Post('claim')
  @HttpCode(200)
  claim() {
    return this.jobs.claim();
  }

  @Post(':id/heartbeat')
  @HttpCode(200)
  heartbeat(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.jobs.heartbeat(id, body);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.jobs.complete(id, body);
  }
}
