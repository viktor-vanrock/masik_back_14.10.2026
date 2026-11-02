import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CsrfExempt } from '@/common/decorators/csrf-exempt.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { BenchmarkJobsService } from './benchmark-jobs.service';
import { InterviewerServiceTokenGuard } from './interviewer-service-token.guard';

@Public()
@CsrfExempt()
@UseGuards(InterviewerServiceTokenGuard)
@Controller('internal/v1/benchmark-jobs')
export class BenchmarkJobsController {
  constructor(private readonly jobs: BenchmarkJobsService) {}

  @Post()
  create(@Body() body: unknown) {
    return this.jobs.accept(body);
  }

  @Post('claim')
  @HttpCode(200)
  claim() {
    return this.jobs.claim();
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.jobs.get(id);
  }

  @Get('session/:sessionId')
  getBySession(@Param('sessionId', new ParseUUIDPipe()) sessionId: string) {
    return this.jobs.getBySession(sessionId);
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

  @Post(':id/fail')
  @HttpCode(200)
  fail(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.jobs.fail(id, body);
  }
}
