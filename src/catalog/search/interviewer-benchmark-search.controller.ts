import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';
import { CsrfExempt } from '@/common/decorators/csrf-exempt.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { InterviewerServiceTokenGuard } from '@/generation/interviewer-service-token.guard';
import { BenchmarkSearchService } from './benchmark-search.service';

class InterviewerBenchmarkSearchDto {
  @Transform(({ value }) => 'string' === typeof value ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  query!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  top_k!: number;
}

@Public()
@CsrfExempt()
@UseGuards(InterviewerServiceTokenGuard)
@Controller('internal/v1/interviewer/benchmark-tests')
export class InterviewerBenchmarkSearchController {
  constructor(private readonly search: BenchmarkSearchService) {}

  @Post('search')
  searchTests(@Body() body: InterviewerBenchmarkSearchDto) {
    return this.search.searchForLegacyInterviewer(body.query, body.top_k);
  }

  @Post('search-agent')
  searchForAgent(@Body() body: InterviewerBenchmarkSearchDto) {
    return this.search.searchForInterviewerAgent(body.query, body.top_k);
  }
}
